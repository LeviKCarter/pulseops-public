'use client';

import { useState } from 'react';

// "N dismissed · Review" under a lane's list: expands to the rows the user dismissed, each with a Restore button.
// The lane owns the data and the restore call; this only draws it.
export interface DismissedRow { key: string; title: string; detail: string }

const ACCENT = {
  green: { link: 'text-[#76d69e]', hover: 'hover:border-[#84c4a1]/40 hover:text-[#76d69e]' },
  gold: { link: 'text-[#e8c46d]', hover: 'hover:border-[#e8c46d]/40 hover:text-[#e8c46d]' },
} as const;

export default function DismissedList({ label, rows, restoringKey, onRestore, accent }: {
  label: string;
  rows: DismissedRow[];
  restoringKey: string;
  onRestore: (key: string) => void;
  accent: keyof typeof ACCENT;
}) {
  const [open, setOpen] = useState(false);
  if (rows.length === 0) return null;
  const c = ACCENT[accent];
  return (
    <div className="mt-4 text-[0.8125rem] leading-4 text-white/62">
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className={`font-bold hover:underline ${c.link}`}>
        {rows.length} dismissed · {open ? 'Hide' : 'Review'}
      </button>
      {open && (
        <ul aria-label={`Dismissed ${label}`} className="mt-2 divide-y divide-white/[0.06] rounded-xl bg-white/[0.03] px-3">
          {rows.map((row) => (
            <li key={row.key} className="flex items-center gap-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate font-bold text-white/85" title={row.title}>{row.title}</p>
                <p className="truncate text-[0.75rem] text-white/62" title={row.detail}>{row.detail}</p>
              </div>
              <button
                type="button"
                disabled={restoringKey === row.key}
                onClick={() => onRestore(row.key)}
                aria-label={`Restore ${row.title}`}
                className={`shrink-0 rounded-md border border-white/[0.1] px-2 py-1 text-[0.75rem] font-bold text-white/72 disabled:opacity-50 ${c.hover}`}
              >
                {restoringKey === row.key ? 'Restoring…' : 'Restore'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
