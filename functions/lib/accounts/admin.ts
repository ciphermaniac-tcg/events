import { readAccountRole } from '../../../shared/accounts/roles.js';
import type { FoundAccount } from '../../../shared/accounts/types.js';

export interface FoundAccountRow {
  id: string;
  name: string;
  email: string | null;
  pop_id: string | null;
  role: string | null;
  created_at: number;
}

export const foundAccount = (row: FoundAccountRow): FoundAccount => ({
  id: row.id,
  name: row.name,
  email: row.email,
  popId: row.pop_id,
  role: readAccountRole(row.role),
  createdAt: row.created_at
});
