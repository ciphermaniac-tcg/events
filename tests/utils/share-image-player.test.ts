/**
 * A player's share image as data: the public sheet's words and decks become
 * the head bar layout's scene, a hidden deck stays hidden, and a bye or a
 * missed round reads as the sheet reads it.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { swissStandings } from '../../shared/tournament/standings.ts';
import { parseTdf } from '../../shared/tournament/tdf.ts';
import type { Pod, Round } from '../../shared/tournament/types.ts';
import {
  assignKeys,
  DEFAULT_SETTINGS,
  publicDivisions,
  publicTournament,
  type TournamentView
} from '../../shared/tournament/view.ts';
import { headBarScene, type PlayerShare, type ShareRound } from '../../src/lib/shareImage/headBar.ts';
import { playerShare, type SheetData } from '../../src/lib/shareImage/playerShare.ts';
import type { Op, TextOp } from '../../src/lib/shareImage/scene.ts';
import { namesById } from '../../src/lib/tournament/present.ts';

/** Every character half its size wide. */
const measure = (text: string, size: number) => text.length * size * 0.5;

const texts = (ops: readonly Op[]) => ops.filter((op): op is TextOp => op.kind === 'text');
const textOf = (ops: readonly Op[], words: string) => {
  const found = texts(ops).find(op => op.text === words);
  assert.ok(found, `"${words}" is drawn`);
  return found;
};
const sprites = (ops: readonly Op[]) => ops.flatMap(op => (op.kind === 'sprite' ? [op.slug] : []));

const row = (over: Partial<ShareRound>): ShareRound => ({
  label: '1',
  cut: false,
  opponent: { name: 'Eli B.', record: '2-1-0', deck: { label: 'Gholdengo', sprites: ['gholdengo'] } },
  note: 'Missed round',
  mark: 'W',
  letter: 'W',
  ...over
});

const SHARE: PlayerShare = {
  event: 'Thursday league night',
  date: 'Nov 6, 2026',
  name: 'Zoë H.',
  place: '1st in Masters',
  deck: { label: 'Dragapult Dusknoir', sprites: ['dragapult', 'dusknoir', 'extra'] },
  record: '3-0-0',
  points: '9',
  owp: '66.67%',
  oowp: '59.26%',
  rounds: [
    row({}),
    row({ label: '2', opponent: { name: 'Kiah P.', record: '2-1-0', deck: null }, mark: 'L', letter: 'L' }),
    row({ label: '3', opponent: null, note: 'Bye' }),
    row({ label: 'Final', cut: true, mark: 'T', letter: 'T' })
  ]
};

test('the head bar carries the event, its date and the site, and the player leads under it', () => {
  const scene = headBarScene(SHARE, measure, 'light');
  assert.equal(scene.width, 440);
  assert.equal(scene.height, 62 + 20 + 36 + 32 + 50 + 30 + 4 * 40 + 18);
  assert.deepEqual(scene.background, [255, 255, 255]);
  assert.deepEqual(scene.ops[0], { kind: 'rect', x: 0, y: 0, w: 440, h: 62, color: [0x1c, 0x1d, 0x1b], r: 0 });
  assert.equal(textOf(scene.ops, 'Thursday league night').maxWidth, 400);
  assert.equal(textOf(scene.ops, 'events.ciphermaniac.com').align, 'right');
  textOf(scene.ops, 'Nov 6, 2026');
  textOf(scene.ops, '1st in Masters · Dragapult Dusknoir');
  for (const figure of ['3-0-0', '9', '66.67%', '59.26%']) {
    assert.equal(textOf(scene.ops, figure).tnum, true);
  }
  // Two of the player's sprites at most, then their opponents', one scale across a row.
  assert.deepEqual(sprites(scene.ops), ['dragapult', 'dusknoir', 'gholdengo', 'gholdengo']);
  assert.ok(scene.ops.every(op => op.kind !== 'sprite' || op.scale === 1));
});

