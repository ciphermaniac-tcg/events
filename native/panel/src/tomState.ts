/**
 * TOM as the app sees it: where its program is, whether it runs, and which
 * way codes reach it. The status is asked again every two seconds, since TOM
 * opens and closes on its own.
 */

import { createSignal, onCleanup, onMount } from 'solid-js';
import type { TomMode, TomStatus } from '../../../shared/native/tomCommands';
import { pickFile } from './tdfFile';
import { errorText, tom } from './tom';

const POLL_MS = 2000;

export function createTomState() {
  const [status, setStatus] = createSignal<TomStatus | null>(null);
  const [mode, setMode] = createSignal<TomMode>('keys');
  const [error, setError] = createSignal<string | null>(null);

  async function refresh() {
    try {
      setStatus(await tom.status());
    } catch (err) {
      setError(errorText(err));
    }
  }

  async function run(step: () => Promise<unknown>) {
    try {
      await step();
      setError(null);
    } catch (err) {
      setError(errorText(err));
    }
    await refresh();
  }

  /** Without a known location, takes the one the app finds on its own. */
  async function start() {
    setMode(await tom.getMode());
    if (!(await tom.status()).path) {
      const found = await tom.detect();
      if (found) {
        await tom.setPath(found);
      }
    }
  }

  onMount(() => {
    void run(start);
    const timer = setInterval(() => void refresh(), POLL_MS);
    onCleanup(() => clearInterval(timer));
  });

  return {
    status,
    mode,
    error,
    launch: () => run(() => tom.launch()),
    locate: () =>
      run(async () => {
        const path = await pickFile();
        if (path) {
          await tom.setPath(path);
        }
      }),
    choose: (next: TomMode) =>
      run(async () => {
        await tom.setMode(next);
        setMode(next);
      })
  };
}

export type TomState = ReturnType<typeof createTomState>;
