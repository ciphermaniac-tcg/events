//! Drives the real TOM 1.86 GUI under Xvfb through the helper and reads the
//! results back from the `.tdf` TOM saves.
//!
//! Ignored by default. Needs Linux with Xvfb, xdotool, node, a JDK 17+ `javac`,
//! and a tom-tdf checkout (vendor/tom.jar, the harness sources and the jlinked
//! runtime with TOM's modules). Run:
//!
//! ```text
//! TOM_TDF_DIR=~/projects/tom-tdf cargo test --test tom_e2e -- --ignored --nocapture
//! ```

use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use tom_link::{Bridge, Entry, Event, SaveResult, StartResult, SubmitResult};

const DISPLAY: &str = ":93";
const LOGIN: &str = "1234567";
/// Masters only: one pod, six tables a round.
const MASTERS: &str = "12";
/// Round 1 is played; round 2 is paired with its pairings viewed, not started.
const PLAYED: &str = "1";
const ROUND: u8 = 2;
/// The harness's event, by name and tournament ID.
const EVENT: Event = Event {
    name: Some("Harness Cup"),
    id: Some("26-10-000001"),
};
/// Another event of the same name, told apart only by its ID.
const LAST_WEEK: Event = Event {
    name: Some("Harness Cup"),
    id: Some("26-10-000002"),
};

struct Env {
    tom_tdf: PathBuf,
    java: PathBuf,
    work: PathBuf,
    classes: PathBuf,
    jar: PathBuf,
}

impl Env {
    fn new() -> Self {
        let home = PathBuf::from(std::env::var_os("HOME").expect("HOME"));
        let tom_tdf = std::env::var_os("TOM_TDF_DIR")
            .map_or_else(|| home.join("projects/tom-tdf"), PathBuf::from);
        let java = std::env::var_os("TOM_E2E_JAVA").map_or_else(
            || tom_tdf.join(".scratch/tom-focus/rt/bin/java"),
            PathBuf::from,
        );
        let scratch = std::env::temp_dir().join(format!("tom-link-e2e-{}", std::process::id()));
        let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));
        Self {
            tom_tdf,
            java,
            work: scratch.join("work"),
            classes: scratch.join("classes"),
            jar: manifest.join("../src-tauri/resources/tom-bridge.jar"),
        }
    }

    fn classpath(&self) -> String {
        let app = self
            .tom_tdf
            .join("vendor/tom/Tournament Operations Manager/app");
        let mut parts = vec![self.tom_tdf.join("vendor/tom.jar")];
        for entry in fs::read_dir(app).expect("TOM app folder").flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            let jar = Path::new(&name)
                .extension()
                .is_some_and(|ext| ext.eq_ignore_ascii_case("jar"));
            if jar && !name.starts_with("tom-") {
                parts.push(entry.path());
            }
        }
        parts.push(self.classes.clone());
        std::env::join_paths(parts).unwrap().into_string().unwrap()
    }

    fn prepare(&self) {
        fs::create_dir_all(self.work.join("TOM_DATA/data")).unwrap();
        fs::create_dir_all(&self.classes).unwrap();
        let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));
        run(Command::new("node").arg(manifest.join("../tom-bridge/build.mjs")));
        let harness = self.tom_tdf.join("harness/src");
        run(Command::new("javac")
            .args(["--release", "17", "-nowarn", "-cp", &self.classpath(), "-d"])
            .arg(&self.classes)
            .arg(harness.join("TdfHarness.java"))
            .arg(harness.join("GuiHarness.java"))
            .arg(harness.join("SlipCodes.java"))
            .arg(manifest.join("tests/fixtures/StartableHarness.java")));
    }

    fn tom_command(&self) -> Command {
        let mut command = Command::new(&self.java);
        command
            .args(["-cp", &self.classpath(), "StartableHarness"])
            .arg(&self.work)
            .args([MASTERS, PLAYED])
            .env("DISPLAY", DISPLAY)
            .stdout(Stdio::null())
            .stderr(fs::File::create(self.work.join("stderr.log")).unwrap());
        command
    }

    /// The current round's slips, from the saved file.
    fn slips(&self) -> Vec<Slip> {
        let output = Command::new(&self.java)
            .args(["-cp", &self.classpath(), "SlipCodes"])
            .arg(self.work.join("event.tdf"))
            .output()
            .unwrap();
        String::from_utf8(output.stdout)
            .unwrap()
            .lines()
            .map(|line| {
                let fields: Vec<&str> = line.split_whitespace().collect();
                Slip {
                    table: fields[2].parse().unwrap(),
                    outcome: fields[3].parse().unwrap(),
                    seats: [fields[4].to_owned(), fields[5].to_owned()],
                    codes: fields[6..9].iter().map(|code| (*code).to_owned()).collect(),
                }
            })
            .collect()
    }
}

/// One match slip: table, the outcome the file holds, both seats' player IDs,
/// and the codes for Player 1, Player 2 and a tie.
struct Slip {
    table: u32,
    outcome: u32,
    seats: [String; 2],
    codes: Vec<String>,
}