test('dark mode sets the image on the page’s dark ground', () => {
  const scene = headBarScene(SHARE, measure, 'dark');
  assert.deepEqual(scene.background, [0x16, 0x16, 0x15]);
  assert.deepEqual(textOf(scene.ops, 'Zoë H.').color, [0xf5, 0xf3, 0xeb]);
});

test('an opponent whose deck is hidden keeps the name column, and a bye reads muted with no record', () => {
  const { ops } = headBarScene(SHARE, measure, 'light');
  const shown = textOf(ops, 'Eli B.');
  const hidden = textOf(ops, 'Kiah P.');
  assert.equal(hidden.x, shown.x, 'names line up whether or not the deck shows');
  assert.ok(shown.x > 70, 'past the sprite slot');
  const bye = textOf(ops, 'Bye');
  assert.equal(bye.x, 70);
  assert.equal(bye.weight, 400);
  assert.equal(texts(ops).filter(op => op.text === '2-1-0').length, 3, 'a record on every row with an opponent');
  // The cut stage sits a size down in the round column.
  assert.equal(textOf(ops, 'Final').size, 12);
  assert.equal(textOf(ops, '1').size, 14);
});

test('with every deck hidden, no sprite is drawn and names start at the column', () => {
  const hidden: PlayerShare = {
    ...SHARE,
    deck: null,
    rounds: SHARE.rounds.map(round => ({ ...round, opponent: round.opponent && { ...round.opponent, deck: null } }))
  };
  const { ops } = headBarScene(hidden, measure, 'light');
  assert.deepEqual(sprites(ops), []);
  assert.equal(textOf(ops, 'Eli B.').x, 70);
  assert.equal(textOf(ops, 'Zoë H.').x, 20);
  textOf(ops, '1st in Masters');
});

test('a win fills its square marigold, a loss is outlined on the ground', () => {
  const { ops } = headBarScene(SHARE, measure, 'light');
  const square = (letter: string) => {
    const at = ops.indexOf(texts(ops).find(op => op.text === letter && op.weight === 700) as Op);
    const fill = ops[at - 1];
    assert.equal(fill?.kind, 'rect');
    return fill.kind === 'rect' ? fill.color : null;
  };
  assert.deepEqual(square('W'), [0xee, 0xaa, 0x11]);
  assert.deepEqual(square('L'), [255, 255, 255]);
  assert.deepEqual(square('T'), [0xe3, 0xe4, 0xe1]);
});

// ----- the sheet's data ------------------------------------------------------

const tdf = parseTdf(readFileSync(new URL('../fixtures/tdf/challenge-midevent.tdf', import.meta.url), 'utf8'));
const tournament = publicTournament(tdf, assignKeys(tdf, {}));
const swiss = tournament.pods[0]!;

/** The fixture's two rounds, then a quarterfinal and a final for the cut labels. */
function withCut(pod: Pod): Pod {
  const first = pod.rounds[0]!;
  const cut = (number: number, tables: number): Round => ({
    ...first,
    number,
    kind: 'elimination',
    matches: first.matches.slice(0, tables).map(match => ({ ...match, outcome: 'p1' }))
  });
  return { ...pod, rounds: [...pod.rounds, cut(3, 4), cut(4, 1)] };
}

const VIEW: TournamentView = {
  code: 'WATCHR',
  mode: 'tom',
  version: 1,
  updatedAt: 0,
  tournament,
  pending: [],
  reports: [],
  divisions: publicDivisions(tdf, assignKeys(tdf, {}), Date.UTC(2026, 9, 3)),
  decks: {},
  settings: { ...DEFAULT_SETTINGS, startsAt: '2026-10-03T10:00' },
  viewer: { role: null, me: null, via: null, signedIn: false }
};

function sheet(pod: Pod, playerId: string, decks: Record<string, string> = {}): SheetData {
  const standings = swissStandings(pod, tournament.players);
  const standing = standings.find(entry => entry.playerId === playerId);
  assert.ok(standing);
  return {
    view: VIEW,
    pod,
    playerId,
    standing,
    place: '1st in Masters',
    names: namesById(tournament),
    records: new Map(standings.map(entry => [entry.playerId, 'r'])),
    decks,
    sprites: label => (label === 'Gardevoir ex' ? ['gardevoir', 'kirlia'] : ['substitute'])
  };
}

