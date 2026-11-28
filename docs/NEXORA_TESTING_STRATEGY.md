# NEXORA — Testing & Verification Strategy

## 1. Verification Layers

1. **Static Type Safety (`npm run lint` -> `tsc --noEmit`):** Validates TypeScript React 19 UI (`src/inbox/*`, `src/platform/*`), shared registry (`shared/featureRegistry.ts`), and Express v1 routers (`server/v1/*`).
2. **Firestore Security Rules Linting (`npx eslint .`):** Enforces `@firebase/eslint-plugin-security-rules` across `firestore.rules`.
3. **Automated Unit & Integration Tests (`node --test tests/*.test.mjs`):**
   - `tests/feature_registry.test.mjs`: Registry uniqueness, enum integrity, file existence, admin/non-admin exposure, deep-link route wiring.
   - `tests/api_v1_security.test.mjs`: Fail-closed Bearer `401` enforcement, admin `403` RBAC on `/api/v1/admin/feature-health`, private profile masking, privacy-safe geo nearby filtering.
   - `tests/feed_algorithm.test.mjs`: Block/mute/draft/private filtering, deterministic scoring, diversity pass, and trending topic velocity.
   - `tests/messaging_reliability.test.mjs`: `clientMutationId` idempotency cache, media magic-byte verification, offline outbox & reconnect sync wiring.
   - `tests/commerce_studio_adapters.test.mjs`: Stale price flagging (>24h), catalog visual token matching, and honest unconfigured adapter flags.
   - Domain suites: `ui_redesign.test.mjs`, `messaging_ui.test.mjs`, `social_utils.test.mjs`, `social_circle_m1.test.mjs`, `notifications.test.mjs`, `call_tab.test.mjs`, `community_leader_moderation.test.mjs`, `multi_account_sync.test.mjs`, `reel_studio.test.mjs`, `template_studio.test.mjs`, `welcome_tour.test.mjs`.
4. **End-to-End Verification Script (`npm run verify:features`):**
   - Runs TypeScript, ESLint, registry file/GUI checks, and all test files.
   - Emits `/reports/feature-verification.json` (ingested live by `GET /api/v1/admin/feature-health`) and `/reports/NEXORA_FEATURE_VERIFICATION.md`.
5. **Live HTTP Smoke Probes:** Validates `/`, `/app.html`, `/api/v1/health` (`200`), `/api/v1/features/registry` & `/api/v1/admin/feature-health` fail-closed (`401`), and deep-link redirects (`302`).
