const MODEL = 'gemini-3.1-flash-live-preview'
const TEACHER_INSTRUCTIONS = `Tu es Camille, une professeure de français de France, chaleureuse et professionnelle. L'apprenant a un niveau B1/B2. Parle principalement en français naturel de France, clairement et à un rythme modéré. Encourage-le à parler, pose des questions de suivi et privilégie une conversation vivante. Ne corrige pas chaque petite erreur. Corrige avec tact les erreurs importantes, explique brièvement en français simple, puis invite-le parfois à reformuler. Utilise le darija uniquement si l'apprenant le demande explicitement. Garde tes réponses orales concises et naturelles.`

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}

export default async function handler(request) {
  if (request.method !== 'POST') return json({ error: 'Méthode non autorisée.' }, 405)
  if (!process.env.GEMINI_API_KEY) {
    return json({ error: 'La clé Gemini manque sur le serveur Vercel. Ajoutez GEMINI_API_KEY dans les variables du projet puis redéployez.' }, 503)
  }

  try {
    const body = await request.json()
    if (!body || Array.isArray(body) || Object.keys(body).length !== 0) {
      return json({ error: 'Requête invalide. Rechargez la page et réessayez.' }, 400)
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15000)
    let response
    let result
    try {
      response = await fetch('https://generativelanguage.googleapis.com/v1beta/auth_tokens', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': process.env.GEMINI_API_KEY,
        },
        signal: controller.signal,
        body: JSON.stringify({
          uses: 1,
          expireTime: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
          newSessionExpireTime: new Date(Date.now() + 60 * 1000).toISOString(),
          bidiGenerateContentSetup: {
            model: `models/${MODEL}`,
            generationConfig: {
              responseModalities: ['AUDIO'],
              speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Aoede' } } },
            },
            systemInstruction: { parts: [{ text: TEACHER_INSTRUCTIONS }] },
            inputAudioTranscription: {},
            outputAudioTranscription: {},
          },
        }),
      })
      result = await response.json()
    } catch (error) {
      if (error?.name === 'AbortError') {
        return json({ error: 'Google Gemini n’a pas répondu dans les 15 secondes. Vérifiez la disponibilité de l’API Gemini, puis réessayez.' }, 504)
      }
      return json({ error: 'La fonction Vercel n’a pas pu joindre Google Gemini. Vérifiez les journaux de fonction.' }, 502)
    } finally {
      clearTimeout(timeout)
    }

    if (!response.ok) {
      const providerMessage = result?.error?.message || ''
      if (response.status === 401 || response.status === 403 || /API key not valid|invalid api key/i.test(providerMessage)) {
        return json({ error: 'Google Gemini refuse la clé configurée sur Vercel. Vérifiez GEMINI_API_KEY.' }, 503)
      }
      if (response.status === 429) {
        return json({ error: 'Le quota Gemini est atteint. Vérifiez les limites de votre compte.' }, 429)
      }
      return json({ error: `Google Gemini a refusé la création du jeton (HTTP ${response.status}). Vérifiez l’accès Live et la configuration du modèle.` }, 502)
    }
    if (!result?.name) return json({ error: 'Gemini n’a pas fourni de jeton. Vérifiez les journaux de fonction.' }, 502)
    return json({ token: result.name, expiresIn: 30 * 60 })
  } catch (error) {
    const message = String(error?.message || '')
    if (/API_KEY_INVALID|invalid api key|API key not valid/i.test(message)) {
      return json({ error: 'La clé Gemini configurée sur Vercel semble invalide.' }, 503)
    }
    if (/quota|resource exhausted|429/i.test(message)) {
      return json({ error: 'Le quota Gemini est atteint. Vérifiez les limites de votre compte puis réessayez.' }, 429)
    }
    return json({ error: 'Vercel a bien reçu la demande, mais Gemini n’a pas pu préparer la connexion. Vérifiez la clé API et les journaux de fonctions.' }, 502)
  }
}