/// Kills TOM and the display when the test ends, pass or fail.
struct Cleanup {
    work: PathBuf,
    xvfb: Option<Child>,
}

impl Drop for Cleanup {
    fn drop(&mut self) {
        let _ = Command::new("pkill")
            .arg("-f")
            .arg(self.work.as_os_str())
            .status();
        if let Some(xvfb) = self.xvfb.as_mut() {
            let _ = xvfb.kill();
        }
        if let Some(scratch) = self.work.parent() {
            let _ = fs::remove_dir_all(scratch);
        }
    }
}

fn run(command: &mut Command) {
    let status = command.status().expect("command runs");
    assert!(status.success(), "{command:?} failed");
}

fn wait_for(what: &str, timeout: Duration, mut done: impl FnMut() -> bool) {
    let deadline = Instant::now() + timeout;
    while !done() {
        assert!(Instant::now() < deadline, "timed out waiting for {what}");
        thread::sleep(Duration::from_millis(250));
    }
}

fn start_display() -> Option<Child> {
    let running = Command::new("xdpyinfo")
        .args(["-display", DISPLAY])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|status| status.success());
    if running {
        return None;
    }
    let xvfb = Command::new("Xvfb")
        .args([DISPLAY, "-screen", "0", "1600x1000x24", "-nolisten", "tcp"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .expect("Xvfb starts");
    thread::sleep(Duration::from_secs(1));
    Some(xvfb)
}

fn xdotool(args: &[&str]) -> bool {
    Command::new("xdotool")
        .args(args)
        .env("DISPLAY", DISPLAY)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|status| status.success())
}

/// Starts TOM through the bridge, signs in, and waits for the helper.
fn launch(env: &Env) -> Bridge {
    let mut bridge = Bridge::new(None);
    bridge
        .launch_with(env.tom_command(), &env.jar)
        .expect("TOM launches");
    wait_for("the Log In window", Duration::from_secs(30), || {
        xdotool(&["search", "--name", "^Log In$"])
    });
    thread::sleep(Duration::from_secs(1));
    assert!(xdotool(&["type", "--delay", "30", LOGIN]) && xdotool(&["key", "Return"]));
    wait_for("the tournament to open", Duration::from_secs(30), || {
        env.work.join("READY").exists()
    });
    wait_for("the helper", Duration::from_secs(30), || {
        bridge.status().file.is_some()
    });
    bridge
}

/// A Masters entry for the current round, with the code and seats TOM's own file gives for it.
fn code(slips: &[Slip], table: u16, outcome: u8) -> Entry {
    let slip = slips
        .iter()
        .find(|slip| slip.table == u32::from(table))
        .unwrap();
    let code = slip.codes[usize::from(outcome - 1)].clone();
    entry(ROUND, table, outcome, &code, &slip.seats)
}

fn entry(round: u8, table: u16, outcome: u8, code: &str, seats: &[String; 2]) -> Entry {
    Entry {
        pod: 2,
        flight: None,
        round,
        table,
        outcome,
        code: code.to_owned(),
        p1: seats[0].clone(),
        p2: seats[1].clone(),
    }
}

/// A slip from round 1 reported late: well-formed, but not the current round.
fn late_slip() -> Entry {
    entry(1, 1, 1, "21113", &["1".into(), "2".into()])
}

/// The right code for a table, but the players of another event of the same name.
fn other_players(slips: &[Slip], table: u16) -> Entry {
    let mut entry = code(slips, table, 1);
    entry.p1 = "9999990".into();
    entry
}

/// Submits a batch and checks, among TOM's own windows, that the slip form was closed again afterwards.
fn submit(bridge: &mut Bridge, entries: &[Entry]) -> Vec<SubmitResult> {
    let results = bridge.submit(entries, EVENT);
    wait_for("the slip form to close", Duration::from_secs(5), || {
        !xdotool(&[
            "search",
            "--onlyvisible",
            "--name",
            "^Speed Match Slip Entry$",
        ])
    });
    results
}

fn accepted(entry: &Entry) -> SubmitResult {
    SubmitResult::Accepted {
        code: entry.code.clone(),
    }
}

fn rejected_with(results: &[SubmitResult], text: &str) -> bool {
    matches!(results, [SubmitResult::Rejected { message, .. }] if message.contains(text))
}

fn refused_with(results: &[SubmitResult], text: &str) -> bool {
    matches!(results, [SubmitResult::NotReady { reason, .. }] if reason.contains(text))
}

/// A late round-1 slip must not start round 2, nor a slip for other players
/// at a paired table.
fn mismatches_start_nothing(bridge: &mut Bridge, slips: &[Slip]) {
    let results = submit(bridge, &[late_slip()]);
    println!("late slip before the round: {results:?}");
    assert!(
        matches!(&results[..], [SubmitResult::NotReady { reason, .. }] if reason.contains("round must be started"))
    );
    let results = submit(bridge, &[other_players(slips, 6)]);
    println!("other players before the round: {results:?}");
    assert!(refused_with(&results, "different players than the site"));
}

