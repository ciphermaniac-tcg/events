//! Inside mode: TOM is started by this app with the helper jar loaded into its
//! JVM, and we talk to the helper over loopback.
//!
//! The helper is injected only through the `JAVA_TOOL_OPTIONS` of the TOM we
//! start, and only after the jar is confirmed present: a missing or broken
//! assistive technology stops TOM from starting.

use std::ffi::OsString;
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::net::{Ipv4Addr, SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::time::Duration;

use serde::Deserialize;
use serde::de::DeserializeOwned;
use serde_json::json;

use crate::code::Entry;
use crate::results::{PodStatus, SaveResult, StartResult, SubmitResult, TomView};

const PROVIDER: &str = "cmevents-tombridge";
const DIR_PROPERTY: &str = "cmevents.tombridge.dir";
const TOKEN_FILE: &str = "token";
const JAVA_TOOL_OPTIONS: &str = "JAVA_TOOL_OPTIONS";
const CONNECT_TIMEOUT: Duration = Duration::from_secs(2);
const WRITE_TIMEOUT: Duration = Duration::from_secs(5);
/// Longer than the helper's worst case: opening the form, then one code.
const READ_TIMEOUT: Duration = Duration::from_secs(20);

/// TOM started by this app.
pub(crate) struct Tom {
    process: Process,
    helper: Option<Helper>,
}

/// How TOM's process is followed.
enum Process {
    /// Started as our child process.
    Child(Child),
    /// Started by macOS `LaunchServices`: not our child, so followed by pid and
    /// the program that pid runs.
    #[cfg(target_os = "macos")]
    App { pid: u32, program: PathBuf },
}

impl Process {
    fn running(&mut self) -> bool {
        match self {
            Self::Child(child) => matches!(child.try_wait(), Ok(None)),
            #[cfg(target_os = "macos")]
            Self::App { pid, program } => crate::macos_app::alive(*pid, program),
        }
    }
}

/// The helper and the `JAVA_TOOL_OPTIONS` that load it, when `jar` is a
/// non-empty file; otherwise TOM starts plain.
fn prepare(jar: &Path) -> Result<Option<(Helper, OsString)>, String> {
    if !fs::metadata(jar).is_ok_and(|meta| meta.is_file() && meta.len() > 0) {
        return Ok(None);
    }
    let helper = Helper::create()?;
    let options = helper.tool_options(jar, std::env::var_os(JAVA_TOOL_OPTIONS))?;
    Ok(Some((helper, options)))
}

impl Tom {
    /// Starts TOM as a child process, with the helper when the jar is there.
    pub(crate) fn spawn(mut command: Command, jar: &Path) -> Result<Self, String> {
        let prepared = prepare(jar)?;
        if let Some((_, options)) = &prepared {
            command.env(JAVA_TOOL_OPTIONS, options);
        }
        let child = command
            .spawn()
            .map_err(|error| format!("TOM could not be started: {error}"))?;
        Ok(Self {
            process: Process::Child(child),
            helper: prepared.map(|(helper, _)| helper),
        })
    }

    /// Starts the `.app` through `LaunchServices` so TOM keeps its own Dock icon
    /// and identity; `program` is the launcher inside it, for liveness checks.
    #[cfg(target_os = "macos")]
    pub(crate) fn open_app(app: &Path, program: &Path, jar: &Path) -> Result<Self, String> {
        let prepared = prepare(jar)?;
        let environment: Vec<(&str, &std::ffi::OsStr)> = prepared
            .iter()
            .map(|(_, options)| (JAVA_TOOL_OPTIONS, options.as_os_str()))
            .collect();
        let pid = crate::macos_app::open(app, &environment)?;
        Ok(Self {
            process: Process::App {
                pid,
                program: program.to_path_buf(),
            },
            helper: prepared.map(|(helper, _)| helper),
        })
    }

    pub(crate) fn running(&mut self) -> bool {
        self.process.running()
    }

    pub(crate) fn view(&mut self) -> TomView {
        match self.request::<HelperStatus>("status", &[]) {
            Ok(status) => status.into_view(),
            Err(failure) => TomView::unavailable(failure.reason()),
        }
    }

    /// `tournament`: the name TOM must have open; the helper refuses another.
    pub(crate) fn submit(&mut self, entry: &Entry, tournament: Option<&str>) -> SubmitResult {
        let code = entry.code.as_str();
        let mut fields = vec![
            ("code", code.to_owned()),
            ("pod", entry.pod.to_string()),
            ("round", entry.round.to_string()),
        ];
        fields.extend(tournament.map(|name| ("tournament", name.to_owned())));
        match self.outcome("submit", &fields) {
            Outcome::Accepted => SubmitResult::accepted(code),
            Outcome::Rejected { message } => SubmitResult::rejected(code, message),
            Outcome::Uncertain { reason } => SubmitResult::uncertain(code, reason),
            other => SubmitResult::not_ready(code, other.reason()),
        }
    }

    /// Ends a batch: the helper closes the slip form if it opened it and puts
    /// back what it changed. Best effort; the helper also does this by itself
    /// shortly after the last code.
    pub(crate) fn finish(&mut self) {
        let _ = self.request::<Outcome>("finish", &[]);
    }

    pub(crate) fn save(&mut self) -> SaveResult {
        match self.outcome("save", &[]) {
            Outcome::Saved => SaveResult::Saved,
            other => SaveResult::not_ready(other.reason()),
        }
    }

    pub(crate) fn start_round(
        &mut self,
        category: Option<u8>,
        tournament: Option<&str>,
    ) -> StartResult {
        let mut fields: Vec<_> = category
            .map(|category| ("category", category.to_string()))
            .into_iter()
            .collect();
        fields.extend(tournament.map(|name| ("tournament", name.to_owned())));
        match self.outcome("start_round", &fields) {
            Outcome::Started => StartResult::Started,
            Outcome::AlreadyStarted => StartResult::AlreadyStarted,
            other => StartResult::not_ready(other.reason()),
        }
    }

    /// The helper's answer. A request that never reached it is `NotReady`; one
    /// that did but got no answer may have run, so it is `Uncertain`.
    fn outcome(&mut self, op: &str, fields: &[(&str, String)]) -> Outcome {
        self.request(op, fields)
            .unwrap_or_else(|failure| match failure {
                Failure::Unsent(reason) => Outcome::NotReady { reason },
                Failure::Unanswered(reason) => Outcome::Uncertain { reason },
            })
    }

    fn request<T: DeserializeOwned>(
        &mut self,
        op: &str,
        fields: &[(&str, String)],
    ) -> Result<T, Failure> {
        if !self.running() {
            return Err(Failure::Unsent(
                "TOM has closed. Launch it again from here.".into(),
            ));
        }
        let helper = self.helper.as_ref().ok_or_else(|| {
            Failure::Unsent(
                "TOM was started without its helper, so inside mode cannot reach it. Restart TOM from here."
                    .into(),
            )
        })?;
        helper.request(op, fields)
    }
}

/// Why a request got no usable answer.
#[derive(Debug, PartialEq, Eq)]
enum Failure {
    /// It never reached the helper, or the helper refused it unread.
    Unsent(String),
    /// It reached the helper, which may have acted on it.
    Unanswered(String),
}

impl Failure {
    fn reason(self) -> String {
        match self {
            Self::Unsent(reason) | Self::Unanswered(reason) => reason,
        }
    }
}

/// The helper's side of one TOM run: secret and handshake file. Each request
/// gets its own connection; the helper serves one request per connection.
struct Helper {
    token: String,
    dir: PathBuf,
}

impl Helper {
    fn create() -> Result<Self, String> {
        let dir = std::env::temp_dir().join(format!("cmevents-tom-{}", crate::random_hex(8)));
        let token = crate::random_hex(32);
        private_dir(&dir)
            .and_then(|()| private_file(&dir.join(TOKEN_FILE), &token))
            .map_err(|error| format!("Could not prepare TOM's helper: {error}"))?;
        Ok(Self { token, dir })
    }

    fn handshake(&self) -> PathBuf {
        self.dir.join("handshake.json")
    }

    /// The JVM options that load the helper. Quoted so paths may hold spaces.
    /// They name only the private folder: the JVM prints these options to
    /// TOM's log, so the token stays in the folder's token file.
    fn tool_options(&self, jar: &Path, existing: Option<OsString>) -> Result<OsString, String> {
        let jar = quotable(jar)?;
        let dir = quotable(&self.dir)?;
        let mut options = OsString::from(format!(
            "\"-Xbootclasspath/a:{jar}\" -Djavax.accessibility.assistive_technologies={PROVIDER} \
             \"-D{DIR_PROPERTY}={dir}\""
        ));
        if let Some(existing) = existing.filter(|existing| !existing.is_empty()) {
            options.push(" ");
            options.push(existing);
        }
        Ok(options)
    }

    fn request<T: DeserializeOwned>(
        &self,
        op: &str,
        fields: &[(&str, String)],
    ) -> Result<T, Failure> {
        // The helper reads string values only, so a missing field is left out rather than null.
        let mut request = json!({ "token": self.token, "op": op });
        for (key, value) in fields {
            request[*key] = value.as_str().into();
        }
        let line = format!("{request}\n");
        let reply = self.exchange(&line)?;
        parse_reply(&reply)
    }

    fn exchange(&self, line: &str) -> Result<String, Failure> {
        let mut stream = self.open().map_err(Failure::Unsent)?;
        let lost = |error: std::io::Error| format!("Lost the connection to TOM's helper: {error}");
        stream
            .write_all(line.as_bytes())
            .map_err(|error| Failure::Unsent(lost(error)))?;
        let mut reply = String::new();
        match BufReader::new(stream).read_line(&mut reply) {
            Ok(0) => Err(Failure::Unanswered(
                "TOM's helper closed the connection.".into(),
            )),
            Ok(_) => Ok(reply),
            Err(error) => Err(Failure::Unanswered(lost(error))),
        }
    }

    fn open(&self) -> Result<TcpStream, String> {
        let port = read_port(&self.handshake()).ok_or("TOM is still starting.")?;
        let address = SocketAddr::from((Ipv4Addr::LOCALHOST, port));
        let unreachable = |error: std::io::Error| format!("Could not reach TOM's helper: {error}");
        let stream = TcpStream::connect_timeout(&address, CONNECT_TIMEOUT).map_err(unreachable)?;
        stream
            .set_read_timeout(Some(READ_TIMEOUT))
            .map_err(unreachable)?;
        stream
            .set_write_timeout(Some(WRITE_TIMEOUT))
            .map_err(unreachable)?;
        stream.set_nodelay(true).map_err(unreachable)?;
        Ok(stream)
    }
}

impl Drop for Helper {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.dir);
    }
}

