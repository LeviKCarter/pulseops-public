// Opt-in overlay of the viewer's own calendars and Google Tasks. Like the forecast/origin routes, it only answers
// the local dashboard: the ICS feed URLs and the tasks feed URL (PERSONAL_TASKS_URL) are configured in
// local-only env vars, never shipped to the published site.
import { readDismissedConcerts, type DismissedConcert } from '../../concertDismissals';
import { fetchDomore } from '../../domore';
import { eventKey } from '../../eventKey';
import { isLocalHost } from '../../liveFeedUrl';
import { fetchPersonalCalendarEvents } from '../../personalCalendars';
import { fetchPersonalTasks } from '../../personalTasks';

export const dynamic = 'force-dynamic';

const reply = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

export async function GET(request: Request): Promise<Response> {
  const host = request.headers.get('host') ?? '';
  const hostname = host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.split(':')[0];
  if (!isLocalHost(hostname)) return reply(403, { error: 'The personal calendar overlay is only available on the local dashboard.' });
  try {
    const [calendars, tasks, domore] = await Promise.all([fetchPersonalCalendarEvents(), fetchPersonalTasks(), fetchDomore()]);
    if (!calendars.configured && !tasks.configured && !domore.configured) {
      return reply(404, { error: 'No PERSONAL_CALENDAR_ICS_URLS, PERSONAL_TASKS_URL or DOMORE_AUTH_TOKEN configured.', events: [] });
    }
    // Concerts the viewer passed on (see concertDismissals.ts) stay out; an unreadable file just means none are hidden.
    const dismissed: Record<string, DismissedConcert> = calendars.events.some((e) => e.suggestion) ? await readDismissedConcerts().catch(() => ({})) : {};
    const events = [...calendars.events, ...tasks.events, ...domore.events]
      .filter((e) => !e.suggestion || !(eventKey(e) in dismissed))
      .sort((a, b) => a.start.localeCompare(b.start));
    const dismissedConcerts = Object.values(dismissed).map(({ eventName, start, venue }) => ({ eventName, start, venue })).sort((a, b) => a.start.localeCompare(b.start));
    return reply(200, { events, dismissedConcerts, domore: domore.configured ? { ...domore.summary, error: domore.errors[0] ?? null } : null, errors: [...calendars.errors, ...tasks.errors, ...domore.errors] });
  } catch {
    return reply(502, { error: 'personal calendar feed unreachable', events: [] });
  }
}
