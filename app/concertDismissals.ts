// Concerts the viewer passed on, from the tracked-artist (Songkick) calendar overlay. Those rows aren't in the event
// ledger, so events_dismiss.py has no sheet row to mark; instead they're kept in a JSON file on this machine, next to
// the job stages, so every device on the local dashboard hides the same shows. Server-only (Node fs), like job-stages:
// the published Cloudflare copy never has the overlay in the first place.
import { SCRIPT_DIR } from './dismissApi';

export interface DismissedConcert { eventName: string; start: string; venue: string; at: string }
type Store = Record<string, DismissedConcert>;

const FILE = process.env.CONCERT_DISMISS_FILE ?? `${SCRIPT_DIR}\\data\\leviops_concert_dismissals.json`;
const MAX_ENTRIES = 2000;

// Loaded by a variable name so the Cloudflare build does not try to bundle Node-only modules.
const nodeFs = async () => { const name = 'node:fs/promises'; return await import(/* @vite-ignore */ name) as typeof import('node:fs/promises'); };

async function read(): Promise<Store> {
  const fs = await nodeFs();
  let text: string;
  try { text = await fs.readFile(FILE, 'utf8'); } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw e;
  }
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch {
    await fs.rename(FILE, `${FILE}.corrupt-${Date.now()}`).catch(() => undefined);
    return {};
  }
  const store: Store = {};
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    for (const [key, e] of Object.entries(parsed as Record<string, Partial<DismissedConcert>>)) {
      if (e && typeof e.eventName === 'string' && typeof e.start === 'string' && typeof e.at === 'string') {
        store[key] = { eventName: e.eventName, start: e.start, venue: typeof e.venue === 'string' ? e.venue : '', at: e.at };
      }
    }
  }
  return store;
}

async function write(store: Store): Promise<void> {
  const fs = await nodeFs();
  const dir = FILE.slice(0, Math.max(FILE.lastIndexOf('\\'), FILE.lastIndexOf('/')));
  if (dir) await fs.mkdir(dir, { recursive: true });
  const temp = `${FILE}.tmp`;
  await fs.writeFile(temp, JSON.stringify(store, null, 1), 'utf8');
  await fs.rename(temp, FILE);
}

let queue: Promise<unknown> = Promise.resolve();
const serialized = <T,>(job: () => Promise<T>): Promise<T> => {
  const run = queue.then(job, job);
  queue = run.catch(() => undefined);
  return run;
};

export const readDismissedConcerts = () => serialized(read);

// Adds (dismissed = true) or removes one concert. Shows that are over drop out, so the file stays small.
export function setConcertDismissed(key: string, entry: Omit<DismissedConcert, 'at'>, dismissed: boolean): Promise<Store> {
  return serialized(async () => {
    const store = await read();
    if (dismissed) store[key] = { ...entry, at: new Date().toISOString() };
    else delete store[key];
    const cutoff = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
    const kept = Object.entries(store).filter(([, e]) => e.start.slice(0, 10) >= cutoff).sort((a, b) => b[1].at.localeCompare(a[1].at)).slice(0, MAX_ENTRIES);
    const next = Object.fromEntries(kept);
    await write(next);
    return next;
  });
}
