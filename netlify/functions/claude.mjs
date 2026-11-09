// PARLEE — ligação segura ao Claude. A chave fica nas variáveis de ambiente da Netlify.
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
const env = (k) => (globalThis.Netlify && Netlify.env.get(k)) || process.env[k] || "";

export default async (req) => {
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const codes = env("PARLEE_CODES").split(",").map((s) => s.trim()).filter(Boolean);
  const code = (req.headers.get("x-parlee-code") || "").trim();
  if (!codes.length || !codes.includes(code)) return json({ error: "invalid_code" }, 401);

  let body;
  try { body = await req.json(); } catch { return json({ error: "bad_request" }, 400); }
  if (body.mode === "ping") return json({ ok: true });

  const key = env("ANTHROPIC_API_KEY");
  if (!key) return json({ error: "not_configured" }, 500);

  let payload;
  if (body.mode === "chat") {
    const msgs = Array.isArray(body.messages) ? body.messages : [];
    if (!msgs.length || msgs.length > 120) return json({ error: "bad_request" }, 400);
    for (const m of msgs) {
      if (!["user", "assistant"].includes(m.role) || typeof m.content !== "string" || m.content.length > 15000)
        return json({ error: "bad_request" }, 400);
    }
    payload = { model: env("PARLEE_MODEL_CLIENTE") || "claude-sonnet-5-5", max_tokens: 800, messages: msgs };
  } else if (body.mode === "json") {
    if (typeof body.prompt !== "string" || body.prompt.length > 120000) return json({ error: "bad_request" }, 400);
    payload = {
      model: env("PARLEE_MODEL_AVALIACAO") || "claude-sonnet-5-5",
      max_tokens: 4000,
      system: "Responde apenas com JSON válido, sem texto antes ou depois e sem blocos de código.",
      messages: [{ role: "user", content: body.prompt }],
    };
  } else return json({ error: "bad_request" }, 400);

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (r.status === 429) return json({ error: "rate_limited" }, 429);
  if (!r.ok) return json({ error: "upstream", status: r.status }, 502);
  const data = await r.json();
  const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
  if (body.mode === "json") {
    try {
      return json({ data: JSON.parse(text.replace(/```json|```/g, "").trim()) });
    } catch { return json({ error: "bad_json" }, 502); }
  }
  return json({ text });
};

export const config = { path: "/api/claude" };
