// The time zone a person reads the desk's times in (Settings › Preferences):
// one IANA zone per person. A person with none saved reads the browser's own
// zone, New York until the browser names one (BROWSER_ZONE_COOKIE). The server
// reads it before the first markup (lib/discover/time-zone-server) and hands
// it to the client (components/discover/TimeZone); every time of day the desk
// prints follows it, with the zone's city after the clock.
//
// One form for a time: "23 Oct 2026, 12:00 Mexico City" (the day, the
// month's three letters and the year, a comma, the 24 h clock, the zone's
// city; "UTC" for UTC). A day-only value stays a day.
//
// Pure: it reads only zoned-time.ts and day-text.ts, so a test runs it with
// no loader.

import { zonedParts } from "../zoned-time.ts";
import { dayMonthYear } from "./day-text.ts";

/** The zone named UTC, and the zone of an unknown or invalid id. */
export const UTC_ZONE = "UTC";

/** The zone of a person with none saved whose browser has named none. */
export const ET_ZONE = "America/New_York";

/** The cookie that holds the zone the browser names, for a person with none
 *  saved: the server's first markup then prints the time the client draws. */
export const BROWSER_ZONE_COOKIE = "crx_tz_browser";

/** The cookie that holds the zone of a session with no email (a maker's
 *  wallet session). An email session's zone lives in the server's store. */
export const ZONE_COOKIE = "crx_tz";

/** The cookie's life: 400 days, the longest a browser keeps one. */
export const ZONE_COOKIE_MAX_AGE = 400 * 24 * 60 * 60;

export interface ZoneChoice {
  /** The IANA id. */
  zone: string;
  /** The city the desk prints after a clock. */
  city: string;
}

/** The zones the Time zone select lists after UTC and the browser's own,
 *  west to east: each pair's market city (dashboard DESK_CORRIDORS; a test
 *  holds the two alike) and the financial centres. Frankfurt reads
 *  Europe/Berlin, its IANA zone. */
export const ZONE_CHOICES: readonly ZoneChoice[] = [
  { zone: "America/Mexico_City", city: "Mexico City" },
  { zone: "America/New_York", city: "New York" },
  { zone: "America/Sao_Paulo", city: "São Paulo" },
  { zone: "Europe/London", city: "London" },
  { zone: "Europe/Zurich", city: "Zurich" },
  { zone: "Europe/Berlin", city: "Frankfurt" },
  { zone: "Asia/Kolkata", city: "Mumbai" },
  { zone: "Asia/Manila", city: "Manila" },
  { zone: "Asia/Singapore", city: "Singapore" },
  { zone: "Asia/Hong_Kong", city: "Hong Kong" },
  { zone: "Asia/Tokyo", city: "Tokyo" },
];

/** The ids that name UTC itself: each reads as UTC_ZONE. */
const UTC_IDS = new Set(["UTC", "Etc/UTC", "Etc/UCT", "UCT", "Etc/Universal", "Universal", "Etc/Zulu", "Zulu", "GMT", "Etc/GMT", "Etc/GMT0", "Etc/GMT+0", "Etc/GMT-0", "GMT0", "GMT+0", "GMT-0", "Etc/Greenwich", "Greenwich"]);

/** An IANA id's shape: letters first, then letters, digits, "_", "+", "-",
 *  in parts split by "/". No offset form ("+05:00"). */
const ZONE_SHAPE = /^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+){0,2}$/;

/** A zone id as the desk stores it: the runtime's own name for a zone it
 *  can read ("america/new_york" → "America/New_York"), UTC_ZONE for any
 *  name of UTC. Null for anything else. */
