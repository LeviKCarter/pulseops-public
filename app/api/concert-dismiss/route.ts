// Dismisses or restores a concert from the tracked-artist calendar overlay (see ../../concertDismissals.ts). The
// personal-calendar route leaves dismissed shows out of its events and lists them for the Restore list. Local server only.
import { eventKey } from '../../eventKey';
import { setConcertDismissed } from '../../concertDismissals';
import { isField, refuseUnlessLocal, reply } from '../../dismissApi';

export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  const refused = refuseUnlessLocal(request);
  if (refused) return refused;

  let body: { action?: unknown; eventName?: unknown; start?: unknown; venue?: unknown };
  try { body = await request.json(); } catch { return reply(400, { ok: false, error: 'Invalid JSON.' }); }
  const { action, eventName, start, venue } = body;
  if ((action !== 'dismiss' && action !== 'restore') || !isField(eventName) || !isField(start)
    || (venue !== undefined && venue !== '' && !isField(venue))) {
    return reply(400, { ok: false, error: 'Expected action, eventName and start.' });
  }
  const entry = { eventName, start, venue: typeof venue === 'string' ? venue : '' };
  try {
    await setConcertDismissed(eventKey(entry), entry, action === 'dismiss');
    return reply(200, { ok: true });
  } catch {
    return reply(500, { ok: false, error: 'Could not save the concert dismissal on this machine.' });
  }
}
