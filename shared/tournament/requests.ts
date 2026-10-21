/**
 * What a player asks staff for from the event's page: to drop (leave at
 * the end of the round) or for someone to come over. Nothing happens until
 * staff answer: a drop is confirmed or declined, a contact marked done.
 * Each player holds at most one request of each kind; asking again after an
 * answer starts a new one, with a new ID, so an answer meant for an earlier
 * request never lands on a later one.
 *
 * A cancelled request stays, marked, so a player cannot cancel and ask
 * again faster than REQUEST_COOLDOWN_MS.
 *
 * Staff see who answered and when; the public copy keys a request by the
 * player's public key and leaves the staff member out.
 */

import { msg } from '../i18n.js';
export const REQUEST_KINDS = ['drop', 'staff'] as const;
export type RequestKind = (typeof REQUEST_KINDS)[number];

export type RequestStatus = 'open' | 'accepted' | 'declined' | 'done' | 'cancelled';
export type RequestAnswer = Exclude<RequestStatus, 'open' | 'cancelled'>;

/** How soon a player may ask again after cancelling a request of the same kind. */
export const REQUEST_COOLDOWN_MS = 30_000;

export const TOO_SOON = msg('Wait a moment before asking again');

export interface PlayerRequest {
  /** Names this request, so staff answer the one they saw. */
  id: string;
  /** The player's event ID; their public key in the public copy. */
  player: string;
  kind: RequestKind;
  /** When the player asked, epoch milliseconds. */
  at: number;
  status: RequestStatus;
  /** The staff member who answered, by name; staff only. */
  by?: string;
  /** When staff answered, or the player cancelled. */
  answeredAt?: number;
}

/**
 * Requests as stored, each with its ID. One stored before requests had IDs
 * takes one from what it already holds, which a player holds one of per
 * kind: the same on every read, so staff can answer it, and kept by the
 * next write of the event.
 */
export const withRequestIds = (stored: readonly (Omit<PlayerRequest, 'id'> & { id?: string })[]): PlayerRequest[] =>
  stored.map(({ id, ...request }) => ({
    ...request,
    id: id || `legacy:${request.player}:${request.kind}:${request.at}`
  }));

/** The answers each kind takes: a drop is confirmed or declined, a contact is done. */
const ANSWERS: Record<RequestKind, readonly RequestAnswer[]> = {
  drop: ['accepted', 'declined'],
  staff: ['done']
};

export const isRequestKind = (value: unknown): value is RequestKind => REQUEST_KINDS.includes(value as RequestKind);

export const isAnswerFor = (kind: RequestKind, value: unknown): value is RequestAnswer =>
  ANSWERS[kind].includes(value as RequestAnswer);

/** Whether `value` answers a request of some kind. */
export const isAnswer = (value: unknown): value is RequestAnswer =>
  REQUEST_KINDS.some(kind => isAnswerFor(kind, value));

const same = (request: PlayerRequest, player: string, kind: RequestKind) =>
  request.player === player && request.kind === kind;

/** The player's request of `kind`, if they have made one. */
export const requestOf = (requests: readonly PlayerRequest[], player: string, kind: RequestKind) =>
  requests.find(request => same(request, player, kind));

/** A request that still asks something: neither cancelled nor (for the player) gone. */
export const isLive = (request: PlayerRequest | undefined): request is PlayerRequest =>
  request !== undefined && request.status !== 'cancelled';

/** The open drop requests from `players`, oldest first: each waits on staff before the next round pairs them. */
export const openDrops = (requests: readonly PlayerRequest[], players: readonly string[]): PlayerRequest[] =>
  requests
    .filter(request => request.kind === 'drop' && request.status === 'open' && players.includes(request.player))
    .sort((a, b) => a.at - b.at);

/**
 * The list with the player's new request; null when an open one of the same
 * kind already stands, so nothing changes; why not when they cancelled one
 * too recently.
 */
export function fileRequest(
  requests: readonly PlayerRequest[],
  ask: { id: string; player: string; kind: RequestKind; at: number }
): PlayerRequest[] | string | null {
  const { id, player, kind, at } = ask;
  const current = requestOf(requests, player, kind);
  if (current?.status === 'open') {
    return null;
  }
  if (current?.status === 'cancelled' && at - (current.answeredAt ?? 0) < REQUEST_COOLDOWN_MS) {
    return TOO_SOON;
  }
  return [...requests.filter(request => !same(request, player, kind)), { id, player, kind, at, status: 'open' }];
}

/** The list with the player's open request of `kind` cancelled at `at`, or why it cannot be. */
export function cancelRequest(
  requests: readonly PlayerRequest[],
  ask: { player: string; kind: RequestKind; at: number }
): PlayerRequest[] | string {
  const open = requestOf(requests, ask.player, ask.kind);
  if (open?.status !== 'open') {
    return msg('Staff have already answered');
  }
  const cancelled: PlayerRequest = { ...open, status: 'cancelled', answeredAt: ask.at };
  return requests.map(request => (request === open ? cancelled : request));
}

/** The list with staff's answer to the open request `id`, or why it cannot take it. */
export function answerRequest(
  requests: readonly PlayerRequest[],
  answer: { id: string; status: RequestAnswer; by: string; at: number }
): PlayerRequest[] | string {
  const open = requests.find(request => request.id === answer.id);
  if (open?.status !== 'open') {
    return msg('That request was already answered or cancelled');
  }
  if (!isAnswerFor(open.kind, answer.status)) {
    return msg('Not an answer to that request');
  }
  const answered = { ...open, status: answer.status, by: answer.by, answeredAt: answer.at };
  return requests.map(request => (request === open ? answered : request));
}

/** The requests as anyone may read them: by public key, without who on staff answered. */
export function publicRequests(requests: readonly PlayerRequest[], keys: Record<string, string>): PlayerRequest[] {
  return requests.flatMap(({ by: _by, ...request }) => {
    const key = keys[request.player];
    return key ? [{ ...request, player: key }] : [];
  });
}
