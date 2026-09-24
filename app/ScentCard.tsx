'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { usePersisted, write as writePersisted } from './useCollapsed';
import { useNow } from './useNow';
import { EMPTY_SHELF, FAMILIES, bandOf, fromFamily, inStock, isStrongName, pick, spraysFor, type Band, type Family, type Fragrance, type ScentShelf, type Slot } from './fragrances';

// One call for what to wear, from today's high and the time of day, with the spray count. "Wore it" logs the day so
// the rotation moves on, "Swap" offers the next fit, "Ran out" drops the bottle from the picks. The + opens a small form
// to add a new bottle by typing or speaking its name, or from a photo of it (the phone's picker includes Google Photos);
// models on this PC (/api/scents/identify) then suggest the name, how it smells and its family, for Levi to confirm.
// State is saved through /api/scents so the phone and PC agree; where that route is unreachable (the Cloudflare copy)
// the wear log stays in this browser and the shelf can't be edited.
const LOCAL_KEY = 'leviops.scentWorn';
const parseWorn = (raw: string): Record<string, string> => {
  try { return JSON.parse(raw || '{}') as Record<string, string>; } catch { return {}; }
};

function denverParts(ms: number) {
  const now = new Date(ms);
  const date = now.toLocaleDateString('en-CA', { timeZone: 'America/Denver' });
  const hour = Number(now.toLocaleString('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: 'America/Denver' }));
  return { date, hour };
}

type Change = { action: 'wear'; name: string; date: string } | { action: 'unwear' | 'out' | 'restock'; name: string } | { action: 'add'; fragrance: Fragrance };

// Applied here right away and again by the server, so a tap never waits on the network.
function applyChange(s: ScentShelf, c: Change): ScentShelf {
  if (c.action === 'wear') return { ...s, worn: { ...s.worn, [c.name]: c.date } };
  if (c.action === 'unwear') { const worn = { ...s.worn }; delete worn[c.name]; return { ...s, worn }; }
  if (c.action === 'out') return { ...s, out: [...s.out.filter((o) => o !== c.name), c.name] };
  if (c.action !== 'add') return { ...s, out: s.out.filter((o) => o !== c.name) };
  const lower = c.fragrance.name.toLowerCase();
  return { ...s, added: [...s.added.filter((f) => f.name.toLowerCase() !== lower), c.fragrance], out: s.out.filter((o) => o.toLowerCase() !== lower) };
}

// The browser's speech-to-text, where it has one (Chrome on Android and desktop). Typed loosely: it isn't in the DOM lib.
type Recognizer = { lang: string; interimResults: boolean; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onend: (() => void) | null; start: () => void; stop: () => void };
const speechApi = (): (new () => Recognizer) | null => {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: new () => Recognizer; webkitSpeechRecognition?: new () => Recognizer };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

// Phone photos run to several MB; the label reads fine at 1280px, which keeps the upload and the model quick.
async function shrink(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL('image/jpeg', 0.85);
}

type Suggestion = { name: string; known: boolean; profile: string; family: Family | null; strong: boolean };
type Draft = { name: string; family: Family | null; sample: boolean; strong: boolean; profile: string };
const EMPTY_DRAFT: Draft = { name: '', family: null, sample: false, strong: false, profile: '' };

const BAND_WORD: Record<Band, string> = { hot: 'hot', warm: 'warm', mild: 'mild', cold: 'cold' };
const pill = 'rounded-full px-3 py-1 text-xs font-bold transition';
const quiet = `${pill} border border-white/[0.12] text-white/72 hover:text-white`;

export default function ScentCard({ highF }: { highF: number | null }) {
  // Time and saved state are browser-only, so the card fills in after mount rather than disagreeing with the server render.
  const nowMs = useNow();
  const now = useMemo(() => (nowMs === null ? null : denverParts(nowMs)), [nowMs]);
  // The server's shelf once /api/scents answers; until then (or where it never does) an empty shelf with this browser's
  // wear log, the only thing that can change without the server.
  const [serverShelf, setServerShelf] = useState<ScentShelf | null>(null);
  const synced = serverShelf !== null;
  const localWornRaw = usePersisted(LOCAL_KEY, '{}');
  const shelf = useMemo(() => serverShelf ?? { ...EMPTY_SHELF, worn: parseWorn(localWornRaw) }, [serverShelf, localWornRaw]);
  const [error, setError] = useState('');
  const [skip, setSkip] = useState<Record<Slot, number>>({ day: 0, night: 0 });
  const [justOut, setJustOut] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  // What the models are doing for the add form, and a note on what they found.
  const [looking, setLooking] = useState('');
  const [hint, setHint] = useState('');
  const photoInput = useRef<HTMLInputElement>(null);
  const [listening, setListening] = useState(false);
  const recognizer = useRef<Recognizer | null>(null);

  useEffect(() => {
    fetch('/api/scents', { cache: 'no-store' })
      .then((r) => r.json() as Promise<{ ok?: boolean; shelf?: ScentShelf }>)
      .then((r) => { if (r.ok && r.shelf) setServerShelf(r.shelf); })
      .catch(() => undefined);
    return () => recognizer.current?.stop();
  }, []);
  if (!now || highF === null) return null;

  const change = (c: Change) => {
    setError('');
    if (!synced) { writePersisted(LOCAL_KEY, JSON.stringify(applyChange(shelf, c).worn)); return; }
    setServerShelf((s) => s && applyChange(s, c));
    fetch('/api/scents', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(c) })
      .then((r) => r.json() as Promise<{ ok?: boolean; shelf?: ScentShelf; error?: string }>)
      .then((r) => { if (r.ok && r.shelf) setServerShelf(r.shelf); else setError(r.error || 'Could not save.'); })
      .catch(() => setError('Could not save.'));
  };

  const listen = () => {
    const Api = speechApi();
    if (!Api) return;
    if (listening) { recognizer.current?.stop(); return; }
    const r = new Api();
    r.lang = 'en-US';
    r.interimResults = false;
    r.onresult = (e) => {
      const said = e.results[0]?.[0]?.transcript?.trim().replace(/\.$/, '');
      if (said) { setDraft((d) => ({ ...d, name: said })); void identify({ name: said }); }
    };
    r.onend = () => setListening(false);
    recognizer.current = r;
    setListening(true);
    r.start();
  };

  // Fills the form from a photo or a name; anything already chosen by hand is kept.
  const identify = async (payload: { image: string } | { name: string }) => {
    setLooking('image' in payload ? 'Reading the label…' : 'Looking it up…');
    setHint('');
    try {
      const resp = await fetch('/api/scents/identify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const r = await resp.json() as { ok?: boolean; found?: boolean; read?: string; suggestion?: Suggestion; error?: string };
      if (!r.ok) { setHint(r.error || 'Could not look it up.'); return; }
      if (!r.found || !r.suggestion) { setHint('No bottle found in that photo. Try a closer shot of the label, or type the name.'); return; }
      const sug = r.suggestion;
      setDraft((d) => ({ ...d, name: sug.name || d.name, family: d.family ?? sug.family, profile: d.profile || sug.profile, strong: d.strong || sug.strong }));
      setHint([r.read ? `Read "${r.read}" from the photo.` : '', sug.known ? 'Check the details, then Add.' : "Not a scent the model knows well, so check how it smells and its family."].filter(Boolean).join(' '));
    } catch {
      setHint('Could not look it up.');
    } finally {
      setLooking('');
    }
  };
  const onPhoto = async (file: File | undefined) => {
    if (!file) return;
    try { await identify({ image: await shrink(file) }); } catch { setHint('Could not open that photo.'); setLooking(''); }
  };

  const add = () => {
    if (!draft.name.trim() || !draft.family) return;
    change({ action: 'add', fragrance: fromFamily(draft.name.trim(), draft.family, draft.sample ? 'sample' : 'full', draft.strong, draft.profile) });
    setDraft(EMPTY_DRAFT);
    setHint('');
    setAdding(false);
  };

  const bottles = inStock(shelf);
  const band = bandOf(highF);
  // From 4 PM the evening pick leads; before then the day pick leads and tonight's shows under it when it differs.
  const slot: Slot = now.hour >= 16 ? 'night' : 'day';
  const main = pick(bottles, band, slot, now.date, shelf.worn, skip[slot]);
  const later = slot === 'day' ? pick(bottles, band, 'night', now.date, shelf.worn, skip.night) : null;
  const woreToday = Object.entries(shelf.worn).find(([, d]) => d === now.date)?.[0];
  const swap = (s: Slot) => setSkip((k) => ({ ...k, [s]: k[s] + 1 }));

  return (
    <section data-own-click aria-label="Scent of the day" className="mt-5 rounded-2xl border border-[#c4a3f0]/15 bg-[#15121d] p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[0.75rem] font-extrabold uppercase tracking-[0.1em] text-[#c4a3f0]">
          {slot === 'night' ? 'Wear tonight' : 'Wear today'}
          <span className="font-bold normal-case tracking-normal text-white/55"> · high {Math.round(highF)}°</span>
        </p>
        {synced && (
          <button type="button" onClick={() => setAdding((a) => !a)} aria-expanded={adding} aria-label={adding ? 'Close adding a bottle' : 'Add a bottle'} className="-mr-1 -mt-1 grid h-7 w-7 shrink-0 place-items-center rounded-full border border-white/[0.12] text-white/72 transition hover:text-white">
            <svg aria-hidden="true" viewBox="0 0 12 12" className={`h-3 w-3 transition-transform ${adding ? 'rotate-45' : ''}`} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M6 2v8M2 6h8" /></svg>
          </button>
        )}
      </div>

      {woreToday ? (
        <p className="mt-1.5 text-[0.9375rem] leading-6 text-white/90">
          Wearing <span className="font-bold">{woreToday}</span> today.
          <button type="button" onClick={() => change({ action: 'unwear', name: woreToday })} className="ml-2 text-xs font-bold text-white/55 underline-offset-2 hover:text-white hover:underline">Undo</button>
        </p>
      ) : main ? (
        <>
          <p className="mt-1.5 text-[0.9375rem] leading-6 text-white/90">
            <span className="font-bold">{main.name}</span>, {spraysFor(main, band)} sprays
          </p>
          <p className="mt-0.5 text-xs leading-5 text-white/72">
            {main.profile[0].toUpperCase() + main.profile.slice(1)} suits a {BAND_WORD[band]} {slot === 'night' ? 'evening' : 'day'}.
            {main.bottle === 'sample' ? ' A sample: see if it earns a full bottle.' : ''}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={() => change({ action: 'wear', name: main.name, date: now.date })} className={`${pill} bg-[#c4a3f0]/18 text-[#dcc6ff] hover:bg-[#c4a3f0]/28`}>Wore it</button>
            <button type="button" onClick={() => swap(slot)} className={quiet}>Swap</button>
            {synced && <button type="button" onClick={() => { change({ action: 'out', name: main.name }); setJustOut(main.name); }} className={quiet}>Ran out</button>}
          </div>
        </>
      ) : (
        <p className="mt-1.5 text-xs leading-5 text-white/72">Nothing left in stock. Add a bottle with +.</p>
      )}

      {justOut && shelf.out.includes(justOut) && (
        <p className="mt-2 text-xs leading-5 text-white/55">
          Out of {justOut}.
          <button type="button" onClick={() => { change({ action: 'restock', name: justOut }); setJustOut(null); }} className="ml-2 font-bold underline-offset-2 hover:text-white hover:underline">Undo</button>
        </p>
      )}

      {later && later.name !== main?.name && !woreToday && (
        <p className="mt-3 border-t border-white/[0.06] pt-3 text-xs leading-5 text-white/72">
          Going out tonight? Switch to <span className="font-bold text-white/90">{later.name}</span>, {spraysFor(later, band)} sprays.
          <button type="button" onClick={() => swap('night')} className="ml-2 font-bold text-white/55 underline-offset-2 hover:text-white hover:underline">Swap</button>
        </p>
      )}

      {adding && (
        <form onSubmit={(e) => { e.preventDefault(); add(); }} className="mt-3 space-y-2.5 border-t border-white/[0.06] pt-3">
          <div className="flex gap-2">
            <input
              value={draft.name}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value, strong: d.strong || isStrongName(e.target.value) }))}
              // A typed name is looked up once the field is left, unless the family is already picked by hand.
              onBlur={() => { if (draft.name.trim() && !draft.family && !looking) void identify({ name: draft.name.trim() }); }}
              placeholder={listening ? 'Listening…' : looking || 'New bottle, e.g. Dior Sauvage'}
              aria-label="Name of the new bottle"
              maxLength={120}
              className="min-w-0 flex-1 rounded-lg border border-white/[0.12] bg-black/20 px-3 py-1.5 text-sm text-white placeholder:text-white/40 focus:border-[#c4a3f0]/50 focus:outline-none"
            />
            {speechApi() && (
              <button type="button" onClick={listen} aria-label={listening ? 'Stop listening' : 'Say the name'} aria-pressed={listening} className={`grid h-8 w-8 shrink-0 place-items-center rounded-full border transition ${listening ? 'border-[#c4a3f0] bg-[#c4a3f0]/25 text-[#dcc6ff]' : 'border-white/[0.12] text-white/72 hover:text-white'}`}>
                <svg aria-hidden="true" viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><rect x="5.5" y="1.5" width="5" height="8" rx="2.5" /><path d="M3 7.5a5 5 0 0 0 10 0M8 12.5v2" /></svg>
              </button>
            )}
            {/* No capture attribute, so a phone offers both the camera and its photo picker (Google Photos included). */}
            <input ref={photoInput} type="file" accept="image/*" hidden onChange={(e) => { void onPhoto(e.target.files?.[0]); e.target.value = ''; }} />
            <button type="button" onClick={() => photoInput.current?.click()} disabled={!!looking} aria-label="Add from a photo" className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-white/[0.12] text-white/72 transition hover:text-white disabled:opacity-40">
              <svg aria-hidden="true" viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"><path d="M2 5.5A1.5 1.5 0 0 1 3.5 4h1.8l1.2-1.5h3l1.2 1.5h1.8A1.5 1.5 0 0 1 14 5.5v6a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5z" /><circle cx="8" cy="8.5" r="2.3" /></svg>
            </button>
          </div>
          {looking && <p className="text-xs text-[#c4a3f0]" aria-live="polite">{looking}</p>}
          {hint && !looking && <p className="text-xs leading-5 text-white/62" aria-live="polite">{hint}</p>}
          {draft.name.trim() && (
            <input
              value={draft.profile}
              onChange={(e) => setDraft((d) => ({ ...d, profile: e.target.value }))}
              placeholder="Smells like, e.g. smooth sandalwood and cedar"
              aria-label="How it smells"
              maxLength={80}
              className="w-full rounded-lg border border-white/[0.12] bg-black/20 px-3 py-1.5 text-xs text-white placeholder:text-white/40 focus:border-[#c4a3f0]/50 focus:outline-none"
            />
          )}
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Family">
            {(Object.keys(FAMILIES) as Family[]).map((f) => (
              <button key={f} type="button" role="radio" aria-checked={draft.family === f} onClick={() => setDraft((d) => ({ ...d, family: f }))} className={draft.family === f ? `${pill} bg-[#c4a3f0]/25 text-[#dcc6ff]` : quiet}>{FAMILIES[f].label}</button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-white/72">
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={draft.sample} onChange={(e) => setDraft((d) => ({ ...d, sample: e.target.checked }))} className="accent-[#c4a3f0]" />Sample</label>
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={draft.strong} onChange={(e) => setDraft((d) => ({ ...d, strong: e.target.checked }))} className="accent-[#c4a3f0]" />Parfum / EDP</label>
            <button type="submit" disabled={!draft.name.trim() || !draft.family} className={`${pill} ml-auto bg-[#c4a3f0]/18 text-[#dcc6ff] hover:bg-[#c4a3f0]/28 disabled:opacity-40`}>Add</button>
          </div>
          {shelf.out.length > 0 && (
            <p className="text-xs leading-6 text-white/55">
              Restock:{' '}
              {shelf.out.map((name) => (
                <button key={name} type="button" onClick={() => change({ action: 'restock', name })} className="mr-2 font-bold text-white/72 underline-offset-2 hover:text-white hover:underline">{name}</button>
              ))}
            </p>
          )}
        </form>
      )}

      {error && <p className="mt-2 text-xs text-[#f2a3a3]">{error}</p>}
    </section>
  );
}
