// The phone location Tasker writes to Google Drive. The file lives on this machine, so only the local server can read it.
const LOCATION_FILE = process.env.TASKER_LOCATION_FILE ?? 'G:\\My Drive\\Tasker\\location';
export const FALLBACK_LOCATION: [number, number] = [39.74, -104.99];

// Tasker's export is loosely formatted (fix_time can be blank), so pull the "lat,lon" pair out with a pattern.
export async function readLocation(): Promise<{ lat: number; lon: number; fromPhone: boolean }> {
  try {
    // Loaded by a variable name so the Cloudflare build does not try to bundle a Node-only module.
    const moduleName = 'node:fs/promises';
    const { readFile } = await import(/* @vite-ignore */ moduleName) as typeof import('node:fs/promises');
    const text = await readFile(LOCATION_FILE, 'utf8');
    const m = /"location"\s*:\s*"(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)"/.exec(text);
    if (m) {
      const lat = Number(m[1]);
      const lon = Number(m[2]);
      if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) return { lat, lon, fromPhone: true };
    }
  } catch { /* file missing or Drive not mounted: use the default */ }
  return { lat: FALLBACK_LOCATION[0], lon: FALLBACK_LOCATION[1], fromPhone: false };
}
