// Where "within N miles" on the Events and Deals chips is measured from: the phone location Tasker writes to Google Drive.
// Like the forecast route it only answers the local dashboard, and the position is rounded to about a kilometre first.
import { isLocalHost } from '../../liveFeedUrl';
import { readLocation } from '../../phoneLocation';

export const dynamic = 'force-dynamic';

const reply = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

export async function GET(request: Request): Promise<Response> {
  const host = request.headers.get('host') ?? '';
  const hostname = host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.split(':')[0];
  if (!isLocalHost(hostname)) return reply(403, { error: 'The phone location is only available on the local dashboard.' });
  const { lat, lon, fromPhone } = await readLocation();
  if (!fromPhone) return reply(404, { error: 'no phone location' });
  return reply(200, { lat: Number(lat.toFixed(2)), lon: Number(lon.toFixed(2)) });
}
