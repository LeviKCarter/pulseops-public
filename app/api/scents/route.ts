// Keeps the scent card's state (bottles added, bottles run out, the day each was last worn) in a JSON file on this machine,
// so the phone and the PC agree on what's left and what was worn. Same shape as the job-stages route: local server only,
// reads and writes one at a time, and an atomic rename so a crash mid-write keeps the old file. The published Cloudflare
// copy cannot reach it; the card still picks from the starting collection there, it just can't save.
import { SCRIPT_DIR, isField, refuseUnlessLocal, reply } from '../../dismissApi';
import { EMPTY_SHELF, type Band, type Fragrance, type ScentShelf, type Slot } from '../../fragrances';

export const dynamic = 'force-dynamic';

const SHELF_FILE = process.env.SCENTS_FILE ?? `${SCRIPT_DIR}\\data\\leviops_scents.json`;
const MAX_ADDED = 200;
const BANDS: Band[] = ['hot', 'warm', 'mild', 'cold'];
const SLOTS: Slot[] = ['day', 'night'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const nodeFs = async () => { const name = 'node:fs/promises'; return await import(/* @vite-ignore */ name) as typeof import('node:fs/promises'); };

function asFragrance(v: unknown): Fragrance | null {
  const f = v as Partial<Fragrance> | null;
  if (!f || !isField(f.name) || !isField(f.profile) || (f.bottle !== 'full' && f.bottle !== 'sample') || typeof f.strong !== 'boolean') return null;
  const bands = Array.isArray(f.bands) ? f.bands.filter((b): b is Band => BANDS.includes(b)) : [];
  const slots = Array.isArray(f.slots) ? f.slots.filter((s): s is Slot => SLOTS.includes(s)) : [];
  if (!bands.length || !slots.length) return null;
  return { name: f.name.trim(), profile: f.profile.trim(), bottle: f.bottle, strong: f.strong, bands, slots };
}

async function readShelf(): Promise<ScentShelf> {
  const fs = await nodeFs();
  let text: string;
  try { text = await fs.readFile(SHELF_FILE, 'utf8'); } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { ...EMPTY_SHELF };
    throw e;
  }
  let raw: Partial<ScentShelf>;
  try { raw = JSON.parse(text) as Partial<ScentShelf>; } catch {
    await fs.rename(SHELF_FILE, `${SHELF_FILE}.corrupt-${Date.now()}`).catch(() => undefined);
    return { ...EMPTY_SHELF };
  }
  const worn: Record<string, string> = {};
  for (const [name, date] of Object.entries(raw.worn ?? {})) if (isField(name) && typeof date === 'string' && DATE.test(date)) worn[name] = date;
  return {
    added: (Array.isArray(raw.added) ? raw.added : []).map(asFragrance).filter((f): f is Fragrance => f !== null).slice(0, MAX_ADDED),
    out: (Array.isArray(raw.out) ? raw.out : []).filter(isField),
    worn,
  };
}

async function writeShelf(shelf: ScentShelf): Promise<void> {
  const fs = await nodeFs();
  const dir = SHELF_FILE.slice(0, Math.max(SHELF_FILE.lastIndexOf('\\'), SHELF_FILE.lastIndexOf('/')));
  if (dir) await fs.mkdir(dir, { recursive: true });
  const temp = `${SHELF_FILE}.tmp`;
  await fs.writeFile(temp, JSON.stringify(shelf, null, 1), 'utf8');
  await fs.rename(temp, SHELF_FILE);
}

let queue: Promise<unknown> = Promise.resolve();
const serialized = <T,>(job: () => Promise<T>): Promise<T> => {
  const run = queue.then(job, job);
  queue = run.catch(() => undefined);
  return run;
};

const failed = () => reply(500, { ok: false, error: 'Could not read or write the scent shelf on this machine.' });

export async function GET(request: Request): Promise<Response> {
  const refused = refuseUnlessLocal(request);
  if (refused) return refused;
  try { return reply(200, { ok: true, shelf: await serialized(readShelf) }); } catch { return failed(); }
}

// One change per request: wear/unwear a bottle for a day, mark it run out or restocked, or add a new one. Each returns
// the whole shelf, so the card stays in step with the other device's edits.
export async function POST(request: Request): Promise<Response> {
  const refused = refuseUnlessLocal(request);
  if (refused) return refused;
  let body: { action?: unknown; name?: unknown; date?: unknown; fragrance?: unknown };
  try { body = await request.json(); } catch { return reply(400, { ok: false, error: 'Expected JSON.' }); }
  const { action, name, date } = body;
  const fragrance = action === 'add' ? asFragrance(body.fragrance) : null;
  if (action === 'add' ? !fragrance : !isField(name)) return reply(400, { ok: false, error: 'Missing or invalid bottle.' });
  if (action === 'wear' && !(typeof date === 'string' && DATE.test(date))) return reply(400, { ok: false, error: 'Invalid date.' });
  if (!['wear', 'unwear', 'out', 'restock', 'add'].includes(action as string)) return reply(400, { ok: false, error: 'Unknown action.' });
  try {
    const shelf = await serialized(async () => {
      const s = await readShelf();
      const n = name as string;
      if (action === 'wear') s.worn[n] = date as string;
      if (action === 'unwear') delete s.worn[n];
      if (action === 'out' && !s.out.includes(n)) s.out.push(n);
      if (action === 'restock') s.out = s.out.filter((o) => o !== n);
      if (fragrance) {
        s.added = [...s.added.filter((f) => f.name.toLowerCase() !== fragrance.name.toLowerCase()), fragrance].slice(-MAX_ADDED);
        s.out = s.out.filter((o) => o.toLowerCase() !== fragrance.name.toLowerCase());
      }
      await writeShelf(s);
      return s;
    });
    return reply(200, { ok: true, shelf });
  } catch { return failed(); }
}