#[cfg(unix)]
fn private_dir(dir: &Path) -> std::io::Result<()> {
    use std::os::unix::fs::DirBuilderExt;
    fs::DirBuilder::new().mode(0o700).create(dir)
}

/// The per-user temp folder is already private on Windows.
#[cfg(not(unix))]
fn private_dir(dir: &Path) -> std::io::Result<()> {
    fs::create_dir(dir)
}

/// A new file only this user can read.
fn private_file(path: &Path, contents: &str) -> std::io::Result<()> {
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
    options.open(path)?.write_all(contents.as_bytes())
}

fn quotable(path: &Path) -> Result<&str, String> {
    path.to_str()
        .filter(|text| !text.contains('"'))
        .ok_or_else(|| format!("TOM's helper cannot be loaded from {}.", path.display()))
}

fn read_port(handshake: &Path) -> Option<u16> {
    #[derive(Deserialize)]
    struct Handshake {
        port: u16,
    }
    let text = fs::read_to_string(handshake).ok()?;
    serde_json::from_str::<Handshake>(&text)
        .ok()
        .map(|h| h.port)
}

#[derive(Deserialize)]
#[serde(untagged)]
enum Reply<T> {
    Failed { error: String },
    Done(T),
}

fn parse_reply<T: DeserializeOwned>(line: &str) -> Result<T, Failure> {
    match serde_json::from_str::<Reply<T>>(line) {
        Ok(Reply::Done(value)) => Ok(value),
        Ok(Reply::Failed { error }) => Err(Failure::Unsent(format!(
            "TOM's helper refused the request: {error}"
        ))),
        Err(_) => Err(Failure::Unanswered(
            "TOM's helper gave an unreadable answer.".into(),
        )),
    }
}

