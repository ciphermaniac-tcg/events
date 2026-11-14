/**
 * Which player the viewer of the public event page is, and what this device
 * remembers of it. See createMe.
 */

import { createEffect, createSignal, onMount } from 'solid-js';
import { keepBrowserMemory, readBrowserMemory } from '../../lib/tournament/browserMemory';
import type { PlayerClaim } from '../../../shared/tournament/identify';
import { isSanctioned, type PublishedView, type TournamentView } from '../../../shared/tournament/view';
import { identifyPlayer } from '../../lib/tournament/api';
import { DAY_MS } from '../../../shared/tournament/limits';
import type { Identified } from './Identify';

const meKey = (code: string) => `cm-tournament-me:${code}`;

/** An event that finished more than a day ago: its page no longer needs to know who the viewer is. */
export const pastEvent = (view: TournamentView, now: number) => view.settings.finished && now - view.updatedAt > DAY_MS;
const claimKey = (code: string) => `cm-tournament-player:${code}`;
/** A spectator put away "Which player are you?" for the event, on this device (see createMe). */
const watchKey = (code: string) => `cm-tournament-watching:${code}`;
const tokenKey = (code: string) => `cm-tournament-report:${code}`;

function storedClaim(code: string): PlayerClaim | null {
  try {
    return JSON.parse(readBrowserMemory(claimKey(code)) ?? 'null') as PlayerClaim | null;
  } catch {
    return null;
  }
}

/**
 * Sets or clears a remembered value. The report token and which player this
 * is (a public key) outlast the tab; the Player ID or name proving it does not.
 */
function keep(key: string, value: string | null) {
  keepBrowserMemory(key, value, key.startsWith('cm-tournament-report:') || key.startsWith('cm-tournament-me:'));
}

/**
 * What the device asks the server of its own accord once the page knows who
 * is signed in, once for each player the account is: an account that is the
 * player by its POP ID, where players report and this device holds no token
 * for them, says so, so its account holds the reporting seat if nobody does;
 * and a device that proved who it is before signing in, at an unsanctioned
 * event, says so again with its token, which makes that player the account's
 * Claim.
 */
export function accountStep(
  view: TournamentView,
  device: { claim: PlayerClaim | null; token: string | null }
): { claim: PlayerClaim; token?: string } | null {
  const { viewer, settings } = view;
  if (!viewer.signedIn || settings.finished) {
    return null;
  }
  if (viewer.via === 'pop' && viewer.claim && settings.playerReporting && !device.token) {
    return { claim: viewer.claim };
  }
  const { claim, token } = device;
  return viewer.via === null && !isSanctioned(view) && claim && token ? { claim, token } : null;
}

/**
 * Which player the viewer is: the one their account is (by its POP ID, or
 * its Claim), or the one they proved on this device with a Player ID or last
 * name (see Identify). A player marked on this device before proof was asked
 * for is not taken on its word, and what this device proved for another
 * player says nothing for the account's. The viewer reports from here when
 * this device holds the token, or when their account holds the player's
 * seat: its Claim does, and the server says so of its POP ID when asked. That
 * answer is the account's, not the device's: nothing of it is kept here, and
 * it counts only while the account is still that player.
 */
export function createMe(
  view: () => TournamentView,
  events: { onView: (view: PublishedView) => void; onLinked: () => void }
) {
  const code = () => view().code;
  const stored = storedClaim(code());
  const [claim, setClaim] = createSignal(stored);
  const [chosen, setChosen] = createSignal(readBrowserMemory(meKey(code()), true));
  const [reportToken, setReportToken] = createSignal(stored ? readBrowserMemory(tokenKey(code()), true) : null);
  /** The player whose seat the account holds, as the server last answered; no token goes with that. */
  const [accountSeat, setAccountSeat] = createSignal<string | null>(null);
  const [watching, setWatching] = createSignal(readBrowserMemory(watchKey(code()), true) !== null);
  /** Whether the viewer only watches: set from the question's close, and let go once they say who they are. */
  function watch(on: boolean) {
    keepBrowserMemory(watchKey(code()), on ? '1' : null, true);
    setWatching(on);
  }
  function identified(found: Identified) {
    watch(false);
    keep(meKey(code()), found.key);
    keep(claimKey(code()), found.lookup ? null : JSON.stringify(found.claim));
    setChosen(found.key);
    setClaim(found.lookup ? null : found.claim);
    // A new token when this device just became the one that reports; none kept for a lookup.
    const token = found.reportToken ?? (found.lookup ? null : reportToken());
    keep(tokenKey(code()), token);
    setReportToken(token);
    setAccountSeat(found.linked && found.reporter ? found.key : null);
    events.onView(found.view);
    // A Claim just made is news to the page's copy, which says who the viewer is as of its last API read.
    if (found.linked && view().viewer.me !== found.key) {
      events.onLinked();
    }
  }
  function forget() {
    [meKey, claimKey, tokenKey].forEach(key => keep(key(code()), null));
    setChosen(null);
    setClaim(null);
    setReportToken(null);
  }
  // A device that said who the player is before reporting took a token asks for one now, if nobody has it.
  async function claimNow(said: PlayerClaim, token?: string) {
    const answer = await identifyPlayer(code(), said, token).catch(() => null);
    if (answer?.key) {
      identified({ ...answer, claim: said, key: answer.key });
    }
  }
  /** Whether the account holds its player's seat by its POP ID: asked as the account, so the device keeps nothing. */
  async function seat(said: PlayerClaim) {
    const answer = await identifyPlayer(code(), said).catch(() => null);
    if (answer?.key) {
      setAccountSeat(answer.linked && answer.reporter ? answer.key : null);
      events.onView(answer.view);
    }
  }
  onMount(() => {
    const said = claim();
    if (said && !reportToken()) {
      void claimNow(said);
    }
  });
  // Which player this is, kept across tabs, is let go a day after the event finishes.
  createEffect(() => {
    if (chosen() !== null && pastEvent(view(), Date.now())) {
      keep(meKey(code()), null);
      setChosen(null);
    }
  });
  // A confirmed selection stays the displayed target even when another account player signs in.
  const selected = () => chosen() !== null;
  const looking = () => selected() && claim() === null;
  const me = () => chosen() ?? view().viewer.me;
  const ownClaim = () => (selected() ? claim() : (view().viewer.claim ?? null));
  const ownToken = () => (selected() ? reportToken() : null);
  const accountReports = () => {
    const { viewer } = view();
    return viewer.me !== null && viewer.me === me() && (accountSeat() === viewer.me || viewer.via === 'claim');
  };
  // The player the account last stepped as (see accountStep): it steps again as another, or once a report is refused.
  const [stepped, setStepped] = createSignal<string | null>(null);
  createEffect(() => {
    const as = view().viewer.me ?? '';
    const step = stepped() === as ? null : accountStep(view(), { claim: ownClaim(), token: ownToken() });
    if (step) {
      setStepped(as);
      void (step.token ? claimNow(step.claim, step.token) : seat(step.claim));
    }
  });
  return {
    me,
    claim: ownClaim,
    reportToken: ownToken,
    reports: () => !looking() && (ownToken() !== null || accountReports()),
    identified,
    forget,
    watching,
    watch: () => watch(true),
    /** A report was refused: the account's seat may have gone to another device since it last asked. */
    recheck: () => setStepped(null)
  };
}
