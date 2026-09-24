// Same-origin proxy for the Levi Ops live feed. The Worker's CORS policy only allows the published site's
// origin, so a browser on localhost cannot read it directly. This route fetches it server-side and returns
// it unchanged. It is read-only and adds no credentials: the feed is the same public snapshot the page reads.
const FEED_URL = 'https://your-live-feed.example.workers.dev/snapshot';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const upstream = await fetch(FEED_URL, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: controller.signal,
    });
    return new Response(await upstream.text(), {
      status: upstream.status,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    });
  } catch {
    return new Response(JSON.stringify({ error: 'live feed unreachable' }), {
      status: 502,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    });
  } finally {
    clearTimeout(timer);
  }
}
