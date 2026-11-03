import { GoogleGenAI } from '@google/genai'

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

    const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY, apiVersion: 'v1beta' })
    const token = await client.authTokens.create({
      config: {
        uses: 1,
        expireTime: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        newSessionExpireTime: new Date(Date.now() + 60 * 1000),
        liveConnectConstraints: {
          model: MODEL,
          config: {
            responseModalities: ['AUDIO'],
            systemInstruction: { parts: [{ text: TEACHER_INSTRUCTIONS }] },
            inputAudioTranscription: {},
            outputAudioTranscription: {},
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Aoede' } } },
          },
        },
      },
    })

    if (!token?.name) return json({ error: 'Gemini n’a pas fourni de jeton. Réessayez dans un instant.' }, 502)
    return json({ token: token.name, expiresIn: 30 * 60 })
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
