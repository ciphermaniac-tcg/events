import type { PlayerReport } from '../../../shared/tournament/reports.js';
import type { D1Like, D1Statement } from '../types.js';

export interface ReportEvidence {
  version: number;
  report: PlayerReport;
  account: string | null;
  claimedAt: number | null;
}

/** Append filed reports in the event transaction; edits and staff acceptance never erase evidence. */
export function reportEvidenceWrites(
  db: D1Like,
  row: { code: string; version: number },
  evidence: Omit<ReportEvidence, 'version'>
): D1Statement[] {
  return [
    db
      .prepare(
        'INSERT INTO report_history (code, version, player_id, report, account_id, claimed_at) ' +
          'SELECT ?1, ?2, ?3, ?4, (SELECT id FROM users WHERE id = ?5), ?6 FROM tournaments WHERE code = ?1 AND version = ?7'
      )
      .bind(
        row.code,
        row.version + 1,
        evidence.report.by,
        JSON.stringify(evidence.report),
        evidence.account,
        evidence.claimedAt,
        row.version
      )
  ];
}

/** Staff-only history, including each prior version of a player's report. */
export async function reportEvidence(db: D1Like, code: string): Promise<ReportEvidence[]> {
  const { results } = await db
    .prepare(
      'SELECT version, report, account_id, claimed_at FROM report_history WHERE code = ? ORDER BY version, player_id'
    )
    .bind(code)
    .all<{ version: number; report: string; account_id: string | null; claimed_at: number | null }>();
  return results.map(row => ({
    version: row.version,
    report: JSON.parse(row.report) as PlayerReport,
    account: row.account_id,
    claimedAt: row.claimed_at
  }));
}
