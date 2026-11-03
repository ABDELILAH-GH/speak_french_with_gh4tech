import { useEffect, useRef, useState } from 'react'
import { AudioLines, BookOpen, Check, Headphones, Mic, MicOff, Phone, Settings2, Sparkles, Volume2, X } from 'lucide-react'
import './App.css'

const API_BASE = import.meta.env.VITE_API_URL || ''
const MODEL = 'gemini-3.1-flash-live-preview'
const TEACHER = `Tu es Camille, une professeure de français de France, chaleureuse et professionnelle. L'apprenant a un niveau B1/B2. Parle principalement en français naturel de France, clairement et à un rythme modéré. Encourage-le à parler, pose des questions de suivi et privilégie une conversation vivante. Ne corrige pas chaque petite erreur. Corrige avec tact les erreurs importantes, explique brièvement en français simple, puis invite-le parfois à reformuler. Utilise le darija uniquement si l'apprenant le demande explicitement. Garde tes réponses orales concises et naturelles.`

function pcm16ToBase64(float32) {
  const bytes = new Uint8Array(float32.length * 2)
  const view = new DataView(bytes.buffer)
  for (let i = 0; i < float32.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, float32[i]))
    view.setInt16(i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
  }
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

function base64ToPcm(data) {
  const binary = atob(data)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  const view = new DataView(bytes.buffer)
  const samples = new Float32Array(bytes.length / 2)
  for (let i = 0; i < samples.length; i += 1) samples[i] = view.getInt16(i * 2, true) / 32768
  return samples
}

