// Live weather, forecast, and air quality for the Pulse card, based on the phone location Tasker writes to Google
// Drive (the same file Pulse reads). Runs google_environment_cli.py on this machine, which calls the Google Weather
// and Air Quality APIs directly — the same APIs the Pulse producer uses, so the card no longer falls back to
// Open-Meteo on the local dashboard. It only works on the local server: the phone-location file and the Google
// service account both live on this machine, so requests from any other host are refused and the published
// Cloudflare copy falls back to a fixed central-Denver Open-Meteo forecast in the page instead.
import { isLocalHost } from '../../liveFeedUrl';
import { readLocation } from '../../phoneLocation';
import { reply, runDismissScript } from '../../dismissApi';

export const dynamic = 'force-dynamic';

// The week of hours (?detail=1) is seven Google pages, and every dashboard load now asks for it (the Events lane marks
// rained-on events), so one answer per location is reused for 25 minutes, the same span the page caches it for.
const DETAIL_TTL_MS = 25 * 60 * 1000;
let detailCache: { at: number; key: string; status: number; body: Record<string, unknown> } | null = null;

export async function GET(request: Request): Promise<Response> {
  const host = request.headers.get('host') ?? '';
  const hostname = host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.split(':')[0];
  if (!isLocalHost(hostname)) return reply(403, { error: 'The phone-location forecast is only available on the local dashboard.' });

  const { lat, lon, fromPhone } = await readLocation();
  // ?detail=1 asks for every hour of the week (for a day opened in the week forecast) instead of the card's usual reading.
  const detail = new URL(request.url).searchParams.get('detail') === '1';
  const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  if (detail && detailCache && detailCache.key === key && Date.now() - detailCache.at < DETAIL_TTL_MS) {
    return reply(detailCache.status, { ...detailCache.body, source: fromPhone ? 'phone' : 'default' });
  }
  const resp = await runDismissScript('google_environment_cli.py', { lat, lon, ...(detail ? { detail: true } : {}) });
  const body = await resp.json() as Record<string, unknown>;
  if (detail && resp.ok && body.ok !== false) detailCache = { at: Date.now(), key, status: resp.status, body };
  return reply(resp.status, { ...body, source: fromPhone ? 'phone' : 'default' });
}