/// Same name, another ID: neither a slip nor Start Round touches TOM.
fn another_event_starts_nothing(bridge: &mut Bridge, slips: &[Slip]) {
    let results = bridge.submit(&[code(slips, 1, 1)], LAST_WEEK);
    println!("another event's slip: {results:?}");
    assert!(refused_with(&results, "not this event"));
    let start = bridge.start_round(Some(2), Some(ROUND), LAST_WEEK);
    assert!(
        matches!(&start, StartResult::NotReady { reason } if reason.contains("not this event")),
        "{start:?}"
    );
}

fn inside_mode(bridge: &mut Bridge, slips: &[Slip]) {
    // The round is not started yet: submit starts it, then enters the codes.
    let entries = [code(slips, 1, 1), code(slips, 2, 2)];
    let results = submit(bridge, &entries);
    println!("inside: {results:?}");
    assert_eq!(results, [accepted(&entries[0]), accepted(&entries[1])]);
    // TOM's live pairings decide: a late slip and a same-name event's players never go in.
    assert!(refused_with(&submit(bridge, &[late_slip()]), "not round 1"));
    assert!(refused_with(
        &submit(bridge, &[other_players(slips, 6)]),
        "different players than the site"
    ));
    assert!(rejected_with(
        &submit(bridge, &[entry(ROUND, 0, 1, "22012", &slips[0].seats)]),
        "table 0"
    ));
    // Same seats: the result TOM holds is taken as sent, another is never typed over it.
    let again = code(slips, 1, 1);
    assert_eq!(
        submit(bridge, std::slice::from_ref(&again)),
        [accepted(&again)]
    );
    assert!(refused_with(
        &submit(bridge, &[code(slips, 1, 2)]),
        "already has a different result"
    ));
}

fn start_round_is_idempotent(bridge: &mut Bridge) {
    // Submit started the round it entered results for.
    assert_eq!(
        bridge.start_round(Some(2), Some(ROUND), EVENT),
        StartResult::AlreadyStarted
    );
    assert_eq!(
        bridge.start_round(None, None, EVENT),
        StartResult::AlreadyStarted
    );
    // The site's clock was for round 1, but TOM is on round 2.
    let stale = bridge.start_round(Some(2), Some(1), EVENT);
    assert!(
        matches!(&stale, StartResult::NotReady { reason } if reason.contains("not round 1")),
        "{stale:?}"
    );
}

/// A batch that stops at a rejection, then the next batch still lands.
fn later_batches(bridge: &mut Bridge, slips: &[Slip]) {
    let entries = [code(slips, 3, 1), late_slip(), code(slips, 4, 3)];
    let results = submit(bridge, &entries);
    println!("stopping batch: {results:?}");
    assert_eq!(results[0], accepted(&entries[0]));
    assert!(matches!(&results[1], SubmitResult::NotReady { .. }));
    assert!(matches!(&results[2], SubmitResult::NotReady { .. }));
    let entries = [code(slips, 4, 3), code(slips, 5, 2)];
    assert_eq!(
        submit(bridge, &entries),
        [accepted(&entries[0]), accepted(&entries[1])]
    );
}

#[test]
#[ignore = "drives the real TOM GUI under Xvfb; see the module docs"]
fn results_land_in_the_saved_tdf() {
    let env = Env::new();
    let _cleanup = Cleanup {
        work: env.work.clone(),
        xvfb: start_display(),
    };
    env.prepare();
    // SAFETY: this test binary has a single test, so nothing else reads the environment.
    unsafe { std::env::set_var("DISPLAY", DISPLAY) };

    let mut bridge = launch(&env);
    // The JVM echoes JAVA_TOOL_OPTIONS to stderr; the secret must not be in them.
    let stderr = fs::read_to_string(env.work.join("stderr.log")).unwrap();
    assert!(
        stderr.contains("Picked up JAVA_TOOL_OPTIONS") && !stderr.contains("token"),
        "{stderr}"
    );
    let slips = env.slips();
    mismatches_start_nothing(&mut bridge, &slips);
    another_event_starts_nothing(&mut bridge, &slips);
    inside_mode(&mut bridge, &slips);
    start_round_is_idempotent(&mut bridge);
    later_batches(&mut bridge, &slips);

    // A save names the event: one TOM does not have open saves nothing.
    assert!(matches!(
        bridge.save(LAST_WEEK),
        SaveResult::NotReady { .. }
    ));
    assert_eq!(bridge.save(EVENT), SaveResult::Saved);
    let outcomes: Vec<(u32, u32)> = env
        .slips()
        .iter()
        .map(|slip| (slip.table, slip.outcome))
        .collect();
    assert_eq!(outcomes, [(1, 1), (2, 2), (3, 1), (4, 3), (5, 2), (6, 0)]);
}
