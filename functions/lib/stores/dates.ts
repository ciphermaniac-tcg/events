/** Date formatters reused while mapping one store's past events. */
const formats = new Map<string, Intl.DateTimeFormat>();

/** The calendar date in the store's time zone. */
export function pastEventDate(timeZone: string, now: number): string {
  let format = formats.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
    formats.set(timeZone, format);
  }
  return format.format(now);
}
