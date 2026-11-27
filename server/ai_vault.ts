import crypto from 'crypto';
import fs from 'fs';
import net from 'net';
import path from 'path';

export type AiProviderKind = 'gemini' | 'openai' | 'openai_compatible';

export interface ProviderCapabilities {
  textGeneration: boolean;
  structuredJson: boolean;
  visionInput: boolean;
  imageGeneration: boolean;
  customEndpoint: boolean;
}

export interface StoredProviderRecord {
  id: string;
  userId: string;
  provider: AiProviderKind;
  label: string;
  baseUrl: string;
  textModel: string;
  imageModel: string;
  keyMasked: string;
  encryptedKey: string;
  hasKey: boolean;
  isDefault: boolean;
  capabilities: ProviderCapabilities;
  lastStatus: string;
  lastError: string;
  lastTestedAtMs: number;
  createdAtMs: number;
  updatedAtMs: number;
}

export type PublicProviderConfig = Omit<StoredProviderRecord, 'encryptedKey'>;

const VAULT_DIR = path.resolve(process.cwd(), '.data');
const VAULT_PATH = path.join(VAULT_DIR, 'ai_vault.enc.json');
const EPHEMERAL_VAULT_SECRET = crypto.randomBytes(32).toString('hex');
const SESSION_SECRET = process.env.SESSION_SECRET || EPHEMERAL_VAULT_SECRET;

function getEncryptionKey(): Buffer {
  return crypto.scryptSync(SESSION_SECRET, 'nexora-ai-provider-salt', 32);
}

export function maskApiKey(rawKey: string): string {
  const trimmed = String(rawKey || '').trim();
  if (!trimmed) return '';
  if (trimmed.length <= 8) return '••••••••';
  return `${trimmed.slice(0, 4)}••••${trimmed.slice(-4)}`;
}

export function encryptSecret(plaintext: string): string {
  const clean = String(plaintext || '').trim();
  if (!clean) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(clean, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptSecret(payload: string): string {
  if (!payload || !payload.includes(':')) return '';
  const [ivHex, tagHex, dataHex] = payload.split(':');
  if (!ivHex || !tagHex || !dataHex) return '';
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    getEncryptionKey(),
    Buffer.from(ivHex, 'hex')
  );
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataHex, 'hex')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}

function isPrivateIpOrHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return true;
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host === 'metadata.google.internal' ||
    host === '169.254.169.254'
  ) {
    return true;
  }
  const ipType = net.isIP(host);
  if (ipType === 4) {
    const parts = host.split('.').map((n) => Number(n));
    const [a, b] = parts;
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
  } else if (ipType === 6) {
    if (host === '::1' || host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd')) {
      return true;
    }
  }
  return false;
}

export function validateSafeEndpointUrl(rawUrl: string): { ok: boolean; url?: string; error?: string } {
  const trimmed = String(rawUrl || '').trim();
  if (!trimmed) return { ok: true, url: '' };
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return { ok: false, error: 'Custom AI endpoint must start with https:// or http://.' };
    }
    if (isPrivateIpOrHost(parsed.hostname)) {
      return { ok: false, error: 'Custom endpoint cannot target localhost, loopback, or private network addresses.' };
    }
    if (parsed.username || parsed.password) {
      return { ok: false, error: 'Endpoint URL must not embed credentials.' };
    }
    return { ok: true, url: parsed.toString().replace(/\/+$/, '') };
  } catch {
    return { ok: false, error: 'Invalid custom AI endpoint URL.' };
  }
}

