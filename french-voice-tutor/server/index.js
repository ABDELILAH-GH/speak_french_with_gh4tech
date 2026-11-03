require('dotenv').config({ path: require('path').join(__dirname, '.env') })

const express = require('express')
const cors = require('cors')
const { GoogleGenAI } = require('@google/genai')

const app = express()
const port = Number(process.env.PORT) || 3001
const model = 'gemini-3.1-flash-live-preview'
const allowedOrigins = new Set([
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  process.env.APP_ORIGIN,
].filter(Boolean))

app.disable('x-powered-by')
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin)) return callback(null, true)
    return callback(new Error('Origin not allowed'))
  },
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type'],
}))
app.use(express.json({ limit: '2kb' }))

app.get('/api/health', (_req, res) => res.json({ ok: true, configured: Boolean(process.env.GEMINI_API_KEY) }))

app.post('/api/live-token', async (req, res) => {
  if (!req.is('application/json') || !req.body || Array.isArray(req.body) || Object.keys(req.body).length !== 0) {
    return res.status(400).json({ error: 'Requête invalide. Réessayez de démarrer la conversation.' })
  }
  if (!process.env.GEMINI_API_KEY) {
    return res.status(503).json({ error: 'Clé Gemini manquante. Ajoutez GEMINI_API_KEY dans server/.env puis redémarrez le serveur.' })
  }

  try {
    const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY, apiVersion: 'v1beta' })
    const token = await client.authTokens.create({
      config: {
        uses: 1,
        expireTime: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        newSessionExpireTime: new Date(Date.now() + 60 * 1000),
        liveConnectConstraints: {
          model,
          config: {
            responseModalities: ['AUDIO'],
            systemInstruction: {
              parts: [{ text: `Tu es Camille, une professeure de français de France, chaleureuse et professionnelle. L'apprenant a un niveau B1/B2. Parle principalement en français naturel de France, clairement et à un rythme modéré. Encourage-le à parler, pose des questions de suivi et privilégie une conversation vivante. Ne corrige pas chaque petite erreur. Corrige avec tact les erreurs importantes, explique brièvement en français simple, puis invite-le parfois à reformuler. Utilise le darija uniquement si l'apprenant le demande explicitement. Garde tes réponses orales concises et naturelles.` }],
            },
            inputAudioTranscription: {},
            outputAudioTranscription: {},
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Aoede' } } },
          },
        },
      },
    })

    if (!token?.name) throw new Error('Token response missing')
    return res.json({ token: token.name, expiresIn: 30 * 60 })
  } catch (error) {
    const message = String(error?.message || '')
    if (/API_KEY_INVALID|invalid api key|API key not valid/i.test(message)) {
      return res.status(503).json({ error: 'La clé Gemini semble invalide. Vérifiez GEMINI_API_KEY dans server/.env.' })
    }
    if (/quota|resource exhausted|429/i.test(message)) {
      return res.status(429).json({ error: 'Le quota Gemini est atteint. Réessayez plus tard ou vérifiez votre offre API.' })
    }
    return res.status(502).json({ error: 'Gemini n’a pas pu préparer la session. Vérifiez votre clé et votre connexion, puis réessayez.' })
  }
})

app.use((error, _req, res, _next) => {
  if (error.message === 'Origin not allowed') return res.status(403).json({ error: 'Cette origine n’est pas autorisée.' })
  if (error.type === 'entity.too.large' || error.type === 'entity.parse.failed') return res.status(400).json({ error: 'Requête invalide.' })
  return res.status(500).json({ error: 'Une erreur serveur est survenue.' })
})

app.listen(port, () => {
  process.stdout.write(`French Voice Tutor API ready on port ${port}\n`)
})
