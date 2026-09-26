'use client';

import { useEffect, useRef, useState } from 'react';
import DismissedList from './DismissedList';
import DomoreBar, { type DomoreStatus } from './DomoreBar';
import { eventRain } from './eventRain';
import { eventKey } from './eventKey';
import { loadDayHours, type DayHour } from './PulseBrief';
import QuickFilters from './QuickFilters';
import { EVENT_RADII, isWithinBand, radiusBand, useOrigin } from './proximity';

export interface EventItem {
  eventName: string;
  start: string;
  end?: string;
  venue: string;
  address?: string;
  sourceUrl?: string;
  category: string;
  group?: string;
  price: string;
  rsvp: string;
  urgency: string;
  disposition: string;
  // The ledger's free-text Notes column: what the event is and why it was picked. Shown when a row is opened.
  notes?: string;
  // Set on events pulled from a viewer's own calendar overlay (see personalCalendars.ts): already on their
  // calendar, so the "add to calendar" and "hide" actions that apply to ledger events don't make sense here.
  source?: 'personal';
  // Set on Google Tasks (see personalTasks.ts): what the "Done" button needs to mark the task complete.
  task?: { id: string; listId: string };
  // A dated event whose source never gives a start time (Songkick's concert feed lists the day only), so the row
  // reads "Time TBA" rather than "All day".
  timeTba?: boolean;
  // A personal-overlay event that is only a suggestion, not a plan: the tracked-artist (Songkick) concert feed. Those
  // rows get "+" (copy it onto the viewer's own calendar) and "×" (pass on it) like ledger events do.
  suggestion?: boolean;
}

export { eventKey } from './eventKey';

// A concert passed on from the Songkick overlay, as /api/personal-calendar lists it for the Restore list.
export interface DismissedConcert { eventName: string; start: string; venue: string }

// Feed text is data, so only http(s) links are ever rendered as hrefs.
function safeUrl(url: string | null | undefined): string | null {
  return url && /^https?:\/\//i.test(url) ? url : null;
}

function parseEventStart(raw: string | undefined): { day: string; mins: number | null } | null {
  const m = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?)?/i.exec((raw || '').trim());
  if (!m) return null;
  if (m[2] === undefined) return { day: m[1], mins: null };
  let h = Number(m[2]);
  const ap = m[4]?.toUpperCase();
  if (ap === 'PM' && h < 12) h += 12;
  if (ap === 'AM' && h === 12) h = 0;
  return { day: m[1], mins: h * 60 + Number(m[3]) };
}

// Day keys are 'YYYY-MM-DD' Denver dates; UTC is only used as a timezone-free calendar.
const utcMs = (day: string, mins = 0) => {
  const [y, mo, d] = day.split('-').map(Number);
  return Date.UTC(y, mo - 1, d, 0, mins);
};
const addDaysKey = (day: string, n: number) => new Date(utcMs(day) + n * 86400000).toISOString().slice(0, 10);
const weekStartKey = (day: string) => addDaysKey(day, -((new Date(utcMs(day)).getUTCDay() + 6) % 7)); // Monday
const fmtDayKey = (day: string, opts: Intl.DateTimeFormatOptions) =>
  new Date(utcMs(day)).toLocaleDateString('en-US', { ...opts, timeZone: 'UTC' });
const denverTodayKey = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Denver' });

function eventClock(mins: number | null, timeTba = false): string {
  if (mins === null) return timeTba ? 'Time TBA' : 'All day';
  const h = Math.floor(mins / 60);
  return `${h % 12 || 12}:${String(mins % 60).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

// The ledger's addresses are free text (state/zip noise, long provenance notes), so trim them for display.
function tidyAddress(address: string | undefined): string {
  return (address || '')
    .replace(/\s*\([^)]{25,}\)/g, '')
    .replace(/,\s*(CO|Colorado)(\s+\d{5})?\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function mapsUrl(event: EventItem): string {
  const place = (event.venue || '').split(',')[0].trim();
  const query = [place, event.address || (event.venue ? 'Denver, CO' : '')].filter(Boolean).join(', ');
  return query ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}` : '';
}

