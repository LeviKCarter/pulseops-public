// Opt-in overlay of the viewer's own calendars (concerts, personal plans) on top of the event ledger.
// Configured as ICS feed URLs in PERSONAL_CALENDAR_ICS_URLS (local-only env, never committed): comma-separated
// "Label|https://.../basic.ics" pairs. Off unless a viewer explicitly asks for it via the dashboard toggle.
import ICAL from 'ical.js';
import type { EventItem } from './UpcomingEvents';

interface CalendarSource {
  label: string;
  url: string;
}

function parseSources(raw: string | undefined): CalendarSource[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const i = entry.indexOf('|');
      return i === -1 ? { label: 'My Calendar', url: entry } : { label: entry.slice(0, i).trim() || 'My Calendar', url: entry.slice(i + 1).trim() };
    })
    .filter((s) => /^https?:\/\//i.test(s.url));
}

// Wall-clock stamps in the same shape UpcomingEvents expects (Denver local time, YYYY-MM-DD or YYYY-MM-DD HH:MM).
function denverStamp(time: ICAL.Time): string {
  const y = String(time.year).padStart(4, '0');
  const mo = String(time.month).padStart(2, '0');
  const d = String(time.day).padStart(2, '0');
  if (time.isDate) return `${y}-${mo}-${d}`;
  const parts = time
    .toJSDate()
    .toLocaleString('en-CA', { timeZone: 'America/Denver', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    .replace(',', '');
  return parts;
}

// A safety cap on how many occurrences an indefinitely-recurring event can expand into.
const MAX_OCCURRENCES_PER_EVENT = 60;

function expandEvent(vevent: ICAL.Component, rangeStart: ICAL.Time, rangeEnd: ICAL.Time): Array<{ start: ICAL.Time; end: ICAL.Time; summary: string; location: string; url: string; uid: string }> {
  const event = new ICAL.Event(vevent);
  const summary = event.summary || 'Untitled event';
  const location = event.location || '';
  const url = vevent.getFirstPropertyValue('url') as string | null ?? '';
  const uid = event.uid || '';
  if (!event.isRecurring()) {
    if (event.endDate.compare(rangeStart) < 0 || event.startDate.compare(rangeEnd) > 0) return [];
    return [{ start: event.startDate, end: event.endDate, summary, location, url, uid }];
  }
  const out: Array<{ start: ICAL.Time; end: ICAL.Time; summary: string; location: string; url: string; uid: string }> = [];
  const duration = event.duration;
  const iterator = event.iterator();
  let next: ICAL.Time | null;
  for (let i = 0; i < MAX_OCCURRENCES_PER_EVENT && (next = iterator.next()); i++) {
    if (next.compare(rangeEnd) > 0) break;
    if (next.compare(rangeStart) >= 0) {
      const occStart = next.clone();
      const occEnd = occStart.clone();
      occEnd.addDuration(duration);
      out.push({ start: occStart, end: occEnd, summary, location, url, uid });
    }
  }
  return out;
}

// Google's ICS export for a calendar never includes a per-event `url`, but its web UI accepts a
// deep link built from the event's id and the calendar's own address: base64("<id> <calendarId>").
// Undocumented but stable (used by several long-running calendar tools), so only applied to
// calendar.google.com sources — other providers keep whatever `url` (if any) their ICS gives us.
// The event id is the ICS UID with Google's own "@google.com" suffix stripped: keeping the suffix
// produces a link that 500s instead of opening the event.
function googleCalendarId(sourceUrl: string): string | null {
  const m = /^https:\/\/calendar\.google\.com\/calendar\/ical\/([^/]+)\//i.exec(sourceUrl);
  return m ? decodeURIComponent(m[1]) : null;
}

function googleEventUrl(uid: string, calendarId: string): string {
  const eventId = uid.replace(/@google\.com$/i, '');
  const eid = Buffer.from(`${eventId} ${calendarId}`, 'utf8').toString('base64');
  return `https://calendar.google.com/calendar/event?eid=${encodeURIComponent(eid)}`;
}

async function fetchOneCalendar(source: CalendarSource, rangeStart: ICAL.Time, rangeEnd: ICAL.Time, signal: AbortSignal): Promise<EventItem[]> {
  const upstream = await fetch(source.url, { headers: { Accept: 'text/calendar' }, cache: 'no-store', signal });
  if (!upstream.ok) throw new Error(`${source.label}: HTTP ${upstream.status}`);
  const text = await upstream.text();
  const root = new ICAL.Component(ICAL.parse(text));
  for (const vtimezone of root.getAllSubcomponents('vtimezone')) {
    try { ICAL.TimezoneService.register(vtimezone); } catch { /* malformed VTIMEZONE: fall back to floating time */ }
  }
  const calendarId = googleCalendarId(source.url);
  const items: EventItem[] = [];
  for (const vevent of root.getAllSubcomponents('vevent')) {
    for (const occ of expandEvent(vevent, rangeStart, rangeEnd)) {
      const explicitUrl = /^https?:\/\//i.test(occ.url) ? occ.url : undefined;
      const sourceUrl = explicitUrl ?? (calendarId && occ.uid ? googleEventUrl(occ.uid, calendarId) : undefined);
      items.push({
        eventName: occ.summary,
        start: denverStamp(occ.start),
        end: denverStamp(occ.end),
        venue: occ.location,
        category: 'Personal',
        group: source.label,
        price: '',
        rsvp: '',
        urgency: '',
        disposition: '',
        sourceUrl,
        source: 'personal',
        // Songkick's tracked-artist feed files every show as an all-day date; the show has a time, it just isn't in the feed.
        ...(occ.start.isDate && /@songkick\.com$/i.test(occ.uid) ? { timeTba: true } : {}),
        // Songkick lists every show by an artist you track, not shows you're going to.
        ...(/@songkick\.com$/i.test(occ.uid) ? { suggestion: true } : {}),
      });
    }
  }
  return items;
}

export interface PersonalCalendarResult {
  events: EventItem[];
  errors: string[];
  configured: boolean;
}

// Window matches how far out the ledger's own "Later" bucket reasonably reaches, plus a short look-back
// so an event that started earlier today (already underway) doesn't disappear from "Today".
export async function fetchPersonalCalendarEvents(): Promise<PersonalCalendarResult> {
  const sources = parseSources(process.env.PERSONAL_CALENDAR_ICS_URLS);
  if (sources.length === 0) return { events: [], errors: [], configured: false };

  const now = new Date();
  const rangeStart = ICAL.Time.fromJSDate(new Date(now.getTime() - 2 * 86400000), false);
  const rangeEnd = ICAL.Time.fromJSDate(new Date(now.getTime() + 180 * 86400000), false);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const settled = await Promise.allSettled(sources.map((s) => fetchOneCalendar(s, rangeStart, rangeEnd, controller.signal)));
    const events: EventItem[] = [];
    const errors: string[] = [];
    for (const result of settled) {
      if (result.status === 'fulfilled') events.push(...result.value);
      else errors.push(result.reason instanceof Error ? result.reason.message : String(result.reason));
    }
    events.sort((a, b) => a.start.localeCompare(b.start));
    return { events, errors, configured: true };
  } finally {
    clearTimeout(timer);
  }
}
