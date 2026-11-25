//! What the bridge reports back, serialized for the app.

use std::path::PathBuf;

use serde::Serialize;

use crate::code::Entry;

/// One code's fate. `{"result":"accepted","code":"21113"}` and so on.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "result", rename_all = "snake_case")]
pub enum SubmitResult {
    /// TOM took the code without an error.
    Accepted { code: String },
    /// TOM (or the code check before it) refused the code.
    Rejected { code: String, message: String },
    /// The code was not sent: TOM was not in a state to take it. `held`:
    /// TOM's own result for the match (its outcome code), when that is why.
    NotReady {
        code: String,
        reason: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        held: Option<u8>,
    },
    /// The code may have reached TOM but its fate was not seen. Check TOM
    /// before sending it again.
    Uncertain { code: String, reason: String },
}

impl SubmitResult {
    pub(crate) fn not_ready(code: &str, reason: impl Into<String>) -> Self {
        Self::NotReady {
            code: code.to_owned(),
            reason: reason.into(),
            held: None,
        }
    }

    pub(crate) fn rejected(code: &str, message: impl Into<String>) -> Self {
        Self::Rejected {
            code: code.to_owned(),
            message: message.into(),
        }
    }

    pub(crate) fn uncertain(code: &str, reason: impl Into<String>) -> Self {
        Self::Uncertain {
            code: code.to_owned(),
            reason: reason.into(),
        }
    }

    pub(crate) fn accepted(code: &str) -> Self {
        Self::Accepted {
            code: code.to_owned(),
        }
    }

    pub(crate) fn reason(&self) -> Option<&str> {
        match self {
            Self::NotReady { reason, .. } | Self::Uncertain { reason, .. } => Some(reason),
            _ => None,
        }
    }
}

/// `{"result":"saved"}` or `{"result":"not_ready","reason":"..."}`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "result", rename_all = "snake_case")]
pub enum SaveResult {
    Saved,
    NotReady { reason: String },
}

impl SaveResult {
    pub(crate) fn not_ready(reason: impl Into<String>) -> Self {
        Self::NotReady {
            reason: reason.into(),
        }
    }
}

/// `{"result":"started"}`, `{"result":"already_started"}` (also a success),
/// or `{"result":"not_ready","reason":"..."}`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "result", rename_all = "snake_case")]
pub enum StartResult {
    Started,
    AlreadyStarted,
    NotReady { reason: String },
}

impl StartResult {
    pub(crate) fn not_ready(reason: impl Into<String>) -> Self {
        Self::NotReady {
            reason: reason.into(),
        }
    }
}

/// What the app reads of TOM: whether the helper inside TOM answered, so
/// TOM is up rather than still starting, and the `.tdf` TOM saves the open
/// tournament to, as TOM keeps it.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Status {
    pub answering: bool,
    pub file: Option<PathBuf>,
}

/// Runs entries in order, vetting each, and stops at the first one that is
/// not accepted: the rest are reported not ready without being sent, so
/// nothing lands after a result someone still has to look at.
pub(crate) fn submit_each(
    entries: &[Entry],
    mut send: impl FnMut(&Entry) -> SubmitResult,
) -> Vec<SubmitResult> {
    let mut halted: Option<String> = None;
    entries
        .iter()
        .map(|entry| {
            let code = entry.code.as_str();
            if let Some(reason) = &halted {
                return SubmitResult::not_ready(code, reason.clone());
            }
            let result = match crate::code::vet(entry) {
                Ok(()) => send(entry),
                Err(message) => SubmitResult::rejected(code, message),
            };
            if !matches!(result, SubmitResult::Accepted { .. }) {
                halted = Some(halted_by(code, &result));
            }
            result
        })
        .collect()
}

fn halted_by(code: &str, result: &SubmitResult) -> String {
    match result.reason() {
        Some(reason) => format!("Not sent: {reason}"),
        None => format!("Not sent, because {code} before it was not accepted."),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::code::entry;

    #[test]
    fn serializes_the_documented_shapes() {
        let json = serde_json::to_string(&[
            SubmitResult::accepted("21113"),
            SubmitResult::rejected("21114", "bad"),
            SubmitResult::not_ready("21121", "closed"),
        ])
        .unwrap();
        assert_eq!(
            json,
            r#"[{"result":"accepted","code":"21113"},{"result":"rejected","code":"21114","message":"bad"},{"result":"not_ready","code":"21121","reason":"closed"}]"#
        );
        assert_eq!(
            serde_json::to_string(&StartResult::AlreadyStarted).unwrap(),
            r#"{"result":"already_started"}"#
        );
    }

    #[test]
    fn stops_at_the_first_entry_that_is_not_accepted() {
        let entries = [
            entry(2, None, 1, 1, 1, "21113"),
            entry(2, None, 1, 2, 1, "21212"),
            entry(2, None, 1, 3, 1, "21311"),
        ];
        let mut sent = Vec::new();
        let results = submit_each(&entries, |entry| {
            sent.push(entry.code.clone());
            if entry.code == "21212" {
                SubmitResult::rejected(&entry.code, "TOM said no")
            } else {
                SubmitResult::accepted(&entry.code)
            }
        });
        assert_eq!(sent, ["21113", "21212"]);
        assert_eq!(
            results[2],
            SubmitResult::not_ready(
                "21311",
                "Not sent, because 21212 before it was not accepted."
            )
        );
    }

    #[test]
    fn never_sends_a_bad_code_or_anything_after_it() {
        let entries = [
            entry(2, None, 1, 1, 1, "21114"),
            entry(2, None, 1, 1, 1, "21113"),
        ];
        let mut sent = 0;
        let results = submit_each(&entries, |entry| {
            sent += 1;
            SubmitResult::accepted(&entry.code)
        });
        assert_eq!(sent, 0);
        assert!(matches!(results[0], SubmitResult::Rejected { .. }));
        assert!(matches!(results[1], SubmitResult::NotReady { .. }));
    }

    #[test]
    fn passes_on_why_tom_was_not_ready() {
        let entries = [
            entry(2, None, 1, 1, 2, "21121"),
            entry(2, None, 1, 1, 3, "21139"),
        ];
        let results = submit_each(&entries, |entry| {
            SubmitResult::not_ready(&entry.code, "TOM closed")
        });
        assert_eq!(
            results[1],
            SubmitResult::not_ready("21139", "Not sent: TOM closed")
        );
    }
}
