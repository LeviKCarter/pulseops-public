'use client';

import { useSyncExternalStore } from 'react';

// The current time for render, as a clock that ticks once a minute, so components read "now" without calling Date.now()
// during render. The server render (and hydration) has no trustworthy now and gets null; the client catches up right after.
const TICK_MS = 60_000;
const listeners = new Set<() => void>();
let now: number | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  if (!timer) timer = setInterval(() => { now = Date.now(); listeners.forEach((l) => l()); }, TICK_MS);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) { clearInterval(timer); timer = null; now = null; }
  };
};
const getSnapshot = () => { if (now === null) now = Date.now(); return now; };

export function useNow(): number | null {
  return useSyncExternalStore(subscribe, getSnapshot, () => null);
}
