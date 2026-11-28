# NEXORA — Known Issues & Mitigations

| ID | Area | Description | Severity | Resolution / Status |
|---|---|---|---|---|
| `KI-01` | Tests (`tests/ui_redesign.test.mjs`, `tests/messaging_ui.test.mjs`) | Legacy assertions expected pre-rewrite landing/AI-bot strings. | Resolved | Reconciled with human-first `index.html`, React 3-zone inbox (`src/inbox/*`), and removed obsolete `live_scene_engine.test.mjs`. |
| `KI-02` | External Adapters | S3, FFmpeg, merchant feed sync, external visual search, VTON, and Redis Pub/Sub have no API credentials configured in `.env`. | Expected | Adapters return explicit `503` / `REQUIRES_CONFIGURATION` status until provider env keys are supplied. |
| `KI-03` | Local Store Persistence | `nexoraStore` (`.data/nexora_store.json`) is container-local ephemeral JSON. | Medium | Durable social/commerce/studio data persists in Firestore; `.data/` holds short-TTL geo presence and local media fallback. |
| `KI-04` | Firestore Rules Deploy | Remote Firebase deploy requires project-owner IAM permissions (`firebase deploy --only firestore:rules`). | Operational | Validated locally via `npx eslint .` (`@firebase/eslint-plugin-security-rules`); deploy from project owner CLI. |
