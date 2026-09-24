'use client';

import { useState } from 'react';
import type { DomoreExtra } from './domore';

export interface DomoreStatus {
  nextDrop: string | null;
  extras?: DomoreExtra[];
  error: string | null;
}

const ACCENT = '#ff8a5c';
const APP = 'https://go.domorestuff.com/';

const dropDay = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { timeZone: 'America/Denver', weekday: 'short', month: 'short', day: 'numeric' });

// The Events lane's DoMORE strip: when the next ticket drop lands, and a dropdown of the "Bonus & Last Minute"
// extras open right now, each linking straight to its claim screen in the DoMORE app.
export default function DomoreBar({ status }: { status: DomoreStatus }) {
  const [open, setOpen] = useState(false);
  const extras = status.extras ?? [];
  const claimable = extras.filter((e) => e.claimable).length;

  if (status.error) {
    return (
      <a href={APP} target="_blank" rel="noopener noreferrer" className="mt-2 flex items-center gap-2 rounded-lg border border-[#f08b8b]/35 bg-[#f08b8b]/[0.06] px-2.5 py-1.5 text-[0.8125rem] font-semibold hover:border-[#f08b8b]/60">
        <span className="font-bold" style={{ color: ACCENT }}>DoMORE</span>
        <span className="text-[#f08b8b]">{status.error}</span>
      </a>
    );
  }

  return (
    <div className="mt-2 rounded-lg border bg-[#ff8a5c]/[0.08]" style={{ borderColor: `color-mix(in srgb, ${ACCENT} ${open ? 55 : 30}%, transparent)` }}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[0.8125rem] font-semibold text-white/80"
      >
        <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: ACCENT }} />
        <span className="font-bold" style={{ color: ACCENT }}>DoMORE</span>
        {status.nextDrop && <span className="truncate">Next drop {dropDay(status.nextDrop)}</span>}
        <span className={`ml-auto shrink-0 rounded-full px-1.5 py-0.5 text-[0.72rem] font-bold ${claimable ? 'bg-[#ff8a5c]/20 text-[#ffb08f]' : 'bg-white/[0.06] text-white/62'}`}>
          {extras.length === 0 ? 'No extras' : `${extras.length} extra${extras.length === 1 ? '' : 's'}`}
        </span>
        <svg aria-hidden="true" viewBox="0 0 12 12" className={`h-2.5 w-2.5 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M2.5 4.5 6 8l3.5-3.5" /></svg>
      </button>
      {open && (
        <div className="border-t border-white/[0.07] px-2.5 pb-2 pt-1">
          <p className="mt-1 text-[0.72rem] font-extrabold uppercase tracking-[0.1em] text-white/62">Bonus &amp; last minute · outside your drop</p>
          {extras.length === 0 ? (
            <p className="mt-1.5 text-[0.8125rem] text-white/72">No extras available right now.</p>
          ) : (
            <ul className="mt-1">
              {extras.map((e) => (
                <li key={e.url + e.title} className="border-b border-white/[0.05] py-1.5 last:border-b-0">
                  <a href={e.url} target="_blank" rel="noopener noreferrer" className={`group flex items-start gap-2 ${e.claimable ? '' : 'opacity-60'}`}>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[0.72rem] font-bold uppercase tracking-[0.06em]" style={{ color: e.kind === 'bonus' ? '#f0cb6d' : ACCENT }}>
                        {e.kind === 'bonus' ? 'Bonus ticket' : 'Last-minute spot'}
                        {e.left !== null && <span className="ml-1.5 normal-case tracking-normal text-white/62">{e.left} left</span>}
                      </span>
                      <span className="block text-[0.875rem] font-bold leading-snug text-white group-hover:underline">{e.title}</span>
                      <span className="block truncate text-[0.8125rem] text-white/72">{[e.when, e.venue].filter(Boolean).join(' · ')}</span>
                    </span>
                    <span className="mt-3 shrink-0 rounded-md border px-2 py-0.5 text-[0.75rem] font-bold" style={{ borderColor: `color-mix(in srgb, ${ACCENT} 45%, transparent)`, color: ACCENT }}>
                      {e.claimable ? 'Claim ↗' : 'Cooldown'}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          )}
          <a href={APP} target="_blank" rel="noopener noreferrer" className="mt-1.5 inline-block text-[0.75rem] font-bold text-[#8db8ee] hover:underline">Open DoMORE ↗</a>
        </div>
      )}
    </div>
  );
}
