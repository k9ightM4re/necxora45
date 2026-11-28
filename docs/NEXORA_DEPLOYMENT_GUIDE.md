# NEXORA — Deployment & Operations Guide

## 1. Prerequisites

- Node.js `22.x`
- Firebase project (`firebase-applet-config.json`) with Firestore & Firebase Authentication enabled
- Optional external provider environment variables in `.env` (see `.env.example`)

## 2. Environment Configuration

Copy `.env.example` to `.env` and populate secrets server-side only (never expose private keys in `VITE_*` client variables):

- `PORT`: `3000`
- `SESSION_SECRET`: HMAC session signing secret
- `GEMINI_API_KEY`: Optional server-side Gemini key for Template Studio & Visual Search keyword extraction
- `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`: Optional external media object storage (falls back to validated local disk storage)
- `FFMPEG_PATH`: Optional server transcoding binary path
- `MERCHANT_FEED_URL`, `MERCHANT_FEED_API_KEY`: Optional external merchant catalog sync
- `VISUAL_SEARCH_ENDPOINT`, `VISUAL_SEARCH_API_KEY`: Optional external visual product index
- `VTON_PROVIDER_URL`, `VTON_API_KEY`: Optional external Virtual Try-On rendering provider
- `REDIS_URL`: Optional Redis URL for multi-instance WebSocket fanout
- `TURN_URLS`, `TURN_USERNAME`, `TURN_CREDENTIAL`: Optional TURN relay credentials for WebRTC calls

## 3. Local & Production Build

```bash
npm ci
npm run lint
npx eslint .
npm run verify:features
npm run build
NODE_ENV=production npm start
```

## 4. Firestore Security Rules Deployment

`firestore.rules` is validated locally using `@firebase/eslint-plugin-security-rules` (`npx eslint .`). Deploy rules as the Firebase project owner:

```bash
firebase deploy --only firestore:rules
```

## 5. Docker Deployment

```bash
docker compose up --build -d
```

Health probe: `GET /api/v1/health` returns `{ ok: true, service: "nexora-api-v1", adapters: { ... } }`.
