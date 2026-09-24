// Keeps the application stage of each Science job (Saved, Applied, Interviewing, ...) in a JSON file on this machine, so
// every device that reaches the local dashboard (this PC, or a phone over the LAN or Tailscale) sees the same stages.
// GET returns the whole map; POST sets or clears one role, so two devices editing different roles never overwrite each
// other. Local server only, like the dismiss routes: the published Cloudflare copy cannot reach the file, and the page
// keeps its stages in the browser there. The file sits in LeviAgent's data folder (gitignored runtime state), not in the
// sheet, because the job pipeline owns the Science Jobs tab's columns and would not expect one it did not write.
// It needs the Node server (`vinext start`): `vinext dev` runs a sandboxed runtime that cannot open files on this machine.
import { SCRIPT_DIR, refuseUnlessLocal, reply } from '../../dismissApi';
import { isJobStageId, type JobStageEntry } from '../../jobStages';

export const dynamic = 'force-dynamic';

const STAGES_FILE = process.env.JOB_STAGES_FILE ?? `${SCRIPT_DIR}\\data\\leviops_job_stages.json`;
const MAX_KEY = 300;
const MAX_ENTRIES = 2000;

type Stages = Record<string, JobStageEntry>;

// Loaded by a variable name so the Cloudflare build does not try to bundle Node-only modules.
const nodeFs = async () => { const name = 'node:fs/promises'; return await import(/* @vite-ignore */ name) as typeof import('node:fs/promises'); };

async function readStages(): Promise<Stages> {
  const fs = await nodeFs();
  let text: string;
  try { text = await fs.readFile(STAGES_FILE, 'utf8'); } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw e;
  }
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch {
    // Keep the unreadable file for inspection rather than overwriting it, and start empty.
    await fs.rename(STAGES_FILE, `${STAGES_FILE}.corrupt-${Date.now()}`).catch(() => undefined);
    return {};
  }
  const stages: Stages = {};
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    for (const [key, entry] of Object.entries(parsed as Record<string, { stage?: unknown; at?: unknown }>)) {
      if (key.length <= MAX_KEY && entry && isJobStageId(entry.stage) && typeof entry.at === 'string') stages[key] = { stage: entry.stage, at: entry.at };
    }
  }
  return stages;
}

async function writeStages(stages: Stages): Promise<void> {
  const fs = await nodeFs();
  const dir = STAGES_FILE.slice(0, Math.max(STAGES_FILE.lastIndexOf('\\'), STAGES_FILE.lastIndexOf('/')));
  if (dir) await fs.mkdir(dir, { recursive: true });
  const temp = `${STAGES_FILE}.tmp`;
  await fs.writeFile(temp, JSON.stringify(stages, null, 1), 'utf8');
  await fs.rename(temp, STAGES_FILE); // a crash mid-write leaves the old file intact
}

// Read-modify-write runs one at a time, so simultaneous requests from two devices cannot lose each other's change.
let queue: Promise<unknown> = Promise.resolve();
const serialized = <T,>(job: () => Promise<T>): Promise<T> => {
  const run = queue.then(job, job);
  queue = run.catch(() => undefined);
  return run;
};

const failed = () => reply(500, { ok: false, error: 'Could not read or write the job stages on this machine.' });

export async function GET(request: Request): Promise<Response> {
  const refused = refuseUnlessLocal(request);
  if (refused) return refused;
  try { return reply(200, { ok: true, stages: await serialized(readStages) }); } catch { return failed(); }
}

export async function POST(request: Request): Promise<Response> {
  const refused = refuseUnlessLocal(request);
  if (refused) return refused;

  let body: { key?: unknown; stage?: unknown; at?: unknown };
  try { body = await request.json(); } catch { return reply(400, { ok: false, error: 'Invalid JSON.' }); }
  const { key, stage, at } = body;
  if (typeof key !== 'string' || !key.trim() || key.length > MAX_KEY || (stage !== null && !isJobStageId(stage))) {
    return reply(400, { ok: false, error: 'Expected key and a stage (or null to clear).' });
  }
  // A device catching up on a change it made earlier may send that time; anything unparseable or in the future is ignored.
  const when = typeof at === 'string' && Date.parse(at) <= Date.now() + 60_000 ? Date.parse(at) : NaN;

  try {
    const stages = await serialized(async () => {
      const current = await readStages();
      if (stage === null) delete current[key];
      else current[key] = { stage, at: new Date(Number.isNaN(when) ? Date.now() : when).toISOString() };
      // Keep the file bounded: past the cap the oldest entries go.
      const entries = Object.entries(current);
      const kept = entries.length > MAX_ENTRIES ? Object.fromEntries(entries.sort((a, b) => b[1].at.localeCompare(a[1].at)).slice(0, MAX_ENTRIES)) : current;
      await writeStages(kept);
      return kept;
    });
    return reply(200, { ok: true, stages });
  } catch { return failed(); }
}
