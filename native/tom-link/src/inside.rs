//! Inside mode: TOM runs as our child with the helper jar loaded into its JVM,
//! and we talk to the helper over loopback.
//!
//! The helper is injected only through this child's `JAVA_TOOL_OPTIONS`, and
//! only after the jar is confirmed present: a missing or broken assistive
//! technology stops TOM from starting.

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
const TOKEN_PROPERTY: &str = "cmevents.tombridge.token";
const HANDSHAKE_PROPERTY: &str = "cmevents.tombridge.handshake";
const JAVA_TOOL_OPTIONS: &str = "JAVA_TOOL_OPTIONS";
const CONNECT_TIMEOUT: Duration = Duration::from_secs(2);
const WRITE_TIMEOUT: Duration = Duration::from_secs(5);
/// Longer than the helper's worst case: opening the form, then one code.
const READ_TIMEOUT: Duration = Duration::from_secs(20);

/// TOM started by this app.
pub(crate) struct Tom {
    child: Child,
    helper: Option<Helper>,
}

impl Tom {
    /// Starts TOM, with the helper when `jar` is a non-empty file.
    pub(crate) fn spawn(mut command: Command, jar: &Path) -> Result<Self, String> {
        let helper = if fs::metadata(jar).is_ok_and(|meta| meta.is_file() && meta.len() > 0) {
            let helper = Helper::create()?;
            let existing = std::env::var_os(JAVA_TOOL_OPTIONS);
            command.env(JAVA_TOOL_OPTIONS, helper.tool_options(jar, existing)?);
            Some(helper)
        } else {
            None
        };
        let child = command
            .spawn()
            .map_err(|error| format!("TOM could not be started: {error}"))?;
        Ok(Self { child, helper })
    }

    pub(crate) fn running(&mut self) -> bool {
        matches!(self.child.try_wait(), Ok(None))
    }

    pub(crate) fn view(&mut self) -> TomView {
        match self.request::<HelperStatus>("status", &[]) {
            Ok(status) => status.into_view(),
            Err(failure) => TomView::unavailable(failure.reason()),
        }
    }

    pub(crate) fn submit(&mut self, entry: &Entry) -> SubmitResult {
        let code = entry.code.as_str();
        let fields = [
            ("code", code.to_owned()),
            ("pod", entry.pod.to_string()),
            ("round", entry.round.to_string()),
        ];
        match self.outcome("submit", &fields) {
            Outcome::Accepted => SubmitResult::accepted(code),
            Outcome::Rejected { message } => SubmitResult::rejected(code, message),
            Outcome::Uncertain { reason } => SubmitResult::uncertain(code, reason),
            other => SubmitResult::not_ready(code, other.reason()),
        }
    }

    pub(crate) fn save(&mut self) -> SaveResult {
        match self.outcome("save", &[]) {
            Outcome::Saved => SaveResult::Saved,
            other => SaveResult::not_ready(other.reason()),
        }
    }

    pub(crate) fn start_round(&mut self, category: Option<u8>) -> StartResult {
        let fields: Vec<_> = category
            .map(|category| ("category", category.to_string()))
            .into_iter()
            .collect();
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
        private_dir(&dir).map_err(|error| format!("Could not prepare TOM's helper: {error}"))?;
        Ok(Self {
            token: crate::random_hex(32),
            dir,
        })
    }

    fn handshake(&self) -> PathBuf {
        self.dir.join("handshake.json")
    }

    /// The JVM options that load the helper. Quoted so paths may hold spaces.
    fn tool_options(&self, jar: &Path, existing: Option<OsString>) -> Result<OsString, String> {
        let jar = quotable(jar)?;
        let handshake_path = self.handshake();
        let handshake = quotable(&handshake_path)?;
        let mut options = OsString::from(format!(
            "\"-Xbootclasspath/a:{jar}\" -Djavax.accessibility.assistive_technologies={PROVIDER} \
             -D{TOKEN_PROPERTY}={} \"-D{HANDSHAKE_PROPERTY}={handshake}\"",
            self.token
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
mod tests {
    use super::*;
    use std::net::TcpListener;
    use std::thread;

    /// Answers each request line with the next canned reply, recording requests.
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
                let (stream, _) = listener.accept().unwrap();
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
            child: Command::new("sleep").arg("5").spawn().unwrap(),
            helper: Some(helper),
        }
    }

    #[test]
    fn a_code_sent_but_unanswered_is_uncertain() {
        let entry = crate::code::entry(2, None, 1, 1, 1, "21113");
        let mut hung_up = tom_answering(None);
        assert!(matches!(
            hung_up.submit(&entry),
            SubmitResult::Uncertain { .. }
        ));
        let mut unsure = tom_answering(Some(
            r#"{"result":"uncertain","reason":"TOM stopped responding."}"#,
        ));
        assert_eq!(
            unsure.submit(&entry),
            SubmitResult::uncertain("21113", "TOM stopped responding.")
        );
        for mut tom in [hung_up, unsure] {
            let _ = tom.child.kill();
        }
    }

    #[test]
    fn names_the_round_a_code_is_for() {
        let helper = Helper::create().unwrap();
        let token = helper.token.clone();
        let server = fake_helper(&helper, &[r#"{"result":"accepted"}"#]);
        let child = Command::new("sleep").arg("5").spawn().unwrap();
        let mut tom = Tom {
            child,
            helper: Some(helper),
        };
        let entry = crate::code::entry(2, None, 3, 1, 1, "23119");
        assert_eq!(tom.submit(&entry), SubmitResult::accepted("23119"));
        let seen: serde_json::Value = serde_json::from_str(&server.join().unwrap()[0]).unwrap();
        let expected =
            json!({ "token": token, "op": "submit", "code": "23119", "pod": "2", "round": "3" });
        assert_eq!(seen, expected);
        let _ = tom.child.kill();
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
        assert!(options.contains(&format!("-D{TOKEN_PROPERTY}={} ", helper.token)));
        assert!(options.ends_with("handshake.json\" -Xmx2g"));
        assert!(helper.tool_options(Path::new("/a\"b.jar"), None).is_err());
    }

    #[test]
    fn launches_without_the_helper_when_the_jar_is_missing() {
        let mut command = Command::new("true");
        command.env(JAVA_TOOL_OPTIONS, "");
        let mut tom = Tom::spawn(command, Path::new("/nonexistent/tom-bridge.jar")).unwrap();
        assert!(tom.helper.is_none());
        let _ = tom.child.wait();
    }
}
