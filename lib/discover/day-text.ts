// Dates and times as Indicative pricing prints them, in UTC: "15 Oct",
// "22 Oct 2026", "15 Oct 09:16:05 UTC". The month names are fixed, so the
// text does not move with the runtime's locale data. Pure: no imports.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

const two = (n: number) => String(n).padStart(2, "0");

/** "15 Oct": the UTC day of an instant (ms). Empty for no instant. */
export function dayMonth(ms: number): string {
  if (!Number.isFinite(ms)) return "";
  const d = new Date(ms);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** "22 Oct 2026": a calendar day (YYYY-MM-DD); the text as given when it
 *  is no day. */
export function dayMonthYear(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return ymd;
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${Number(m[3])} ${month} ${m[1]}` : ymd;
}

/** "15 Oct 09:16 UTC", or with `secs` "15 Oct 09:16:05 UTC": an instant
 *  (ms) in UTC. Empty for no instant. */
export function utcStamp(ms: number, secs = false): string {
  if (!Number.isFinite(ms)) return "";
  const d = new Date(ms);
  const clock = `${two(d.getUTCHours())}:${two(d.getUTCMinutes())}${secs ? `:${two(d.getUTCSeconds())}` : ""}`;
  return `${dayMonth(ms)} ${clock} UTC`;
}
