'use client';

import { useCallback, useMemo, useSyncExternalStore } from 'react';
import QuickFilters from './QuickFilters';
import { DEAL_RADII, isWithin, useOrigin } from './proximity';
import { dealValue, mapsUrl, priceTag, type ValueTier } from './foodPrice';
import type { DealSchedule } from './gameDayDeals';

export interface FoodItem {
  kind?: 'verified' | 'recurring';
  restaurant: string;
  deal: string;
  price: string;
  discount: string;
  location: string;
  validThrough: string;
  orderSource: string;
  // Tagged by scripts/food_groups.py; absent on snapshots written before the tagger existed.
  svc?: string[];
  type?: string;
  // When the deal runs, read from the sheet by food_groups.deal_schedule; absent when the sheet states no schedule.
  when?: DealSchedule;
}

type Sort = 'value' | 'price' | 'newest';

const SORTS: [Sort, string][] = [['value', 'Best value'], ['price', 'Price, low to high'], ['newest', 'Newest']];
const SERVICES: [string, string][] = [['dine-in', 'Dine-in'], ['pickup', 'Pickup'], ['delivery', 'Delivery'], ['app', 'App / code']];
const VIEW_KEY = 'leviops-food-view-v1';

// The chosen sort and filters are a per-viewer convenience kept in localStorage. Storage can be missing or blocked,
// so the current value also lives in memory and every storage access is guarded.
interface View { sort: Sort; services: string[]; type: string; freeOnly: boolean; radius: number | null }
const DEFAULT_VIEW: View = { sort: 'value', services: [], type: '', freeOnly: false, radius: null };
const viewListeners = new Set<() => void>();
let viewRaw: string | null = null;

const readViewRaw = (): string => {
  if (viewRaw !== null) return viewRaw;
  try { return localStorage.getItem(VIEW_KEY) ?? ''; } catch { return ''; }
};

function parseView(raw: string): View {
  try {
    const saved = JSON.parse(raw || 'null');
    if (!saved || typeof saved !== 'object') return DEFAULT_VIEW;
    return {
      sort: SORTS.some(([id]) => id === saved.sort) ? saved.sort : DEFAULT_VIEW.sort,
      services: Array.isArray(saved.services) ? saved.services.filter((s: unknown): s is string => typeof s === 'string') : [],
      type: typeof saved.type === 'string' ? saved.type : '',
      freeOnly: saved.freeOnly === true,
      radius: DEAL_RADII.some((r) => r.miles === saved.radius) ? saved.radius : null,
    };
  } catch { return DEFAULT_VIEW; }
}

function useFoodView(): [View, (patch: Partial<View>) => void] {
  const raw = useSyncExternalStore(
    (notify) => { viewListeners.add(notify); return () => { viewListeners.delete(notify); }; },
    readViewRaw,
    () => '',
  );
  const view = useMemo(() => parseView(raw), [raw]);
  const patchView = useCallback((patch: Partial<View>) => {
    viewRaw = JSON.stringify({ ...parseView(readViewRaw()), ...patch });
    try { localStorage.setItem(VIEW_KEY, viewRaw); } catch { /* kept in memory only */ }
    viewListeners.forEach((notify) => notify());
  }, []);
  return [view, patchView];
}

