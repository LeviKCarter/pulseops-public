// Opt-in overlay of the viewer's DoMORE (do303) member tickets: what they've claimed, plus the "Bonus & Last Minute"
// extras outside their monthly drop (bonus tickets waiting to be claimed and last-minute guestlist spots), plus when the next monthly drop lands. Reads the same member API the
// go.domorestuff.com app uses, authorised with the app's own sign-in token, which lives in DOMORE_AUTH_TOKEN (local-only
// env, never committed). The token stops working when DoMORE signs the viewer out, and the overlay then reports that.
import type { EventItem } from './UpcomingEvents';

const API = 'https://g.do312.com';
const APP = 'https://go.domorestuff.com';

interface DomorePerk {
  name?: string;
  token?: string;
  pretty_date_time?: string;
  available?: number;
  district_name?: string;
  area_name?: string;
  ticket_redemption_info?: string;
  event?: { begin_time_in_tz?: string; end_time_in_tz?: string; venue?: { title?: string } };
  partner?: { organization?: string; ticket_redemption_info?: string };
}

interface DomoreTicket {
  token?: string;
  status?: string;
  last_minute?: boolean;
  claim_by?: string | null;
  injected_ticket_redemption_info?: string;
  perk?: DomorePerk;
}

interface TicketPage { tickets?: DomoreTicket[]; has_more?: boolean; next_page?: number }

// One card from the app's "Bonus & Last Minute" carousel.
export interface DomoreExtra {
  kind: 'bonus' | 'last-minute';
  title: string;
  when: string;
  venue: string;
  url: string;
  // False while DoMORE's last-minute cooldown blocks claiming (the app greys the card out).
  claimable: boolean;
  left: number | null;
}

export interface DomoreSummary {
  // ISO timestamp of the next monthly drop, when DoMORE has scheduled one.
  nextDrop: string | null;
  extras: DomoreExtra[];
}

export interface DomoreResult {
  events: EventItem[];
  summary: DomoreSummary | null;
  errors: string[];
  configured: boolean;
}

// '2026-09-25T21:00:00.000-06:00' -> '2026-09-25 21:00', the Denver wall-clock stamp UpcomingEvents parses.
// The API already gives times in the metro's own zone (America/Denver for do303), so the wall clock is the prefix.
function wallClock(iso: string | undefined): string {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(iso || '');
  return m ? `${m[1]} ${m[2]}` : '';
}

const plainText = (html: string | undefined) =>
  (html || '').replace(/<br\s*\/?>|<\/p>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/\n{2,}/g, '\n').trim();

