'use client';

import { useEffect, useSyncExternalStore } from 'react';

import type { Lane } from './LaneIcon';

// Values live in localStorage, with an in-memory copy for when storage is blocked. The server render uses the fallback.
const memory = new Map<string, string>();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const read = (key: string, fallback: string) => {
  if (memory.has(key)) return memory.get(key)!;
  try { return window.localStorage.getItem(key) ?? fallback; } catch { return fallback; }
};
export const write = (key: string, value: string) => {
  memory.set(key, value);
  try { window.localStorage.setItem(key, value); } catch { /* keep the in-memory value */ }
  listeners.forEach((listener) => listener());
};
export const usePersisted = (key: string, fallback: string) => useSyncExternalStore(subscribe, () => read(key, fallback), () => fallback);

// A collapsed/open flag remembered per browser, for the phone-only section toggles.
export function useCollapsed(key: string): [boolean, () => void] {
  const collapsed = usePersisted(key, '0') === '1';
  return [collapsed, () => write(key, read(key, '0') === '1' ? '0' : '1')];
}

// On phones one lane is open at a time and the rest sit as buttons in a row above it. With none open, all four are
// stacked as previews; that overview is where a phone starts.
const LANES: Lane[] = ['pulse', 'events', 'jobs', 'food'];
const PHONE_LANE_KEY = 'leviops.phoneLane';
const asLane = (value: unknown): Lane | null => LANES.find((lane) => lane === value) ?? null;
// An open lane is also a browser history entry, so the phone's back button closes the lane instead of leaving the app.
// Opening pushes an entry, switching lanes replaces it, and closing from the page goes back through it; the popstate
// listener below then records the lane the restored entry names (none, for the overview).
// Module-level, so the setter keeps one identity across renders and is safe in an effect's dependencies.
const setPhoneLane = (lane: Lane | null) => {
  const wasOpen = asLane(read(PHONE_LANE_KEY, 'none')) !== null;
  const inHistory = asLane((window.history.state as { leviopsLane?: unknown } | null)?.leviopsLane) !== null;
  if (lane && !wasOpen) window.history.pushState({ leviopsLane: lane }, '');
  else if (lane && inHistory) window.history.replaceState({ leviopsLane: lane }, '');
  else if (!lane && inHistory) { window.history.back(); return; }
  write(PHONE_LANE_KEY, lane ?? 'none');
};
let historyWired = false;
function wireLaneHistory() {
  if (historyWired) return;
  historyWired = true;
  window.addEventListener('popstate', (e) => {
    write(PHONE_LANE_KEY, asLane((e.state as { leviopsLane?: unknown } | null)?.leviopsLane) ?? 'none');
  });
  // A lane still open from the last visit gets its entry too, so back closes it rather than the app.
  const open = asLane(read(PHONE_LANE_KEY, 'none'));
  if (open && !asLane((window.history.state as { leviopsLane?: unknown } | null)?.leviopsLane)) window.history.pushState({ leviopsLane: open }, '');
}
export function usePhoneLane(): [Lane | null, (lane: Lane | null) => void] {
  const open = asLane(usePersisted(PHONE_LANE_KEY, 'none'));
  useEffect(wireLaneHistory, []);
  return [open, setPhoneLane];
}

// True below the md breakpoint, where the open lane always shows in full. The server render assumes a wide screen.
const PHONE = '(max-width: 767px)';
const subscribePhone = (listener: () => void) => {
  const query = window.matchMedia(PHONE);
  query.addEventListener('change', listener);
  return () => query.removeEventListener('change', listener);
};
export function useIsPhone() {
  return useSyncExternalStore(subscribePhone, () => window.matchMedia(PHONE).matches, () => false);
}

// The chevron button that drives it; shown below the md breakpoint only, since collapsing is a phone affordance.
export function CollapseButton({ collapsed, onToggle, label }: { collapsed: boolean; onToggle: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={!collapsed}
      aria-label={`${collapsed ? 'Show' : 'Hide'} ${label}`}
      className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-white/[0.1] text-white/72 transition hover:text-white md:hidden"
    >
      <svg aria-hidden="true" viewBox="0 0 12 12" className={`h-3 w-3 transition-transform ${collapsed ? '' : 'rotate-180'}`} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2.5 4.5 6 8l3.5-3.5" />
      </svg>
    </button>
  );
}
