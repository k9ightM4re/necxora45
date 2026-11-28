import { getActiveIdToken } from '../../js/session.js';

export class ApiV1Error extends Error {
  status: number;
  code: string;
  details?: Record<string, unknown>;
  requestId?: string | null;

  constructor(
    message: string,
    status: number,
    code = 'API_ERROR',
    details?: Record<string, unknown>,
    requestId?: string | null
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
  }
}

export async function apiV1Request<T = Record<string, any>>(
  path: string,
  options: RequestInit = {}
): Promise<T & { ok: true; requestId?: string | null }> {
  const headers = new Headers(options.headers || {});
  const token = await getActiveIdToken();
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  if (options.body && !(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const url = path.startsWith('/api/v1') ? path : `/api/v1${path.startsWith('/') ? path : `/${path}`}`;
  const res = await fetch(url, {
    ...options,
    headers,
    credentials: 'same-origin',
  });
  let payload: any = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }
  if (!res.ok || payload?.ok === false) {
    const message =
      payload?.error?.message ||
      (typeof payload?.error === 'string' ? payload.error : '') ||
      `Request failed (${res.status})`;
    throw new ApiV1Error(
      message,
      res.status,
      payload?.error?.code || 'API_ERROR',
      payload?.error?.details,
      payload?.error?.requestId || null
    );
  }
  return payload || ({ ok: true } as any);
}
