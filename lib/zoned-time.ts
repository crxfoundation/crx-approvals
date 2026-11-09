// Wall clocks in an IANA zone, from a UTC instant and back. Pure, with no
// library: Intl reads the zone, and the offset search follows a DST switch.
// The quote desk (lib/quote-desk) and the settlement-day rule
// (lib/settle-day) share it.

/** Calendar date parts of a UTC instant, read in `zone`. */
export function zonedParts(zone: string, utcMs: number): { y: number; m: number; d: number; h: number; mi: number; s: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return { y: get("year"), m: get("month"), d: get("day"), h: get("hour") % 24, mi: get("minute"), s: get("second") };
}

/** Zone offset (ms east of UTC) in force at `utcMs`. */
function zoneOffsetMs(zone: string, utcMs: number): number {
  const p = zonedParts(zone, utcMs);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(utcMs / 1000) * 1000;
}

/** The UTC instant of a wall-clock time in `zone`. */
export function zonedToUtc(zone: string, y: number, m: number, d: number, h: number, mi: number): number {
  const wall = Date.UTC(y, m - 1, d, h, mi);
  let utc = wall - zoneOffsetMs(zone, wall);
  const off = zoneOffsetMs(zone, utc);
  if (wall - off !== utc) utc = wall - off;
  return utc;
}

/** A UTC instant as a wall clock in `zone`, with the zone's label:
 *  "2026-09-30 13:21:33 UTC" to the second, "2026-09-30 13:21 UTC" to the
 *  minute. */
export function zonedStamp(zone: string, utcMs: number, label: string = zone, seconds = true): string {
  const p = zonedParts(zone, utcMs);
  const two = (n: number) => String(n).padStart(2, "0");
  const clock = seconds ? `${two(p.h)}:${two(p.mi)}:${two(p.s)}` : `${two(p.h)}:${two(p.mi)}`;
  return `${String(p.y).padStart(4, "0")}-${two(p.m)}-${two(p.d)} ${clock} ${label}`;
}
