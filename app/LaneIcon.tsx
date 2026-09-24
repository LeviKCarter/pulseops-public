'use client';

import type { MouseEvent, ReactNode } from 'react';

export type Lane = 'pulse' | 'events' | 'jobs' | 'food';

const GLYPHS: Record<Lane, { box: string; stroke: string; name: string; short?: string; paths: ReactNode }> = {
  events: {
    box: 'bg-[#84c4a1]',
    stroke: '#17231d',
    name: 'Events',
    paths: (
      <>
        <rect x="3" y="4.5" width="18" height="16" rx="3" />
        <path d="M3 9.5h18M8 2.5v4M16 2.5v4" />
        <path d="M8 14h2M14 14h2M8 17.5h2" />
      </>
    ),
  },
  jobs: {
    box: 'bg-[#8eabd2]',
    stroke: '#17231d',
    name: 'Science jobs',
    short: 'Jobs',
    paths: (
      <>
        <rect x="3" y="7.5" width="18" height="12.5" rx="3" />
        <path d="M9 7.5V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1.5M3 13h18" />
      </>
    ),
  },
  food: {
    box: 'bg-[#f7c972]',
    stroke: '#17231d',
    name: 'Deals',
    paths: (
      <>
        <path d="M7 3v7a2.5 2.5 0 0 0 5 0V3M9.5 3v18" />
        <path d="M17 21V3c-2.2 1.2-3.5 4-3.5 7.5 0 1.6.9 2.5 2 2.5h1.5" />
      </>
    ),
  },
  pulse: {
    box: 'bg-[#f472b6]/20',
    stroke: '#fbcfe8',
    name: 'Pulse',
    paths: <path d="M2.5 12.5h4l2.5-7 4 14 2.8-7.5h5.7" />,
  },
};

