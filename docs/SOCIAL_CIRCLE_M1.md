# NEXORA Social Circle Engine — Milestone 1 (M1)

Milestone 1 delivers the consent-first, official-API **Connector Framework**, normalized schema, envelope encryption vault, idempotent sync queue, 90-day retention sweep, and user-isolated hybrid RAG retrieval.

## Hard Privacy & API Guarantees

- **Official APIs & OAuth Only**: No scraping, no reverse-engineered private endpoints, no self-bots, no user tokens.
- **Consent-First**: Explicit per-source opt-in (`POST /api/social-circle/consent`), clear scope selection, and one-click disconnect + full deletion (`POST /api/social-circle/disconnect/:provider`).
- **No Non-User Profiling**: Only authorized accounts and explicitly consented data are ingested.
- **Envelope Encryption**: OAuth tokens are encrypted per record with random 256-bit DEKs wrapped by `SOCIAL_CIRCLE_KEK` using AES-256-GCM.
- **90-Day Data Retention**: Default 90-day TTL enforced via `sweepExpired()` across `Person`, `Interaction`, and `Content`.
- **Zero PII / Message Content in Logs**: Errors and job logs pass through `redactForLog()`.

## OAuth Callback URLs

Register the exact redirect URLs in each developer portal:

### Dev App
- Instagram (Meta Login): `https://ais-dev-nji56klkqosla2egiayinr-384600797715.asia-northeast1.run.app/api/social-circle/oauth/instagram/callback`
- Slack OAuth v2: `https://ais-dev-nji56klkqosla2egiayinr-384600797715.asia-northeast1.run.app/api/social-circle/oauth/slack/callback`
- Discord OAuth2: `https://ais-dev-nji56klkqosla2egiayinr-384600797715.asia-northeast1.run.app/api/social-circle/oauth/discord/callback`

### Shared App
- Instagram (Meta Login): `https://ais-pre-nji56klkqosla2egiayinr-384600797715.asia-northeast1.run.app/api/social-circle/oauth/instagram/callback`
- Slack OAuth v2: `https://ais-pre-nji56klkqosla2egiayinr-384600797715.asia-northeast1.run.app/api/social-circle/oauth/slack/callback`
- Discord OAuth2: `https://ais-pre-nji56klkqosla2egiayinr-384600797715.asia-northeast1.run.app/api/social-circle/oauth/discord/callback`

## Required Environment Variables (`.env`)

- `SOCIAL_CIRCLE_KEK`
- `INSTAGRAM_CLIENT_ID`, `INSTAGRAM_CLIENT_SECRET`, `INSTAGRAM_APP_SECRET`
- `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_SIGNING_SECRET`
- `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_BOT_TOKEN`, `DISCORD_PUBLIC_KEY`
