// Levi's fragrances and the call for what to wear. The starting collection is kept here; bottles added from the card, the
// ones marked run out, and the wear log live in a JSON file on this machine (app/api/scents). Entries whose scent is
// unknown (unlabeled Chanel vials, a Ferragamo EDT with no name, Kinetic GMT) stay out until they're identified, since a
// pick can't be explained without knowing how they smell; add them from the card once they are.

// Today's high, in bands: hot is 80°F and up, warm 65–79, mild 50–64, cold under 50.
export type Band = 'hot' | 'warm' | 'mild' | 'cold';
export type Slot = 'day' | 'night';

export interface Fragrance {
  name: string;
  bottle: 'full' | 'sample';
  // A few words on how it smells, shown as the reason for the pick.
  profile: string;
  bands: Band[];
  slots: Slot[];
  // Parfum and EDP concentrations project further, so they get one spray fewer.
  strong: boolean;
}

export const FRAGRANCES: Fragrance[] = [
  { name: 'Bleu de Chanel Parfum', bottle: 'full', profile: 'smooth sandalwood and cedar', bands: ['warm', 'mild', 'cold'], slots: ['day', 'night'], strong: true },
  { name: 'CK One', bottle: 'full', profile: 'light citrus and tea', bands: ['hot', 'warm'], slots: ['day'], strong: false },
  { name: 'Avon Black Suede Touch', bottle: 'full', profile: 'soft leather and spice', bands: ['mild', 'cold'], slots: ['day', 'night'], strong: false },
  { name: 'Azzaro Wanted by Night', bottle: 'sample', profile: 'cinnamon, tobacco and red cedar', bands: ['cold'], slots: ['night'], strong: true },
  { name: 'Burberry Brit Rhythm', bottle: 'sample', profile: 'leather and incense', bands: ['mild', 'cold'], slots: ['night'], strong: false },
  { name: 'Burberry Hero', bottle: 'sample', profile: 'cedar and juniper', bands: ['warm', 'mild'], slots: ['day', 'night'], strong: true },
  { name: 'Calvin Klein Defy', bottle: 'sample', profile: 'lavender and vetiver', bands: ['hot', 'warm'], slots: ['day'], strong: false },
  { name: 'Pasha de Cartier', bottle: 'sample', profile: 'clean lavender and mint', bands: ['warm', 'mild'], slots: ['day'], strong: false },
  { name: "L'Eau d'Issey Pour Homme", bottle: 'sample', profile: 'bright yuzu and water', bands: ['hot'], slots: ['day'], strong: false },
  { name: 'Jimmy Choo Man Aqua', bottle: 'sample', profile: 'cool aquatic citrus', bands: ['hot', 'warm'], slots: ['day'], strong: false },
  { name: 'Missoni Parfum Pour Homme', bottle: 'sample', profile: 'citrus over soft woods', bands: ['hot', 'warm'], slots: ['day'], strong: false },
  { name: "Ralph's Club Parfum", bottle: 'sample', profile: 'lavender and dark vetiver', bands: ['mild', 'cold'], slots: ['night'], strong: true },
  { name: 'Versace Dylan Blue', bottle: 'sample', profile: 'fresh bergamot and ambroxan', bands: ['hot', 'warm', 'mild'], slots: ['day', 'night'], strong: false },
  { name: 'Versace Eros Parfum', bottle: 'sample', profile: 'mint and vanilla', bands: ['mild', 'cold'], slots: ['night'], strong: true },
];

// A bottle added from the card takes its fit from one tap on its family, since no model is on hand to profile it.
export type Family = 'fresh' | 'woody' | 'warm';
export const FAMILIES: Record<Family, { label: string; profile: string; bands: Band[]; slots: Slot[] }> = {
  fresh: { label: 'Fresh', profile: 'fresh and light', bands: ['hot', 'warm'], slots: ['day'] },
  woody: { label: 'Woody', profile: 'clean woods', bands: ['warm', 'mild', 'cold'], slots: ['day', 'night'] },
  warm: { label: 'Warm & sweet', profile: 'warm and sweet', bands: ['mild', 'cold'], slots: ['night'] },
};
export const fromFamily = (name: string, family: Family, bottle: Fragrance['bottle'], strong: boolean, profile?: string): Fragrance => ({
  name, bottle, strong, profile: profile?.trim() || FAMILIES[family].profile, bands: FAMILIES[family].bands, slots: FAMILIES[family].slots,
});
// Concentrations that project further, told from the name alone.
export const isStrongName = (name: string) => /\b(edp|elixir|intense|extrait|absolu|profumo)\b|eau de parfum|\bparfum\b(?! pour)/i.test(name);

// What the card keeps on this machine: bottles added, names run out, and the day each was last worn.
export interface ScentShelf { added: Fragrance[]; out: string[]; worn: Record<string, string> }
export const EMPTY_SHELF: ScentShelf = { added: [], out: [], worn: {} };
export const inStock = (shelf: ScentShelf): Fragrance[] => {
  const added = new Set(shelf.added.map((f) => f.name.toLowerCase()));
  return [...FRAGRANCES.filter((f) => !added.has(f.name.toLowerCase())), ...shelf.added].filter((f) => !shelf.out.includes(f.name));
};

export function bandOf(highF: number): Band {
  if (highF >= 80) return 'hot';
  if (highF >= 65) return 'warm';
  if (highF >= 50) return 'mild';
  return 'cold';
}

// Heat carries scent, so fewer sprays when it's hot; Denver's dry air keeps the counts modest otherwise.
export function spraysFor(f: Fragrance, band: Band): number {
  const base = band === 'hot' ? 2 : band === 'cold' ? 4 : 3;
  return Math.max(1, base - (f.strong ? 1 : 0));
}

// A small stable hash, so a day's pick holds all day but moves on tomorrow.
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  // FNV alone barely moves the high bits for a change at the start (the date), so finish with murmur3's mix.
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

// What fits the band and slot, least recently worn first; never-worn ones lead. Among equals, a date-seeded shuffle
// breaks the tie. `skip` moves past picks turned down with Swap. A band with nothing for the slot widens to any band.
export function pick(bottles: Fragrance[], band: Band, slot: Slot, date: string, worn: Record<string, string>, skip: number): Fragrance | null {
  let pool = bottles.filter((f) => f.bands.includes(band) && f.slots.includes(slot));
  if (pool.length === 0) pool = bottles.filter((f) => f.slots.includes(slot));
  if (pool.length === 0) return null;
  const ranked = [...pool].sort((a, b) => (worn[a.name] ?? '').localeCompare(worn[b.name] ?? '') || hash(date + slot + a.name) - hash(date + slot + b.name));
  // Never offer something worn today again unless everything was.
  const fresh = ranked.filter((f) => worn[f.name] !== date);
  const list = fresh.length ? fresh : ranked;
  return list[skip % list.length];
}