const shortDay = (iso: string) =>
  new Date(iso).toLocaleString('en-US', { timeZone: 'America/Denver', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

const venueOf = (perk: DomorePerk) => perk.event?.venue?.title || perk.partner?.organization || '';
// Bonus and last-minute cards both open the app's claim screen for that ticket.
const claimUrl = (ticket: DomoreTicket) => {
  const token = ticket.token || ticket.perk?.token;
  return token ? `${APP}/events/single-perk/${encodeURIComponent(token)}` : APP;
};

function toEvent(ticket: DomoreTicket, kind: 'claimed' | 'bonus' | 'last-minute'): EventItem | null {
  const perk = ticket.perk;
  const start = wallClock(perk?.event?.begin_time_in_tz);
  if (!perk?.name || !start) return null;
  const token = ticket.token || perk.token || '';
  const price = kind === 'claimed' ? 'Free · claimed'
    : kind === 'bonus' ? `Free · bonus${ticket.claim_by ? ` · claim by ${shortDay(ticket.claim_by)}` : ''}`
    : `Free · last-minute${typeof perk.available === 'number' && perk.available > 0 ? ` · ${perk.available} left` : ''}`;
  const sourceUrl = kind !== 'claimed' ? claimUrl(ticket) : token ? `${APP}/events/${encodeURIComponent(token)}` : APP;
  return {
    eventName: perk.name,
    start,
    end: wallClock(perk.event?.end_time_in_tz),
    venue: venueOf(perk),
    address: perk.district_name || perk.area_name || '',
    category: 'DoMORE',
    group: 'DoMORE',
    price,
    rsvp: kind === 'claimed' ? 'Claimed on DoMORE' : 'Not claimed yet',
    urgency: kind === 'claimed' ? '' : 'high',
    disposition: '',
    notes: plainText(ticket.injected_ticket_redemption_info || perk.partner?.ticket_redemption_info || perk.ticket_redemption_info),
    sourceUrl,
    source: 'personal',
  };
}

async function getJson<T>(path: string, token: string, signal: AbortSignal): Promise<T> {
  const res = await fetch(`${API}/${path}`, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    cache: 'no-store',
    signal,
  });
  if (res.status === 401) throw new Error('DoMORE: signed out. Copy a fresh DO_MORE_auth_token into DOMORE_AUTH_TOKEN.');
  if (!res.ok) throw new Error(`DoMORE ${path}: HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

async function allPages(path: string, token: string, signal: AbortSignal): Promise<DomoreTicket[]> {
  const out: DomoreTicket[] = [];
  for (let page = 1; page <= 5; page++) {
    const data = await getJson<TicketPage>(`${path}?page=${page}`, token, signal);
    out.push(...(data.tickets ?? []));
    if (!data.has_more) break;
  }
  return out;
}

export async function fetchDomore(): Promise<DomoreResult> {
  const token = process.env.DOMORE_AUTH_TOKEN?.trim();
  if (!token) return { events: [], summary: null, errors: [], configured: false };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const [member, upcoming, pending] = await Promise.all([
      getJson<{ next_bundle?: string | null; last_minute_available?: boolean; last_minute_info?: { tickets?: DomoreTicket[] } }>('members/current?full=1', token, controller.signal),
      allPages('members/tickets/upcoming', token, controller.signal),
      allPages('members/tickets/pending', token, controller.signal),
    ]);
    const lastMinute = (member.last_minute_info?.tickets ?? []).filter((t) => t.status !== 'claimed');
    const events = [
      ...upcoming.map((t) => toEvent(t, 'claimed')),
      ...pending.map((t) => toEvent(t, 'bonus')),
      ...lastMinute.map((t) => toEvent(t, 'last-minute')),
    ].filter((e): e is EventItem => e !== null);
    // A ticket can show up in more than one list (a claimed last-minute spot); keep the first, most-settled copy.
    const seen = new Set<string>();
    const unique = events.filter((e) => { const k = `${e.eventName}|${e.start}`; if (seen.has(k)) return false; seen.add(k); return true; });
    // Same order as the app's carousel: bonus tickets first, then last-minute spots.
    const extras: DomoreExtra[] = [
      ...pending.map((t) => ({ t, kind: 'bonus' as const, claimable: true })),
      ...lastMinute.map((t) => ({ t, kind: 'last-minute' as const, claimable: member.last_minute_available !== false })),
    ].flatMap(({ t, kind, claimable }) => (t.perk?.name ? [{
      kind,
      title: t.perk.name,
      when: (t.perk.pretty_date_time || '').replace(/\s+/g, ' ').trim(),
      venue: venueOf(t.perk),
      url: claimUrl(t),
      claimable,
      left: typeof t.perk.available === 'number' && t.perk.available > 0 ? t.perk.available : null,
    }] : []));
    return { events: unique, summary: { nextDrop: member.next_bundle || null, extras }, errors: [], configured: true };
  } catch (err) {
    const message = (err as { name?: string })?.name === 'AbortError' ? 'DoMORE: timed out' : err instanceof Error ? err.message : String(err);
    return { events: [], summary: null, errors: [message], configured: true };
  } finally {
    clearTimeout(timer);
  }
}