function App() {
  const [status, setStatus] = useState('disconnected')
  const [muted, setMuted] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [transcript, setTranscript] = useState([])
  const [error, setError] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const sessionRef = useRef(null)
  const streamRef = useRef(null)
  const contextRef = useRef(null)
  const sourceRef = useRef(null)
  const processorRef = useRef(null)
  const gainRef = useRef(null)
  const playbackNodesRef = useRef(new Set())
  const playAtRef = useRef(0)
  const activeRef = useRef(false)
  const mutedRef = useRef(muted)
  const transcriptRef = useRef([])

  useEffect(() => { mutedRef.current = muted }, [muted])
  useEffect(() => {
    if (status === 'disconnected' || status === 'error') return undefined
    const timer = window.setInterval(() => setElapsed((value) => value + 1), 1000)
    return () => window.clearInterval(timer)
  }, [status])
  useEffect(() => () => {
    activeRef.current = false
    sessionRef.current?.close?.()
    for (const node of playbackNodesRef.current) {
      try { node.stop() } catch { /* Audio already ended. */ }
    }
    playbackNodesRef.current.clear()
    streamRef.current?.getTracks().forEach((track) => track.stop())
    if (contextRef.current && contextRef.current.state !== 'closed') contextRef.current.close().catch(() => {})
  }, [])

  const addTranscript = (speaker, text, replace = false, final = false) => {
    if (!text?.trim()) return
    const current = transcriptRef.current
    const last = current[current.length - 1]
    if (last?.speaker === speaker && last.partial) {
      current[current.length - 1] = { ...last, text: replace ? text : `${last.text}${text}`, partial: !final }
    } else current.push({ id: `${Date.now()}-${Math.random()}`, speaker, text, partial: !final })
    transcriptRef.current = [...current]
    setTranscript([...current])
  }
  const finishTranscript = (speaker) => {
    const current = transcriptRef.current.map((item, index) => index === transcriptRef.current.length - 1 && item.speaker === speaker ? { ...item, partial: false } : item)
    transcriptRef.current = current
    setTranscript(current)
  }

  function stopSession(update = true) {
    activeRef.current = false
    sessionRef.current?.close?.()
    sessionRef.current = null
    for (const node of playbackNodesRef.current) {
      try { node.stop() } catch { /* Audio already ended. */ }
    }
    playbackNodesRef.current.clear()
    processorRef.current?.disconnect()
    sourceRef.current?.disconnect()
    processorRef.current = null
    sourceRef.current = null
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    if (contextRef.current && contextRef.current.state !== 'closed') contextRef.current.close().catch(() => {})
    contextRef.current = null
    gainRef.current = null
    if (update) setStatus('disconnected')
  }

  async function startSession() {
    if (activeRef.current) return
    setError('')
    setElapsed(0)
    setTranscript([])
    transcriptRef.current = []
    setStatus('connecting')
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.AudioContext) throw new Error('Votre navigateur ne permet pas la capture audio. Utilisez une version récente de Chrome, Edge ou Firefox.')
      const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false })
      streamRef.current = mic
      const tokenResponse = await fetch(`${API_BASE}/api/live-token`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      const tokenPayload = await tokenResponse.json().catch(() => ({}))
      if (!tokenResponse.ok) {
        const message = tokenPayload.error || (tokenResponse.status === 404
          ? 'La route API Gemini manque dans le déploiement Vercel. Redéployez le projet avec le dossier api.'
          : 'Impossible de sécuriser la connexion Gemini.')
        throw new Error(message)
      }
      if (!tokenPayload.token) throw new Error('Vercel n’a pas renvoyé de jeton Gemini. Vérifiez les journaux des fonctions Vercel.')

      const { GoogleGenAI, Modality } = await import('@google/genai')
      const ai = new GoogleGenAI({ apiKey: tokenPayload.token, apiVersion: 'v1beta' })
      const session = await ai.live.connect({
        model: MODEL,
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: TEACHER,
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Aoede' } } },
        },
        callbacks: {
          onopen: () => { activeRef.current = true; setStatus('listening') },
          onmessage: (message) => {
            const content = message.serverContent
            if (!content) return
            if (content.interimInputTranscription?.text) addTranscript('you', content.interimInputTranscription.text, true)
            if (content.inputTranscription?.text) addTranscript('you', content.inputTranscription.text, true, true)
            if (content.outputTranscription?.text) addTranscript('teacher', content.outputTranscription.text)
            if (content.turnComplete) {
              finishTranscript('you'); finishTranscript('teacher')
              if (playbackNodesRef.current.size === 0) setStatus('listening')
            }
            if (content.interrupted) {
              for (const node of playbackNodesRef.current) {
                try { node.stop() } catch { /* Audio already ended. */ }
              }
              playbackNodesRef.current.clear()
              playAtRef.current = contextRef.current?.currentTime || 0
              setStatus('listening')
            }
            for (const part of content.modelTurn?.parts || []) {
              if (part.inlineData?.data && contextRef.current) {
                const ctx = contextRef.current
                const pcm = base64ToPcm(part.inlineData.data)
                const buffer = ctx.createBuffer(1, pcm.length, 24000)
                buffer.copyToChannel(pcm, 0)
                const node = ctx.createBufferSource()
                node.buffer = buffer
                node.connect(gainRef.current)
                playbackNodesRef.current.add(node)
                node.onended = () => {
                  playbackNodesRef.current.delete(node)
                  if (playbackNodesRef.current.size === 0 && activeRef.current) setStatus('listening')
                }
                const startAt = Math.max(ctx.currentTime, playAtRef.current)
                node.start(startAt)
                playAtRef.current = startAt + buffer.duration
                setStatus('speaking')
              }
            }
          },
          onerror: (event) => {
            const messageText = event?.message || 'La connexion Gemini a rencontré un problème.'
            setError(messageText)
            setStatus('error')
            stopSession(false)
          },
          onclose: (event) => {
            if (!activeRef.current) return
            activeRef.current = false
            setStatus('disconnected')
            if (event?.reason) setError(`Connexion terminée : ${event.reason}`)
            stopSession(false)
          },
        },
      })
      sessionRef.current = session
      const context = new AudioContext()
      contextRef.current = context
      await context.resume()
      const source = context.createMediaStreamSource(mic)
      const processor = context.createScriptProcessor(4096, 1, 1)
      const muteOutput = context.createGain()
      muteOutput.gain.value = 0
      gainRef.current = context.createGain()
      gainRef.current.gain.value = mutedRef.current ? 0 : 1
      gainRef.current.connect(context.destination)
      source.connect(processor)
      processor.connect(muteOutput)
      muteOutput.connect(context.destination)
      processor.onaudioprocess = (event) => {
        if (!activeRef.current || !sessionRef.current || mutedRef.current) return
        const samples = event.inputBuffer.getChannelData(0)
        const ratio = context.sampleRate / 16000
        const length = Math.floor(samples.length / ratio)
        const downsampled = new Float32Array(length)
        for (let i = 0; i < length; i += 1) {
          const start = Math.floor(i * ratio)
          const end = Math.floor((i + 1) * ratio)
          let total = 0
          for (let j = start; j < Math.min(end, samples.length); j += 1) total += samples[j]
          downsampled[i] = total / Math.max(1, end - start)
        }
        try {
          sessionRef.current.sendRealtimeInput({ audio: { data: pcm16ToBase64(downsampled), mimeType: 'audio/pcm;rate=16000' } })
        } catch {
          if (activeRef.current) setError('Audio non envoyé. La connexion est peut-être interrompue.')
        }
      }
      sourceRef.current = source
      processorRef.current = processor
      activeRef.current = true
      setStatus('listening')
      session.sendClientContent({
        turns: [{ role: 'user', parts: [{ text: 'Commence la séance en m’accueillant chaleureusement. Dis exactement qui tu es et que tu vas m’aider à apprendre le français, puis pose-moi une question simple pour lancer notre conversation.' }] }],
        turnComplete: true,
      })
    } catch (cause) {
      stopSession(false)
      setError(cause.name === 'NotAllowedError' ? 'Accès au micro refusé. Autorisez le microphone dans les réglages du navigateur puis réessayez.' : cause.name === 'NotFoundError' ? 'Aucun microphone disponible. Branchez ou activez un microphone.' : cause.message || 'La connexion n’a pas pu démarrer.')
      setStatus('error')
    }
  }

  const formatTime = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`
  const statusLabel = { disconnected: 'Prête à commencer', connecting: 'Connexion en cours', listening: 'Je vous écoute', speaking: 'Camille parle', error: 'Connexion interrompue' }[status]

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#home" aria-label="GH4TECH French Voice Tutor accueil"><img className="brand-logo" src="/gh4tech-mark.png" alt="" /><span className="brand-lockup"><strong>GH<span>4</span>TECH</strong><small>DIGITAL SOLUTIONS</small></span><span className="brand-divider" /><span className="product-name">French Voice Tutor</span></a>
        <div className="topbar-right"><span className="level-pill"><span /> Niveau B1–B2</span><button className="icon-button settings-button" aria-label="Réglages audio" onClick={() => setSettingsOpen(!settingsOpen)}><Settings2 size={19} /></button></div>
      </header>
      <section className="workspace" id="home">
        <div className="intro"><div className="eyebrow"><Sparkles size={14} /> VOTRE PROFESSEURE DE FRANÇAIS</div><h1>Parlons français,<br /><em>tout simplement.</em></h1><p>Une vraie conversation pour progresser à votre rythme.</p></div>
        <div className={`session-card ${status}`}>
          <div className="session-head"><div><div className="session-kicker"><span className={`status-dot ${status}`} />{statusLabel}</div><div className="mode-title"><BookOpen size={16} /> Conversation libre</div></div><div className="timer"><span className="timer-dot" />{formatTime}</div></div>
          <div className={`teacher-visual ${status}`} aria-label={statusLabel}><div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="avatar"><span className="avatar-glow" /><span className="avatar-letter">C</span><Sparkles className="avatar-spark" size={14} /></div><div className="sound-bars" aria-hidden="true">{Array.from({ length: 25 }, (_, index) => <span key={index} style={{ '--i': index, '--h': `${9 + ((index * 17) % 24)}px` }} />)}</div><div className="teacher-name">Camille <span>·</span> votre professeure</div></div>
          <div className="session-controls"><button className={`mic-button ${status === 'listening' ? 'active' : ''}`} onClick={status === 'disconnected' || status === 'error' ? startSession : () => setMuted((value) => !value)} disabled={status === 'connecting'} aria-label={status === 'disconnected' || status === 'error' ? 'Démarrer la conversation' : muted ? 'Réactiver le microphone' : 'Couper le microphone'}>{status === 'connecting' ? <span className="spinner" /> : status === 'disconnected' || status === 'error' ? <Mic size={23} /> : muted ? <MicOff size={22} /> : <Mic size={23} />}</button><span className="control-hint">{status === 'disconnected' || status === 'error' ? 'Démarrer la conversation' : muted ? 'Micro coupé' : status === 'connecting' ? 'Connexion…' : 'Touchez pour couper le micro'}</span>{status !== 'disconnected' && status !== 'error' && <button className="end-button" onClick={() => { stopSession(); setElapsed(0) }} aria-label="Terminer la conversation"><Phone size={18} /></button>}</div>
          {error && <div className="error-box"><X size={16} /><span>{error}</span></div>}
          {settingsOpen && <div className="settings-popover"><div className="settings-title"><Headphones size={17} /> Audio</div><p>Microphone actif · {muted ? 'coupé' : 'ouvert'}</p><p>La sortie audio est lue directement dans ce navigateur.</p></div>}
          <div className="privacy-note"><Volume2 size={14} /> Votre conversation reste privée</div>
        </div>
        <section className="transcript-panel"><div className="transcript-heading"><div><span className="section-label">VOTRE ÉCHANGE</span><h2>Conversation</h2></div><span className="live-indicator">{status === 'disconnected' || status === 'error' ? 'En attente' : 'EN DIRECT'}</span></div><div className="transcript-body">{transcript.length === 0 ? <div className="transcript-empty"><div className="empty-icon"><AudioLines size={19} /></div><div><strong>Votre échange apparaîtra ici</strong><span>Parlez naturellement, Camille vous répondra en français.</span></div></div> : transcript.map((item) => <article className={`transcript-line ${item.speaker}`} key={item.id}><span className="speaker-label">{item.speaker === 'you' ? 'VOUS' : 'CAMILLE'}</span><p>{item.text}{item.partial && <i className="typing-cursor" />}</p></article>)}</div></section>
        <footer className="footer-note"><span><Check size={14} /> Corrections bienveillantes</span><i /><span>Français de France</span><i /><span>À votre rythme</span></footer>
      </section>
    </main>
  )
}

export default App
