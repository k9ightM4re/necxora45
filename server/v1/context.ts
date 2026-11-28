import crypto from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import type { ZodType } from 'zod';

export interface VerifiedUser {
  uid: string;
  email: string;
  emailVerified: boolean;
  phoneNumber: string;
  displayName: string;
  idToken: string;
}

export interface AuthedRequest extends Request {
  requestId?: string;
  verifiedUser?: VerifiedUser;
}

export interface AdapterConfigStatus {
  gemini: { configured: boolean; label: string };
  s3Storage: { configured: boolean; fallback: string };
  ffmpegTranscoding: { configured: boolean; reason: string };
  merchantFeedSync: { configured: boolean; reason: string };
  externalVisualSearch: { configured: boolean; fallback: string };
  virtualTryOn: { configured: boolean; reason: string };
  videoRunway: { configured: boolean; reason: string };
  bodyEstimation: { configured: boolean; reason: string };
  weatherContext: { configured: boolean; reason: string };
  turnRelay: { configured: boolean; fallback: string };
}

export function getAdapterConfigStatus(): AdapterConfigStatus {
  return {
    gemini: {
      configured: Boolean(process.env.GEMINI_API_KEY?.trim()),
      label: 'Platform Gemini API',
    },
    s3Storage: {
      configured: Boolean(
        process.env.S3_ENDPOINT?.trim() &&
          process.env.S3_BUCKET?.trim() &&
          process.env.S3_ACCESS_KEY_ID?.trim() &&
          process.env.S3_SECRET_ACCESS_KEY?.trim()
      ),
      fallback: 'local-disk-validated-storage',
    },
    ffmpegTranscoding: {
      configured: Boolean(process.env.FFMPEG_PATH?.trim()),
      reason: 'FFMPEG_PATH not configured; raw validated uploads pass through without server transcoding.',
    },
    merchantFeedSync: {
      configured: Boolean(process.env.MERCHANT_FEED_URL?.trim() && process.env.MERCHANT_FEED_API_KEY?.trim()),
      reason: 'MERCHANT_FEED_URL and MERCHANT_FEED_API_KEY are not configured.',
    },
    externalVisualSearch: {
      configured: Boolean(
        process.env.VISUAL_SEARCH_ENDPOINT?.trim() && process.env.VISUAL_SEARCH_API_KEY?.trim()
      ),
      fallback: 'firestore-catalog-tag-matching',
    },
    virtualTryOn: {
      configured: Boolean(process.env.VTON_PROVIDER_URL?.trim() && process.env.VTON_API_KEY?.trim()),
      reason: 'VTON_PROVIDER_URL and VTON_API_KEY are not configured.',
    },
    videoRunway: {
      configured: Boolean(
        process.env.VIDEO_RUNWAY_PROVIDER_URL?.trim() && process.env.VIDEO_RUNWAY_API_KEY?.trim()
      ),
      reason: 'VIDEO_RUNWAY_PROVIDER_URL and VIDEO_RUNWAY_API_KEY are not configured.',
    },
    bodyEstimation: {
      configured: Boolean(process.env.BODY_ESTIMATION_URL?.trim() && process.env.BODY_ESTIMATION_API_KEY?.trim()),
      reason: 'BODY_ESTIMATION_URL and BODY_ESTIMATION_API_KEY are not configured; manual measurements only.',
    },
    weatherContext: {
      configured: Boolean(process.env.WEATHER_API_KEY?.trim()),
      reason: 'WEATHER_API_KEY is not configured; weather-adaptive styling is disabled.',
    },
    turnRelay: {
      configured: Boolean(process.env.TURN_URLS?.trim()),
      fallback: 'public-stun-only',
    },
  };
}

export function logEvent(
  level: 'info' | 'warn' | 'error',
  event: string,
  meta: Record<string, unknown> = {}
): void {
  const sanitized: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (/token|secret|password|apikey|authorization|cookie/i.test(k)) {
      sanitized[k] = '[REDACTED]';
    } else {
      sanitized[k] = v;
    }
  }
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    event,
    ...sanitized,
  });
  if (level === 'error') {
    console.error(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export class ApiError extends Error {
  status: number;
  code: string;
  details?: Record<string, unknown>;

  constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function attachRequestContext(req: AuthedRequest, res: Response, next: NextFunction): void {
  const incomingId = String(req.headers['x-request-id'] || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
  const requestId = incomingId || `req_${crypto.randomBytes(6).toString('hex')}`;
  req.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);

  const startedAt = Date.now();
  res.on('finish', () => {
    if (req.path.startsWith('/api/')) {
      logEvent(res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info', 'http_request', {
        requestId,
        method: req.method,
        path: req.path,
        status: res.statusCode,
        durationMs: Date.now() - startedAt,
        uid: req.verifiedUser?.uid || null,
      });
    }
  });
  next();
}

export function sendApiOk(req: AuthedRequest, res: Response, data: Record<string, unknown>, status = 200): void {
  res.status(status).json({
    ok: true,
    requestId: req.requestId || null,
    ...data,
  });
}

export function sendApiError(
  req: AuthedRequest,
  res: Response,
  status: number,
  code: string,
  message: string,
  details?: Record<string, unknown>
): void {
  res.status(status).json({
    ok: false,
    error: {
      code,
      message,
      ...(details ? { details } : {}),
      requestId: req.requestId || null,
    },
  });
}

export function parseWithSchema<T>(
  req: AuthedRequest,
  res: Response,
  schema: ZodType<T>,
  payload: unknown
): T | null {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.join('.') || 'body';
      if (!fieldErrors[key]) fieldErrors[key] = [];
      fieldErrors[key].push(issue.message);
    }
    sendApiError(req, res, 400, 'VALIDATION_ERROR', 'Request validation failed.', { fieldErrors });
    return null;
  }
  return parsed.data;
}

export function v1ErrorMiddleware(
  err: unknown,
  req: AuthedRequest,
  res: Response,
  _next: NextFunction
): void {
  if (res.headersSent) return;
  if (err instanceof ApiError) {
    sendApiError(req, res, err.status, err.code, err.message, err.details);
    return;
  }
  const message = err instanceof Error ? err.message : 'Internal server error';
  logEvent('error', 'unhandled_api_error', {
    requestId: req.requestId || null,
    path: req.path,
    error: message,
  });
  sendApiError(req, res, 500, 'INTERNAL_ERROR', 'An unexpected server error occurred.');
}
