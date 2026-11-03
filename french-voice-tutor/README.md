# French Voice Tutor

A real-time French speaking practice app. The browser streams microphone audio to Gemini Live over a WebSocket using a short-lived token minted by the backend. Locally, the app uses Express; on Vercel it uses the serverless route in `api/live-token.js`. The permanent Gemini API key stays server-side.

## Requirements

- Node.js 20.19+ or 22.12+ and npm
- A Gemini API key with Gemini Live API access
- A current Chrome, Edge, or Firefox browser and a working microphone

Microphone access requires localhost or HTTPS. The included Vite development server uses localhost.

## Setup

From the project root, install the existing root dependencies and the backend dependencies:

```sh
npm install
npm --prefix server install
```

Copy `server/.env.example` to `server/.env`, then set your key:

```env
GEMINI_API_KEY=your_key_here
PORT=3001
```

Create a Gemini API key in [Google AI Studio](https://aistudio.google.com/app/apikey). Do not add the key to a frontend `.env` file or commit `server/.env`.

## Start the app

Start the frontend and backend together:

```sh
npm run dev
```

Open the Vite URL shown in the terminal, usually <http://localhost:5173>.

Run either service on its own:

```sh
npm run dev:client
npm run dev:server
```

### Deploy on Vercel

The `api/live-token.js` file provides the `/api/live-token` function required by the deployed frontend. In Vercel, open **Project → Settings → Environment Variables** and add `GEMINI_API_KEY` for both **Production** and **Preview**. Then deploy the latest project again. Do not use a `VITE_` prefix for this secret. Vercel only applies changed environment variables to new deployments.

Keep the project root set to this repository's root so Vercel can detect the `api` folder. The app and function are same-origin, so no public API key or separate `VITE_API_URL` is needed. Serve the app over HTTPS so mobile browsers permit microphone access.

For a different production host, serve `/api/*` through a same-origin reverse proxy to the Express backend. The browser intentionally calls the relative `/api/live-token` path so production builds cannot accidentally call a developer machine or expose an API URL in frontend settings.

## Microphone and troubleshooting

1. Open the app at its localhost URL and choose **Démarrer la conversation**.
2. Allow microphone access when the browser asks.
3. Speak naturally in French. The transcript appears as Gemini provides transcription events.

- If microphone access was denied, allow it in the browser's site settings and retry.
- If a Vercel deployment reports a missing key, set `GEMINI_API_KEY` in Vercel's Production and Preview variables, then redeploy.
- If running locally, confirm `GEMINI_API_KEY` is set in `server/.env`, then restart the backend.
- If Gemini rejects the request, confirm the key is active, Live API access is available, and the account has quota.
- If the API is unreachable, confirm port 3001 is available and the backend starts successfully.
- If audio playback is blocked, interact with the page once and check the browser's audio output and volume.

## Live API behavior and limits

The current integration uses `gemini-3.1-flash-live-preview`, 16 kHz little-endian PCM microphone audio, 24 kHz PCM response audio, and the Live API's input/output transcription events. A barge-in event clears queued playback. The API key is used only on the backend to mint a one-use ephemeral token with a 1-minute session-start window and 30-minute expiry.

Gemini API free-tier availability, quotas, and model access vary by account and can change. Check the current [Gemini API pricing and limits](https://ai.google.dev/gemini-api/docs/pricing) for your account. The API key and browser microphone are required for an end-to-end conversation; this project does not simulate responses.
