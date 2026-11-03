function json(data) {
  return new Response(JSON.stringify(data), {
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}

export default function handler(request) {
  if (request.method !== 'GET') return json({ error: 'Méthode non autorisée.' }, 405)
  return json({ ok: true, geminiKeyConfigured: Boolean(process.env.GEMINI_API_KEY) })
}