// A pre-filled Google Calendar "new event" link: it opens in the viewer's own signed-in calendar and adds nothing until they save.
function calendarUrl(event: EventItem): string {
  const start = parseEventStart(event.start);
  if (!start) return '';
  const stamp = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, '').slice(0, 15);
  let dates: string;
  if (start.mins === null) {
    dates = `${start.day.replace(/-/g, '')}/${addDaysKey(start.day, 1).replace(/-/g, '')}`;
  } else {
    const startMs = utcMs(start.day, start.mins);
    const end = parseEventStart(event.end);
    let endMs = end && end.mins !== null ? utcMs(end.day, end.mins) : 0;
    if (endMs <= startMs) endMs = startMs + 3600000;
    dates = `${stamp(startMs)}/${stamp(endMs)}`;
  }
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: event.eventName,
    dates,
    ctz: 'America/Denver',
    location: [event.venue, tidyAddress(event.address)].filter(Boolean).join(', '),
    details: [safeUrl(event.sourceUrl), event.suggestion ? 'From Songkick, via Pulse Ops.' : 'From the Pulse Ops event ledger.'].filter(Boolean).join('\n'),
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

// One fixed color per group so a category reads the same in the chip and on every row. Unknown groups get a stable hue from their name.
const GROUP_COLORS: Record<string, string> = {
  'Earth & Climate': '#4ade80',
  'Physics & Math': '#8b9cf5',
  'Chemistry': '#bef264',
  'Life & Health': '#f472b6',
  'Engineering & Computing': '#38bdf8',
  'Campus & Outreach': '#b4a7d6',
  'Art & Culture': '#c792ea',
  'Music': '#facc15',
  'Film': '#fb7185',
  'Food & Drink': '#fb923c',
  'Whiskey': '#c98b5a',
  'Community & Markets': '#2dd4bf',
  'Workshops & Classes': '#fdba74',
  'Cannabis': '#86efac',
  'Glass': '#a5f3fc',
  'Comedy': '#fde68a',
  'Theater & Dance': '#f0abfc',
  'DoMORE': '#ff8a5c',
};

export function groupColor(group: string): string {
  if (GROUP_COLORS[group]) return GROUP_COLORS[group];
  let h = 0;
  for (const ch of group) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `hsl(${h} 65% 68%)`;
}

// The CU Boulder fields from scripts/event_groups.py (plus the raw scrape category, for feeds from before grouping).
export const CAMPUS_GROUPS = new Set(['Earth & Climate', 'Physics & Math', 'Chemistry', 'Life & Health', 'Engineering & Computing', 'Campus & Outreach', 'Science & Earth']);
// Non-campus categories that still start switched off: the tracked-artist concert feed is long enough to bury
// everything else. Pick "All" or tap the chip to bring them back.
const OFF_BY_DEFAULT = new Set(['Concerts']);

// Free means the ticket itself costs nothing: "Free with museum admission" or "Free with purchase" still costs money.
export const isFreeEvent = (price: string | undefined) => { const p = (price ?? '').trim(); return /^free\b/i.test(p) && !/^free (?:with|w\/) (?:museum|purchase|admission)/i.test(p); };

export const groupOf = (event: EventItem) => event.group || event.category || 'Other';

// Matches a ledger event to the copy "+ Cal" puts on the viewer's calendar: that link pre-fills the title with
// the event's name, so the same name on the same day means it's already on their calendar.
const calendarMatchKey = (name: string, day: string) => `${name.toLowerCase().replace(/\s+/g, ' ').trim()}|${day}`;

type EventTab = 'all' | 'today' | 'week' | 'next' | 'later';
const TABS: Array<{ id: EventTab; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'This week' },
  { id: 'next', label: 'Next week' },
  { id: 'later', label: 'Later' },
];

// On a touchscreen, hiding an event is one stray tap from "+", so it needs a deliberate press: holding fills the button red
// from the center out and fires once full; letting go, sliding off, or scrolling first cancels. A mouse click or a
// keyboard press hides right away.
const HOLD_MS = 600;
function HoldToConfirm({ label, title, onConfirm, className, children }: { label: string; title: string; onConfirm: () => void; className: string; children: React.ReactNode }) {
  const [holding, setHolding] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touch = useRef(false); // the press in progress came from a finger or pen, so it has to be held
  const cancel = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; setHolding(false); };
  const start = () => {
    if (timer.current) return;
    setHolding(true);
    timer.current = setTimeout(() => { timer.current = null; setHolding(false); onConfirm(); }, HOLD_MS);
  };
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  return (
    <button
      type="button"
      aria-label={label}
      title={title}
      onPointerDown={(e) => { touch.current = e.pointerType !== 'mouse'; if (touch.current && e.button === 0) start(); }}
      onClick={(e) => { if (!touch.current || e.detail === 0) onConfirm(); touch.current = false; }}
      onPointerUp={cancel}
      // A swipe that starts on the button still scrolls the page (touch-pan-y): the browser cancels the pointer
      // when the scroll begins, which drops the hold.
      onPointerCancel={cancel}
      onPointerLeave={cancel}
      onBlur={cancel}
      onContextMenu={(e) => e.preventDefault()}
      className={`${className} touch-pan-y select-none [-webkit-touch-callout:none]`}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 origin-center rounded-[inherit] bg-[#f08b8b]/45"
        style={{ transform: `scale(${holding ? 1 : 0})`, transition: `transform ${holding ? HOLD_MS : 150}ms linear` }}
      />
      <span className="relative">{children}</span>
    </button>
  );
}