export function detectProviderCapabilities(
  provider: AiProviderKind,
  textModel: string,
  imageModel: string,
  hasKeyOrPlatformDefault: boolean
): ProviderCapabilities {
  const cleanText = String(textModel || '').trim().toLowerCase();
  const cleanImage = String(imageModel || '').trim().toLowerCase();
  if (!hasKeyOrPlatformDefault) {
    return {
      textGeneration: false,
      structuredJson: false,
      visionInput: false,
      imageGeneration: false,
      customEndpoint: provider === 'openai_compatible',
    };
  }
  if (provider === 'gemini') {
    return {
      textGeneration: true,
      structuredJson: true,
      visionInput: true,
      imageGeneration: Boolean(cleanImage || cleanText.includes('image')),
      customEndpoint: false,
    };
  }
  if (provider === 'openai') {
    return {
      textGeneration: true,
      structuredJson: true,
      visionInput: cleanText.includes('4o') || cleanText.includes('4.1') || cleanText.includes('gpt-5') || cleanText.includes('vision'),
      imageGeneration: Boolean(cleanImage),
      customEndpoint: false,
    };
  }
  return {
    textGeneration: true,
    structuredJson: true,
    visionInput: cleanText.includes('vision') || cleanText.includes('4o') || cleanText.includes('vl') || cleanText.includes('gemini'),
    imageGeneration: Boolean(cleanImage),
    customEndpoint: true,
  };
}

