// Marks one of the viewer's Google Tasks complete (the Events panel's "Done" button) through the Apps Script
// behind PERSONAL_TASKS_URL. Local dashboard only, same-origin only; see ../../dismissApi.ts and ../../personalTasks.ts.
import { isField, refuseUnlessLocal, reply } from '../../dismissApi';
import { completePersonalTask } from '../../personalTasks';

export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  const refused = refuseUnlessLocal(request);
  if (refused) return refused;

  let body: { action?: unknown; listId?: unknown; id?: unknown };
  try { body = await request.json(); } catch { return reply(400, { ok: false, error: 'Invalid JSON.' }); }
  const { action, listId, id } = body;
  if (action !== 'complete' || !isField(listId) || !isField(id)) {
    return reply(400, { ok: false, error: 'Expected action "complete" with listId and id.' });
  }
  const result = await completePersonalTask(listId, id);
  return reply(result.ok ? 200 : 502, result);
}
