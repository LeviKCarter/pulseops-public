'use client';

import { useState } from 'react';
import { CollapseButton, useCollapsed } from './useCollapsed';

export interface RssItem {
  id: string;
  title: string;
  url: string;
  category: string;
  source?: string;
  sourceUrl?: string;
  feedName?: string;
  // The item's discussion thread (RSS <comments>), e.g. the Hacker News page for a story that links elsewhere.
  commentsUrl?: string;
  publishedAt: string;
  summary?: string;
}

// Feed text is data, so only http(s) links are ever rendered as hrefs.
const safeUrl = (url: string | null | undefined) => (url && /^https?:\/\//i.test(url) ? url : null);

function whenLabel(iso: string): string {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return '';
  const opts = { timeZone: 'America/Denver' } as const;
  const day = t.toLocaleDateString('en-CA', opts);
  const today = new Date().toLocaleDateString('en-CA', opts);
  const time = t.toLocaleTimeString('en-US', { ...opts, hour: 'numeric', minute: '2-digit' });
  return day === today ? time : `${t.toLocaleDateString('en-US', { ...opts, month: 'short', day: 'numeric' })}, ${time}`;
}

function chipClass(category: string): string {
  const c = category.toLowerCase();
  if (/local|denver/.test(c)) return 'bg-[#f472b6]/20 text-[#fbcfe8]';
  if (/weather|hazard/.test(c)) return 'bg-[#3b3018] text-[#f0cb6d]';
  if (/food|deal/.test(c)) return 'bg-[#3b3018] text-[#e8c46d]';
  if (/outdoor|colorado/.test(c)) return 'bg-[#163426] text-[#8de0ad]';
  if (/science|earth/.test(c)) return 'bg-[#1c2a3d] text-[#8db8ee]';
  if (/ai|tech|program|open source/.test(c)) return 'bg-[#2b2340] text-[#c9b6f2]';
  return 'bg-white/[0.07] text-white/70';
}

// The feed's categories are fine-grained, so the filter tabs fold them into a few broad groups, always in this order.
// Each row keeps its own category on its chip. A category not listed here gets a tab of its own after these.
const TAB_GROUPS: Array<[string, RegExp]> = [
  ['Local', /local|denver|colorado|outdoor|weather|hazard|food|deal/i],
  ['Tech', /tech|\bai\b|model|program|open source/i],
  ['Science', /science|earth/i],
  ['Entertainment', /entertain|gaming|game|movie|tv|music/i],
];
const tabOf = (category: string) => TAB_GROUPS.find(([, re]) => re.test(category))?.[0] ?? category;

// `standalone` is its own panel (the phone overview) rather than a section under Pulse's other blocks.
// `below` is the expanded desktop Pulse lane's copy, full width under the brief: it grows with the page instead of
// taking its height from a column beside it.
export default function RssFeed({ items, standalone = false, below = false }: { items: RssItem[]; standalone?: boolean; below?: boolean }) {
  const [filter, setFilter] = useState('All');
  const [collapsed, toggleCollapsed] = useCollapsed('leviops.collapsed.rss');
  const counts = new Map<string, number>();
  for (const item of items) counts.set(tabOf(item.category), (counts.get(tabOf(item.category)) ?? 0) + 1);
  const order = (name: string) => { const i = TAB_GROUPS.findIndex(([group]) => group === name); return i < 0 ? TAB_GROUPS.length : i; };
  const categories = ['All', ...[...counts.keys()].sort((a, b) => order(a) - order(b) || (counts.get(b) ?? 0) - (counts.get(a) ?? 0))];
  const active = categories.includes(filter) ? filter : 'All';
  const shown = active === 'All' ? items : items.filter((item) => tabOf(item.category) === active);

  return (
    // Side by side (xl) the panel takes its height from the column beside it, absolutely positioned so the list never stretches the row, and scrolls inside that height.
    <div className={`relative min-w-0 ${standalone ? '' : below ? 'mt-6 border-t border-white/[0.07]' : 'mt-5 border-t border-white/[0.07] xl:min-h-[28rem]'}`}>
      <div className={`${standalone ? '' : 'pt-4 '}${below ? '' : 'xl:absolute xl:inset-0 xl:flex xl:flex-col'}`}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-[0.75rem] font-extrabold uppercase tracking-[0.1em] text-[#f472b6]">From your RSS feed</p>
        <span className="ml-auto text-[0.75rem] text-white/62">{shown.length} of {items.length} from the last 48 hours</span>
        <CollapseButton collapsed={collapsed} onToggle={toggleCollapsed} label="the RSS feed" />
      </div>
      <div className={`${collapsed ? 'max-md:hidden' : ''} xl:flex xl:min-h-0 xl:flex-1 xl:flex-col`}>
      <div role="tablist" aria-label="RSS categories" className="mt-2 flex flex-wrap gap-1.5">
        {categories.map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            aria-selected={active === name}
            onClick={() => setFilter(name)}
            className={`rounded-full border px-2.5 py-1 text-[0.75rem] font-bold transition-colors ${active === name ? 'border-[#f472b6]/40 bg-[#f472b6]/15 text-[#fbcfe8]' : 'border-white/[0.08] text-white/62 hover:text-white/85'}`}
          >
            {name} <span className="font-semibold opacity-70">{name === 'All' ? items.length : counts.get(name)}</span>
          </button>
        ))}
      </div>
      {/* Phones scroll the feed with the page; wider screens cap it and scroll it on its own. */}
      <ul className={`mt-3 grid content-start gap-x-8 grid-cols-[repeat(auto-fill,minmax(min(20rem,100%),1fr))] ${below ? '' : 'md:max-h-[40rem] md:overflow-y-auto md:pr-1 xl:min-h-0 xl:max-h-none xl:flex-1'}`}>
        {shown.map((item) => {
          const href = safeUrl(item.url);
          const sourceHref = safeUrl(item.sourceUrl);
          const commentsHref = safeUrl(item.commentsUrl);
          return (
            <li key={item.id} className="border-b border-white/[0.08] py-3.5 first:pt-1">
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span title={tabOf(item.category) !== item.category ? `Filed under ${tabOf(item.category)}` : undefined} className={`shrink-0 rounded px-1.5 py-0.5 text-[0.75rem] font-bold uppercase tracking-[0.04em] ${chipClass(item.category)}`}>{item.category}</span>
                  {item.source && (sourceHref
                    ? <a href={sourceHref} target="_blank" rel="noopener noreferrer" title={item.feedName && item.feedName !== item.source ? `${item.feedName} · open ${item.source}` : `Open ${item.source}`} className="truncate text-[0.8rem] text-white/70 hover:text-white/90 hover:underline focus-visible:underline">{item.source}</a>
                    : <span className="truncate text-[0.8rem] text-white/70">{item.source}</span>)}
                  {commentsHref && <a href={commentsHref} target="_blank" rel="noopener noreferrer" className="shrink-0 text-[0.8rem] font-semibold text-[#8db8ee] hover:underline focus-visible:underline">Comments</a>}
                </div>
                <span className="shrink-0 text-[0.8rem] tabular-nums text-white/75">{whenLabel(item.publishedAt)}</span>
              </div>
              <h4 className="mt-2 text-base font-semibold leading-[1.4] text-white/95">
                {href ? <a href={href} target="_blank" rel="noopener noreferrer" className="hover:underline focus-visible:underline">{item.title}</a> : item.title}
              </h4>
              {item.summary && item.summary.length > 30 && <p className="mt-1.5 line-clamp-3 text-sm leading-[1.55] text-white/80">{item.summary}</p>}
            </li>
          );
        })}
      </ul>
      </div>
      </div>
    </div>
  );
}
