//! Checks a result before its code goes anywhere near TOM.
//!
//! A code is `pod [flight] round table outcome check`, and how TOM splits it
//! depends on the event: whether the pod has flights, how many digits the
//! round takes. A code alone can read several ways (`211014` is round 1,
//! table 10 without flights, but flight 1, round 1, table 0 with them), so
//! every code arrives with the layout it was built from. The code must spell
//! exactly that layout, and table 0, where byes and forced losses sit, is
//! refused outright: TOM would accept a code for one.

use serde::Deserialize;

const MIN_LEN: usize = 5;
const MAX_LEN: usize = 10;
const MAX_VALUE: u64 = 2_147_483_647;
const OUTCOMES: [u8; 5] = [0, 1, 2, 3, 6];
const PODS: [u8; 6] = [0, 1, 2, 8, 9, 10];
const MAX_TABLE_DIGITS: usize = 3;

/// One result to enter, as the slip-code builder computed it from TOM's file.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
pub struct Entry {
    /// TOM's category code: 0, 1, 2, 8, 9 or 10.
    pub pod: u8,
    /// Only when the pod is flighted and the round is Swiss.
    #[serde(default)]
    pub flight: Option<u8>,
    pub round: u8,
    pub table: u16,
    /// 0 pending, 1 player 1 wins, 2 player 2 wins, 3 tie, 6 double loss.
    pub outcome: u8,
    pub code: String,
    /// The TOM player IDs in seats 1 and 2: the helper enters the code only
    /// when TOM's live pairings seat exactly these two at that table.
    pub p1: String,
    pub p2: String,
}

/// Returns why TOM must not be sent this entry, or `Ok` when it may be.
///
/// # Errors
/// A sentence for the person who reported the result.
pub fn vet(entry: &Entry) -> Result<(), String> {
    let code = entry.code.as_str();
    let digits = digits(code)?;
    check_layout(entry)?;
    let (body, tail) = digits.split_at(digits.len() - 2);
    if tail[1] != check_digit(&digits[..digits.len() - 1]) {
        return Err(format!("{code} has the wrong check digit."));
    }
    let prefix = prefix(entry);
    let table = body
        .get(prefix.len()..)
        .filter(|_| code.starts_with(&prefix));
    let spelled = table
        .filter(|t| (1..=MAX_TABLE_DIGITS).contains(&t.len()))
        .map(number);
    if spelled != Some(u32::from(entry.table)) || tail[0] != entry.outcome {
        return Err(format!(
            "{code} does not match pod {}, round {}, table {}, outcome {}.",
            entry.pod, entry.round, entry.table, entry.outcome
        ));
    }
    Ok(())
}

fn check_layout(entry: &Entry) -> Result<(), String> {
    let code = &entry.code;
    if entry.table == 0 {
        return Err(format!(
            "{code} is for table 0, where byes and forced losses sit."
        ));
    }
    if !PODS.contains(&entry.pod) {
        return Err(format!(
            "{code} names pod {}, which TOM does not use.",
            entry.pod
        ));
    }
    let flight_ok = entry.flight.is_none_or(|flight| (1..=9).contains(&flight));
    let round_ok = (1..=99).contains(&entry.round);
    let table_ok = entry.table < 1000;
    if !(flight_ok && round_ok && table_ok) {
        return Err(format!(
            "{code} has a flight, round or table TOM cannot print."
        ));
    }
    if !OUTCOMES.contains(&entry.outcome) {
        return Err(format!("{code} has an outcome TOM does not accept."));
    }
    Ok(())
}

/// Pod, flight and round as TOM prints them before the table.
fn prefix(entry: &Entry) -> String {
    let flight = entry
        .flight
        .map(|flight| flight.to_string())
        .unwrap_or_default();
    format!("{}{flight}{}", entry.pod, entry.round)
}

fn number(digits: &[u8]) -> u32 {
    digits
        .iter()
        .fold(0, |acc, &digit| acc * 10 + u32::from(digit))
}

fn digits(code: &str) -> Result<Vec<u8>, String> {
    if !code.bytes().all(|b| b.is_ascii_digit()) {
        return Err(format!(
            "{code} is not a result code: it must be digits only."
        ));
    }
    if !(MIN_LEN..=MAX_LEN).contains(&code.len()) {
        return Err(format!("{code} is not a result code: wrong length."));
    }
    if code.parse::<u64>().map_or(true, |value| value > MAX_VALUE) {
        return Err(format!("{code} is not a result code: too large for TOM."));
    }
    Ok(code.bytes().map(|b| b - b'0').collect())
}

