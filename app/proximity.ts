'use client';

import { useEffect, useState } from 'react';

// The feeds carry street addresses but no coordinates, so a place is placed by its ZIP code, or failing that its city or
// neighborhood name. That is accurate to about a mile, which is all a "within N miles" chip needs. Approximate centroids.
type LatLon = [number, number];

const ZIP_CENTROIDS: Record<string, LatLon> = {
  '80202': [39.7517, -104.9985], '80203': [39.7311, -104.9819], '80204': [39.7346, -105.0192], '80205': [39.757, -104.9718],
  '80206': [39.7377, -104.9527], '80207': [39.7615, -104.9182], '80209': [39.7002, -104.9744], '80210': [39.6784, -104.966],
  '80211': [39.7691, -105.0197], '80212': [39.7745, -105.043], '80216': [39.7810, -104.9600], '80218': [39.7307, -104.966],
  '80219': [39.6954, -105.033], '80220': [39.7337, -104.916], '80221': [39.833, -105.01], '80222': [39.6733, -104.927],
  '80223': [39.696, -105.0], '80224': [39.6787, -104.92], '80230': [39.72, -104.898], '80231': [39.679, -104.9],
  '80238': [39.762, -104.885], '80239': [39.78, -104.84], '80246': [39.705, -104.927], '80249': [39.79, -104.76],
  '80010': [39.74, -104.86], '80011': [39.74, -104.79], '80012': [39.7, -104.84], '80014': [39.66, -104.84], '80045': [39.745, -104.838],
  '80003': [39.81, -105.05], '80005': [39.84, -105.11], '80030': [39.85, -105.03], '80031': [39.87, -105.04],
  '80214': [39.7400, -105.0700], '80215': [39.7400, -105.1100], '80226': [39.7, -105.09], '80401': [39.7500, -105.2200],
  '80301': [40.0500, -105.2200], '80302': [40.019, -105.293], '80303': [39.994, -105.24], '80304': [40.04, -105.29],
  '80305': [39.98, -105.24], '80309': [40.008, -105.265],
};

// Fallbacks for addresses with no ZIP; the first pattern that matches wins, so specific names come before their city.
const PLACE_CENTROIDS: Array<[RegExp, LatLon]> = [
  [/CU Boulder|Boulder/i, [40.008, -105.265]],
  [/Larimer Square/i, [39.7502, -104.9995]],
  [/Capitol Hill/i, [39.7311, -104.9819]],
  [/Cherry Creek/i, [39.7168, -104.9535]],
  [/\bRiNo\b/i, [39.7690, -104.9800]],
  [/\bAurora\b/i, [39.7294, -104.8319]],
  [/Westminster/i, [39.8367, -105.0372]],
  [/Lakewood/i, [39.7047, -105.0814]],
  [/Arvada/i, [39.8028, -105.0875]],
  [/Golden/i, [39.7555, -105.2211]],
  // A bare "Denver" is downtown; "Denver Metro" and chain promos ("participating stores") name no single place.
  [/^(?!.*(?:metro|participating|nearby|stores|locations|,\s*DC\b)).*\bDenver\b/i, [39.7392, -104.9903]],
];

export function placeOf(text: string | undefined): LatLon | null {
  const t = text ?? '';
  const zip = /\b(80\d{3})\b/.exec(t)?.[1];
  if (zip && ZIP_CENTROIDS[zip]) return ZIP_CENTROIDS[zip];
  for (const [pattern, at] of PLACE_CENTROIDS) if (pattern.test(t)) return at;
  return null;
}

// Named points for labeling a coordinate back to a place ("near Capitol Hill") rather than filtering by one — a
// few of these overlap PLACE_CENTROIDS above, plus some closer-in Denver neighborhoods for finer resolution near
// the phone's actual position.
const NAMED_PLACES: Array<[string, LatLon]> = [
  ['Boulder', [40.008, -105.265]],
  ['Larimer Square', [39.7502, -104.9995]],
  ['Capitol Hill', [39.7311, -104.9819]],
  ['Cherry Creek', [39.7168, -104.9535]],
  ['RiNo', [39.769, -104.98]],
  ['Five Points', [39.7597, -104.9767]],
  ['Congress Park', [39.7364, -104.955]],
  ['City Park', [39.7458, -104.9506]],
  ['Highlands', [39.7676, -105.018]],
  ["Sloan's Lake", [39.7469, -105.0431]],
  ['Washington Park', [39.7018, -104.9722]],
  ['Baker', [39.7089, -104.9922]],
  ['Aurora', [39.7294, -104.8319]],
  ['Westminster', [39.8367, -105.0372]],
  ['Lakewood', [39.7047, -105.0814]],
  ['Arvada', [39.8028, -105.0875]],
  ['Golden', [39.7555, -105.2211]],
  ['downtown Denver', [39.7392, -104.9903]],
];

