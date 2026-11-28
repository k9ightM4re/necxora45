# NEXORA — System Architecture

**Version:** 1.0 (Core Platform Baseline)  
**Scope:** Core Nexora Social, Discovery, Real-Time Messaging, Communities, Social Commerce, Visual Product Search, and Nexora Studio.  
**Excluded Scope:** Separate Institutional/Organization Administration app and Standalone Reels short-video app are explicitly out of scope for this release.

---

## 1. High-Level Topology

Nexora runs as a unified full-stack Node.js web application served on port `3000`:

1. **Client Layer (`app.html`, `index.html`, Auth Pages + React 19 Islands)**
   - **Core Shell (`app.html` + `js/*.js`)**: Modular ES modules (`app.js`, `social.js`, `profile.js`, `session.js`, `auth.js`, `comms.js`, `rtc.js`, `call_tab.js`, `template_studio.js`, `reel_studio.js`, `social_circle_ui.js`, `theme.js`) using Firebase Web SDK v13 for Authentication and real-time Firestore listeners.
   - **React 19 + TypeScript Islands (`src/`)**:
     - `src/inbox/*`: 3-column Instagram-inspired Direct Messages workspace powered by `zustand` (`useInboxStore.ts`), `react-virtuoso`, `lucide-react`, and `window.NEXORA_APP_BRIDGE`.
     - `src/platform/*`: New modular React 19 + TypeScript + Tailwind v4 features mounted cleanly into `app.html` views (Social Commerce Marketplace, Visual Product Search, Nexora Studio).
   - **Design System (`css/global.css`, `css/app.css`, `css/social.css`, `src/inbox/inbox.css`)**: Graphite Dark (`#101318`, `#171C23`, `#1D232C`, `#242B35`) and Daylight Light (`#F5F6F8`, `#EBEEF2`, `#FFFFFF`) paired with Signal Blue (`#4777DF` highlight / `#3868CE` AA button fill) and Soft Amber (`#C49A52`), typography `Manrope` + `Inter` + `JetBrains Mono`, zero AI-bot personas.

2. **Application API & Real-Time Server (`server.ts`, `server/`)**
   - **HTTP Server**: Express 4 with Vite middleware in development (`NODE_ENV !== 'production'`) and static `dist/` serving in production.
   - **Versioned REST API (`/api/v1/*`)**: Modular domain routers under `server/v1/` with request correlation IDs (`X-Request-Id`), structured JSON logging, Zod request validation, Firebase ID token verification, rate limiting, and standardized error envelopes.
   - **Legacy API Compatibility (`/api/*`)**: Preserved aliases for existing clients (`api_router.ts`, `media_router.ts`, `discovery_router.ts`, `social_circle/router.ts`).
   - **WebSocket Hub (`/ws` in `server/realtime_ws.ts`)**: Token-authenticated WebSocket server on the shared HTTP server handling live online presence snapshots, presence updates, typing indicators, delivery/read receipts, and DM/notification wakeups.

3. **Data & Storage Layer**
   - **Primary Persistent Database**: Google Cloud Firestore (`ai-studio-remixnexoracommu-8c1b32d7-e98f-4a2a-abc8-811570610cac`) backed by `firebase-blueprint.json` schemas and strict `firestore.rules` (enforced via `@firebase/eslint-plugin-security-rules`).
   - **Server-Side Firestore REST & Store Access (`server/v1/firestore_client.ts`)**: Uses the authenticated caller's Firebase ID token against Firestore REST API so every user-scoped query and write respects Firestore security rules, plus bounded server-side cache/store (`nexoraStore`) for ephemeral geo TTLs, local media files (`.data/uploads/`), and adapter state.
   - **External Service Adapters (Provider-Independent)**:
     - Object Storage Adapter (`S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`) — falls back to validated local disk media storage (`.data/uploads/`) when S3 is unconfigured; explicitly reports S3 as `unconfigured`.
     - Media Processing Adapter (`FFMPEG_PATH`) — explicitly reports `unconfigured` transcoding when FFmpeg is unavailable.
     - Merchant Feed / Catalog Sync Adapter (`MERCHANT_FEED_SYNC_KEY` / merchant webhook URL) — returns explicit `unconfigured` / `503` when live merchant feed credentials are absent; persists verified catalog & collection documents in Firestore.
     - Virtual Try-On Provider Adapter (`VTON_PROVIDER_URL`, `VTON_API_KEY`) — returns explicit `unconfigured` (`503`) status when external try-on provider credentials are absent; never fabricates fake try-on composites.
