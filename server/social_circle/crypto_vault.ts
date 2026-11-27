import crypto from 'crypto';
import type { EncryptedTokenBundle, OAuthTokenPayload, SocialSource } from './types.ts';

const EPHEMERAL_FALLBACK = crypto.randomBytes(32).toString('hex');

function getKekBuffer(): Buffer {
  const raw =
    process.env.SOCIAL_CIRCLE_KEK ||
    process.env.SESSION_SECRET ||
    EPHEMERAL_FALLBACK;
  return crypto.scryptSync(raw, 'nexora-social-circle-kek-v1', 32);
}

/**
 * Envelope encryption:
 * 1. Generate a fresh 256-bit random DEK per credential record.
 * 2. Encrypt the OAuth token bundle JSON using AES-256-GCM with the DEK.
 * 3. Wrap (encrypt) the DEK using AES-256-GCM with the server KEK.
 */
export function envelopeEncryptTokens(
  userId: string,
  source: SocialSource,
  payload: OAuthTokenPayload
): EncryptedTokenBundle {
  const dek = crypto.randomBytes(32);
  const kek = getKekBuffer();

  const aad = Buffer.from(`${userId}:${source}`, 'utf8');

  // Encrypt payload with DEK
  const dataIv = crypto.randomBytes(12);
  const dataCipher = crypto.createCipheriv('aes-256-gcm', dek, dataIv);
  dataCipher.setAAD(aad);
  const plaintext = JSON.stringify(payload);
  const ciphertextBuf = Buffer.concat([
    dataCipher.update(plaintext, 'utf8'),
    dataCipher.final(),
  ]);
  const dataTag = dataCipher.getAuthTag();

  // Wrap DEK with KEK
  const wrapIv = crypto.randomBytes(12);
  const wrapCipher = crypto.createCipheriv('aes-256-gcm', kek, wrapIv);
  wrapCipher.setAAD(aad);
  const wrappedBuf = Buffer.concat([wrapCipher.update(dek), wrapCipher.final()]);
  const wrapTag = wrapCipher.getAuthTag();
  dek.fill(0);

  return {
    userId,
    source,
    wrappedDek: `${wrapIv.toString('hex')}:${wrapTag.toString('hex')}:${wrappedBuf.toString('hex')}`,
    iv: dataIv.toString('hex'),
    authTag: dataTag.toString('hex'),
    ciphertext: ciphertextBuf.toString('hex'),
    updatedAtMs: Date.now(),
  };
}

export function envelopeDecryptTokens(bundle: EncryptedTokenBundle): OAuthTokenPayload {
  const kek = getKekBuffer();
  const [wrapIvHex, wrapTagHex, wrappedHex] = String(bundle.wrappedDek || '').split(':');
  if (!wrapIvHex || !wrapTagHex || !wrappedHex) {
    throw new Error('Corrupted wrapped DEK envelope.');
  }

  const aad = Buffer.from(`${bundle.userId}:${bundle.source}`, 'utf8');
  const unwrapDecipher = crypto.createDecipheriv(
    'aes-256-gcm',
    kek,
    Buffer.from(wrapIvHex, 'hex')
  );
  unwrapDecipher.setAAD(aad);
  unwrapDecipher.setAuthTag(Buffer.from(wrapTagHex, 'hex'));
  const dek = Buffer.concat([
    unwrapDecipher.update(Buffer.from(wrappedHex, 'hex')),
    unwrapDecipher.final(),
  ]);

  try {
    const dataDecipher = crypto.createDecipheriv(
      'aes-256-gcm',
      dek,
      Buffer.from(bundle.iv, 'hex')
    );
    dataDecipher.setAAD(aad);
    dataDecipher.setAuthTag(Buffer.from(bundle.authTag, 'hex'));
    const decrypted = Buffer.concat([
      dataDecipher.update(Buffer.from(bundle.ciphertext, 'hex')),
      dataDecipher.final(),
    ]);
    return JSON.parse(decrypted.toString('utf8')) as OAuthTokenPayload;
  } finally {
    dek.fill(0);
  }
}

export function computeExpiresAtMs(tsMs: number, retentionDays = 90): number {
  const days = Math.min(365, Math.max(1, Number(retentionDays || 90)));
  return tsMs + days * 24 * 60 * 60 * 1000;
}

/**
 * Redacts PII, tokens, and message text before emitting operational telemetry.
 */
export function redactForLog(input: Record<string, any>): Record<string, any> {
  const sensitiveKeys = new Set([
    'accesstoken',
    'refreshtoken',
    'bottoken',
    'token',
    'secret',
    'password',
    'email',
    'text',
    'content',
    'message',
    'body',
    'displayname',
    'handles',
    'authorization',
  ]);
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(input || {})) {
    if (sensitiveKeys.has(k.toLowerCase())) {
      out[k] = '[REDACTED]';
    } else if (v && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = redactForLog(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}
