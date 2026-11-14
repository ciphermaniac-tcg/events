//! Drives the real TOM 1.86 GUI under Xvfb through both entry modes and reads
//! the results back from the `.tdf` TOM saves.
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

use tom_link::{Bridge, Mode, SaveResult, StartResult, SubmitResult};

const DISPLAY: &str = ":93";
const LOGIN: &str = "1234567";
/// Masters only: one pod, six tables in round 1.
const MASTERS: &str = "12";

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
            .arg(MASTERS)
            .env("DISPLAY", DISPLAY)
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        command
    }

    /// `(table, outcome, [p1 code, p2 code, tie code])` for round 1, from the saved file.
    fn slips(&self) -> Vec<(u32, u32, Vec<String>)> {
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
                let codes = fields[6..9].iter().map(|code| (*code).to_owned()).collect();
                (
                    fields[2].parse().unwrap(),
                    fields[3].parse().unwrap(),
                    codes,
                )
            })
            .collect()
    }
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
    let mut bridge = Bridge::new(Mode::Inside, None);
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
        bridge.status().ready
    });
    bridge
}

fn code(slips: &[(u32, u32, Vec<String>)], table: u32, outcome: usize) -> String {
    slips.iter().find(|slip| slip.0 == table).unwrap().2[outcome - 1].clone()
}

/// Pod 2 (Masters), round 2, table 1: well-formed, but not the current round.
const WRONG_ROUND: &str = "22111";

fn inside_mode(bridge: &mut Bridge, slips: &[(u32, u32, Vec<String>)]) {
    let pods = bridge.status().pods;
    assert_eq!(
        (pods.len(), pods[0].category, pods[0].started),
        (1, Some(2), false)
    );

    // The round is not started yet: submit starts it, then enters the code.
    let codes = [
        code(slips, 1, 1),
        WRONG_ROUND.to_owned(),
        "21014".to_owned(),
        code(slips, 2, 2),
    ];
    let results = bridge.submit(&codes);
    println!("inside: {results:?}");
    assert_eq!(
        results[0],
        SubmitResult::Accepted {
            code: codes[0].clone()
        }
    );
    assert!(
        matches!(&results[1], SubmitResult::Rejected { message, .. } if message.contains("two codes in a row"))
    );
    assert!(
        matches!(&results[2], SubmitResult::Rejected { message, .. } if message.contains("table 0"))
    );
    assert_eq!(
        results[3],
        SubmitResult::Accepted {
            code: codes[3].clone()
        }
    );
}

fn start_round_is_idempotent(bridge: &mut Bridge) {
    assert!(bridge.status().pods[0].started);
    assert_eq!(bridge.start_round(Some(2)), StartResult::AlreadyStarted);
    assert_eq!(bridge.start_round(None), StartResult::AlreadyStarted);
}

fn keys_mode(bridge: &mut Bridge, slips: &[(u32, u32, Vec<String>)]) {
    bridge.set_mode(Mode::Keys);
    let status = bridge.status();
    assert!(status.ready, "{status:?}");
    let codes = [
        code(slips, 3, 1),
        WRONG_ROUND.to_owned(),
        code(slips, 4, 3),
        code(slips, 5, 2),
    ];
    let results = bridge.submit(&codes);
    println!("keys: {results:?}");
    assert_eq!(
        results[0],
        SubmitResult::Accepted {
            code: codes[0].clone()
        }
    );
    assert!(matches!(&results[1], SubmitResult::Rejected { .. }));
    assert_eq!(
        results[2],
        SubmitResult::Accepted {
            code: codes[2].clone()
        }
    );
    assert_eq!(
        results[3],
        SubmitResult::Accepted {
            code: codes[3].clone()
        }
    );
    assert!(
        matches!(bridge.save(), SaveResult::NotReady { reason } if reason.contains("cannot save"))
    );
}

#[test]
#[ignore = "drives the real TOM GUI under Xvfb; see the module docs"]
fn both_modes_record_results_in_the_saved_tdf() {
    let env = Env::new();
    let _cleanup = Cleanup {
        work: env.work.clone(),
        xvfb: start_display(),
    };
    env.prepare();
    // SAFETY: this test binary has a single test, so nothing else reads the environment.
    unsafe { std::env::set_var("DISPLAY", DISPLAY) };

    let mut bridge = launch(&env);
    let slips = env.slips();
    inside_mode(&mut bridge, &slips);
    start_round_is_idempotent(&mut bridge);
    keys_mode(&mut bridge, &slips);

    bridge.set_mode(Mode::Inside);
    assert_eq!(bridge.save(), SaveResult::Saved);
    let outcomes: Vec<(u32, u32)> = env.slips().iter().map(|slip| (slip.0, slip.1)).collect();
    assert_eq!(outcomes, [(1, 1), (2, 2), (3, 1), (4, 3), (5, 2), (6, 0)]);
}
