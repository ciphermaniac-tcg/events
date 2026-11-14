//! Checks a result code before it goes anywhere near TOM.
//!
//! A code is `pod [flight] round table outcome check`. Pod, flight, round and
//! table widths depend on the event, so a code alone can parse several ways.
//! A code is refused when no parse fits, or when every parse lands on table 0:
//! byes and forced losses sit there and TOM would wrongly accept a code for one.
//! Codes whose table the event layout decides are trusted to come from the
//! slip-code builder, which never emits table 0.

const MIN_LEN: usize = 5;
const MAX_LEN: usize = 10;
const MAX_VALUE: u64 = 2_147_483_647;
const OUTCOMES: [u8; 5] = [0, 1, 2, 3, 6];
const SINGLE_DIGIT_PODS: [u8; 5] = [0, 1, 2, 8, 9];
const MAX_TABLE_DIGITS: usize = 3;

/// Returns why TOM must not be sent this code, or `Ok` when it may be.
///
/// # Errors
/// A sentence for the person who reported the result.
pub fn vet(code: &str) -> Result<(), String> {
    let digits = digits(code)?;
    let (body, tail) = digits.split_at(digits.len() - 2);
    if !OUTCOMES.contains(&tail[0]) {
        return Err(format!("{code} has an outcome digit TOM does not accept."));
    }
    if tail[1] != check_digit(&digits[..digits.len() - 1]) {
        return Err(format!("{code} has the wrong check digit."));
    }
    let tables = tables(body);
    if tables.is_empty() {
        return Err(format!("{code} does not match any pod and round TOM uses."));
    }
    if tables.iter().all(|&table| table == 0) {
        return Err(format!(
            "{code} is for table 0, where byes and forced losses sit."
        ));
    }
    Ok(())
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

/// Every table number the body could name, across all plausible layouts.
fn tables(body: &[u8]) -> Vec<u32> {
    let after_pod = pod_len(body).map_or(&[][..], |len| &body[len..]);
    let mut out = Vec::new();
    for after_flight in [Some(after_pod), skip_flight(after_pod)]
        .into_iter()
        .flatten()
    {
        for round_len in [1, 2] {
            out.extend(table_after_round(after_flight, round_len));
        }
    }
    out
}

/// Pod 10 takes two digits; other pods one. "10" can only be pod 10, since
/// neither a flight nor a round starts with 0.
fn pod_len(body: &[u8]) -> Option<usize> {
    match body {
        [1, 0, ..] => Some(2),
        [pod, ..] if SINGLE_DIGIT_PODS.contains(pod) => Some(1),
        _ => None,
    }
}

fn skip_flight(rest: &[u8]) -> Option<&[u8]> {
    match rest {
        [flight, tail @ ..] if *flight != 0 => Some(tail),
        _ => None,
    }
}

fn table_after_round(rest: &[u8], round_len: usize) -> Option<u32> {
    let table = rest.get(round_len..)?;
    let round_ok = rest.first().is_some_and(|&first| first != 0);
    if !round_ok || table.is_empty() || table.len() > MAX_TABLE_DIGITS {
        return None;
    }
    Some(
        table
            .iter()
            .fold(0, |acc, &digit| acc * 10 + u32::from(digit)),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn with_check(base: &str) -> String {
        let digits: Vec<u8> = base.bytes().map(|b| b - b'0').collect();
        format!("{base}{}", check_digit(&digits))
    }

    #[test]
    fn accepts_codes_tom_printed() {
        for code in [
            "21113", "21121", "21139", "210319", "2110914", "2213023", "01131", "2100113",
            "2120525", "219918", "211112",
        ] {
            assert_eq!(vet(code), Ok(()), "{code}");
        }
    }

    #[test]
    fn computes_the_documented_check_digit() {
        assert_eq!(with_check("2111"), "21113");
    }

    #[test]
    fn refuses_codes_that_can_only_be_table_zero() {
        for base in ["2101", "21001", "210001", "2110001", "10101"] {
            let code = with_check(base);
            let error = vet(&code).unwrap_err();
            assert!(error.contains("table 0"), "{code}: {error}");
        }
    }

    #[test]
    fn keeps_tables_ending_in_zero() {
        // Pod 2, round 1, table 10: also parses as flight 1, round 1, table 0.
        assert_eq!(vet(&with_check("21101")), Ok(()));
        assert_eq!(vet(&with_check("211002")), Ok(()));
    }

    #[test]
    fn refuses_malformed_codes() {
        let cases = [
            ("2111", "wrong length"),
            ("12345678901", "wrong length"),
            ("9999999999", "too large"),
            ("+21113", "digits only"),
            ("TIE12", "digits only"),
            (" 21113", "digits only"),
            ("21114", "check digit"),
            ("21145", "outcome digit"),
        ];
        for (code, expected) in cases {
            let error = vet(code).unwrap_err();
            assert!(error.contains(expected), "{code}: {error}");
        }
    }

    #[test]
    fn refuses_unknown_pods() {
        let error = vet(&with_check("3111")).unwrap_err();
        assert!(error.contains("pod"), "{error}");
    }
}
