// Every food-deal card gets the same top-right tag: what it costs after Denver sales tax.
// The tag is the total: tax and any stated fee are already in it, so it carries no "w/ tax" label.
// The sheet's price column is free text ("$6.00 + tax/upcharges", "$0 for the smoothie with a purchase",
// "50% of regular price + tax"), so this reads the first dollar amount and applies tax and any stated fee.

// Denver city 4.81% + state 2.9% + RTD 1.0% + Cultural Facilities 0.1%. Update here if the rate changes.
export const DENVER_TAX_RATE = 0.0881;

// `amount` is the all-in dollar figure the tag shows (per item when `each`), so the list can sort on it.
// `amount` is the all-in dollar figure the tag shows (per item when `each`), so the list can sort on it.
export interface PriceTag { text: string; tone: 'price' | 'free' | 'other'; title: string; amount?: number; each?: boolean }

const money = (n: number) => `$${n.toFixed(2)}`;

export function priceTag(price: string | undefined, deal: string | undefined): PriceTag {
  const p = (price ?? '').trim();
  const d = (deal ?? '').trim();
  const title = p || d;

  if (/\bfree\b/i.test(p) || /^\$0(?:\.00)?(?!\d)/.test(p)) {
    return { text: /purchase|\bwith\b|w\//i.test(p) ? 'Free w/ purchase' : 'Free', tone: 'free', title };
  }

  // The price column first; fall back to the deal text ("... for $6") only when the column has no amount.
  const fromPrice = p.match(/\$(\d+(?:\.\d+)?)/);
  const fromDeal = fromPrice ? null : d.match(/(?<!first\s)\$(\d+(?:\.\d+)?)/i);
  const found = fromPrice ?? fromDeal;
  if (found) {
    const base = parseFloat(found[1]);
    const source = fromPrice ? p : d;
    const taxIncluded = /(?:tax(?:es)?\s+included|incl(?:uding|\.)?\s+tax|all[- ]in)/i.test(source);
    const fee = source.match(/(\d+(?:\.\d+)?)%\s*(?:[a-z-]+\s+)?(?:service\s+(?:fee|charge)|gratuity|fee|charge)/i);
    const feeRate = fee ? parseFloat(fee[1]) / 100 : 0;
    const total = base * (1 + (taxIncluded ? 0 : DENVER_TAX_RATE) + feeRate);
    const each = fromPrice && /\bper\b|\beach\b/i.test(p) ? ' ea' : '';
    const detail = `${money(base)}${taxIncluded ? '' : ` + ${(DENVER_TAX_RATE * 100).toFixed(2)}% Denver tax`}${feeRate ? ` + ${fee![1]}% fee` : ''}`;
    return { text: `${money(total)}${each}`, tone: 'price', title: `${p || d}\n= ${detail}`, amount: total, each: !!each };
  }

  const both = `${p} ${d}`;
  if (/\bBOGO\b|buy one|equal-or-lower/i.test(both)) return { text: 'BOGO', tone: 'other', title };
  const pct = both.match(/(\d{1,2})%\s*(?:off|of)\b/i);
  if (pct) return { text: `${pct[1]}% off`, tone: 'other', title };
  return { text: 'Price varies', tone: 'other', title };
}

// Just the food out of a deal's free-text description, for places with room for a few words: "Weekday happy hour: Patio
// Burger a la carte for $10; smashed double patty, ..." reads "Patio Burger". A lead-in before a colon is dropped when it
// names the promotion ("Daily happy hour", "7REWARDS members"), but kept when it is the item itself ("Limited-time $6
// Big Box: choice of ..."). Then the first clause is cut before any price, terms, or list of extras.
const PROMO_LABEL = /hour|special|offer|member|fest|deal|promo|sips|night|daily|weekly|reward|menu|week/i;
export function dealItem(deal: string | undefined): string {
  const text = (deal ?? '').trim();
  const colon = text.indexOf(': ');
  let item = text;
  if (colon > 0 && colon < 45) {
    const lead = text.slice(0, colon);
    item = !PROMO_LABEL.test(lead) && /\$\d/.test(lead) ? lead.replace(/\blimited[- ]time\b/i, '').replace(/\$\d+(?:\.\d{2})?\+?/g, '') : text.slice(colon + 2);
  }
  // A clause that is only the hours ("every day 4–5 p.m.; Pork Al Pastor Taco $1, ...") gives way to the next one.
  const clauses = item.split(/;\s*/);
  item = clauses.find((c) => !/^(?:every|daily|weekdays?|mon|tue|wed|thu|fri|sat|sun|\d{1,2}(?::\d{2})?\s*[–-])/i.test(c)) ?? clauses[0];
  item = item.split(/;|\s\(|,|\s+with\s|\s+for\s|\s+after\s|\s+the day after\b|\s+\+\s*tax|\s+a la carte\b/i)[0];
  // A combo that is still long keeps its first part: "SONIC Cheeseburger + Medium Tots or Fries + ..." reads "SONIC Cheeseburger".
  if (item.length > 40) item = item.split(/\s+(?:\+|or)\s+/)[0];
  item = item
    .replace(/^(?:(?:free|get|enjoy|happy hour|daily|weekday|all|select|\$\d+(?:\.\d{2})?\+?|\d{1,2}% off|half[- ]price)\s+)+/i, '')
    .replace(/^(?:one|an?)\s+/i, '')
    .replace(/\b(?:qualifying|regular|massive|substantial)\s+/gi, '')
    .replace(/(?:\s+(?:\$\d+(?:\.\d{2})?\+?|each|special))+\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!item || item.length > 60) return text;
  return item[0].toUpperCase() + item.slice(1);
}

export const foodKey = (restaurant: string, deal: string) =>
  `${restaurant}|${deal}`.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 200);

// Google Maps search for the restaurant. The sheet's Location is a street address when the deal is tied to one
// store; for chain promos it says "participating locations", so the search falls back to the name and city.
export function mapsUrl(restaurant: string, location: string | undefined): string {
  const loc = (location ?? '').replace(/\([^)]*\)/g, '').trim();
  const name = restaurant.replace(/\s*\([^)]*\)/g, '').trim();
  // A chain promo can carry an example store's address, in the location or inside the name's parentheses.
  const street = (text: string) => text.match(/\b\d{2,5}\s+(?:[NSEW]\.?\s+)?[A-Za-z0-9.']+(?:\s+[A-Za-z0-9.']+){0,3}/)?.[0] ?? '';
  const address = /^\d/.test(loc) ? loc : street(loc) || street(restaurant.match(/\(([^)]*)/)?.[1] ?? '');
  const query = [name, address || 'Denver, CO'].join(' ');
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