function readVaultFile(): Record<string, StoredProviderRecord[]> {
  try {
    if (!fs.existsSync(VAULT_PATH)) return {};
    const raw = fs.readFileSync(VAULT_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeVaultFile(data: Record<string, StoredProviderRecord[]>): void {
  if (!fs.existsSync(VAULT_DIR)) {
    fs.mkdirSync(VAULT_DIR, { recursive: true, mode: 0o700 });
  }
  fs.writeFileSync(VAULT_PATH, JSON.stringify(data, null, 2), { mode: 0o600 });
}

export function sanitizeProviderRecord(rec: StoredProviderRecord): PublicProviderConfig {
  const { encryptedKey: _drop, ...safe } = rec;
  return safe;
}

export function listUserProviders(uid: string): PublicProviderConfig[] {
  const vault = readVaultFile();
  const records = Array.isArray(vault[uid]) ? vault[uid] : [];
  return records.map(sanitizeProviderRecord).sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || b.updatedAtMs - a.updatedAtMs);
}

export function getUserProviderInternal(uid: string, configId?: string): StoredProviderRecord | null {
  const vault = readVaultFile();
  const records = Array.isArray(vault[uid]) ? vault[uid] : [];
  if (records.length === 0) return null;
  if (configId) {
    return records.find((r) => r.id === configId) || null;
  }
  return records.find((r) => r.isDefault) || records[0] || null;
}

export function upsertUserProvider(
  uid: string,
  input: {
    id?: string;
    provider: AiProviderKind;
    label?: string;
    apiKey?: string;
    baseUrl?: string;
    textModel?: string;
    imageModel?: string;
    isDefault?: boolean;
  }
): { ok: boolean; record?: PublicProviderConfig; error?: string } {
  const provider: AiProviderKind =
    input.provider === 'openai' || input.provider === 'openai_compatible' ? input.provider : 'gemini';

  const endpointCheck = validateSafeEndpointUrl(input.baseUrl || '');
  if (!endpointCheck.ok) {
    return { ok: false, error: endpointCheck.error };
  }
  if (provider === 'openai_compatible' && !endpointCheck.url) {
    return { ok: false, error: 'Base URL is required for OpenAI-Compatible providers.' };
  }

  const defaultTextModel =
    provider === 'gemini' ? 'gemini-4-hydrogen' : provider === 'openai' ? 'gpt-4o-mini' : 'llama-3.3-70b-versatile';
  const defaultImageModel = provider === 'gemini' ? 'gemini-3.1-flash-lite-image' : provider === 'openai' ? 'dall-e-3' : '';

  const textModel = String(input.textModel || defaultTextModel).trim().slice(0, 100) || defaultTextModel;
  const imageModel = String(input.imageModel ?? defaultImageModel).trim().slice(0, 100);

  const vault = readVaultFile();
  const existingList = Array.isArray(vault[uid]) ? [...vault[uid]] : [];
  const targetId = String(input.id || `prv-${crypto.randomUUID().slice(0, 12)}`).replace(/[^a-zA-Z0-9_-]/g, '');
  const idx = existingList.findIndex((r) => r.id === targetId);
  const existing = idx >= 0 ? existingList[idx] : null;

  const trimmedNewKey = String(input.apiKey || '').trim();
  const encryptedKey = trimmedNewKey ? encryptSecret(trimmedNewKey) : existing?.encryptedKey || '';
  const keyMasked = trimmedNewKey ? maskApiKey(trimmedNewKey) : existing?.keyMasked || '';
  const hasKey = Boolean(encryptedKey);

  if (!hasKey) {
    return { ok: false, error: 'Please provide an API key for this provider configuration.' };
  }

  const now = Date.now();
  const shouldBeDefault = input.isDefault !== undefined ? Boolean(input.isDefault) : existingList.length === 0 || Boolean(existing?.isDefault);
  const capabilities = detectProviderCapabilities(provider, textModel, imageModel, hasKey);

  const nextRec: StoredProviderRecord = {
    id: targetId,
    userId: uid,
    provider,
    label: String(input.label || (provider === 'gemini' ? 'My Gemini Key' : provider === 'openai' ? 'OpenAI Key' : 'Custom Endpoint')).trim().slice(0, 80),
    baseUrl: provider === 'openai_compatible' ? endpointCheck.url || '' : provider === 'openai' ? 'https://api.openai.com/v1' : '',
    textModel,
    imageModel,
    keyMasked,
    encryptedKey,
    hasKey,
    isDefault: shouldBeDefault,
    capabilities,
    lastStatus: trimmedNewKey ? 'untested' : existing?.lastStatus || 'untested',
    lastError: trimmedNewKey ? '' : existing?.lastError || '',
    lastTestedAtMs: existing?.lastTestedAtMs || 0,
    createdAtMs: existing?.createdAtMs || now,
    updatedAtMs: now,
  };

  if (shouldBeDefault) {
    for (let i = 0; i < existingList.length; i++) {
      existingList[i] = { ...existingList[i], isDefault: false };
    }
  }

  if (idx >= 0) {
    existingList[idx] = nextRec;
  } else {
    if (existingList.length >= 12) {
      return { ok: false, error: 'Maximum 12 saved AI provider profiles allowed per account.' };
    }
    existingList.push(nextRec);
  }

  vault[uid] = existingList;
  writeVaultFile(vault);
  return { ok: true, record: sanitizeProviderRecord(nextRec) };
}

export function updateUserProviderTestStatus(
  uid: string,
  configId: string,
  status: string,
  errorMsg = ''
): PublicProviderConfig | null {
  const vault = readVaultFile();
  const existingList = Array.isArray(vault[uid]) ? [...vault[uid]] : [];
  const idx = existingList.findIndex((r) => r.id === configId);
  if (idx < 0) return null;
  const updated: StoredProviderRecord = {
    ...existingList[idx],
    lastStatus: status,
    lastError: String(errorMsg || '').slice(0, 300),
    lastTestedAtMs: Date.now(),
    updatedAtMs: Date.now(),
  };
  existingList[idx] = updated;
  vault[uid] = existingList;
  writeVaultFile(vault);
  return sanitizeProviderRecord(updated);
}

export function deleteUserProvider(uid: string, configId: string): boolean {
  const vault = readVaultFile();
  const existingList = Array.isArray(vault[uid]) ? vault[uid] : [];
  const filtered = existingList.filter((r) => r.id !== configId);
  if (filtered.length === existingList.length) return false;
  if (filtered.length > 0 && !filtered.some((r) => r.isDefault)) {
    filtered[0].isDefault = true;
  }
  vault[uid] = filtered;
  writeVaultFile(vault);
  return true;
}

export function getPlatformGeminiConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim().length > 8);
}
