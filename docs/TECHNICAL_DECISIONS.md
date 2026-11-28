# NEXORA — Technical Decisions & Known Issues

## Technical Decisions
1. **Runtime Stack**: Keep **Node.js 22 + Express + WebSockets (`ws`) + Firebase Auth & Firestore** as the primary backend and database rather than rewriting to Python/FastAPI/PostgreSQL.
2. **Frontend Hybrid Architecture**: Preserve working modular `js/*.js` + `app.html` shell and the React 19 3-column inbox (`src/inbox/*`), while building new interactive subsystems (Social Commerce Marketplace, Visual Product Search, Nexora Studio) as **React 19 + TypeScript** modules mounted cleanly into `app.html`.
3. **External Integrations Policy**: S3/object storage, FFmpeg video transcoding, live merchant feed sync, external visual search APIs, and Virtual Try-On AI providers use explicit provider-independent adapters that report `unconfigured` (`503`) when credentials are missing rather than fabricating live prices, inventory, or synthetic try-on images.
4. **Core Scope Isolation**: Separate Institutional/Organization Administration and Standalone Reels apps are kept out of scope.
5. **Human-First Identity**: Zero AI bots, bot directories, or OpenBot interfaces are included.

## Known Issues (Tracked from Phase 0 Audit)
1. `tests/ui_redesign.test.mjs` has 3 pre-existing assertion mismatches checking legacy landing copy (`"One network."`, `live-team-scene-root`) against the updated human-first `index.html` (`"Real people."`, `"Connected in real time."`). Will be reconciled during test verification without restoring excluded bot-scene copy.
2. `nexoraStore` (`.data/nexora_store.json`) is local disk JSON for ephemeral geo state and local media fallback; persistent social/commerce/studio documents belong in Firestore.
3. Local bash environment defaults `PORT=8080`; standalone test runs of `server.ts` must specify a free port (e.g., `PORT=3099`), while the preview runtime serves on port `3000`.
