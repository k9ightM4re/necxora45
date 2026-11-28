# NEXORA — Security Model

1. **Identity & Authentication**
   - Firebase Authentication ID tokens verified server-side via Google Identity Toolkit lookup (`verifyFirebaseToken`) and client-side via Firebase Auth SDK.
   - Email verification enforced in `firestore.rules` (`request.auth.token.email_verified == true`) for all sensitive social, messaging, commerce, and studio writes.
   - Server-signed `HttpOnly; SameSite` OTP verification cookie (`nx_otp_sig`) using timing-safe HMAC verification.

2. **Firestore Security Rules (8-Pillar Enforcement)**
   - Default-deny catch-all (`match /{document=**} { allow read, write: if false; }`).
   - Strict PII split: `/users/{userId}` holds only public profile fields; `/users/{userId}/private/{docId}` isolates email/phone strictly to the owner.
   - Private account protection: follow requests gated in `/users/{userId}/follow_requests/{requesterUid}`; blocked/muted subcollections strictly owner-scoped.
   - Relational access checks (`isParticipant`, `isServerMember`, `isAdmin`) backed by `@firebase/eslint-plugin-security-rules` static validation.

3. **Backend API & Privacy Controls**
   - Standardized Zod schema validation on all `/api/v1/*` inputs.
   - Rate limiting per IP/UID across OTP, upload, AI generation, nearby probes, and report submissions.
   - **Nearby Location Privacy**: Coarse rounding on stored coordinates (`roundCoarseCoordinate`), short TTL expiration, explicit opt-in & pause toggle, block filtering, and **zero raw peer coordinate exposure** in responses (distance bands/km only).
   - **Nexora Studio Photo Consent**: Personal photos require explicit consent acknowledgement timestamp and support immediate owner-authenticated deletion.
   - **Zero Secret Exposure**: External keys (`GEMINI_API_KEY`, `S3_*`, `MERCHANT_*`, `VTON_*`, `TURN_*`, `SESSION_SECRET`) remain strictly in server `process.env`.