export type ValueTier = 'great' | 'good' | 'meh';
export interface DealValue { tier: ValueTier; label: string; score: number; reasons: string[] }

// The lower end of the first "NN% off / below" in the text ("~39%-61% below" reads as 39: the safe end of a range).
function percentOff(text: string): number | null {
  const m = text.match(/(\d{1,3}(?:\.\d+)?)%(?:\s*[-–]\s*\d{1,3}(?:\.\d+)?%)?\s*(?:off|below|cheaper|less|discount|savings)/i);
  return m ? Math.min(100, parseFloat(m[1])) : null;
}

// Is this a good deal, or a normal price with a happy-hour label? The discount against the regular price counts
// most, because a bundle's dollar total says little about portion size. The all-in price adds or subtracts a
// little. The sheet marks nearly everything "exceptional", so its wording is ignored; what it does say is when
// there is no regular price to compare against, and without a comparison a deal can rate Good at best.
export function dealValue(item: { price?: string; deal?: string; discount?: string }): DealValue {
  const tag = priceTag(item.price, item.deal);
  const discount = item.discount ?? '';
  const both = `${item.price ?? ''} ${item.deal ?? ''}`;
  const reasons: string[] = [];
  let score = 0;

  const bogo = /\bBOGO\b|buy one|2-for-1|two-for-one|half[- ]price/i.test(both);
  const pct = percentOff(discount) ?? percentOff(item.deal ?? '') ?? (bogo ? 50 : null);
  const noBaseline = /(?:baseline|regular[- ]price|percentage|discount)[^.;]{0,50}(?:not (?:established|published|used|needed|stated|available)|unknown)|no (?:apples-to-apples|regular)/i.test(discount);

  if (tag.tone === 'free') {
    score = 6;
    reasons.push(tag.text === 'Free w/ purchase' ? 'Free item with a purchase' : 'Free item');
  } else {
    if (pct !== null) {
      score += pct >= 60 ? 5 : pct >= 50 ? 4 : pct >= 40 ? 3 : pct >= 30 ? 2 : pct >= 20 ? 1 : pct < 15 ? -1 : 0;
      reasons.push(`${Math.round(pct)}% below the regular price`);
    } else if (noBaseline) {
      reasons.push('No regular price to compare against');
    }
    if (tag.amount !== undefined) {
      const a = tag.amount;
      score += tag.each && a <= 3.5 ? 3 : a <= 6.5 ? 2 : a <= 9.5 ? 1 : a <= 12 ? 0 : -1;
      reasons.push(`${money(a)}${tag.each ? ' each' : ''} after tax`);
    }
  }
  if (/\b(?:new (?:app )?(?:user|member)s?|first[- ](?:time|order)|new-member|signup)/i.test(both + discount)) {
    score -= 1;
    reasons.push('New customers only');
  }
  if (pct === null && tag.tone !== 'free' && score > 3) score = 3;

  const tier: ValueTier = score >= 5 ? 'great' : score >= 3 ? 'good' : 'meh';
  return { tier, score, label: tier === 'great' ? 'Great' : tier === 'good' ? 'Good' : 'Meh', reasons };
}
