const WORKER_FEED_URL = 'https://your-live-feed.example.workers.dev/snapshot';

// The Worker only allows the published site's origin (CORS), so copies served from this machine
// should read the feed through the same-origin /api/live-feed route instead. "Local" covers loopback, LAN ranges and
// Tailscale: 100.64.0.0/10 and fd7a:115c:a1e0::/48 addresses, full *.ts.net names, and short MagicDNS machine names
// (e.g. http://levi-pc:3000). A single-label name can only resolve on a private network, never on the public web.
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const PRIVATE_ADDRESS = /^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/;
const TAILSCALE_IPV6 = /^\[fd7a:115c:a1e0:/;
const SINGLE_LABEL = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

export function isLocalHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  return (
    LOOPBACK_HOSTS.has(host) ||
    host.endsWith('.ts.net') ||
    host.endsWith('.trycloudflare.com') ||
    PRIVATE_ADDRESS.test(host) ||
    TAILSCALE_IPV6.test(host) ||
    SINGLE_LABEL.test(host)
  );
}

export function liveFeedUrl(): string {
  if (typeof window !== 'undefined' && isLocalHost(window.location.hostname)) {
    return '/api/live-feed';
  }
  return WORKER_FEED_URL;
}
