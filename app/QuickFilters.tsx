'use client';

// Floating bar of one-tap chips at the top of the Events and Deals panels. It stays pinned while the list scrolls.
interface Props {
  label: string;
  freeOnly: boolean;
  onFreeOnly: (on: boolean) => void;
  radius: number | null;
  onRadius: (miles: number | null) => void;
  radii: ReadonlyArray<{ miles: number; label: string; hint: string }>;
  originLabel: string;
  // Only Deals is a true "from a point" radius — Events' bands name a place (Denver/Metro/Boulder) rather than
  // measuring outward from the viewer, so showing where that measurement starts from only makes sense for Deals.
  showOrigin: boolean;
  accent: string; // an rgb triplet such as '132 196 161'
  // Events only: narrow the list to High-urgency rows (free, limited spots, act soon).
  urgentOnly?: boolean;
  onUrgentOnly?: (on: boolean) => void;
}

export default function QuickFilters({ label, freeOnly, onFreeOnly, radius, onRadius, radii, originLabel, showOrigin, accent, urgentOnly = false, onUrgentOnly }: Props) {
  const chip = (on: boolean) =>
    `shrink-0 rounded-full border px-2 py-0.5 text-[0.75rem] font-bold transition-colors ${on ? 'text-white' : 'border-white/[0.14] text-white/78 hover:text-white'}`;
  const onStyle = (on: boolean) => (on ? { borderColor: `rgb(${accent} / 0.6)`, backgroundColor: `rgb(${accent} / 0.18)` } : undefined);
  // The chips scroll sideways on a narrow screen; where the distances are measured from gets its own line under them,
  // so a long neighborhood name is never squeezed out by the chips.
  return (
    <div className="sticky top-0 z-10 -mx-1 rounded-xl bg-[#0b120e]/95 px-1 py-1.5 shadow-[0_6px_14px_rgba(0,0,0,0.25)]">
      <div
        role="group"
        aria-label={label}
        className="no-scrollbar flex flex-nowrap items-center gap-1 overflow-x-auto"
      >
        {onUrgentOnly && (
          <button type="button" aria-pressed={urgentOnly} onClick={() => onUrgentOnly(!urgentOnly)} title="Only High urgency: free events with limited spots that need an RSVP or tickets soon" className={chip(urgentOnly)} style={onStyle(urgentOnly)}>
            Urgent
          </button>
        )}
        <button type="button" aria-pressed={freeOnly} onClick={() => onFreeOnly(!freeOnly)} className={chip(freeOnly)} style={onStyle(freeOnly)}>
          Free
        </button>
        <span aria-hidden="true" className="mx-0.5 h-4 w-px shrink-0 bg-white/[0.12]" />
        <span className="shrink-0 text-[0.75rem] font-bold text-white/62">{showOrigin ? 'Within' : 'Near'}</span>
        {radii.map(({ miles, label, hint }) => (
          <button
            key={miles}
            type="button"
            aria-pressed={radius === miles}
            onClick={() => onRadius(radius === miles ? null : miles)}
            title={radius === miles ? 'Clear the distance filter' : showOrigin ? `${hint} of ${originLabel}` : hint}
            className={chip(radius === miles)}
            style={onStyle(radius === miles)}
          >
            {label}
          </button>
        ))}
      </div>
      {showOrigin && <p className="mt-1 px-1 text-[0.75rem] leading-4 text-white/62" aria-live="polite">of {originLabel}</p>}
    </div>
  );
}
