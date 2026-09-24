'use client';

import type { GearItem } from './queueSnapshot';

const safeUrl = (url: string | null | undefined) => (url && /^https?:\/\//i.test(url) ? url : null);

type Stock = 'in' | 'out' | 'unknown';

// The gear watch writes the stock text itself: "IN STOCK: Refurbished", "SOLD OUT (all variants)", "OUT OF STOCK", or "UNVERIFIED (...)".
function stockOf(text: string): Stock {
  const t = text.toUpperCase();
  if (/SOLD OUT|OUT OF STOCK|OUT-OF-STOCK/.test(t)) return 'out';
  if (/IN[ -]STOCK/.test(t)) return 'in';
  return 'unknown';
}

const STOCK_STYLE: Record<Stock, string> = {
  in: 'bg-[#4d9a6d]/18 text-[#7fd1a0]',
  out: 'bg-white/8 text-white/62',
  unknown: 'bg-[#f7c972]/12 text-[#e8c46d]',
};

function checkedLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/Denver' });
}

export default function GearWatch({ items }: { items: GearItem[] }) {
  if (items.length === 0) return null;
  const products = [...new Set(items.map((i) => i.product))];
  return (
    // Its own labeled section under the food deals, so a watched product never reads as one of the specials.
    <section aria-label="Watching" className="lane-wide mt-5 border-t border-white/[0.07] pt-4">
      <p className="mb-2 text-[0.75rem] font-extrabold uppercase tracking-[0.1em] text-[#e8c46d]">Watching</p>
      {products.map((product) => {
        const sellers = items.filter((i) => i.product === product);
        const checked = sellers.map((s) => s.checkedAt).sort().pop() ?? '';
        return (
          <section key={product} aria-label={`${product} price watch`} className="first:mt-0 mt-3">
            <div className="flex items-start justify-between gap-3">
              <h4 className="text-sm font-bold leading-snug">{product}</h4>
              {checked && <span className="shrink-0 text-[0.75rem] leading-5 text-white/62">Checked {checkedLabel(checked)}</span>}
            </div>
            <ul className="mt-1 divide-y divide-white/[0.06]">
              {sellers.map((s) => {
                const stock = stockOf(s.stock);
                const href = safeUrl(s.url);
                return (
                  <li key={s.seller} className="py-2 last:pb-0" title={s.notes || undefined}>
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-xs font-bold leading-5">{href ? <a href={href} target="_blank" rel="noreferrer" className="underline-offset-2 hover:text-[#e8c46d] hover:underline">{s.seller}</a> : s.seller}</span>
                      <span className="flex shrink-0 items-center gap-1.5">
                        {s.alert && <span className="rounded bg-[#e8c46d]/18 px-1.5 py-0.5 text-[0.75rem] font-bold text-[#e8c46d]">Under target</span>}
                        <span className={`rounded px-1.5 py-0.5 text-[0.75rem] font-bold ${STOCK_STYLE[stock]}`}>{s.stock}</span>
                      </span>
                    </div>
                    <p className="mt-0.5 text-[0.75rem] leading-4 text-white/72">{s.price}</p>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </section>
  );
}