// The named place closest to `at`, for a human-readable "near ___" label. Approximate (nearest of ~18 landmarks),
// so it's for display only — never used for the isWithin/isWithinBand filtering above.
export function nearestPlaceName(at: LatLon): string {
  let bestName = NAMED_PLACES[0][0];
  let bestDist = milesBetween(at, NAMED_PLACES[0][1]);
  for (const [name, place] of NAMED_PLACES.slice(1)) {
    const d = milesBetween(at, place);
    if (d < bestDist) { bestName = name; bestDist = d; }
  }
  return bestName;
}

export const DEFAULT_ORIGIN: LatLon = [39.74, -104.99]; // The same central-Denver point the weather card falls back to.

export function milesBetween([lat1, lon1]: LatLon, [lat2, lon2]: LatLon): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.sqrt(a));
}

// True only when the place can be located and lies within `radius` miles of the origin.
export const isWithin = (text: string | undefined, origin: LatLon, radius: number): boolean => {
  const at = placeOf(text);
  return at !== null && milesBetween(origin, at) <= radius;
};

// True only when the place can be located and its distance from the origin falls in (low, high] miles — an
// exclusive band, so picking "Boulder" doesn't also pull in everything already covered by "Denver"/"Metro".
export const isWithinBand = (text: string | undefined, origin: LatLon, low: number, high: number): boolean => {
  const at = placeOf(text);
  if (at === null) return false;
  const d = milesBetween(origin, at);
  return d > low && d <= high;
};

// Given an ascending radii list and the currently-selected band's `miles`, returns the exclusive (low, high] range
// for that band — low is the previous band's miles, or 0 for the first one.
export function radiusBand(radii: ReadonlyArray<{ miles: number }>, miles: number): { low: number; high: number } {
  const idx = radii.findIndex((r) => r.miles === miles);
  return { low: idx > 0 ? radii[idx - 1].miles : 0, high: miles };
}

// Events either sit right downtown, out in the metro suburbs (Lakewood, Aurora, Arvada, Golden), or are a CU Boulder
// listing ~25 miles out; barely anything falls between 10 and 20 miles. Each band is exclusive (see isWithinBand),
// so "Boulder" shows only the Boulder cluster instead of downtown + metro + Boulder all at once.
export const EVENT_RADII = [
  { miles: 3, label: 'Denver', hint: 'Only the walkable downtown core' },
  { miles: 10, label: 'Metro', hint: 'Only the metro suburbs — Lakewood, Aurora, Arvada, Golden — not downtown' },
  { miles: 30, label: 'Boulder', hint: 'Only the Boulder-area cluster' },
] as const;

// Deals never leave the Denver metro (the farthest is ~8 miles out), so a "Boulder" band would always be empty and
// a "Metro" band would always match everything "Denver" already does. These are plain cumulative distance bands —
// about a third of deals sit within a mile, most within 3, and effectively all within 7.
export const DEAL_RADII = [
  { miles: 1, label: '1 mi', hint: 'Only places within 1 mile' },
  { miles: 3, label: '3 mi', hint: 'Only places within 3 miles' },
  { miles: 7, label: '7 mi', hint: 'Only places within 7 miles' },
] as const;

// Where "within N miles" is measured from: the phone location, served by /api/origin on the local dashboard. Anywhere
// else (the published copy) or when the file is unavailable, it measures from central Denver instead. Fetched once, and
// only after a distance chip is first switched on.
let phoneFix: Promise<LatLon | null> | null = null;
const loadPhoneFix = () => (phoneFix ??= fetch('/api/origin', { cache: 'no-store' })
  .then((r) => (r.ok ? (r.json() as Promise<{ lat?: number; lon?: number }>) : null))
  .then((j) => (j && Number.isFinite(j.lat) && Number.isFinite(j.lon) ? ([j.lat, j.lon] as LatLon) : null))
  .catch(() => null));

export function useOrigin(active: boolean): { origin: LatLon; label: string } {
  const [fix, setFix] = useState<LatLon | 'none' | null>(null);
  useEffect(() => {
    if (!active || fix) return;
    let live = true;
    loadPhoneFix().then((at) => { if (live) setFix(at ?? 'none'); });
    return () => { live = false; };
  }, [active, fix]);
  if (Array.isArray(fix)) return { origin: fix, label: nearestPlaceName(fix) };
  return { origin: DEFAULT_ORIGIN, label: fix === 'none' ? 'central Denver' : 'central Denver (locating…)' };
}