/// Weights 1, 2, 1, 2... from the left; products summed without digit splitting.
pub(crate) fn check_digit(digits: &[u8]) -> u8 {
    let sum: u32 = digits
        .iter()
        .zip([1u32, 2].into_iter().cycle())
        .map(|(&digit, weight)| u32::from(digit) * weight)
        .sum();
    u8::try_from((10 - sum % 10) % 10).unwrap_or(0)
}

#[cfg(test)]
pub(crate) fn entry(
    pod: u8,
    flight: Option<u8>,
    round: u8,
    table: u16,
    outcome: u8,
    code: &str,
) -> Entry {
    Entry {
        pod,
        flight,
        round,
        table,
        outcome,
        code: code.to_owned(),
        p1: "1".to_owned(),
        p2: "2".to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The entries the panel and the site build (shared/tournament/slipCodes.ts)
    /// send `flight` as null when the code has none.
    #[test]
    fn reads_entries_as_the_webview_sends_them() {
        let sent = r#"[
            {"pod":2,"flight":null,"round":1,"table":3,"outcome":1,"code":"210319","p1":"1","p2":"2"},
            {"pod":2,"flight":2,"round":1,"table":30,"outcome":2,"code":"2213023","p1":"1","p2":"2"}
        ]"#;
        let entries: Vec<Entry> = serde_json::from_str(sent).expect("the webview's entries");
        assert_eq!(
            entries,
            [
                entry(2, None, 1, 3, 1, "210319"),
                entry(2, Some(2), 1, 30, 2, "2213023"),
            ]
        );
        assert!(entries.iter().all(|entry| vet(entry).is_ok()));
    }

    #[test]
    fn accepts_codes_tom_printed_with_their_layout() {
        let printed = [
            entry(2, None, 1, 1, 1, "21113"),
            entry(2, None, 1, 1, 3, "21139"),
            entry(2, None, 1, 3, 1, "210319"),
            entry(2, Some(1), 1, 9, 1, "2110914"),
            entry(2, Some(2), 1, 30, 2, "2213023"),
            entry(0, None, 1, 1, 3, "01131"),
            entry(2, None, 1, 205, 2, "2120525"),
            entry(2, None, 11, 1, 1, "211112"),
        ];
        for entry in printed {
            assert_eq!(vet(&entry), Ok(()), "{entry:?}");
        }
    }

    #[test]
    fn computes_the_documented_check_digit() {
        assert_eq!(check_digit(&[2, 1, 1, 1]), 3);
    }

    #[test]
    fn refuses_a_code_that_reads_as_table_zero_in_a_flighted_pod() {
        // Without flights 211014 is round 1, table 10. In a pod with flights,
        // TOM reads flight 1, round 1, table 0: a bye.
        assert_eq!(vet(&entry(2, None, 1, 10, 1, "211014")), Ok(()));
        let error = vet(&entry(2, Some(1), 1, 10, 1, "211014")).unwrap_err();
        assert!(error.contains("does not match"), "{error}");
    }

    #[test]
    fn refuses_table_zero_and_mismatched_parts() {
        let cases = [
            (entry(2, None, 1, 0, 1, "21014"), "table 0"),
            (entry(2, None, 2, 1, 1, "21113"), "does not match"),
            (entry(2, None, 1, 1, 2, "21113"), "does not match"),
            (entry(1, None, 1, 1, 1, "21113"), "does not match"),
            (entry(3, None, 1, 1, 1, "31112"), "pod 3"),
            (entry(2, None, 1, 1, 4, "21145"), "outcome"),
        ];
        for (entry, expected) in cases {
            let error = vet(&entry).unwrap_err();
            assert!(error.contains(expected), "{entry:?}: {error}");
        }
    }

    #[test]
    fn refuses_malformed_codes() {
        let cases = [
            ("2111", "wrong length"),
            ("12345678901", "wrong length"),
            ("9999999999", "too large"),
            ("+21113", "digits only"),
            ("TIE12", "digits only"),
            ("21114", "check digit"),
        ];
        for (code, expected) in cases {
            let error = vet(&entry(2, None, 1, 1, 1, code)).unwrap_err();
            assert!(error.contains(expected), "{code}: {error}");
        }
    }
}
