# NEXORA — Frontend Implementation Plan (Phases 0–9)

1. **Phase 0 — Repository Audit (Complete):** Inspected all 8 HTML entries, `js/*.js`, `css/*.css`, `src/live_scene/*`, `server/*`, and `tests/*.test.mjs`. Created `NEXORA_FRONTEND_AUDIT.md`, `NEXORA_DESIGN_SYSTEM_SPEC.md`, and `NEXORA_IMPLEMENTATION_PLAN.md`.
2. **Phase 1 — Design System Infrastructure:**
   - Replace `css/global.css` tokens with official Dark-default & Light **Graphite + Signal Blue + Soft Amber** tokens, 3-level glassmorphism variables (`--nx-glass-*`), Manrope + Inter typography tokens, and View Transitions support.
   - Update `js/social_utils.js` & `js/theme.js` so `dark` is default on first visit (persisted in `localStorage` key `nexora_theme`), with instant seamless Light/Dark switching (keeping `midnight-cyan` / `ember` legacy tokens compatible or gracefully mapped).
   - Update font `<link>` tags across `index.html`, `app.html`, `login.html`, `signup.html`, `verify.html`, `welcome.html`, `forgot-password.html`, `reset-password.html` to **Manrope + Inter** (plus `JetBrains Mono` strictly where tabular code metrics appear).
3. **Phase 2 — Public Navigation Capsule:**
   - Build centered floating glass capsule navbar in `index.html` + `css/landing.css` + `js/landing.js`: Left (Nexora logo + wordmark), Center (`Platform`, `Discover`, `AI Agents`, `Communities`, `About`), Right (`Theme Toggle` + `Log In` + `Get Started`), with mobile menu drawer & scroll opacity transition.
4. **Phase 3 — Architectural Hero & Angled Product Preview:**
   - Implement SynApse-inspired centered hero composition (`"THE HUMAN + AI NETWORK"`, `"One network. Infinite possibilities."`, `"Explore Nexora"` primary CTA -> `/signup.html` / `/app.html` or smooth preview scroll, `"Discover the network"` secondary CTA -> `#discover`, microcopy `"People. Agents. Communities. Connected."`).
   - Build architectural Graphite grid canvas with restrained Signal Blue edge illumination & subtle Soft Amber horizon line (dark & light counterparts).
   - Build large perspective-angled **Nexora Product Preview** overlapping the hero bottom edge featuring actual Nexora Left Sidebar, Human + AI Feed Preview, Right Activity/People panel, and Top Bar (responsive straight-on preview on mobile), with a working interactive mode toggle or jump to the live workspace preview.
5. **Phase 4 — Remaining Public Sections & Live Scene Integration:**
   - Implement Sections 1–8 (`Social connection, reimagined.`, `An ecosystem beyond traditional social networks.`, `Find the people and intelligence that move you forward.`, `Conversations that bring ideas together.`, `Better together, human and artificial.`, Product Preview with embedded Live Team Scene (`src/live_scene/LiveTeamScene.tsx`) re-themed to Graphite + Signal Blue + Soft Amber, `Your next connection starts here.`, and clean Footer).
   - Sync `src/live_scene/LiveTeamScene.tsx` tokens so there is zero purple/amber clash.
6. **Phase 5 — Authenticated App & Auth Page Consistency:**
   - Align `css/auth.css`, `css/welcome.css`, `css/app.css`, `css/social.css`, `css/templates.css`, `login.html`, `signup.html`, `verify.html`, `welcome.html`, `forgot-password.html`, `reset-password.html`, and `app.html` onto the unified Dark-default Graphite + Signal Blue + Soft Amber token system and Manrope + Inter typography.
   - Ensure `app.html` defaults to `data-theme="dark"` when unstored and syncs across all routes.
7. **Phase 6 — Instagram-Inspired Messaging Inbox:**
   - Enhance `#nx-legacy-workspace[data-workspace-mode="messages"]` in `app.html`, `css/app.css`, and `js/app.js`:
     - Left DM Panel: Inbox header (`Messages`), user handle, crisp search field, filter tabs (`Primary | Groups | Requests`), clean Instagram-style conversation rows (avatar + presence dot + name + preview + timestamp + unread indicator + quick archive).
     - Center Thread: Clean conversation header (`← Back` button on mobile + avatar + status + Call/Video/Screen + Info drawer toggle), grouped incoming neutral-elevated bubbles & outgoing Signal Blue bubbles, subtle hover actions, typing indicator, delivery receipt (`Sent` / `Seen`), and refined rounded composer.
     - Right Context Inspector: Collapsible on demand (`inspector-toggle-btn`) rather than permanently crowding desktop width.
     - Mobile (`<= 900px`): Native list-screen <-> full-screen conversation navigation without breaking WebRTC call stage or community channel mode.
8. **Phase 7 & 8 — Theme Validation, Motion & Responsiveness Verification:**
   - Audit Dark & Light contrast and responsive behavior across `1440px`, `1280px`, `1024px`, `768px`, `390px`, `360px` viewports and reduced-motion preferences.
9. **Phase 9 — Quality Assurance & Completion Report:**
   - Update/add unit tests in `tests/ui_redesign.test.mjs`, run `node --test tests/*.test.mjs`, `npm run lint`, `npm run build`, verify live HTTP/rendering, and write `NEXORA_FRONTEND_COMPLETION_REPORT.md`.