// A collapsed lane on phones: its icon and name as one button in the row above the open lane. `compact` is the icon
// alone, small enough for three to sit in the open lane's header beside its name.
export function LaneChip({ lane, onOpen, compact = false }: { lane: Lane; onOpen: () => void; compact?: boolean }) {
  const glyph = GLYPHS[lane];
  if (compact) {
    return (
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Open the ${glyph.name} lane`}
        title={glyph.name}
        className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg transition active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70 ${glyph.box}`}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke={glyph.stroke} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          {glyph.paths}
        </svg>
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Open the ${glyph.name} lane`}
      className="flex min-w-0 flex-1 flex-col items-center gap-1.5 rounded-2xl border border-white/[0.08] bg-white/[0.035] px-1 py-2.5 transition hover:bg-white/[0.07] focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/70"
    >
      <span className={`grid h-8 w-8 place-items-center rounded-lg ${glyph.box}`}>
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke={glyph.stroke} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          {glyph.paths}
        </svg>
      </span>
      <span className="max-w-full truncate text-[0.75rem] font-bold text-white/78">{glyph.short ?? glyph.name}</span>
    </button>
  );
}

// A per-lane icon that doubles as the expand/collapse control for its card.
// `onToggle` receives the button, for a lane that needs to know where the icon is on screen when it opens.
// `fixed` draws the plain icon with no control, for phones, where the open lane is always shown in full.
export default function LaneIcon({ lane, expanded, onToggle, fixed = false }: { lane: Lane; expanded: boolean; onToggle: (button: HTMLElement) => void; fixed?: boolean }) {
  const glyph = GLYPHS[lane];
  if (fixed) {
    return (
      <span aria-hidden="true" className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${glyph.box}`}>
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke={glyph.stroke} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          {glyph.paths}
        </svg>
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={(e) => onToggle(e.currentTarget)}
      aria-expanded={expanded}
      aria-label={`${expanded ? 'Collapse' : 'Expand'} the ${glyph.name} lane`}
      title={expanded ? 'Collapse lane' : 'Expand lane to see more'}
      className={`group relative grid h-9 w-9 shrink-0 place-items-center rounded-xl transition hover:scale-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70 ${glyph.box}`}
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke={glyph.stroke} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        {glyph.paths}
      </svg>
      <span aria-hidden="true" className="absolute -bottom-1 -right-1 grid h-[18px] w-[18px] place-items-center rounded-full border border-white/15 bg-[#0f1713] text-white/75">
        <svg viewBox="0 0 12 12" className={`h-2.5 w-2.5 transition-transform ${expanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2.5 4.5 6 8l3.5-3.5" />
        </svg>
      </span>
    </button>
  );
}

// A lane on the phone overview (no lane open): a panel with the lane's icon, name and headline number, then a widget
// body that fills whatever height the overview gives it. The header button is stretched over the whole panel, so a tap
// anywhere opens the lane (z-10, since the body's fade mask makes it a stacking context that would otherwise sit on
// top); the body is display-only and fades out at the bottom rather than cutting a row in half.
// `controls` are live inputs (filters) for the header's right end; they sit above the stretched button so they work.
// `bare` drops the icon, name and stat, giving a narrow panel's header to its controls; the stretched button stays.
// `grow` lets the body run to its full height instead of clipping and fading at the panel's edge (Pulse, while the
// morning brief under its weather is open). `liftBody` puts the body above the panel-wide open button, for a body
// with its own controls (that brief); the header still opens the lane. `onClickCapture` sees every tap in the panel
// first, so a grown panel can take any tap as "shrink back" instead.
export function LanePreview({ lane, stat, onOpen, className = '', aside, controls, bare = false, grow = false, liftBody = false, onClickCapture, children }: { lane: Lane; stat?: string; onOpen: () => void; className?: string; aside?: ReactNode; controls?: ReactNode; bare?: boolean; grow?: boolean; liftBody?: boolean; onClickCapture?: (e: MouseEvent<HTMLDivElement>) => void; children?: ReactNode }) {
  const glyph = GLYPHS[lane];
  return (
    <div onClickCapture={onClickCapture} className={`relative flex min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.035] px-3.5 pb-2 pt-3 transition has-[>div>button:active]:bg-white/[0.07] ${className}`}>
      <div className="flex min-w-0 items-center gap-2">
        <button
          type="button"
          onClick={onOpen}
          aria-label={`Open the ${glyph.name} lane`}
          className={`flex min-w-0 items-center gap-2.5 text-left ${bare ? 'shrink-0' : 'flex-1'} after:absolute after:inset-0 after:z-10 after:rounded-2xl focus-visible:outline-none focus-visible:after:outline focus-visible:after:outline-2 focus-visible:after:outline-white/70`}
        >
          {!bare && <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${glyph.box}`}>
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke={glyph.stroke} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              {glyph.paths}
            </svg>
          </span>}
          {!bare && <span className={aside ? 'shrink-0' : 'min-w-0 flex-1'}>
            <span className="block truncate text-[0.9375rem] font-bold leading-tight text-white/90">{glyph.short ?? glyph.name}</span>
            {stat && <span className="block truncate text-[0.72rem] font-semibold leading-tight text-white/62">{stat}</span>}
          </span>}
          {aside && <span className="min-w-0 flex-1">{aside}</span>}
          {!aside && !controls && <svg aria-hidden="true" viewBox="0 0 12 12" className="h-3 w-3 shrink-0 -rotate-90 text-white/50" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2.5 4.5 6 8l3.5-3.5" />
          </svg>}
        </button>
        {controls && <div className={`relative z-20 flex items-center gap-1.5 ${bare ? 'min-w-0 flex-1 flex-wrap' : 'shrink-0'}`}>{controls}</div>}
      </div>
      <div className={`mt-2.5 min-h-0 flex-1 ${liftBody ? 'relative z-20 ' : ''}${grow ? '' :'overflow-hidden [mask-image:linear-gradient(to_bottom,black_calc(100%-1.25rem),transparent)]'}`}>
        {children}
      </div>
    </div>
  );
}

// One line item inside a LanePreview body: an optional lead (a date, a price), a title and a quieter detail line.
// `wrapDetail` lets the detail run to two lines, for a narrow panel where one line cuts it off.
export function PreviewRow({ lead, title, detail, aside, wrapDetail = false }: { lead?: ReactNode; title: ReactNode; detail?: ReactNode; aside?: ReactNode; wrapDetail?: boolean }) {
  return (
    <li className="flex min-w-0 items-center gap-2.5 py-1.5">
      {lead}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[0.8125rem] font-semibold leading-5 text-white/88">{title}</span>
        {detail && <span className={`block text-[0.75rem] leading-4 text-white/60 ${wrapDetail ? 'line-clamp-2' : 'truncate'}`}>{detail}</span>}
      </span>
      {aside}
    </li>
  );
}
