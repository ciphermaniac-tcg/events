use std::time::Duration;

use super::*;

const MAIN: &str = "Tournament Operations Manager (1.86.0) - Tournament: Harness Cup";
const TOM_PID: u32 = 7;

/// A pretend desktop running TOM: Enter in the slip form records the typed
/// code, or opens an Error window for codes listed in `bad`.
#[derive(Default)]
struct FakeTom {
    windows: Vec<(String, u32)>,
    foreground: String,
    field: String,
    recorded: Vec<String>,
    bad: Vec<&'static str>,
    /// Activation silently fails, as Windows does without foreground rights.
    stuck: bool,
    /// Focus jumps to this window as soon as typing starts.
    steal_on_type: Option<&'static str>,
    keys_in: Vec<String>,
    saves: usize,
}

impl FakeTom {
    fn with(titles: &[&str]) -> Self {
        let mut windows: Vec<(String, u32)> =
            titles.iter().map(|t| ((*t).to_owned(), TOM_PID)).collect();
        windows.push(("Notes".to_owned(), 99));
        Self {
            windows,
            foreground: "Notes".to_owned(),
            ..Self::default()
        }
    }

    fn remove(&mut self, title: &str) {
        self.windows.retain(|(t, _)| t != title);
    }
}

impl Desktop for FakeTom {
    type Handle = String;
    type Focus = String;

    fn windows(&mut self) -> Result<Vec<OsWindow<String>>, String> {
        Ok(self
            .windows
            .iter()
            .map(|(title, pid)| OsWindow {
                handle: title.clone(),
                title: title.clone(),
                pid: Some(*pid),
            })
            .collect())
    }

    fn focus(&mut self) -> Result<String, String> {
        Ok(self.foreground.clone())
    }

    fn foreground_title(&mut self) -> Result<Option<String>, String> {
        Ok(Some(self.foreground.clone()))
    }

    fn activate(&mut self, window: &String) -> Result<(), String> {
        if !self.stuck {
            self.foreground.clone_from(window);
        }
        Ok(())
    }

    fn type_digits(&mut self, digits: &str) -> Result<(), String> {
        if let Some(thief) = self.steal_on_type {
            self.foreground = thief.to_owned();
        }
        self.keys_in.push(self.foreground.clone());
        if self.foreground == SLIP {
            self.field.push_str(digits);
        }
        Ok(())
    }

    fn press_enter(&mut self) -> Result<(), String> {
        self.keys_in.push(self.foreground.clone());
        if self.foreground == ERROR {
            self.remove(ERROR);
            self.foreground = MAIN.to_owned();
        } else if self.foreground == SLIP {
            let code = std::mem::take(&mut self.field);
            if self.bad.contains(&code.as_str()) {
                self.windows.push((ERROR.to_owned(), TOM_PID));
                self.foreground = ERROR.to_owned();
            } else {
                self.recorded.push(code);
            }
        }
        Ok(())
    }

    fn press_save(&mut self) -> Result<(), String> {
        self.keys_in.push(self.foreground.clone());
        self.saves += 1;
        Ok(())
    }

    fn restore(&mut self, focus: String) -> Result<(), String> {
        self.foreground = focus;
        Ok(())
    }
}

fn fast() -> Timing {
    Timing {
        settle: Duration::ZERO,
        focus_wait: Duration::from_millis(5),
        poll: Duration::from_millis(1),
    }
}

/// Masters, round 1 entries for codes of the form `2 1 table outcome check`.
fn codes(list: &[&str]) -> Vec<Entry> {
    list.iter()
        .map(|code| {
            let table = code[2..code.len() - 2].parse().unwrap();
            let outcome = code.as_bytes()[code.len() - 2] - b'0';
            crate::code::entry(2, None, 1, table, outcome, code)
        })
        .collect()
}

