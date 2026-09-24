'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import LaneIcon, { type Lane } from './LaneIcon';

// A lane opened as a panel over the whole screen. The header row is padded to the icon's original screen position, so
// the icon does not move when the panel opens or closes, and nothing under the panel reflows. A very low icon is pulled
// up to 60% of the screen so the list keeps room. It is a portal because the lane card's hover transform would otherwise
// become the containing block of a fixed panel. Escape or the icon closes it.
export default function LanePanel({ lane, title, origin, onClose, action, children }: {
  lane: Lane;
  title: string;
  origin: { x: number; y: number };
  onClose: () => void;
  action?: ReactNode;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  // The latest onClose, so the key listener is added once rather than on every render of the page.
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; });
  useEffect(() => {
    panel.current?.querySelector<HTMLElement>('button')?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close.current(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return createPortal(
    <div ref={panel} role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-50 overflow-y-auto overscroll-contain bg-[#090e0c] pb-10">
      <div className="flex items-center gap-3 pr-6" style={{ paddingTop: `calc(min(${origin.y}px, 60vh) - 1px)`, paddingLeft: `max(1rem, min(${origin.x}px, calc(100vw - 18rem)))` }}>
        <LaneIcon lane={lane} expanded onToggle={onClose} />
        <h3 className="min-w-0 flex-1 truncate text-xl font-semibold tracking-[-0.04em]">{title}</h3>
        {action}
      </div>
      <div className="mx-auto max-w-[112rem] px-6">{children}</div>
    </div>,
    document.body,
  );
}