export default function UpcomingEvents({ items, expanded = false, onDismiss }: { items: EventItem[]; expanded?: boolean; onDismiss?: (event: EventItem) => void }) {
  const [tab, setTab] = useState<EventTab>('all');
  // null means the user has not chosen yet: the lane then defaults to the non-campus categories.
  const [pickedRaw, setPickedRaw] = useState<string[] | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [freeOnly, setFreeOnly] = useState(false);
  const [urgentOnly, setUrgentOnly] = useState(false);
  const [radius, setRadius] = useState<number | null>(null);
  // Personal-calendar events (see personalCalendars.ts) merge in automatically wherever they're configured:
  // silently absent elsewhere, since PERSONAL_CALENDAR_ICS_URLS is only ever set on the owner's own machine.
  // Re-fetched when the tab regains focus (at most every 30s), so an event saved via "+ Cal" in another tab
  // shows up as the viewer's own without a reload.
  const [personalItems, setPersonalItems] = useState<EventItem[]>([]);
  const [personalReady, setPersonalReady] = useState(false);
  // DoMORE member status (see domore.ts): the next ticket drop and open extras, or why the ticket overlay is missing.
  const [domore, setDomore] = useState<DomoreStatus | null>(null);
  // Tasks marked done here: hidden straight away, and put back with a note if Google Tasks refuses the change.
  const [doneTasks, setDoneTasks] = useState<Set<string>>(() => new Set());
  const [taskErrors, setTaskErrors] = useState<Record<string, string>>({});
  // The one event row whose details panel is open, by eventKey.
  const [openEvent, setOpenEvent] = useState<string | null>(null);
  // The week's hourly forecast (shared with the weather card's cache), for the rain marks on event rows.
  const [weekHours, setWeekHours] = useState<DayHour[]>([]);
  useEffect(() => {
    let active = true;
    const load = () => loadDayHours().then((hours) => { if (active) setWeekHours(hours); }).catch(() => { /* no forecast: rows just go unmarked */ });
    load();
    const timer = window.setInterval(load, 25 * 60 * 1000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);
  const completeTask = async (task: { id: string; listId: string }) => {
    setDoneTasks((cur) => new Set(cur).add(task.id));
    setTaskErrors((cur) => { const next = { ...cur }; delete next[task.id]; return next; });
    let error = '';
    try {
      const res = await fetch('/api/personal-tasks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'complete', listId: task.listId, id: task.id }),
      });
      const data = await res.json().catch(() => ({})) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) error = data.error || `HTTP ${res.status}`;
    } catch {
      error = 'The dashboard server is unreachable.';
    }
    if (!error) return;
    setDoneTasks((cur) => { const next = new Set(cur); next.delete(task.id); return next; });
    setTaskErrors((cur) => ({ ...cur, [task.id]: `Couldn't mark done: ${error}` }));
  };
  // Songkick concerts passed on: saved on the local server (see concertDismissals.ts), which leaves them out of the
  // overlay; `hiddenConcerts` hides one straight away while that saves, and `dismissedConcerts` feeds the Restore list.
  const [dismissedConcerts, setDismissedConcerts] = useState<DismissedConcert[]>([]);
  const [hiddenConcerts, setHiddenConcerts] = useState<Set<string>>(() => new Set());
  const [restoringConcert, setRestoringConcert] = useState('');
  const [concertNotice, setConcertNotice] = useState('');
  // Bumped after a concert is hidden or restored, to re-read the overlay straight away (past the 30s throttle).
  const [personalReload, setPersonalReload] = useState(0);
  const saveConcert = async (event: Pick<EventItem, 'eventName' | 'start' | 'venue'>, action: 'dismiss' | 'restore') => {
    try {
      const res = await fetch('/api/concert-dismiss', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, eventName: event.eventName, start: event.start, venue: event.venue }),
      });
      const data = await res.json().catch(() => ({})) as { ok?: boolean; error?: string };
      return !res.ok || !data.ok ? data.error || `HTTP ${res.status}` : '';
    } catch {
      return 'The dashboard server is unreachable.';
    }
  };
  const dismissConcert = async (event: EventItem) => {
    const key = eventKey(event);
    setHiddenConcerts((cur) => new Set(cur).add(key));
    setConcertNotice('');
    const error = await saveConcert(event, 'dismiss');
    if (!error) { setPersonalReload((n) => n + 1); return; }
    setHiddenConcerts((cur) => { const next = new Set(cur); next.delete(key); return next; });
    setConcertNotice(`Couldn't hide that concert: ${error}`);
  };
  const restoreConcert = async (key: string) => {
    const item = dismissedConcerts.find((c) => eventKey(c) === key);
    if (!item) return;
    setRestoringConcert(key);
    setConcertNotice('');
    const error = await saveConcert(item, 'restore');
    setRestoringConcert('');
    if (error) { setConcertNotice(`Couldn't restore that concert: ${error}`); return; }
    setDismissedConcerts((cur) => cur.filter((c) => eventKey(c) !== key));
    setHiddenConcerts((cur) => { const next = new Set(cur); next.delete(key); return next; });
    setPersonalReload((n) => n + 1);
  };
  const lastPersonalFetch = useRef(0);
  useEffect(() => {
    let controller: AbortController | null = null;
    const load = () => {
      if (Date.now() - lastPersonalFetch.current < 30_000) return;
      lastPersonalFetch.current = Date.now();
      controller?.abort();
      const current = new AbortController();
      controller = current;
      fetch('/api/personal-calendar', { signal: current.signal })
        .then(async (res) => {
          if (!res.ok) return;
          const data = await res.json() as { events: EventItem[]; dismissedConcerts?: DismissedConcert[]; domore?: DomoreStatus | null };
          setPersonalItems(data.events ?? []);
          setDismissedConcerts(data.dismissedConcerts ?? []);
          setDomore(data.domore ?? null);
          setPersonalReady(true);
        })
        .catch((err: unknown) => { if ((err as { name?: string })?.name !== 'AbortError') lastPersonalFetch.current = 0; })
        .finally(() => { if (controller === current) controller = null; });
    };
    const onVisible = () => { if (document.visibilityState === 'visible') load(); };
    if (personalReload > 0) lastPersonalFetch.current = 0;
    load();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      // An aborted first load (React's dev double-mount) must not count against the 30s throttle.
      if (controller) { controller.abort(); lastPersonalFetch.current = 0; }
    };
  }, [personalReload]);
  const { origin, label: originLabel } = useOrigin(radius !== null);
  const filterRef = useRef<HTMLDivElement>(null);
  const today = denverTodayKey();
  const thisWeek = weekStartKey(today);
  const nextWeek = addDaysKey(thisWeek, 7);

  // A ledger event the viewer already put on their calendar (via "+ Cal") is shown once, as their own calendar
  // copy, so it lands in their personal category instead of appearing twice. The same goes for a Songkick concert
  // copied onto their own calendar: once it's there, the Songkick row steps aside.
  const matchKeys = (list: EventItem[]) => new Set(list.flatMap((e) => { const p = parseEventStart(e.start); return p ? [calendarMatchKey(e.eventName, p.day)] : []; }));
  const onCalendar = matchKeys(personalItems);
  const onOwnCalendar = matchKeys(personalItems.filter((e) => !e.suggestion));
  const notIn = (keys: Set<string>) => (e: EventItem) => { const p = parseEventStart(e.start); return !p || !keys.has(calendarMatchKey(e.eventName, p.day)); };
  const effectiveItems = personalReady
    ? [...items.filter(notIn(onCalendar)),
      ...personalItems.filter((e) => (!e.task || !doneTasks.has(e.task.id)) && (!e.suggestion || (!hiddenConcerts.has(eventKey(e)) && notIn(onOwnCalendar)(e))))]
    : items;
  // The personal-calendar events are appended after the ledger's own (already-sorted) items rather than
  // interleaved, so the combined list needs its own chronological sort: the day/week grouping below assumes
  // same-day rows are contiguous, and without this a repeated day would open a second, duplicate-keyed section.
  const dated = effectiveItems
    .flatMap((event) => {
      const p = parseEventStart(event.start);
      return p ? [{ event, day: p.day, mins: p.mins, week: weekStartKey(p.day), group: groupOf(event) }] : [];
    })
    .sort((a, b) => (a.day === b.day ? (a.mins ?? -1) - (b.mins ?? -1) : a.day < b.day ? -1 : 1));
  const defaultPicked = [...new Set(dated.map((d) => d.group))].filter((g) => !CAMPUS_GROUPS.has(g) && !OFF_BY_DEFAULT.has(g));
  const campusPicked = [...new Set(dated.map((d) => d.group))].filter((g) => CAMPUS_GROUPS.has(g));
  const allGroups = [...new Set(dated.map((d) => d.group))];
  const picked = pickedRaw ?? defaultPicked;
  const band = radius === null ? null : radiusBand(EVENT_RADII, radius);
  const quickOk = (d: (typeof dated)[number]) =>
    (!freeOnly || isFreeEvent(d.event.price))
    && (!urgentOnly || d.event.urgency?.toLowerCase() === 'high')
    && (band === null || isWithinBand(d.event.address || d.event.venue, origin, band.low, band.high));
  // An empty `picked` means "None" -- deliberately show nothing until at least one category chip is added back.
  const inPicked = (d: (typeof dated)[number]) => quickOk(d) && picked.includes(d.group);
  const matches: Record<EventTab, (d: (typeof dated)[number]) => boolean> = {
    all: () => true,
    today: (d) => d.day === today,
    week: (d) => d.week === thisWeek,
    next: (d) => d.week === nextWeek,
    later: (d) => d.week > nextWeek,
  };
  // Each filter's counts respect the other: tab counts follow the picked groups, group counts follow the active tab.
  const counts = Object.fromEntries(TABS.map((t) => [t.id, dated.filter((d) => inPicked(d) && matches[t.id](d)).length])) as Record<EventTab, number>;
  const visibleTabs = TABS.filter((t) => t.id === 'all' || counts[t.id] > 0);
  const activeTab = tab === 'all' || counts[tab] > 0 ? tab : 'all';
  const shown = dated.filter((d) => inPicked(d) && matches[activeTab](d));
  const groupCounts = new Map<string, number>();
  for (const d of dated) if (quickOk(d) && matches[activeTab](d)) groupCounts.set(d.group, (groupCounts.get(d.group) ?? 0) + 1);
  for (const g of picked) if (!groupCounts.has(g)) groupCounts.set(g, 0);
  // Non-campus categories lead; campus fields follow.
  const groupChips = [...groupCounts.entries()].sort((a, b) => Number(CAMPUS_GROUPS.has(a[0])) - Number(CAMPUS_GROUPS.has(b[0])) || b[1] - a[1] || a[0].localeCompare(b[0]));
  const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((g) => b.includes(g));
  const mode: 'all' | 'none' | 'noncu' | 'cu' | 'custom' = picked.length === 0 ? 'none'
    : pickedRaw === null ? 'noncu'
    : campusPicked.length > 0 && sameSet(picked, campusPicked) ? 'cu'
    : sameSet(picked, allGroups) ? 'all'
    : 'custom';
  const filterLabel = mode === 'all' ? 'All categories' : mode === 'none' ? 'No categories'
    : mode === 'noncu' ? 'Non-CU categories' : mode === 'cu' ? 'CU categories' : `${picked.length} of ${groupChips.length} categories`;
  useEffect(() => {
    if (!filterOpen) return;
    const onDown = (e: MouseEvent) => { if (!filterRef.current?.contains(e.target as Node)) setFilterOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setFilterOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [filterOpen]);
  const togglePicked = (g: string) => setPickedRaw((cur) => {
    const base = cur ?? defaultPicked;
    return base.includes(g) ? base.filter((x) => x !== g) : [...base, g];
  });
  const spansWeeks = new Set(shown.map((d) => d.week)).size > 1;

  const weekLabel = (week: string) => {
    const name = week === thisWeek ? 'This week' : week === nextWeek ? 'Next week' : `Week of ${fmtDayKey(week, { month: 'short', day: 'numeric' })}`;
    const end = addDaysKey(week, 6);
    const sameMonth = week.slice(0, 7) === end.slice(0, 7);
    return { name, range: `${fmtDayKey(week, { month: 'short', day: 'numeric' })} – ${fmtDayKey(end, sameMonth ? { day: 'numeric' } : { month: 'short', day: 'numeric' })}` };
  };

  const weeks: Array<{ week: string; days: Array<{ day: string; rows: typeof shown }> }> = [];
  for (const row of shown) {
    let w = weeks[weeks.length - 1];
    if (!w || w.week !== row.week) { w = { week: row.week, days: [] }; weeks.push(w); }
    let d = w.days[w.days.length - 1];
    if (!d || d.day !== row.day) { d = { day: row.day, rows: [] }; w.days.push(d); }
    d.rows.push(row);
  }

  const renderRow = ({ event, mins, group }: (typeof shown)[number], index: number) => {
    // Songkick suggestions act like ledger events here: they aren't on the viewer's own calendar yet.
    const isPersonal = event.source === 'personal' && !event.suggestion;
    const sourceHref = safeUrl(event.sourceUrl);
    const mapHref = mapsUrl(event);
    const calHref = isPersonal ? '' : calendarUrl(event); // already on the viewer's own calendar
    const dismiss = event.suggestion ? () => void dismissConcert(event) : onDismiss && !isPersonal ? () => onDismiss(event) : null;
    const address = tidyAddress(event.address);
    const key = eventKey(event);
    const rsvp = (event.rsvp || '').trim();
    const end = parseEventStart(event.end);
    const start = parseEventStart(event.start);
    const until = end && end.mins !== null
      ? `${end.day !== start?.day ? `${fmtDayKey(end.day, { month: 'short', day: 'numeric' })}, ` : ''}${eventClock(end.mins)}`
      : '';
    const rain = start && !event.task ? eventRain(weekHours, start, end) : null;
    const notes = (event.notes || '').trim();
    const hasDetails = Boolean(notes || rsvp || until);
    const isOpen = hasDetails && openEvent === key;
    const toggle = () => setOpenEvent(isOpen ? null : key);
    return (
      <div key={`${event.eventName}-${event.start}-${index}`} className="grid grid-cols-[3.75rem_minmax(0,1fr)] grid-rows-[auto_1fr] gap-x-3 border-b border-white/[0.05] py-2 last:border-b-0">
        {/* Actions sit under the time so the title and location get the full width. */}
        <div className="col-start-1 row-start-1">
          <time className="block whitespace-nowrap text-[0.8125rem] font-semibold leading-5 text-[#76d69e]">{eventClock(mins, event.timeTba)}</time>
          {rain && (
            <span title={`Rain likely: ${rain.peak}% around ${rain.label}`} className="mt-0.5 flex items-center gap-0.5 whitespace-nowrap text-[0.72rem] font-bold leading-4 text-[#8db8ee]">
              <span aria-hidden="true">{rain.icon}</span>
              <span className="sr-only">Rain likely, </span>{rain.peak}%
            </span>
          )}
        </div>
        <div className="col-start-2 row-span-2 row-start-1 min-w-0">
          <h4 className="text-[0.875rem] font-bold leading-snug">
            {sourceHref ? (
              <a href={sourceHref} target="_blank" rel="noopener noreferrer" className="underline decoration-white/20 underline-offset-2 hover:decoration-[#76d69e]">{event.eventName}</a>
            ) : (
              event.eventName
            )}
          </h4>
          <p className="mt-0.5 line-clamp-1 text-[0.8125rem] text-white/72" title={event.venue}>
            <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full align-middle" style={{ backgroundColor: groupColor(group) }} />
            <span className="font-semibold" style={{ color: groupColor(group) }}>{group}</span>
            {[event.venue, event.price].filter(Boolean).map((part) => ` · ${part}`).join('')}
          </p>
          {mapHref && (
            <a href={mapHref} target="_blank" rel="noopener noreferrer" title="Open in Google Maps" className="mt-0.5 flex items-start gap-1 text-[0.8125rem] leading-4 text-[#8db8ee] hover:underline">
              <svg aria-hidden="true" viewBox="0 0 16 16" className="mt-px h-3 w-3 shrink-0" fill="currentColor"><path d="M8 0a5 5 0 0 0-5 5c0 3.6 5 10.6 5 10.6S13 8.6 13 5a5 5 0 0 0-5-5Zm0 7a2 2 0 1 1 0-4 2 2 0 0 1 0 4Z" /></svg>
              <span>{address || 'Open in Maps'}</span>
            </a>
          )}
          {/* Notes preview in the space beside the actions: two lines closed, the full notes and ticket info open. */}
          {hasDetails && (
            <button
              type="button"
              aria-expanded={isOpen}
              aria-label={`${isOpen ? 'Collapse' : 'Expand'} notes for ${event.eventName}`}
              onClick={toggle}
              className={`mt-1.5 block w-full rounded-md border-l-2 px-2 py-1 text-left text-[0.8125rem] leading-5 transition-colors ${isOpen ? 'border-[#76d69e]/60 bg-white/[0.04] text-white/85' : 'border-white/[0.14] text-white/65 hover:border-[#76d69e]/50 hover:bg-white/[0.03] hover:text-white/80'}`}
            >
              {notes ? (
                <span className={`block whitespace-pre-line ${isOpen ? '' : 'line-clamp-2'}`}>{notes}</span>
              ) : (
                !isOpen && <span className="block text-[0.75rem] font-semibold text-white/55">{[until && `Until ${until}`, rsvp && `Tickets: ${rsvp}`].filter(Boolean).join(' · ')}</span>
              )}
              {isOpen && (until || rsvp) && (
                <span className={`flex flex-wrap gap-x-3 text-[0.75rem] font-semibold text-white/62 ${notes ? 'mt-1.5' : ''}`}>
                  {until && <span>Until {until}</span>}
                  {rsvp && <span>Tickets: {rsvp}</span>}
                </span>
              )}
            </button>
          )}
          {isOpen && sourceHref && (
            <a href={sourceHref} target="_blank" rel="noopener noreferrer" className="ml-2 mt-1 inline-block text-[0.75rem] font-bold text-[#8db8ee] hover:underline">Open listing ↗</a>
          )}
          {/* The ledger's Disposition ("Watch" vs "Calendar Candidate") only restates its calendar-fit guess, so it isn't shown. */}
          {event.urgency?.toLowerCase() === 'high' && (
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[0.75rem]">
              <span className="rounded bg-[#3b3018] px-1.5 py-0.5 font-bold text-[#f0cb6d]">High urgency</span>
            </div>
          )}
          {event.task && taskErrors[event.task.id] && (
            <p role="alert" className="mt-1 text-[0.75rem] font-semibold text-[#f08b8b]">{taskErrors[event.task.id]}</p>
          )}
        </div>
        <div className="col-start-1 row-start-2 mt-1.5 flex h-fit flex-col items-stretch gap-1 self-start text-center">
          {event.task && (
            <button
              type="button"
              aria-label={`Mark ${event.eventName} done`}
              title="Mark this task complete in Google Tasks"
              onClick={() => { if (event.task) void completeTask(event.task); }}
              className="whitespace-nowrap rounded-md border border-white/[0.1] px-1 py-1 text-[0.75rem] font-bold text-white/65 hover:border-[#84c4a1]/40 hover:text-[#76d69e]"
            >
              ✓ Done
            </button>
          )}
          {calHref && (
            <a
              href={calHref}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Add ${event.eventName} to Google Calendar`}
              title="Opens a pre-filled event in Google Calendar. Nothing is added until you save it."
              className="rounded-md border border-[#84c4a1]/35 py-0.5 text-base font-bold leading-5 text-[#76d69e] hover:border-[#84c4a1]/70 hover:bg-[#84c4a1]/10"
            >
              +
            </a>
          )}
          {dismiss && (
            <HoldToConfirm
              label={`Hide ${event.eventName}`}
              title={event.suggestion ? 'Not going: hide this concert on every device (on a touchscreen, press and hold)' : 'Not interested: hide this event, saved to the sheet (on a touchscreen, press and hold)'}
              onConfirm={dismiss}
              className="relative overflow-hidden rounded-md border border-[#f08b8b]/35 py-0.5 text-base font-bold leading-5 text-[#f08b8b] hover:border-[#f08b8b]/70 hover:bg-[#f08b8b]/10"
            >
              ×
            </HoldToConfirm>
          )}
        </div>
      </div>
    );
  };

  const list = weeks.map((w) => (
    <section key={w.week}>
      {spansWeeks && (
        <div className="mb-1 mt-4 flex items-baseline justify-between rounded-lg bg-white/[0.05] px-2.5 py-1.5 first:mt-1">
          <span className="text-[0.8125rem] font-extrabold uppercase tracking-[0.1em] text-white/80">{weekLabel(w.week).name}</span>
          <span className="text-[0.75rem] font-semibold text-white/62">{weekLabel(w.week).range}</span>
        </div>
      )}
      <div className={expanded ? 'lane-cols' : ''}>
        {w.days.map((d) => {
          const isToday = d.day === today;
          return (
            <div key={d.day} className="lane-block">
              <div className={`mb-0.5 mt-3 flex items-center gap-2 border-b pb-1 text-[0.8125rem] font-extrabold ${isToday ? 'border-[#84c4a1]/40 text-[#76d69e]' : 'border-white/[0.09] text-white/70'}`}>
                <span>{fmtDayKey(d.day, { weekday: 'long', month: 'short', day: 'numeric' })}</span>
                {isToday && <span className="rounded bg-[#84c4a1]/15 px-1.5 py-0.5 text-[0.72rem] uppercase tracking-[0.08em]">Today</span>}
                {d.day === addDaysKey(today, 1) && <span className="rounded bg-white/[0.07] px-1.5 py-0.5 text-[0.72rem] uppercase tracking-[0.08em] text-white/78">Tomorrow</span>}
              </div>
              {d.rows.map(renderRow)}
            </div>
          );
        })}
      </div>
    </section>
  ));

  return (
    <div className={`lane-wide mt-5 flex flex-col border-t border-white/[0.07] pt-4 ${expanded ? '' : 'min-h-0 flex-1'}`}>
      <QuickFilters label="Quick filters for events" freeOnly={freeOnly} onFreeOnly={setFreeOnly} urgentOnly={urgentOnly} onUrgentOnly={setUrgentOnly} radius={radius} onRadius={setRadius} radii={EVENT_RADII} originLabel={originLabel} showOrigin={false} accent="132 196 161" />
      {domore && <DomoreBar status={domore} />}
      <div ref={filterRef} className="relative mt-2 flex flex-wrap items-center gap-1.5">
        <div role="tablist" aria-label="Upcoming events" className="flex flex-wrap gap-1.5">
          {visibleTabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={activeTab === t.id}
              onClick={() => setTab(t.id)}
              className={`rounded-full border px-2 py-0.5 text-[0.8125rem] font-bold transition-colors ${activeTab === t.id ? 'border-[#84c4a1]/40 bg-[#84c4a1]/15 text-[#76d69e]' : 'border-white/[0.08] text-white/72 hover:text-white/80'}`}
            >
              {t.label} <span className="font-semibold opacity-70">{counts[t.id]}</span>
            </button>
          ))}
        </div>
        {groupChips.length > 1 && (
          <>
            <button
              type="button"
              aria-expanded={filterOpen}
              aria-haspopup="true"
              onClick={() => setFilterOpen((v) => !v)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[0.8125rem] font-bold transition-colors ${filterOpen ? 'border-white/30 text-white' : 'border-white/[0.14] text-white/80 hover:text-white'}`}
            >
              {filterLabel}
              <svg aria-hidden="true" viewBox="0 0 12 12" className={`h-2.5 w-2.5 transition-transform ${filterOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M2.5 4.5 6 8l3.5-3.5" /></svg>
            </button>
            {filterOpen && (
              <div role="group" aria-label="Filter by category" className="absolute left-0 right-0 top-full z-20 mt-1.5 rounded-2xl border border-white/[0.14] bg-[#0f1713] p-3 shadow-[0_18px_40px_rgba(0,0,0,0.5)]">
                <div role="radiogroup" aria-label="Quick filter" className="mb-2 inline-flex overflow-hidden rounded-full border border-white/[0.14] text-[0.75rem] font-bold">
                  {([['noncu', 'Non-CU', () => setPickedRaw(null)], ['cu', 'CU', () => setPickedRaw(campusPicked)], ['all', 'All', () => setPickedRaw(allGroups)], ['none', 'None', () => setPickedRaw([])]] as const).map(([id, label, apply]) => (
                    <button
                      key={id}
                      type="button"
                      role="radio"
                      aria-checked={mode === id}
                      onClick={apply}
                      className={`px-3 py-0.5 transition-colors ${mode === id ? 'bg-white/[0.16] text-white' : 'text-white/65 hover:text-white'}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {groupChips.map(([g, n]) => {
                    const on = picked.includes(g);
                    const color = groupColor(g);
                    return (
                      <button
                        key={g}
                        type="button"
                        aria-pressed={on}
                        onClick={() => { togglePicked(g); if (g === 'Concerts') setFilterOpen(false); }}
                        className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[0.75rem] font-bold transition-colors ${on ? 'text-white' : n === 0 ? 'border-white/[0.06] text-white/62' : 'border-white/[0.08] text-white/78 hover:text-white/90'}`}
                        style={on ? { borderColor: color, backgroundColor: `color-mix(in srgb, ${color} 22%, transparent)` } : undefined}
                      >
                        <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color, opacity: n === 0 && !on ? 0.4 : 1 }} />
                        {g} <span className="font-semibold opacity-70">{n}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </div>
      {shown.length === 0 ? (
        <p className="mt-3 text-xs leading-5 text-white/72">{dated.length === 0 ? 'No upcoming events in the snapshot.' : 'No events match these filters.'}</p>
      ) : expanded ? (
        <div className="mt-2">{list}</div>
      ) : (
        // Fills whatever height the lane has and fades out at the bottom; it doesn't scroll (expand the lane to see
        // the rest), and the list itself adds no height to the row.
        <div className="relative mt-2 min-h-[24rem] flex-1">
          <div className="absolute inset-0 overflow-hidden pb-8 [mask-image:linear-gradient(to_bottom,black_calc(100%-2rem),transparent)]">{list}</div>
        </div>
      )}
      {concertNotice && <p role="alert" className="mt-3 text-[0.75rem] font-semibold text-[#f08b8b]">{concertNotice}</p>}
      <DismissedList
        label="concerts"
        accent="green"
        rows={dismissedConcerts.map((c) => ({ key: eventKey(c), title: c.eventName, detail: [fmtDayKey(c.start.slice(0, 10), { weekday: 'short', month: 'short', day: 'numeric' }), c.venue].filter(Boolean).join(' · ') }))}
        restoringKey={restoringConcert}
        onRestore={(key) => void restoreConcert(key)}
      />
    </div>
  );
}
