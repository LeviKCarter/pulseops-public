// Suggests a new bottle's details for the scent card's add form, from a photo of it or from its name, using models
// that run on this PC through Ollama (no API keys or credits): a vision model reads the label, then a text model gives
// the proper name, a few words on how it smells and its family. An 8B model's fragrance knowledge is shaky (it will
// invent notes for a scent it doesn't know), so this only fills the form; Levi confirms or edits before adding.
// Local server only, like the other scent route.
import { refuseUnlessLocal, reply } from '../../../dismissApi';
import { isStrongName, type Family } from '../../../fragrances';

export const dynamic = 'force-dynamic';

const OLLAMA = process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434';
const VISION_MODEL = process.env.SCENT_VISION_MODEL ?? 'qwen3-vl:8b';
const TEXT_MODEL = process.env.SCENT_TEXT_MODEL ?? 'qwen3:8b';
// The page shrinks photos to about 1280px before sending, so a few MB of base64 is plenty.
const MAX_IMAGE = 8_000_000;
const FAMILIES: Family[] = ['fresh', 'woody', 'warm'];
// Longest first, so "eau de parfum" wins over "parfum"; "parfum pour homme" is part of a name, not a concentration.
const CONCENTRATION = /\b(eau de parfum|eau de toilette|eau de cologne|elixir|intense|extrait|absolu|profumo|edp|edt|parfum(?! pour))\b/i;

async function chat(model: string, messages: Record<string, unknown>[], format: Record<string, unknown>): Promise<Record<string, unknown>> {
  const resp = await fetch(`${OLLAMA}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // The first call after a while loads the model into the GPU, which can take most of a minute.
    signal: AbortSignal.timeout(150_000),
    body: JSON.stringify({ model, messages, format, stream: false, think: false, options: { temperature: 0.1 } }),
  });
  if (!resp.ok) throw new Error(`Ollama ${model}: HTTP ${resp.status}`);
  const data = await resp.json() as { message?: { content?: string; thinking?: string } };
  // qwen3-vl puts its whole answer in `thinking` and leaves `content` empty, even with thinking off.
  return JSON.parse(data.message?.content || data.message?.thinking || '{}') as Record<string, unknown>;
}

async function readLabel(image: string): Promise<string | null> {
  const out = await chat(VISION_MODEL, [{
    role: 'user',
    content: 'This photo should show a fragrance bottle or box. Read the brand and the fragrance name printed on it, plus the concentration if shown (Eau de Toilette, Eau de Parfum, Parfum, Elixir, Intense). Reply with found=false if no fragrance is visible.',
    images: [image],
  }], {
    type: 'object',
    properties: { found: { type: 'boolean' }, brand: { type: 'string' }, name: { type: 'string' }, concentration: { type: 'string' } },
    required: ['found', 'brand', 'name', 'concentration'],
  });
  if (out.found !== true) return null;
  const [brand, name, concentration] = [out.brand, out.name, out.concentration].map((p) => (typeof p === 'string' ? p.trim() : ''));
  // Labels often repeat the brand in the name (Bleu de Chanel), so the brand leads only when it isn't already there.
  const parts = [name.toLowerCase().includes(brand.toLowerCase()) ? '' : brand, name, concentration].filter(Boolean);
  return parts.length ? parts.join(' ') : null;
}

async function describe(name: string) {
  const out = await chat(TEXT_MODEL, [
    { role: 'system', content: "You are a fragrance expert. Answer only from what you actually know; if you don't recognize the fragrance, set known=false." },
    { role: 'user', content: `Fragrance, as spoken or read from a label: "${name}".\nReturn: name = brand and name in proper title case, plus concentration if stated (e.g. 'Dior Sauvage Elixir'); known; notes = its 3-5 main notes; profile = 3-5 lowercase words on how it smells, built from those notes (e.g. 'smooth sandalwood and cedar'); family: fresh (citrus, aquatic, green, light), woody (woods, aromatic, lavender, versatile) or warm (sweet, spicy, amber, vanilla, tobacco).` },
  ], {
    type: 'object',
    properties: { name: { type: 'string' }, known: { type: 'boolean' }, notes: { type: 'array', items: { type: 'string' } }, profile: { type: 'string' }, family: { type: 'string', enum: FAMILIES } },
    required: ['name', 'known', 'notes', 'profile', 'family'],
  });
  let proper = typeof out.name === 'string' && out.name.trim() ? out.name.trim().slice(0, 120) : name;
  // The model sometimes drops the concentration ("versace eros parfum" came back as "Versace Eros"), which names a
  // different fragrance, so one that was said or read on the label is put back.
  const said = CONCENTRATION.exec(name)?.[1];
  if (said && !proper.toLowerCase().includes(said.toLowerCase())) proper = `${proper} ${said.replace(/\b\w/g, (c) => c.toUpperCase())}`;
  return {
    name: proper,
    known: out.known === true,
    profile: typeof out.profile === 'string' ? out.profile.trim().toLowerCase().slice(0, 80) : '',
    family: FAMILIES.includes(out.family as Family) ? out.family as Family : null,
    strong: isStrongName(proper),
  };
}

export async function POST(request: Request): Promise<Response> {
  const refused = refuseUnlessLocal(request);
  if (refused) return refused;
  let body: { image?: unknown; name?: unknown };
  try { body = await request.json(); } catch { return reply(400, { ok: false, error: 'Expected JSON.' }); }
  const image = typeof body.image === 'string' && body.image.length > 0 && body.image.length <= MAX_IMAGE ? body.image.replace(/^data:[^,]*,/, '') : null;
  const typed = typeof body.name === 'string' ? body.name.trim().slice(0, 120) : '';
  if (!image && !typed) return reply(400, { ok: false, error: 'Send a photo or a name.' });
  try {
    const name = image ? await readLabel(image) : typed;
    if (!name) return reply(200, { ok: true, found: false });
    return reply(200, { ok: true, found: true, read: image ? name : undefined, suggestion: await describe(name) });
  } catch {
    return reply(502, { ok: false, error: 'The models on this PC could not be reached. Is Ollama running?' });
  }
}
