/**
 * NEXORA Supabase client — zero-dependency REST wrapper.
 * Firebase is untouched; this module is additive only.
 *
 * The publishable key is designed for browsers. Never put the service role
 * key here. Optional override: window.NEXORA_SUPABASE_CONFIG = { url, key }.
 */
const FALLBACK_URL = 'https://narymvkaddrgqjhxmwni.supabase.co';
const FALLBACK_KEY = 'sb_publishable_HxjlUjNbkXPB85aTQS16pg_cGuu9hgC';

const runtimeConfig =
  (typeof window !== 'undefined' && window.NEXORA_SUPABASE_CONFIG) || {};

const SUPABASE_URL = String(runtimeConfig.url || FALLBACK_URL).trim().replace(/\/+$/, '');
const SUPABASE_KEY = String(runtimeConfig.key || FALLBACK_KEY).trim();

let bearerToken = null;

/** Attach a logged-in user's Supabase JWT so RLS can identify them. */
export function setSupabaseToken(token) {
  bearerToken = token || null;
}

export const supabaseConfig = Object.freeze({
  url: SUPABASE_URL,
  isConfigured: Boolean(SUPABASE_URL && SUPABASE_KEY),
});

function buildHeaders(extra = {}) {
  return {
    apikey: SUPABASE_KEY,
    Authorization: 'Bearer ' + (bearerToken || SUPABASE_KEY),
    'Content-Type': 'application/json',
    ...extra,
  };
}

async function request(method, table, options = {}) {
  const {
    select = '*',
    filter = '',
    order = '',
    limit,
    body,
    prefer = 'return=representation',
  } = options;

  const params = [];
  if (select) params.push('select=' + encodeURIComponent(select));
  if (filter) params.push(filter);
  if (order) params.push('order=' + encodeURIComponent(order));
  if (limit !== undefined && limit !== null) params.push('limit=' + Number(limit));

  const endpoint =
    SUPABASE_URL + '/rest/v1/' + encodeURIComponent(table) +
    (params.length ? '?' + params.join('&') : '');

  const response = await fetch(endpoint, {
    method,
    headers: buildHeaders({ Prefer: prefer }),
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const raw = await response.text();
  let payload = raw;
  try { payload = raw ? JSON.parse(raw) : null; } catch (_) { /* keep raw text */ }

  if (!response.ok) {
    const message =
      (payload && (payload.message || payload.hint || payload.details)) ||
      'Supabase request failed (' + response.status + ')';
    const error = new Error(message);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

/** Rows from a table. filter examples: "id=eq.123", "author_id=eq.<uuid>" */
export function supabaseSelect(table, options = {}) {
  return request('GET', table, options);
}

export function supabaseInsert(table, rows, options = {}) {
  return request('POST', table, { ...options, body: rows });
}

export function supabaseUpdate(table, patch, options = {}) {
  return request('PATCH', table, { ...options, body: patch });
}

export function supabaseDelete(table, options = {}) {
  return request('DELETE', table, { ...options, prefer: 'return=minimal' });
}

/** Health/schema check. Returns { ok, message, schemaReady }. */
export async function checkSupabaseConnection() {
  const result = { ok: false, schemaReady: false, url: SUPABASE_URL, message: '' };
  try {
    await supabaseSelect('profiles', { select: 'id', limit: 1 });
    result.ok = true;
    result.schemaReady = true;
    result.message = 'Connected';
  } catch (error) {
    result.message = error instanceof Error ? error.message : String(error);
    if (error && error.status === 404) result.message += ' — run supabase/schema.sql first';
  }
  return result;
}

if (typeof window !== 'undefined') {
  window.NEXORA_SUPABASE = {
    config: supabaseConfig,
    select: supabaseSelect,
    insert: supabaseInsert,
    update: supabaseUpdate,
    remove: supabaseDelete,
    setToken: setSupabaseToken,
    check: checkSupabaseConnection,
  };
}
