// Reads and writes food-deal dismissals in the Denver Food Deal Collaboration sheet by running LeviAgent's
// food_dismiss.py: POST dismisses a deal (sets the row's Status to DISMISSED) or, with action "restore", puts it back;
// GET lists the dismissed deals still worth restoring, so the dashboard can offer Restore for them. Local server only;
// see ../../dismissApi.ts.
import { isField, refuseUnlessLocal, reply, runDismissScript } from '../../dismissApi';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const refused = refuseUnlessLocal(request);
  if (refused) return refused;
  return runDismissScript('food_dismiss.py', { action: 'list' });
}

export async function POST(request: Request): Promise<Response> {
  const refused = refuseUnlessLocal(request);
  if (refused) return refused;

  let body: { action?: unknown; kind?: unknown; restaurant?: unknown; deal?: unknown };
  try { body = await request.json(); } catch { return reply(400, { ok: false, error: 'Invalid JSON.' }); }
  const { action, kind, restaurant, deal } = body;
  if ((action !== undefined && action !== 'dismiss' && action !== 'restore')
      || (kind !== 'verified' && kind !== 'recurring') || !isField(restaurant) || !isField(deal)) {
    return reply(400, { ok: false, error: 'Expected kind, restaurant and deal.' });
  }
  return runDismissScript('food_dismiss.py', { action: action ?? 'dismiss', kind, restaurant, deal });
}
