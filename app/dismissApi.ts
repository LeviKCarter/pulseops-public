// Shared by routes that run a LeviAgent script on this machine and relay its JSON: the food/event dismissal
// routes (food_dismiss.py / events_dismiss.py, writing to a Google Sheet) and the forecast route
// (google_environment_cli.py, reading Google Weather/Air Quality). That only works on the local server (the
// `vinext start` process here, reached on localhost, the LAN or Tailscale): requests from any other host are refused,
// so the published Cloudflare copy of the page can never reach these. Callers fall back to something else in the
// browser when a route returns an error.
import { isLocalHost } from './liveFeedUrl';

const PYTHON = process.env.FOOD_DISMISS_PYTHON ?? 'C:\\Users\\YOU\\miniforge3\\python.exe';
export const SCRIPT_DIR = process.env.FOOD_DISMISS_DIR ?? 'C:\\Users\\YOU\\Documents\\Codex\\LeviAgent';
export const MAX_FIELD = 400;

export const reply = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

// Returns an error response when the request is not a same-origin call from the local dashboard, else null.
export function refuseUnlessLocal(request: Request): Response | null {
  const host = request.headers.get('host') ?? '';
  const hostname = host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.split(':')[0];
  if (!isLocalHost(hostname)) return reply(403, { ok: false, error: 'Dismissals can only be saved from the local dashboard.' });
  // A browser page on another site cannot forge this: require a same-origin request.
  const origin = request.headers.get('origin');
  if (origin && new URL(origin).host !== host) return reply(403, { ok: false, error: 'Cross-origin request refused.' });
  return null;
}

export const isField = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= MAX_FIELD;

// Feeds `payload` to the script on stdin and relays the JSON object it prints.
export async function runDismissScript(script: string, payload: Record<string, unknown>): Promise<Response> {
  try {
    // Loaded by a variable name so the Cloudflare build does not try to bundle a Node-only module.
    const moduleName = 'node:child_process';
    const { execFile } = await import(/* @vite-ignore */ moduleName) as typeof import('node:child_process');
    const output = await new Promise<string>((resolve, reject) => {
      const child = execFile(PYTHON, [script], { cwd: SCRIPT_DIR, timeout: 60_000, windowsHide: true, maxBuffer: 1 << 20 },
        (error, stdout) => (stdout ? resolve(stdout) : reject(error ?? new Error('no output'))));
      child.stdin?.end(JSON.stringify(payload));
    });
    const result = JSON.parse(output.trim().split('\n').pop() ?? '{}') as { ok?: boolean; status?: number; error?: string };
    return reply(result.ok ? 200 : (result.status ?? 500), result);
  } catch {
    return reply(502, { ok: false, error: 'Could not run the sheet update on this machine.' });
  }
}
