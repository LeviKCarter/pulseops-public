const SITE_ORIGIN = "https://your-site.example.com";
const ALLOWED_KEYS = new Set([
  "record_type","id_or_key","status","engine","current_step","created_at",
  "started_at","finished_at","value","detail","snapshot_updated_at"
]);
function headers(extra = {}) {
  return {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": SITE_ORIGIN,
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "content-type",
    "x-content-type-options": "nosniff",
    ...extra,
  };
}
function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: headers() });
}
const worker = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: headers() });
    if (url.pathname === "/health" && request.method === "GET") return json({ ok: true, service: "levi-ops-live-feed" });
    if (url.pathname !== "/snapshot") return json({ error: "not_found" }, 404);
    if (request.method === "GET") {
      const raw = await env.SNAPSHOT.get("latest");
      if (!raw) return json({ error: "snapshot_unavailable" }, 503);
      return new Response(raw, { status: 200, headers: headers() });
    }
    if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
    const auth = request.headers.get("authorization") || "";
    if (!env.WRITE_TOKEN || auth !== `Bearer ${env.WRITE_TOKEN}`) return json({ error: "unauthorized" }, 401);
    const len = Number(request.headers.get("content-length") || "0");
    if (len > 262144) return json({ error: "payload_too_large" }, 413);
    let body;
    try { body = await request.json(); } catch { return json({ error: "invalid_json" }, 400); }
    if (!body || body.schema !== "levi-ops-live-v1" || !Array.isArray(body.rows) || body.rows.length > 200) return json({ error: "invalid_schema" }, 400);
    for (const row of body.rows) {
      if (!row || typeof row !== "object" || Array.isArray(row)) return json({ error: "invalid_row" }, 400);
      for (const key of Object.keys(row)) if (!ALLOWED_KEYS.has(key)) return json({ error: "forbidden_field", field: key }, 400);
    }
    const stored = JSON.stringify({ schema: "levi-ops-live-v1", snapshot_updated_at: body.snapshot_updated_at || null, rows: body.rows });
    if (stored.length > 262144) return json({ error: "payload_too_large" }, 413);
    await env.SNAPSHOT.put("latest", stored);
    return json({ ok: true, rows: body.rows.length, snapshot_updated_at: body.snapshot_updated_at || null });
  }
};

export default worker;