export function readZone(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 64 || !ZONE_SHAPE.test(raw)) return null;
  let zone: string;
  try {
    zone = new Intl.DateTimeFormat("en-US", { timeZone: raw }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
  if (UTC_IDS.has(zone) || UTC_IDS.has(raw)) return UTC_ZONE;
  return ZONE_SHAPE.test(zone) ? zone : null;
}

/** A stored or asked zone, UTC_ZONE when it is unknown or invalid. */
export function zoneOrUtc(raw: unknown): string {
  return readZone(raw) ?? UTC_ZONE;
}

/** The zone of a person with none saved: the browser's, as its cookie holds it,
 *  else ET_ZONE. */
export function defaultZone(browserCookie: unknown): string {
  return readZone(browserCookie) ?? ET_ZONE;
}

/** The city the desk prints after a clock in `zone`: "UTC" for UTC, the
 *  city of a listed zone ("São Paulo"), else the id's last part with its
 *  underscores as spaces ("America/Argentina/Buenos_Aires" → "Buenos
 *  Aires"). */
export function zoneCity(zone: string): string {
  if (zone === UTC_ZONE || UTC_IDS.has(zone)) return "UTC";
  const listed = ZONE_CHOICES.find((c) => c.zone === zone);
  if (listed) return listed.city;
  const last = zone.split("/").pop() ?? zone;
  return last.replace(/_/g, " ");
}

/** The word the desk prints after a clock in `zone`: "ET" for New York, on every
 *  page; else its city (zoneCity). */
function clockWord(zone: string): string {
  return zone === ET_ZONE ? "ET" : zoneCity(zone);
}

/** Is this a usable epoch in ms (allin usableEpoch's bound)? */
function usable(ms: unknown): ms is number {
  return typeof ms === "number" && Number.isFinite(ms) && ms > 0 && ms <= 8.64e15;
}

const two = (n: number) => String(n).padStart(2, "0");

export interface ZonedWhen {
  /** The day in the zone: "23 Oct 2026". */
  day: string;
  /** The clock and the zone's word: "12:00 Mexico City", "12:00 ET". */
  clock: string;
  /** The two in the one form: "23 Oct 2026, 12:00 Mexico City". */
  text: string;
  /** The day as YYYY-MM-DD, for a file that sorts: "2026-10-23". */
  ymd: string;
  /** The clock alone: "12:00" ("12:00:05" to the second). */
  hm: string;
  /** The zone's word: "Mexico City", "ET". */
  city: string;
}

/** An instant (ms) in `zone`, in the desk's one form. `seconds`: the clock
 *  to the second. A zone the runtime cannot read reads as UTC. Null with no
 *  usable instant. */
export function zonedWhen(ms: number | null | undefined, zone: string, seconds = false): ZonedWhen | null {
  if (!usable(ms)) return null;
  // No zone named reads UTC, never the runtime's own zone.
  let at = typeof zone === "string" && zone !== "" ? zone : UTC_ZONE;
  let p: ReturnType<typeof zonedParts>;
  try {
    p = zonedParts(at, ms);
  } catch {
    at = UTC_ZONE;
    p = zonedParts(UTC_ZONE, ms);
  }
  const ymd = `${String(p.y).padStart(4, "0")}-${two(p.m)}-${two(p.d)}`;
  const hm = seconds ? `${two(p.h)}:${two(p.mi)}:${two(p.s)}` : `${two(p.h)}:${two(p.mi)}`;
  const city = clockWord(at);
  const day = dayMonthYear(ymd);
  const clock = `${hm} ${city}`;
  return { day, clock, text: `${day}, ${clock}`, ymd, hm, city };
}

/** An instant in New York time, in a staff page's one form: "1 Nov 2026, 20:13 ET"; "—"
 *  with no usable instant. */
export function etText(ms: number | null | undefined): string {
  const w = zonedWhen(ms, ET_ZONE);
  return w ? `${w.day}, ${w.hm} ET` : "—";
}

/** zonedWhen's one line: "23 Oct 2026, 12:00 Mexico City"; "—" with no
 *  usable instant. */
export function whenText(ms: number | null | undefined, zone: string, seconds = false): string {
  return zonedWhen(ms, zone, seconds)?.text ?? "—";
}