#[test]
fn types_codes_dismisses_errors_and_gives_focus_back() {
    let mut tom = FakeTom::with(&[MAIN, SLIP]);
    // 21212 passes the local check but TOM rejects it (say, no such table).
    tom.bad = vec!["21212"];
    let sent = codes(&["21113", "21212", "21014", "21220"]);
    let results = submit(&mut tom, fast(), &sent);
    let table_zero = crate::code::vet(&sent[2]).unwrap_err();
    assert_eq!(
        results,
        [
            SubmitResult::accepted("21113"),
            SubmitResult::rejected("21212", "TOM rejected the code."),
            SubmitResult::rejected("21014", table_zero),
            SubmitResult::accepted("21220"),
        ]
    );
    assert_eq!(tom.recorded, ["21113", "21220"]);
    assert!(tom.keys_in.iter().all(|w| w == SLIP || w == ERROR));
    assert_eq!(tom.foreground, "Notes");
}

#[test]
fn types_nothing_until_the_slip_form_is_open() {
    let mut tom = FakeTom::with(&[MAIN]);
    let results = submit(&mut tom, fast(), &codes(&["21113", "21121"]));
    assert!(results.iter().all(|r| r.reason() == Some(OPEN_SLIP)));
    assert_eq!(tom.keys_in, Vec::<String>::new());
}

#[test]
fn types_nothing_when_tom_will_not_come_forward() {
    let mut tom = FakeTom::with(&[MAIN, SLIP]);
    tom.stuck = true;
    let results = submit(&mut tom, fast(), &codes(&["21113"]));
    assert!(
        results[0]
            .reason()
            .is_some_and(|r| r.contains("could not be brought to the front"))
    );
    assert_eq!(tom.keys_in, Vec::<String>::new());
}

#[test]
fn holds_enter_when_focus_moves_while_typing() {
    let mut tom = FakeTom::with(&[MAIN, SLIP]);
    tom.steal_on_type = Some("Notes");
    let results = submit(&mut tom, fast(), &codes(&["21113"]));
    assert!(
        results[0]
            .reason()
            .is_some_and(|r| r.contains("Enter was not pressed"))
    );
    assert_eq!(tom.keys_in, ["Notes"]);
    assert_eq!(tom.recorded, Vec::<String>::new());
}

#[test]
fn ignores_other_apps_and_waits_out_toms_own_errors() {
    let mut tom = FakeTom::with(&[MAIN, SLIP]);
    tom.windows.push((ERROR.to_owned(), 99));
    assert_eq!(
        submit(&mut tom, fast(), &codes(&["21113"]))[0],
        SubmitResult::accepted("21113")
    );

    tom.windows.push((ERROR.to_owned(), TOM_PID));
    let results = submit(&mut tom, fast(), &codes(&["21121"]));
    assert_eq!(results[0].reason(), Some(SHOWING_ERROR));
}

#[test]
fn reports_tom_missing() {
    let mut tom = FakeTom::with(&[]);
    assert_eq!(view(&mut tom).reason.as_deref(), Some(NOT_RUNNING));
    assert_eq!(save(&mut tom, fast()), SaveResult::not_ready(NOT_RUNNING));
}

#[test]
fn describes_toms_windows() {
    let mut tom = FakeTom::with(&[MAIN, SLIP]);
    let view = view(&mut tom);
    assert!(view.ready && view.tournament_open && view.slip_dialog_open);
    assert_eq!(view.windows, [MAIN, SLIP]);
}

#[test]
fn saves_from_the_main_window_only() {
    let mut tom = FakeTom::with(&[MAIN, SLIP]);
    assert!(
        matches!(save(&mut tom, fast()), SaveResult::NotReady { reason } if reason.contains("cannot save"))
    );
    tom.remove(SLIP);
    assert_eq!(save(&mut tom, fast()), SaveResult::Saved);
    assert_eq!(tom.keys_in, [MAIN]);
    assert_eq!(tom.saves, 1);
    assert_eq!(tom.foreground, "Notes");
}