const roundOne = swiss.rounds[0]!;
const byePlayer = roundOne.matches.find(match => match.p2 === null && match.outcome === 'bye')!.p1;
const missedPlayer = roundOne.matches.find(match => match.p2 === null && match.outcome === 'loss')!.p1;

test('the sheet’s words, formatted: event, day, name, place, figures', () => {
  const share = playerShare(sheet(swiss, byePlayer));
  assert.equal(share.event, 'Fixture Challenge & Friends');
  assert.match(share.date, /Oct 3/);
  assert.equal(share.name, namesById(tournament).get(byePlayer));
  assert.equal(share.place, '1st in Masters');
  assert.match(share.record, /^\d+-\d+-\d+$/);
  assert.match(share.owp, /^\d+\.\d\d%$/);
  assert.equal(share.deck, null, 'no deck where the page shows none');
});

test('a bye and a missed round read as the sheet reads them, and a round still playing is left out', () => {
  const bye = playerShare(sheet(swiss, byePlayer)).rounds[0]!;
  assert.deepEqual([bye.opponent, bye.note, bye.mark, bye.letter, bye.label], [null, 'Bye', 'W', 'W', '1']);
  const missed = playerShare(sheet(swiss, missedPlayer)).rounds[0]!;
  assert.deepEqual([missed.opponent, missed.note, missed.mark], [null, 'Missed round', 'L']);
  const pending = swiss.rounds[1]!.matches.find(match => match.p2 !== null && match.outcome === 'pending')!;
  const { rounds } = playerShare(sheet(swiss, pending.p1));
  assert.deepEqual(
    rounds.map(entry => entry.label),
    ['1'],
    'round 2 is still on'
  );
});

test('opponents carry their name, record and deck only where the page shows the deck', () => {
  const played = roundOne.matches.find(match => match.p2 !== null)!;
  const share = playerShare(sheet(swiss, played.p1, { [played.p2!]: 'Gardevoir ex', [played.p1]: 'Rogue' }));
  assert.deepEqual(share.deck, { label: 'Rogue', sprites: ['substitute'] });
  assert.deepEqual(share.rounds[0]!.opponent, {
    name: namesById(tournament).get(played.p2!),
    record: 'r',
    deck: { label: 'Gardevoir ex', sprites: ['gardevoir', 'kirlia'] }
  });
  const hidden = playerShare(sheet(swiss, played.p1)).rounds[0]!.opponent;
  assert.equal(hidden?.deck, null);
});

test('top cut rounds are named by the players still in: Top 8, then the final', () => {
  const pod = withCut(swiss);
  const player = pod.rounds[3]!.matches[0]!.p1;
  const share = playerShare(sheet(pod, player));
  assert.deepEqual(
    share.rounds.filter(entry => entry.cut).map(entry => entry.label),
    ['Top 8', 'Final']
  );
});

test('the match for third, played in the final’s round, reads as 3rd rather than as the final', () => {
  const first = swiss.rounds[0]!;
  const [a, b] = first.matches.filter(match => match.p2 !== null);
  const semis: Round = {
    ...first,
    number: 3,
    kind: 'elimination',
    matches: [a!, b!].map(m => ({ ...m, outcome: 'p1' }))
  };
  const final: Round = {
    ...first,
    number: 4,
    kind: 'elimination',
    matches: [
      { ...a!, p1: a!.p1, p2: b!.p1, outcome: 'p1' },
      { ...b!, p1: a!.p2!, p2: b!.p2, outcome: 'p2' }
    ]
  };
  const pod = { ...swiss, rounds: [...swiss.rounds, semis, final] };
  const label = (id: string) => playerShare(sheet(pod, id)).rounds.at(-1)!.label;
  assert.equal(label(a!.p1), 'Final');
  assert.equal(label(a!.p2!), '3rd');
});
