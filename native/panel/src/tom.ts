/** The app's TOM commands, through Tauri's own invoke. */

import { invoke } from '@tauri-apps/api/core';
import { tomCommands } from '../../../shared/native/tomCommands';

export const tom = tomCommands(invoke);

/** What a failed command or file call says; Tauri rejects with a plain string. */
export const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));
