const DEDUPE_WINDOW_MS = 2500;
const recentNotifications = new Map();
let shieldInstalled = false;

function extractErrorDetails(err) {
  let code = '';
  let message = '';

  if (typeof err === 'string') {
    message = err;
  } else if (err && typeof err === 'object') {
    code = String(err.code || err.status || '').toLowerCase();
    message = String(err.message || err.reason || '');
    if (!code && typeof err.cause === 'object' && err.cause) {
      code = String(err.cause.code || '').toLowerCase();
    }
  }

  // Unwrap JSON error payloads if an internal error was serialized
  if (message.trim().startsWith('{') && message.trim().endsWith('}')) {
    try {
      const parsed = JSON.parse(message);
      if (parsed && typeof parsed.error === 'string') {
        message = parsed.error;
      }
    } catch {
      // keep message as-is for keyword matching only
    }
  }

  return {
    code: code.toLowerCase(),
    lowerMsg: message.toLowerCase(),
  };
}

/**
 * Converts any technical, Firebase, network, or runtime error into a calm,
 * non-technical user-facing message. Never leaks raw codes, JSON, or stack traces.
 */
export function formatFriendlyError(err, fallbackMessage = '') {
  const { code, lowerMsg } = extractErrorDetails(err);
  const combined = `${code} ${lowerMsg}`;

  if (
    code === 'auth/invalid-credential' ||
    code === 'auth/wrong-password' ||
    code === 'auth/user-not-found' ||
    combined.includes('invalid-credential') ||
    combined.includes('wrong-password') ||
    combined.includes('user-not-found')
  ) {
    return 'Incorrect email or password. Please check your details and try again.';
  }

  if (code === 'auth/email-already-in-use' || combined.includes('email-already-in-use')) {
    return 'An account with this email already exists. Please sign in instead.';
  }

  if (code === 'auth/weak-password' || combined.includes('weak-password')) {
    return 'Please choose a password with at least 6 characters.';
  }

  if (code === 'auth/invalid-email' || combined.includes('invalid-email')) {
    return 'Please enter a valid email address.';
  }

  if (
    code === 'auth/popup-closed-by-user' ||
    code === 'auth/cancelled-popup-request' ||
    combined.includes('popup-closed-by-user')
  ) {
    return 'Sign-in was cancelled before completion. Please try again.';
  }

  if (code === 'auth/popup-blocked' || combined.includes('popup-blocked')) {
    return 'Sign-in window could not open here. Please use Email & Password instead.';
  }

  if (
    code === 'auth/requires-recent-login' ||
    combined.includes('requires-recent-login')
  ) {
    return 'For your security, please sign out and sign back in before making this change.';
  }

  if (
    code === 'auth/invalid-phone-number' ||
    code === 'auth/missing-phone-number' ||
    combined.includes('invalid-phone-number')
  ) {
    return 'Please enter a valid phone number with country code.';
  }

  if (
    code === 'auth/invalid-verification-code' ||
    code === 'auth/missing-verification-code' ||
    combined.includes('invalid-verification-code')
  ) {
    return 'That verification code did not match. Please check and try again.';
  }

  if (
    code === 'auth/code-expired' ||
    code === 'auth/expired-action-code' ||
    code === 'auth/invalid-action-code' ||
    combined.includes('code-expired') ||
    combined.includes('action-code')
  ) {
    return 'This verification link or code has expired. Please request a fresh one.';
  }

  if (
    code === 'auth/too-many-requests' ||
    code === 'resource-exhausted' ||
    code === '429' ||
    combined.includes('too-many-requests') ||
    combined.includes('too many') ||
    combined.includes('quota') ||
    combined.includes('rate limit')
  ) {
    return 'Site is busy right now. Please wait a moment and try again.';
  }

  if (
    code === 'unavailable' ||
    code === 'deadline-exceeded' ||
    code === 'auth/network-request-failed' ||
    code === '502' ||
    code === '503' ||
    code === '504' ||
    combined.includes('network-request-failed') ||
    combined.includes('failed to fetch') ||
    combined.includes('client is offline') ||
    combined.includes('could not reach') ||
    combined.includes('timeout') ||
    combined.includes('unavailable') ||
    combined.includes('offline')
  ) {
    return 'Site is busy or your connection is unstable. Please try again in a moment.';
  }

  if (
    code === 'auth/unauthorized-domain' ||
    code === 'auth/unauthorized-continue-uri' ||
    code === 'auth/operation-not-allowed' ||
    code === 'auth/app-not-authorized' ||
    code === 'auth/user-disabled'
  ) {
    return 'You cannot enter with this sign-in option right now. Please try Email & Password or check back shortly.';
  }

  if (
    code === 'permission-denied' ||
    code === 'unauthenticated' ||
    code === '401' ||
    code === '403' ||
    combined.includes('permission-denied') ||
    combined.includes('permission_denied') ||
    combined.includes('missing or insufficient permissions') ||
    combined.includes('unauthorized')
  ) {
    return 'You cannot enter or perform this action right now. Please try again later.';
  }

  if (
    combined.includes('notallowederror') ||
    combined.includes('notfounderror') ||
    combined.includes('notreadableerror') ||
    combined.includes('permission dismissed') ||
    combined.includes('getusermedia')
  ) {
    return 'Microphone or camera is unavailable right now. Please check your browser permissions.';
  }

  if (
    code === 'auth/captcha-check-failed' ||
    code === 'auth/invalid-app-credential' ||
    code === 'auth/invalid-verification-id' ||
    combined.includes('captcha-check-failed') ||
    combined.includes('invalid-app-credential')
  ) {
    return 'Verification check failed. Please refresh the page and try again.';
  }

  if (fallbackMessage && typeof fallbackMessage === 'string') {
    console.warn('Unmapped sign-in error:', code || lowerMsg || 'unknown');
    return fallbackMessage;
  }

  return 'Site is busy right now. You cannot complete this action at this time — please try again shortly.';
}