const safeUrl = (url: string | null | undefined) => (url && /^https?:\/\//i.test(url) ? url : null);

const VALUE_STYLE: Record<ValueTier, string> = {
  great: 'text-[#7fd1a0]',
  good: 'text-[#e8c46d]',
  meh: 'text-white/62',
};

interface Row { item: FoodItem; index: number; tag: ReturnType<typeof priceTag>; value: ReturnType<typeof dealValue> }

const amountOf = (r: Row) => (r.tag.tone === 'free' ? 0 : r.tag.amount ?? Infinity);

const COMPARE: Record<Sort, (a: Row, b: Row) => number> = {
  value: (a, b) => b.value.score - a.value.score || amountOf(a) - amountOf(b) || a.index - b.index,
  price: (a, b) => (amountOf(a) === amountOf(b) ? b.value.score - a.value.score || a.index - b.index : amountOf(a) < amountOf(b) ? -1 : 1),
  newest: (a, b) => a.index - b.index,
};

const toRow = (item: FoodItem, index: number): Row => ({ item, index, tag: priceTag(item.price, item.deal), value: dealValue(item) });

// The phone overview's Deals panel: a few filter pills bound to the same saved view as the lane (so a filter picked
// there is still on when the lane opens), and the deals that view shows, in the lane's order. "Near" is the lane's
// 3-mile distance chip, measured from the phone's location.
const GLANCE_NEAR_MILES = 3;
export const GLANCE_PILLS: Array<{ id: string; label: string }> = [{ id: 'free', label: 'Free' }, ...SERVICES.slice(0, 2).map(([id, label]) => ({ id, label })), { id: 'near', label: `${GLANCE_NEAR_MILES} mi` }];
export function useDealsGlance(verified: FoodItem[], recurring: FoodItem[]) {
  const [{ sort, services, type, freeOnly, radius }, patchView] = useFoodView();
  const { origin } = useOrigin(radius !== null);
  const rows = useMemo(() => [...verified, ...recurring].map(toRow).filter((r) => r.value.tier !== 'meh'), [verified, recurring]);
  const shown = rows
    .filter((r) => (!freeOnly || r.tag.text === 'Free')
      && (radius === null || isWithin(r.item.location, origin, radius))
      && (!type || r.item.type === type)
      && (services.length === 0 || services.some((s) => r.item.svc?.includes(s))))
    .sort(COMPARE[sort])
    .map((r) => r.item);
  const isOn = (id: string) => (id === 'free' ? freeOnly : id === 'near' ? radius === GLANCE_NEAR_MILES : services[0] === id);
  // Free and the distance stack with a service; the services are one at a time, as in the lane's Service picker.
  const toggle = (id: string) => (id === 'free' ? patchView({ freeOnly: !freeOnly })
    : id === 'near' ? patchView({ radius: radius === GLANCE_NEAR_MILES ? null : GLANCE_NEAR_MILES })
    : patchView({ services: services[0] === id ? [] : [id] }));
  return { shown, total: rows.length, isOn, toggle };
}

function DealRow({ row, cols, onDismiss }: { row: Row; cols: boolean; onDismiss: (item: FoodItem) => void }) {
  const { item, tag, value } = row;
  const href = safeUrl(item.orderSource);
  const svcLabels = (item.svc ?? []).map((s) => SERVICES.find(([id]) => id === s)?.[1] ?? s);
  const meta = [item.type && item.type !== 'Other' ? item.type : '', ...svcLabels].filter(Boolean).join(' · ');
  return (
    <li className={cols ? 'border-b border-white/[0.06] py-2.5' : 'py-2.5 first:pt-1 last:pb-0'}>
      <div className="flex items-start justify-between gap-2">
        <h4 className="text-sm font-bold leading-snug">
          <a href={mapsUrl(item.restaurant, item.location)} target="_blank" rel="noreferrer" title="Open in Google Maps" className="underline-offset-2 hover:text-[#e8c46d] hover:underline">{item.restaurant}</a>
        </h4>
        <span className="flex shrink-0 items-center gap-1.5">
          <span title={value.reasons.join('\n')} aria-label={`${value.label} value. ${value.reasons.join('. ')}`} className={`inline-flex items-center gap-1 text-[0.75rem] font-bold ${VALUE_STYLE[value.tier]}`}>
            <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />{value.label}
          </span>
          <span title={tag.title} className={`rounded px-1.5 py-0.5 text-[0.75rem] font-bold ${tag.tone === 'free' ? 'bg-[#4d9a6d]/18 text-[#7fd1a0]' : tag.tone === 'other' ? 'bg-white/8 text-white/78' : 'bg-[#f7c972]/12 text-[#e8c46d]'}`}>{tag.text}</span>
          <button type="button" aria-label={`Hide ${item.restaurant}`} title="Dismiss this deal (saved to the sheet)" onClick={() => onDismiss(item)} className="rounded px-1 text-sm leading-none text-white/62 hover:bg-white/10 hover:text-white/80">×</button>
        </span>
      </div>
      {meta && <p className="mt-0.5 text-[0.75rem] font-bold uppercase tracking-[0.06em] text-white/62">{meta}</p>}
      <p className="mt-1 line-clamp-2 text-xs leading-5 text-white/72" title={item.deal}>{item.deal}</p>
      <div className="mt-1 flex items-start justify-between gap-3 text-[0.75rem] leading-4 text-white/62">
        <span className="line-clamp-2" title={item.validThrough}>{[item.discount, item.validThrough].filter(Boolean).join(' · ')}</span>
        {href && <a href={href} target="_blank" rel="noreferrer" className="shrink-0 font-bold text-[#e8c46d] hover:underline">Source ↗</a>}
      </div>
    </li>
  );
}

const selectClass = 'min-w-0 max-w-full rounded-md border border-white/[0.14] bg-[#0f1713] px-2 py-0.5 text-[0.75rem] font-bold text-white/85';

interface Props {
  verified: FoodItem[];
  recurring: FoodItem[];
  expanded: boolean;
  onDismiss: (item: FoodItem) => void;
  onExpand: () => void;
}

export default function FoodDeals({ verified, recurring, expanded, onDismiss, onExpand }: Props) {
  const [{ sort, services, type, freeOnly, radius }, patchView] = useFoodView();
  // Always shown next to the radius chips now (not just once a radius is picked), so fetch it eagerly rather than
  // waiting for the first chip click.
  const { origin, label: originLabel } = useOrigin(true);

  // Verified and recurring deals share one list; the verified ones come first so "Newest" keeps them on top.
  // Meh-tier deals are dropped here rather than behind a toggle -- nobody's going out of their way to see a bad deal.
  const rows = useMemo(() => [...verified, ...recurring].map(toRow).filter((r) => r.value.tier !== 'meh'), [verified, recurring]);
  const tagged = rows.some((r) => r.item.svc || r.item.type);
  const service = services[0] ?? '';

  // Each filter as its own test, so a dropdown's counts can apply every filter except its own (faceted counts):
  // "Pickup (n)" then says how many deals picking Pickup would actually show with Free and the radius still on.
  const passFree = (r: Row) => !freeOnly || r.tag.text === 'Free';
  const passRadius = (r: Row) => radius === null || isWithin(r.item.location, origin, radius);
  const passType = (r: Row) => !type || r.item.type === type;
  const passService = (r: Row) => services.length === 0 || services.some((s) => r.item.svc?.includes(s));
  const forServices = rows.filter((r) => passFree(r) && passRadius(r) && passType(r));
  const forTypes = rows.filter((r) => passFree(r) && passRadius(r) && passService(r));
  const serviceCount = (id: string) => forServices.filter((r) => r.item.svc?.includes(id)).length;
  const typeCounts = (() => {
    const counts = new Map<string, number>();
    for (const r of rows) if (r.item.type) counts.set(r.item.type, 0);
    for (const r of forTypes) if (r.item.type) counts.set(r.item.type, (counts.get(r.item.type) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  })();

  const shown = useMemo(
    () => rows
      .filter((r) => (!freeOnly || r.tag.text === 'Free')
        && (radius === null || isWithin(r.item.location, origin, radius))
        && (!type || r.item.type === type)
        && (services.length === 0 || services.some((s) => r.item.svc?.includes(s))))
      .sort(COMPARE[sort]),
    [rows, freeOnly, radius, origin, type, services, sort],
  );
  const listed = expanded ? shown : shown.slice(0, 6);
  const filtered = freeOnly || radius !== null || type !== '' || services.length > 0;
  const activeFilters = [
    freeOnly ? 'Free' : '',
    radius !== null ? `within ${DEAL_RADII.find((r) => r.miles === radius)?.label ?? `${radius} mi`}` : '',
    service ? SERVICES.find(([id]) => id === service)?.[1] ?? service : '',
    type,
  ].filter(Boolean);
  const clearFilters = () => patchView({ freeOnly: false, radius: null, type: '', services: [] });

  if (rows.length === 0) {
    return <div className="lane-wide mt-5 border-t border-white/[0.07] pt-4"><p className="text-xs leading-5 text-white/72">No deals are live right now.</p></div>;
  }

  return (
    <div className="lane-wide mt-5 border-t border-white/[0.07] pt-4">
      <QuickFilters label="Quick filters for deals" freeOnly={freeOnly} onFreeOnly={(on) => patchView({ freeOnly: on })} radius={radius} onRadius={(miles) => patchView({ radius: miles })} radii={DEAL_RADII} originLabel={originLabel} showOrigin accent="232 196 109" />
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-2" role="group" aria-label="Sort and filter deals">
        <p className="mr-auto text-[0.75rem] font-bold text-white/62" aria-live="polite">
          {filtered ? `${shown.length} of ${rows.length} deals` : `${rows.length} deals`}
        </p>
        {tagged && (
          <label className="flex min-w-0 max-w-full items-center gap-1.5 text-[0.75rem] font-bold text-white/62">
            Service
            <select value={service} onChange={(e) => patchView({ services: e.target.value ? [e.target.value] : [] })} className={selectClass}>
              <option value="">All</option>
              {SERVICES.filter(([id]) => id === service || rows.some((r) => r.item.svc?.includes(id))).map(([id, label]) => <option key={id} value={id}>{label} ({serviceCount(id)})</option>)}
            </select>
          </label>
        )}
        {tagged && typeCounts.length > 1 && (
          <label className="flex min-w-0 max-w-full items-center gap-1.5 text-[0.75rem] font-bold text-white/62">
            Type
            <select value={type} onChange={(e) => patchView({ type: e.target.value })} className={selectClass}>
              <option value="">All</option>
              {typeCounts.map(([name, n]) => <option key={name} value={name}>{name} ({n})</option>)}
            </select>
          </label>
        )}
        <label className="flex min-w-0 max-w-full items-center gap-1.5 text-[0.75rem] font-bold text-white/62">
          Sort
          <select value={sort} onChange={(e) => patchView({ sort: e.target.value as Sort })} className={selectClass}>
            {SORTS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
        </label>
      </div>

      {shown.length === 0
        ? (
          <p className="mt-3 text-xs leading-5 text-white/72">
            No deals match {activeFilters.join(' + ')}.{' '}
            <button type="button" onClick={clearFilters} className="font-bold text-[#e8c46d] hover:underline">Clear filters</button>
          </p>
        )
        : <ul className={expanded ? 'lane-rows mt-2' : 'mt-2 divide-y divide-white/[0.06]'}>{listed.map((r) => <DealRow key={`${r.item.kind ?? 'r'}-${r.item.restaurant}-${r.index}`} row={r} cols={expanded} onDismiss={onDismiss} />)}</ul>}
      {!expanded && shown.length > listed.length && (
        <button type="button" onClick={onExpand} className="mt-2 text-[0.75rem] font-bold text-[#e8c46d] hover:underline">Show all {shown.length}</button>
      )}
    </div>
  );
}
