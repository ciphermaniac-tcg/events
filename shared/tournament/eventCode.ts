/** Codes are short enough to read aloud and type from a table sign: no 0/O or 1/I/L. */
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 6;

/** Whether `value` could be a code `length` long: an event's, or a public profile's address. */
export function isCode(value: string, length = CODE_LENGTH): boolean {
  return value.length === length && [...value].every(char => CODE_ALPHABET.includes(char));
}

/**
 * The event code in what a player typed or pasted: a bare code, a `/t/CODE`
 * path, or a link to this site (`host`) or ciphermaniac.com holding one.
 * Only that path is read, so an unrelated link never opens an event; null
 * when no code is there.
 */
export function eventCodeIn(typed: string, host = ''): string | null {
  const text = typed.replace(/\s+/g, '');
  const linked = /^(?:https?:\/\/)?([^/]+)?\/t\/([^/?#]+)/i.exec(text);
  const ours = (name = '') => !name || name === host || /(^|\.)ciphermaniac\.com$/i.test(name);
  if (linked && !ours(linked[1])) {
    return null;
  }
  const code = (linked?.[2] ?? text).toUpperCase();
  return isCode(code) ? code : null;
}