function getToastContainer() {
  if (typeof document === 'undefined') return null;
  const existingAppStack = document.getElementById('toast-stack');
  if (existingAppStack) {
    existingAppStack.classList.add('nx-toast-region');
    return existingAppStack;
  }
  let region = document.getElementById('nx-toast-region');
  if (!region && document.body) {
    region = document.createElement('div');
    region.id = 'nx-toast-region';
    region.className = 'nx-toast-region';
    region.setAttribute('aria-live', 'polite');
    region.setAttribute('aria-atomic', 'false');
    document.body.appendChild(region);
  }
  return region;
}

const VARIANT_META = {
  error: { title: 'Notice', glyph: '!' },
  busy: { title: 'Site Busy', glyph: '!' },
  warning: { title: 'Notice', glyph: '!' },
  success: { title: 'Done', glyph: '✓' },
  info: { title: 'NEXORA', glyph: 'i' },
};

/**
 * Displays a sleek floating notification toast across any NEXORA page.
 */
export function notifyUser(message, variant = 'error', options = {}) {
  if (typeof document === 'undefined') return;
  const text = String(message || '').trim();
  if (!text) return;

  const normalizedVariant = VARIANT_META[variant] ? variant : 'error';
  const dedupeKey = `${normalizedVariant}:${text}`;
  const now = Date.now();
  const lastShownAt = recentNotifications.get(dedupeKey) || 0;
  if (now - lastShownAt < DEDUPE_WINDOW_MS) {
    return;
  }
  recentNotifications.set(dedupeKey, now);

  const container = getToastContainer();
  if (!container) return;

  const meta = VARIANT_META[normalizedVariant];
  const titleText = typeof options.title === 'string' && options.title ? options.title : meta.title;
  const durationMs = typeof options.durationMs === 'number' ? options.durationMs : normalizedVariant === 'success' ? 3200 : 4800;

  const card = document.createElement('div');
  card.className = `nx-toast nx-toast--${normalizedVariant}`;
  card.setAttribute('role', normalizedVariant === 'error' || normalizedVariant === 'busy' ? 'alert' : 'status');

  const icon = document.createElement('span');
  icon.className = 'nx-toast-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = meta.glyph;

  const body = document.createElement('div');
  body.className = 'nx-toast-body';

  if (normalizedVariant !== 'info' && normalizedVariant !== 'success') {
    const titleEl = document.createElement('strong');
    titleEl.className = 'nx-toast-title';
    titleEl.textContent = titleText;
    body.appendChild(titleEl);
  }

  const msgEl = document.createElement('span');
  msgEl.className = 'nx-toast-message';
  msgEl.textContent = text;
  body.appendChild(msgEl);

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'nx-toast-close';
  closeBtn.setAttribute('aria-label', 'Dismiss notification');
  closeBtn.textContent = '×';

  let timer = null;
  const dismiss = () => {
    if (timer) clearTimeout(timer);
    card.classList.add('is-leaving');
    setTimeout(() => card.remove(), 180);
  };

  closeBtn.addEventListener('click', dismiss);
  card.append(icon, body, closeBtn);
  container.appendChild(card);

  // Keep stack compact (max 4 visible notifications)
  while (container.children.length > 4) {
    container.firstElementChild?.remove();
  }

  timer = setTimeout(dismiss, durationMs);
}

/**
 * Intercepts uncaught errors and unhandled promise rejections globally so users
 * never see raw application crash messages; instead they see a calm notification.
 */
export function installGlobalErrorShield() {
  if (typeof window === 'undefined' || shieldInstalled) return;
  shieldInstalled = true;

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event?.reason;
    const { lowerMsg } = extractErrorDetails(reason);
    if (lowerMsg.includes('resizeobserver')) return;
    event.preventDefault();
    console.warn('Handled background error:', reason);
    notifyUser(
      formatFriendlyError(reason, 'Site is busy right now. Please try again in a moment.'),
      'busy'
    );
  });

  window.addEventListener('error', (event) => {
    const err = event?.error || event?.message || '';
    const { lowerMsg } = extractErrorDetails(err);
    if (
      !lowerMsg ||
      lowerMsg.includes('resizeobserver') ||
      lowerMsg.includes('script error')
    ) {
      return;
    }
    event.preventDefault();
    console.warn('Handled page error:', err);
    notifyUser(
      formatFriendlyError(err, 'Site is busy right now. Please try again in a moment.'),
      'busy'
    );
  });
}
