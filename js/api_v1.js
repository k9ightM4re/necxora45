import { getActiveIdToken } from './session.js';

export async function apiV1Fetch(path, options = {}) {
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
  let payload = null;
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
    const err = new Error(message);
    err.status = res.status;
    err.code = payload?.error?.code || 'API_ERROR';
    err.details = payload?.error?.details || null;
    err.requestId = payload?.error?.requestId || null;
    throw err;
  }
  return payload || { ok: true };
}
