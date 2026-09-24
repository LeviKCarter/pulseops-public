// Reads and writes event dismissals in the Denver Event Ledger sheet by running LeviAgent's events_dismiss.py:
// POST dismisses an event (sets the row's Disposition to Ignored) or, with action "restore", puts it back; GET lists
// the dismissed events that have not started yet, so the dashboard can offer Restore for them. Local server only;
// see ../../dismissApi.ts.
import { isField, refuseUnlessLocal, reply, runDismissScript } from '../../dismissApi';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const refused = refuseUnlessLocal(request);
  if (refused) return refused;
  return runDismissScript('events_dismiss.py', { action: 'list' });
}

export async function POST(request: Request): Promise<Response> {
  const refused = refuseUnlessLocal(request);
  if (refused) return refused;

  let body: { action?: unknown; eventName?: unknown; start?: unknown; venue?: unknown };
  try { body = await request.json(); } catch { return reply(400, { ok: false, error: 'Invalid JSON.' }); }
  const { action, eventName, start, venue } = body;
  if ((action !== undefined && action !== 'dismiss' && action !== 'restore')
      || !isField(eventName) || !isField(start) || (venue !== undefined && venue !== '' && !isField(venue))) {
    return reply(400, { ok: false, error: 'Expected eventName, start and venue.' });
  }
  return runDismissScript('events_dismiss.py', { action: action ?? 'dismiss', eventName, start, venue: venue || undefined });
}
