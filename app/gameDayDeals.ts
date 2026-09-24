'use client';

import { useEffect, useState } from 'react';

// Which food deals apply right now. Two kinds of context decide it:
// - The schedule the sheet states ("Recurring Tuesdays, 4–10 p.m.", "through Sep. 27"), which
//   scripts/food_groups.py reads into `when`: a deal shows only on its weekdays, between its dates, and while one of
//   its hour windows for the day is running (a 3–6 p.m. happy hour shows from 3 to 6, not before or after).
// - Deals that only run the day after a qualifying Rockies game. Each rule spots its deal by its wording and says
//   whether yesterday's result (from /api/rockies) qualifies. Until that result is known, or if it cannot be
//   fetched, these deals stay hidden: they apply on a minority of days, so hiding is the likelier right answer.
export interface RockiesYesterday { sevenPlusRuns: boolean; stoleBase: boolean }

// days: 0 = Monday; left out when the deal runs every day. hours: weekday -> [start, end] windows in minutes of the
// day, end null when it runs to close; a weekday left out runs all day.
export interface DealSchedule { days?: number[]; hours?: Record<string, Array<[number, number | null]>>; from?: string; until?: string }

// The clock in Denver, where every deal is: the date (YYYY-MM-DD), weekday (0 = Monday) and minute of the day.
export interface DenverNow { date: string; weekday: number; minute: number }

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function denverNow(at: Date = new Date()): DenverNow {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Denver', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23',
  }).formatToParts(at).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, weekday: WEEKDAYS.indexOf(parts.weekday), minute: (Number(parts.hour) % 24) * 60 + Number(parts.minute) };
}

export function inSchedule(when: DealSchedule | undefined, now: DenverNow): boolean {
  if (!when) return true;
  if (when.from && now.date < when.from) return false;
  if (when.until && now.date > when.until) return false;
  if (when.days && !when.days.includes(now.weekday)) return false;
  const windows = when.hours?.[String(now.weekday)];
  return !windows || windows.some(([start, end]) => now.minute >= start && (end === null || now.minute < end));
}

const RULES: Array<{ matches: RegExp; live: (r: RockiesYesterday, now: DenverNow) => boolean }> = [
  // Taco Bell: 4 Crunchy Tacos for $3, 4–6 p.m. the day after the Rockies score 7+ runs, shown only in that window.
  { matches: /rockies[^.]*\b7\+?\s*run/i, live: (r, now) => r.sevenPlusRuns && now.minute >= 16 * 60 && now.minute < 18 * 60 },
  // Jet's Pizza: a free slice the day after the Rockies steal a base.
  { matches: /rockies[^.]*steal/i, live: (r) => r.stoleBase },
];

export function isDealLive(item: { deal?: string; price?: string; when?: DealSchedule }, rockies: RockiesYesterday | null, now: DenverNow): boolean {
  if (!inSchedule(item.when, now)) return false;
  const text = `${item.deal ?? ''} ${item.price ?? ''}`;
  const rule = RULES.find((r) => r.matches.test(text));
  return !rule || (rockies !== null && rule.live(rockies, now));
}

// The Denver clock, moved on each minute boundary and when the page is looked at again, so a deal drops off when
// its window closes (or the day turns over) without waiting for the next snapshot.
export function useDenverNow(): DenverNow {
  const [now, setNow] = useState<DenverNow>(() => denverNow());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      setNow((prev) => { const next = denverNow(); return next.date === prev.date && next.minute === prev.minute ? prev : next; });
      clearTimeout(timer);
      timer = setTimeout(tick, 60_000 - (Date.now() % 60_000) + 50);
    };
    const onVisible = () => { if (document.visibilityState === 'visible') tick(); };
    tick();
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearTimeout(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, []);
  return now;
}

// Yesterday's Rockies result, refreshed when the page is looked at again (the server caches it for 10 minutes).
export function useRockiesYesterday(): RockiesYesterday | null {
  const [result, setResult] = useState<RockiesYesterday | null>(null);
  useEffect(() => {
    let active = true;
    const load = () => {
      fetch('/api/rockies', { cache: 'no-store' })
        .then((resp) => resp.json() as Promise<{ ok?: boolean; sevenPlusRuns?: boolean; stoleBase?: boolean }>)
        .then((body) => {
          if (active && body.ok) setResult({ sevenPlusRuns: body.sevenPlusRuns === true, stoleBase: body.stoleBase === true });
        })
        .catch(() => { /* unreachable: the game-day deals stay hidden */ });
    };
    const onVisible = () => { if (document.visibilityState === 'visible') load(); };
    load();
    document.addEventListener('visibilitychange', onVisible);
    return () => { active = false; document.removeEventListener('visibilitychange', onVisible); };
  }, []);
  return result;
}