#[derive(Deserialize)]
#[serde(tag = "result", rename_all = "snake_case")]
enum Outcome {
    Accepted,
    Rejected {
        message: String,
    },
    NotReady {
        reason: String,
    },
    Saved,
    Started,
    AlreadyStarted,
    Finished,
    /// The helper entered the code but could not see what TOM did with it.
    Uncertain {
        reason: String,
    },
}

impl Outcome {
    /// Why a request did not do what it asked, for answers that are not its success.
    fn reason(self) -> String {
        match self {
            Self::NotReady { reason }
            | Self::Rejected { message: reason }
            | Self::Uncertain { reason } => reason,
            _ => "TOM's helper gave an unexpected answer.".to_owned(),
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct HelperStatus {
    tournament_open: bool,
    slip_dialog_open: bool,
    windows: Vec<String>,
    #[serde(default)]
    pods: Vec<PodStatus>,
}

impl HelperStatus {
    fn into_view(self) -> TomView {
        TomView {
            ready: self.tournament_open,
            reason: (!self.tournament_open).then(|| "No tournament is open in TOM.".to_owned()),
            tournament_open: self.tournament_open,
            slip_dialog_open: self.slip_dialog_open,
            windows: self.windows,
            pods: self.pods,
        }
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use std::net::TcpListener;
    use std::thread;

    impl Tom {
        #[allow(
            irrefutable_let_patterns,
            reason = "macOS builds also follow TOM by pid"
        )]
        pub(crate) fn kill(&mut self) {
            if let Process::Child(child) = &mut self.process {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }

    /// Answers each request line with the next canned reply, recording requests.
    /// A request that never comes ends the fake instead of hanging the test.
    fn accept_within(listener: &TcpListener, wait: Duration) -> Option<TcpStream> {
        listener.set_nonblocking(true).unwrap();
        let deadline = std::time::Instant::now() + wait;
        while std::time::Instant::now() < deadline {
            if let Ok((stream, _)) = listener.accept() {
                stream.set_nonblocking(false).unwrap();
                return Some(stream);
            }
            thread::sleep(Duration::from_millis(10));
        }
        None
    }

    /// TOM run by a stand-in process, with a fake helper giving `replies`.
    /// The handle yields the requests the fake saw.
    pub(crate) fn fake_tom(
        replies: &'static [&'static str],
    ) -> (Tom, thread::JoinHandle<Vec<String>>) {
        let helper = Helper::create().unwrap();
        let server = fake_helper(&helper, replies);
        let tom = Tom {
            process: Process::Child(Command::new("sleep").arg("5").spawn().unwrap()),
            helper: Some(helper),
        };
        (tom, server)
    }

    fn fake_helper(
        helper: &Helper,
        replies: &'static [&'static str],
    ) -> thread::JoinHandle<Vec<String>> {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        fs::write(helper.handshake(), format!("{{\"port\":{port}}}")).unwrap();
        thread::spawn(move || {
            let mut seen = Vec::new();
            // One connection per request, as the real helper serves them.
            for reply in replies {
                let Some(stream) = accept_within(&listener, Duration::from_secs(5)) else {
                    break;
                };
                let mut line = String::new();
                BufReader::new(stream.try_clone().unwrap())
                    .read_line(&mut line)
                    .unwrap();
                seen.push(line);
                writeln!(&stream, "{reply}").unwrap();
            }
            seen
        })
    }

    #[test]
    fn reads_the_helpers_answers() {
        let helper = Helper::create().unwrap();
        let server = fake_helper(
            &helper,
            &[
                r#"{"tournamentOpen":true,"slipDialogOpen":false,"windows":["Main"]}"#,
                r#"{"result":"rejected","message":"Two codes in a row"}"#,
                r#"{"error":"unauthorized"}"#,
            ],
        );
        let status: HelperStatus = helper.request("status", &[]).unwrap();
        assert_eq!(status.into_view().windows, ["Main"]);
        let outcome: Outcome = helper
            .request("submit", &[("code", "21113".into())])
            .unwrap();
        assert!(
            matches!(outcome, Outcome::Rejected { message } if message == "Two codes in a row")
        );
        let refused = helper.request::<Outcome>("save", &[]).err().unwrap();
        assert!(matches!(refused, Failure::Unsent(reason) if reason.contains("unauthorized")));
        server.join().unwrap();
    }

    #[test]
    fn sends_the_token_and_only_the_fields_it_needs() {
        let helper = Helper::create().unwrap();
        let server = fake_helper(
            &helper,
            &[r#"{"result":"saved"}"#, r#"{"result":"accepted"}"#],
        );
        helper.request::<Outcome>("save", &[]).unwrap();
        helper
            .request::<Outcome>("submit", &[("code", "21113".into())])
            .unwrap();
        let seen: Vec<serde_json::Value> = server
            .join()
            .unwrap()
            .iter()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect();
        assert_eq!(seen[0], json!({ "token": helper.token, "op": "save" }));
        assert_eq!(
            seen[1],
            json!({ "token": helper.token, "op": "submit", "code": "21113" })
        );
        assert_eq!(helper.token.len(), 64);
    }

    #[test]
    fn starts_a_pods_round_and_reads_pod_state() {
        let helper = Helper::create().unwrap();
        let server = fake_helper(
            &helper,
            &[
                r#"{"result":"already_started"}"#,
                r#"{"tournamentOpen":true,"slipDialogOpen":false,"windows":[],"pods":[{"category":2,"round":3,"started":true},{"round":1,"started":false}]}"#,
            ],
        );
        let outcome: Outcome = helper
            .request("start_round", &[("category", "2".into())])
            .unwrap();
        assert!(matches!(outcome, Outcome::AlreadyStarted));
        let status: HelperStatus = helper.request("status", &[]).unwrap();
        let pods = status.into_view().pods;
        assert_eq!(
            pods[0],
            PodStatus {
                category: Some(2),
                round: 3,
                started: true
            }
        );
        assert_eq!(pods[1].category, None);
        let seen: serde_json::Value = serde_json::from_str(&server.join().unwrap()[0]).unwrap();
        assert_eq!(
            seen,
            json!({ "token": helper.token, "op": "start_round", "category": "2" })
        );
    }

    /// TOM with a fake helper that reads one request, then gives `reply` (or hangs up).
    fn tom_answering(reply: Option<&'static str>) -> Tom {
        let helper = Helper::create().unwrap();
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        fs::write(helper.handshake(), format!("{{\"port\":{port}}}")).unwrap();
        thread::spawn(move || {
            let (stream, _) = listener.accept().unwrap();
            let mut line = String::new();
            BufReader::new(stream.try_clone().unwrap())
                .read_line(&mut line)
                .unwrap();
            if let Some(reply) = reply {
                writeln!(&stream, "{reply}").unwrap();
            }
        });
        Tom {
            process: Process::Child(Command::new("sleep").arg("5").spawn().unwrap()),
            helper: Some(helper),
        }
    }

    #[test]
    fn a_code_sent_but_unanswered_is_uncertain() {
        let entry = crate::code::entry(2, None, 1, 1, 1, "21113");
        let mut hung_up = tom_answering(None);
        assert!(matches!(
            hung_up.submit(&entry, None),
            SubmitResult::Uncertain { .. }
        ));
        let mut unsure = tom_answering(Some(
            r#"{"result":"uncertain","reason":"TOM stopped responding."}"#,
        ));
        assert_eq!(
            unsure.submit(&entry, None),
            SubmitResult::uncertain("21113", "TOM stopped responding.")
        );
        for mut tom in [hung_up, unsure] {
            tom.kill();
        }
    }

    #[test]
    fn names_the_round_a_code_is_for() {
        let helper = Helper::create().unwrap();
        let token = helper.token.clone();
        let server = fake_helper(&helper, &[r#"{"result":"accepted"}"#]);
        let mut tom = Tom {
            process: Process::Child(Command::new("sleep").arg("5").spawn().unwrap()),
            helper: Some(helper),
        };
        let entry = crate::code::entry(2, None, 3, 1, 1, "23119");
        assert_eq!(
            tom.submit(&entry, Some("Spring Cup")),
            SubmitResult::accepted("23119")
        );
        let seen: serde_json::Value = serde_json::from_str(&server.join().unwrap()[0]).unwrap();
        let expected = json!({
            "token": token, "op": "submit", "code": "23119", "pod": "2", "round": "3",
            "tournament": "Spring Cup"
        });
        assert_eq!(seen, expected);
        tom.kill();
    }

    #[test]
    fn waits_for_the_handshake_instead_of_hanging() {
        let helper = Helper::create().unwrap();
        let error = helper.request::<Outcome>("status", &[]).err().unwrap();
        assert_eq!(error, Failure::Unsent("TOM is still starting.".into()));
    }

    #[test]
    fn quotes_paths_with_spaces_and_keeps_existing_options() {
        let helper = Helper::create().unwrap();
        let jar =
            Path::new("/Applications/Ciphermaniac Events.app/Contents/Resources/tom-bridge.jar");
        let options = helper.tool_options(jar, Some("-Xmx2g".into())).unwrap();
        let options = options.to_str().unwrap();
        assert!(options.starts_with(
            "\"-Xbootclasspath/a:/Applications/Ciphermaniac Events.app/Contents/Resources/tom-bridge.jar\" "
        ));
        assert!(
            !options.contains(&helper.token),
            "the token would be echoed to TOM's log"
        );
        assert!(options.ends_with(&format!("{}\" -Xmx2g", helper.dir.display())));
        let token_file = helper.dir.join(TOKEN_FILE);
        assert_eq!(fs::read_to_string(&token_file).unwrap(), helper.token);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::metadata(&token_file).unwrap().permissions().mode();
            assert_eq!(mode & 0o777, 0o600);
        }
        assert!(helper.tool_options(Path::new("/a\"b.jar"), None).is_err());
    }

    #[test]
    fn launches_without_the_helper_when_the_jar_is_missing() {
        let mut command = Command::new("true");
        command.env(JAVA_TOOL_OPTIONS, "");
        let mut tom = Tom::spawn(command, Path::new("/nonexistent/tom-bridge.jar")).unwrap();
        assert!(tom.helper.is_none());
        tom.kill();
    }
}
