# NEXORA FRONTEND MASTER PROMPT

Usage: place in the repo root and work phase by phase, stopping at every CHECKPOINT.
> **Phase 0 mode**: Read `NEXORA_FRONTEND_MASTER.md`, inspect the real codebase, publish `docs/FRONTEND_AUDIT.md`, and **WAIT at CHECKPOINT 0** before modifying any application code (`src/`, `js/`, `css/`, `package.json`, `vite.config.ts`). Frontend only: mock all server interactions behind the Section 5 API contract (`VITE_API_MODE=mock|live`).

---

## 1. SCOPE AND RULES
- **Frontend only.** The backend comes later. Every server interaction goes through a typed API client with a mock implementation (MSW + in-memory fixtures), so the real backend can be swapped in by changing one env var (`VITE_API_MODE=mock|live`, or the framework's equivalent).
- **Phase 0 first:** read the repo, detect the real stack (framework, router, styling, state, package manager, existing pages and components) and adapt every instruction below. Keep what works, refactor what blocks the design. Never assume.
- Branch `feat/nexora-frontend`; commit per phase; no breaking of existing routes without a redirect.
- Original design only. Do not copy any third-party code, copy, icons or imagery. No download or installer UI anywhere; primary hero CTA is `"Try the live scene"`.
- No secrets or API keys in client code. Any AI call goes through the (future) backend contract.
- Real metrics only in performance UI; marketing numbers are labeled placeholders.
- Privacy-first UI: consent screens, clear data inventory, one-click disconnect and delete flows (UI now, API later).
- WCAG AA contrast (`>= 4.5:1` body, `>= 3:1` UI/large text), `prefers-reduced-motion` respected everywhere, full keyboard accessibility.
- **Community Aesthetic & Interaction Addendum (Instagram + OpenBot/Rea craft):**
  - Community surfaces (Feed, Stories, Reels, Explore, Circles, Profile, Comments/Share sheets) adopt Instagram-level visual restraint, edge-to-edge media framing, fluid spring/gesture physics, gradient story rings with active progress segments, double-tap heart burst micro-interactions, optimistic likes/saves, and tactile navigation ergonomics—reimagined with **100% original Nexora code, Lucide/custom vector icons, and Nexora tokens**.

---

## 2. TECH DEFAULTS (use existing equivalents if the repo already has them)
- **Language & Build:** TypeScript (`strict: true`), Vite (existing `vite@8`), React 19
- **Styling & UI Primitives:** Tailwind CSS v4 (`@tailwindcss/vite`) + shadcn/ui (Radix UI primitives)
- **Motion & Icons:** Framer Motion (`motion` / `motion/react`) + `lucide-react`
- **Data, State & Forms:** TanStack Query (`@tanstack/react-query`), TanStack Virtual (`@tanstack/react-virtual`), Zustand, Zod
- **Mocking & Testing:** MSW (`msw`), Vitest + `@testing-library/react`, Playwright (E2E + axe/WCAG + visual diff)
- **Visualization & Compute:** Recharts, `d3-force`, Three.js / WebGL or high-FPS Canvas 2D, Web Workers pool

---

## 3. DESIGN SYSTEM & THEMING
- **6 Official Themes** via `[data-theme]` persisted in `localStorage`, OS `prefers-color-scheme` aware, View Transitions API animated when supported:
  1. `aurora` (dark violet `#7C5CFF` / cyan `#22D3EE` on `#07080F` / `#0E1020`)
  2. `aurora-light` (clean light `#F7F8FC` / `#FFFFFF`, `#5B3DF5` / `#0891B2`)
  3. `midnight-cyan` (deep oceanic cyan-led)
  4. `ember` (warm dark with `#FB923C` / `#F43F5E`)
  5. `obsidian-gold` (architectural carbon `#0B0C0E` + burnished brass `#E5A93C`)
  6. `ivory-gold` (editorial alabaster `#F7F5F0` + deep amber `#B45309`)
- **`/design` Showcase Route:** interactive token matrix, typography specimen, component gallery, theme switcher, and WCAG AA contrast checker.

---

## 4. ROUTE ARCHITECTURE & COMPATIBILITY
- **Target SPA Routes:**
  - `/` — Landing + Hero (`"Try the live scene"` primary CTA) + Live Team Scene + Community Preview
  - `/scene` — Dedicated Live Team Scene workspace (Atlas, Nova, Iris, Orion + handoff graph + approval gate)
  - `/connect` — Connector & OAuth Consent Hub (Instagram, Slack, Discord, scoped permissions, retention slider, one-click revoke/delete)
  - `/circles` — Social Circle Explorer (5k+ node WebGL/Canvas graph + virtualized member directory + cluster filters)
  - `/ask` — Grounded RAG Assistant & Search (`⌘K` + streaming citation cards)
  - `/insights` — Real-metrics telemetry, Recharts analytics & Performance HUD
  - `/privacy` — Privacy Center, Data Inventory, Export & Delete-All confirmation flows
  - `/settings` — Preferences, theme, motion, notification & account settings
  - `/design` — Living Design System & Token Inspector
  - Community views mapped cleanly into `/app` / community shell: Feed, Stories, Reels, Explore, Templates, Messages, Calls, Communities, Notifications, Profile, Saved, Live.
- **Backward-Compatible Redirects (Zero Broken URLs):**
  - `index.html`, `app.html`, `login.html`, `signup.html`, `welcome.html`, `verify.html`, `forgot-password.html`, `reset-password.html` must continue resolving or redirect smoothly to canonical routes.

---

## 5. API CONTRACT & MOCK LAYER
- Single typed entry point: `src/api/client.ts` controlled by `VITE_API_MODE=mock|live` (default `mock` during frontend phases).
- Strict **Zod** schemas at the client boundary validating all request/response payloads.
- **MSW handlers + deterministic in-memory fixtures** mirroring existing Express routes:
  - `GET /api/health`
  - `POST /api/live-scene/run`
  - `GET /api/rag/search`, `POST /api/rag/query` (JSON + SSE stream simulation)
  - `GET /api/social-circle/status`, `POST /api/social-circle/consent`, `POST /api/social-circle/sync/:provider`, `POST /api/social-circle/disconnect/:provider`, `POST /api/social-circle/retention`
  - `GET|POST|DELETE /api/ai-providers*`, `POST /api/templates/generate`
  - Community Feed / Stories / Reels / Circles typed endpoints (backed by MSW fixtures until live backend parity is built).

---

## 6. PERFORMANCE BUDGETS & WORKER COMPUTE
- **Initial JS Budget:** `< 170 KB gzip` on `/` (route-level `React.lazy`, manual Rollup chunk splitting, deferred Live Scene / Three.js / Circle Explorer chunks).
- **Web Worker Pool:** offload graph force layout (`d3-force`), circle clustering, and client-side RAG search/indexing off the main thread.
- **Processing HUD & Perf Panel:** live FPS, heap/timing metrics (real `performance.now()` / `PerformanceObserver` measurements only), worker queue depth.
- **Asset Optimization:** convert oversized raster hero/icon assets (`708 KB` JPG, `677 KB` maskable PNG) to optimized WebP/AVIF + responsive `srcset` and crisp SVGs.

---

## 7. PHASE EXECUTION PLAN & CHECKPOINTS
- **Phase 0 (NOW):** Repo Audit & Gap Analysis -> `docs/FRONTEND_AUDIT.md` -> **STOP AT CHECKPOINT 0**
- **Phase 1:** Toolchain, Router Skeleton, Route Redirects, Theme System (6 themes + `/design`), Layout Shell -> **CHECKPOINT 1**
- **Phase 2:** Typed API Contract (`VITE_API_MODE=mock|live`), Zod Schemas, MSW Fixtures, TanStack Query Layer -> **CHECKPOINT 2**
- **Phase 3:** Landing Experience + Live Team Scene (`/`, `/scene`) -> **CHECKPOINT 3**
- **Phase 4:** Instagram + OpenBot Community Shell (Feed, Stories Rings, Double-Tap Burst, Reels, Explore, Profile, Sheet Modals) -> **CHECKPOINT 4**
- **Phase 5:** Social Circle Explorer (5k-node Canvas/WebGL + Web Worker `d3-force`) & Connect Hub (`/circles`, `/connect`) -> **CHECKPOINT 5**
- **Phase 6:** Grounded RAG Ask (`/ask`), Insights (`/insights`), Privacy Center (`/privacy`), Settings (`/settings`) -> **CHECKPOINT 6**
- **Phase 7:** Performance Pass (`< 170 KB gzip` initial JS, image/font optimization, Worker pool, Perf HUD) -> **CHECKPOINT 7**
- **Phase 8:** Accessibility (WCAG AA, keyboard nav, reduced motion) + Vitest / RTL / Playwright E2E Suite -> **CHECKPOINT 8**
- **Phase 9:** Final Verification, Bundle Audit, Documentation & Clean Handoff -> **CHECKPOINT 9**
