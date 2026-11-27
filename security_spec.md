# NEXORA AI Template Studio — Security Specification & Dirty Dozen Audit

## 1. Data Invariants
1. **API Key Secrecy**: User-provided AI provider API keys (Gemini, OpenAI, OpenAI-Compatible) are **never** sent back to the browser after save, never stored in `localStorage`/`sessionStorage`, never logged, never embedded into `templates` or generated exports, and never stored as plaintext in Firestore. Keys are encrypted at rest with AES-256-GCM on the Node/Express server (`/api/ai-providers/*`) and only decrypted transiently in server memory during verified API calls.
2. **Firestore `ai_provider_settings` Secret Exclusion**: Only masked metadata (`keyMasked` e.g. `sk-••••4812`, model selection, capability flags, sanitized base URL) may exist in `ai_provider_settings/{configId}`. Schema rules strictly allowlist keys and reject any shadow secret fields.
3. **Template Ownership & Moderation Isolation**: Only the authenticated creator (`creatorId == request.auth.uid`) may create or edit their template design (`isFeatured == false`, `status == 'active'` on creation). Only verified admins (`isAdmin()`) may promote `isFeatured`, restrict visibility, change moderation `status`, or manage `template_categories`.
4. **Duplicate-Free Likes & Saves**: Likes and saves use deterministic composite document IDs (`${templateId}__${uid}`), enforced in Firestore rules via `exists()` / `existsAfter()` paired transactions so a user cannot like or save the same template twice to inflate counts.
5. **Template Cloning Safety**: Using or remixing a community template clones `templateData` into a fresh `templates` document owned by the current user (`sourceTemplateId` set, `creatorId == request.auth.uid`) without mutating the source creator's document.
6. **SSRF & Payload Hardening**: Custom OpenAI-Compatible endpoints are validated server-side to permit only `http:` / `https:` URLs targeting non-loopback, non-link-local, non-private hosts. Image upload & DataURL strings are size-capped to prevent resource exhaustion.

## 2. The "Dirty Dozen" Adversarial Payloads
1. **Identity Spoofing on Template Create**: `{ creatorId: "victimUid", isFeatured: false }` -> Rejected (`incoming().creatorId == request.auth.uid`).
2. **Self-Featured Promotion**: `{ creatorId: auth.uid, isFeatured: true, status: "active" }` -> Rejected (`incoming().isFeatured == false`).
3. **Privilege Escalation on Template Update**: Owner updates `{ status: "active", visibility: "public" }` on a moderator-restricted template or modifies `isFeatured` -> Rejected (`affectedKeys().hasOnly(...)` excludes `isFeatured`, `status`, `moderatedBy`, and blocks un-restricting `'restricted'` templates).
4. **Raw Key Injection into Firestore**: Writing `{ apiKey: "AIzaSy...", userId: auth.uid }` to `ai_provider_settings` -> Rejected (`data.keys().hasOnly(...)` forbids secret keys).
5. **Cross-User AI Config Snooping**: User B attempts `get` or `list` on `/ai_provider_settings/{configId}` belonging to User A -> Rejected (`existing().userId == request.auth.uid`).
6. **Duplicate Template Like Replay**: User A calls batch write attempting second like on same template (`likesCount + 1` while `template_likes/${tid}__${uidA}` already exists) -> Rejected (`!exists(...) && existsAfter(...)`).
7. **Arbitrary Counter Inflation**: User sets `likesCount: 99999` or `usesCount: 9999` without valid increment / paired edge -> Rejected (`incoming().likesCount == existing().likesCount + 1`).
8. **Shadow Ghost Field Injection**: Adding `adminVerified: true` to `/templates/{id}` -> Rejected (`hasOnly(...)` whitelist).
9. **1.5 KB Document ID Poisoning**: Attempting write to `/templates/<1500 chars>` or `/templates/foo$bar` -> Rejected (`isValidId()`).
10. **Non-Admin Category Creation**: Standard user creates `/template_categories/hacked` -> Rejected (`isAdmin()`).
11. **Report Status Forgery**: Standard user creates `/template_reports/{id}` with `status: "resolved"` or updates another user's report -> Rejected (`incoming().status == 'open'`, `update` restricted to `isAdmin()`).
12. **Server API Proxy Without Valid Firebase Token / SSRF**: `POST /api/templates/generate` with spoofed header or `baseUrl: "http://169.254.169.254/latest/meta-data"` -> Rejected (`401 Unauthorized` / `400 Unsafe endpoint URL`).
