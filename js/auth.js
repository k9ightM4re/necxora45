import {
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
  sendEmailVerification,
  sendPasswordResetEmail,
  sendSignInLinkToEmail,
  verifyPasswordResetCode,
  confirmPasswordReset,
  RecaptchaVerifier,
  signInWithPhoneNumber,
  onAuthStateChanged,
  signOut,
  isSignInWithEmailLink,
  signInWithEmailLink,
} from 'firebase/auth';
import { auth, googleProvider } from './firebase.js';
import { ensureUserProfile } from './profile.js';
import { formatFriendlyError, notifyUser } from './notifications.js';
import { initThemeSync } from './theme.js';
import {
  getPostAuthDestination,
  isUserVerified,
  redirectIfAuthenticated,
  resolveVerifiedSession,
} from './session.js';

initThemeSync();

let phoneConfirmationResult = null;
let recaptchaVerifierInstance = null;
let phoneOtpCooldownTimer = null;
let authFlowInProgress = false;

function formatFirebaseAuthError(err) {
  return formatFriendlyError(err, 'You cannot enter right now. Please try again in a moment.');
}

function showAlert(msg, isSuccess = false) {
  const safeMsg = String(msg || '').trim();
  const el = document.getElementById('form-alert');
  if (el) {
    el.textContent = safeMsg;
    el.classList.add('visible');
    el.classList.toggle('success', isSuccess);
  }
  if (!isSuccess && safeMsg) {
    notifyUser(safeMsg, 'error');
  }
}

function clearAlert() {
  const el = document.getElementById('form-alert');
  if (!el) return;
  el.textContent = '';
  el.classList.remove('visible', 'success');
}

function setFieldError(id, msg) {
  const el = document.getElementById(id);
  if (el) el.textContent = msg;
}

function setButtonBusy(btn, busy, busyLabel = 'Processing...') {
  if (!btn) return;
  if (busy) {
    if (!btn.dataset.originalHtml) {
      btn.dataset.originalHtml = btn.innerHTML;
    }
    btn.disabled = true;
    btn.innerHTML = `<span class="nx-spinner" aria-hidden="true"></span><span>${busyLabel}</span>`;
    btn.style.display = 'inline-flex';
    btn.style.alignItems = 'center';
    btn.style.justifyContent = 'center';
    btn.style.gap = '8px';
  } else {
    btn.disabled = false;
    if (btn.dataset.originalHtml) {
      btn.innerHTML = btn.dataset.originalHtml;
    }
  }
}

async function checkRateLimit(kind, identifier) {
  try {
    const res = await fetch('/api/auth/rate-check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, identifier }),
    });
    if (res.status === 429) {
      throw new Error('Site is busy right now. Please wait a moment before retrying.');
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('Site is busy')) throw err;
  }
}

function initPasswordToggles() {
  document.querySelectorAll('.toggle-password[data-toggle-for]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-toggle-for');
      const input = targetId ? document.getElementById(targetId) : null;
      if (!(input instanceof HTMLInputElement)) return;
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.setAttribute('aria-pressed', String(show));
      btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    });
  });
}

function initMethodTabs() {
  const tabs = document.querySelectorAll('.method-tab[data-auth-method]');
  const emailContainer = document.getElementById('email-section-container');
  const phoneForm = document.getElementById('phone-auth-form');
  if (!tabs.length || !emailContainer || !phoneForm) return;

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      clearAlert();
      const method = tab.getAttribute('data-auth-method');
      tabs.forEach((t) => t.setAttribute('aria-selected', String(t === tab)));
      emailContainer.hidden = method !== 'email';
      phoneForm.hidden = method !== 'phone';
    });
  });
}

function initSubmethodTabs() {
  const subtabs = document.querySelectorAll('.submethod-tab[data-email-mode]');
  const passwordForm = document.getElementById('email-password-form');
  const linkForm = document.getElementById('email-link-form');
  if (!subtabs.length || !passwordForm) return;

  subtabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      clearAlert();
      const mode = tab.getAttribute('data-email-mode');
      subtabs.forEach((t) => t.setAttribute('aria-selected', String(t === tab)));
      passwordForm.hidden = mode !== 'password';
      if (linkForm) linkForm.hidden = mode !== 'link';
    });
  });
}

function initGoogleButton() {
  const btn = document.getElementById('google-auth-btn');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    clearAlert();
    setButtonBusy(btn, true, 'Processing...');
    authFlowInProgress = true;
    try {
      const cred = await signInWithPopup(auth, googleProvider);
      try {
        await ensureUserProfile(cred.user);
      } catch (profileErr) {
        console.warn('Profile sync note:', profileErr);
      }
      showAlert('Signed in with Google. Opening NEXORA...', true);
      window.location.replace(getPostAuthDestination('/app.html'));
    } catch (err) {
      authFlowInProgress = false;
      showAlert(formatFirebaseAuthError(err));
      setButtonBusy(btn, false);
    }
  });
}

function startCooldownTimer(btn, setTimerRef, defaultSeconds = 60) {
  if (!btn) return;
  let remaining = defaultSeconds;
  btn.disabled = true;
  btn.textContent = `Resend (${remaining}s)`;
  const timer = setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) {
      clearInterval(timer);
      btn.disabled = false;
      btn.textContent = 'Resend OTP';
    } else {
      btn.textContent = `Resend (${remaining}s)`;
    }
  }, 1000);
  setTimerRef(timer);
}

function initEmailOtpFlow() {
  // Removed broken in-memory Email OTP handler; Email + Password and Sign-In Link are used instead.
}

function initPasswordlessLinkForm() {
  const form = document.getElementById('email-link-form');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearAlert();
    setFieldError('err-email-link', '');
    const email = document.getElementById('email-link-address')?.value?.trim().toLowerCase() || '';
    const submitBtn = document.getElementById('send-email-link-btn');

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setFieldError('err-email-link', 'Enter a valid email address.');
      return;
    }

    setButtonBusy(submitBtn, true, 'Sending sign-in link...');
    try {
      await checkRateLimit('email-link', email);
      await sendSignInLinkToEmail(auth, email, {
        url: `${window.location.origin}/login.html`,
        handleCodeInApp: true,
      });
      window.localStorage.setItem('emailForSignIn', email);
      showAlert(`Passwordless sign-in link sent to ${email}. Open the link from your inbox on this device.`, true);
    } catch (err) {
      showAlert(formatFirebaseAuthError(err));
    } finally {
      setButtonBusy(submitBtn, false);
    }
  });
}

function initPasswordAuthFlow() {
  const form = document.getElementById('email-password-form');
  if (!form) return;

  const isSignup = document.body.dataset.page === 'signup';

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearAlert();
    setFieldError('err-email', '');
    setFieldError('err-password', '');
    if (isSignup) setFieldError('err-display', '');

    const email = document.getElementById('auth-email')?.value?.trim() || '';
    const password = document.getElementById('auth-password')?.value || '';
    const displayName = document.getElementById('signup-display')?.value?.trim() || '';
    const submitBtn = document.getElementById('email-password-submit-btn');

    if (isSignup && displayName.length < 2) {
      setFieldError('err-display', 'Display name must be at least 2 characters.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setFieldError('err-email', 'Enter a valid email address.');
      return;
    }
    if (password.length < 6) {
      setFieldError('err-password', 'Password must be at least 6 characters.');
      return;
    }

    setButtonBusy(submitBtn, true, 'Processing...');
    authFlowInProgress = true;
    try {
      if (isSignup) {
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        await updateProfile(cred.user, { displayName }).catch(() => {});
        try {
          await ensureUserProfile(cred.user, { displayName });
        } catch (profileErr) {
          console.warn('Profile sync note:', profileErr);
        }
        await sendEmailVerification(cred.user).catch((verErr) => {
          console.warn('Verification email note:', verErr?.code || verErr?.message);
        });
        showAlert('Account created! Opening NEXORA...', true);
        window.location.replace(getPostAuthDestination('/app.html'));
      } else {
        const cred = await signInWithEmailAndPassword(auth, email, password);
        try {
          await ensureUserProfile(cred.user);
        } catch (profileErr) {
          console.warn('Profile sync note:', profileErr);
        }
        showAlert('Signed in! Opening NEXORA...', true);
        window.location.replace(getPostAuthDestination('/app.html'));
      }
    } catch (err) {
      authFlowInProgress = false;
      showAlert(formatFirebaseAuthError(err));
      setButtonBusy(submitBtn, false);
    }
  });
}

function getRecaptchaVerifier() {
  const container = document.getElementById('recaptcha-container');
  if (!container) return null;
  if (!recaptchaVerifierInstance) {
    recaptchaVerifierInstance = new RecaptchaVerifier(auth, 'recaptcha-container', {
      size: 'normal',
      callback: () => {},
      'expired-callback': () => {
        showAlert('Verification challenge expired. Please solve it again.');
      },
    });
  }
  return recaptchaVerifierInstance;
}

function initPhoneAuthForm() {
  const form = document.getElementById('phone-auth-form');
  if (!form) return;

  const sendOtpBtn = document.getElementById('send-otp-btn');
  const resendOtpBtn = document.getElementById('resend-otp-btn');
  const otpStep = document.getElementById('otp-step');
  const verifyOtpBtn = document.getElementById('verify-otp-btn');
  const codeSelect = document.getElementById('phone-country');
  const numInput = document.getElementById('phone-number');
  const otpInput = document.getElementById('otp-code');
  const displayInput = document.getElementById('phone-signup-display');

  async function dispatchSmsOtp() {
    clearAlert();
    setFieldError('err-phone', '');
    const country = codeSelect instanceof HTMLSelectElement ? codeSelect.value : '+1';
    const rawNum = numInput instanceof HTMLInputElement ? numInput.value.replace(/[^\d]/g, '') : '';
    if (rawNum.length < 7) {
      setFieldError('err-phone', 'Enter a valid phone number.');
      return;
    }
    const fullPhone = `${country}${rawNum}`;

    try {
      setButtonBusy(sendOtpBtn, true, 'Sending SMS...');
      await checkRateLimit('otp', fullPhone);
      const verifier = getRecaptchaVerifier();
      if (!verifier) throw new Error('Phone verification is temporarily unavailable.');
      phoneConfirmationResult = await signInWithPhoneNumber(auth, fullPhone, verifier);
      if (otpStep) otpStep.hidden = false;
      if (sendOtpBtn) sendOtpBtn.hidden = true;
      startCooldownTimer(resendOtpBtn, (t) => {
        clearInterval(phoneOtpCooldownTimer);
        phoneOtpCooldownTimer = t;
      }, 60);
      showAlert(`OTP sent via SMS to ${fullPhone}.`, true);
      if (otpInput instanceof HTMLInputElement) otpInput.focus();
    } catch (err) {
      showAlert(formatFirebaseAuthError(err));
      if (recaptchaVerifierInstance) {
        recaptchaVerifierInstance.clear();
        recaptchaVerifierInstance = null;
      }
    } finally {
      setButtonBusy(sendOtpBtn, false);
    }
  }

  sendOtpBtn?.addEventListener('click', dispatchSmsOtp);
  resendOtpBtn?.addEventListener('click', dispatchSmsOtp);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!phoneConfirmationResult) {
      await dispatchSmsOtp();
      return;
    }
    clearAlert();
    setFieldError('err-otp', '');
    const code = otpInput instanceof HTMLInputElement ? otpInput.value.trim() : '';
    if (!/^\d{6}$/.test(code)) {
      setFieldError('err-otp', 'Enter the 6-digit SMS OTP code.');
      return;
    }

    setButtonBusy(verifyOtpBtn, true, 'Processing...');
    try {
      const cred = await phoneConfirmationResult.confirm(code);
      const displayName = displayInput instanceof HTMLInputElement ? displayInput.value.trim() : '';
      if (displayName && cred.user) {
        await updateProfile(cred.user, { displayName }).catch(() => {});
      }
      await ensureUserProfile(cred.user, { displayName });
      showAlert('Phone verified! Launching NEXORA...', true);
      window.location.replace(getPostAuthDestination('/app.html'));
    } catch (err) {
      showAlert(formatFirebaseAuthError(err));
      setButtonBusy(verifyOtpBtn, false);
    }
  });
}

function initEmailLinkDetection() {
  if (!isSignInWithEmailLink(auth, window.location.href)) return;

  authFlowInProgress = true;
  const storedEmail = window.localStorage.getItem('emailForSignIn');
  const finishWithEmail = async (email) => {
    try {
      const cred = await signInWithEmailLink(auth, email, window.location.href);
      window.localStorage.removeItem('emailForSignIn');
      try {
        await ensureUserProfile(cred.user);
      } catch (profileErr) {
        console.warn('Profile sync note:', profileErr);
      }
      showAlert('Signed in via email link! Opening NEXORA...', true);
      window.location.replace(getPostAuthDestination('/app.html'));
    } catch (err) {
      authFlowInProgress = false;
      showAlert(formatFirebaseAuthError(err));
    }
  };

  if (storedEmail) {
    finishWithEmail(storedEmail);
    return;
  }

  const confirmBox = document.getElementById('email-link-confirm-box');
  const confirmForm = document.getElementById('email-link-confirm-form');
  if (confirmBox && confirmForm) {
    const gate = document.getElementById('auth-session-gate');
    const content = document.getElementById('auth-page-content');
    if (gate) gate.hidden = true;
    if (content) content.hidden = false;
    confirmBox.hidden = false;
    confirmForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = document.getElementById('email-link-confirm-input');
      const email = input instanceof HTMLInputElement ? input.value.trim().toLowerCase() : '';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        showAlert('Please enter the email address that requested the sign-in link.');
        return;
      }
      await finishWithEmail(email);
    });
  }
}

function initVerifyPage() {
  if (document.body.dataset.page !== 'verify') return;
  const emailTarget = document.getElementById('verify-email-address');
  const resendBtn = document.getElementById('resend-verify-btn');
  const checkBtn = document.getElementById('check-verify-btn');
  const logoutBtn = document.getElementById('verify-logout-btn');

  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      window.location.replace('/login.html');
      return;
    }
    if (emailTarget) emailTarget.textContent = user.email || 'your email address';
    if (await resolveVerifiedSession(user)) {
      window.location.replace(getPostAuthDestination('/app.html'));
    }
  });

  resendBtn?.addEventListener('click', async () => {
    clearAlert();
    const user = auth.currentUser;
    if (!user) return;
    try {
      await checkRateLimit('verify', user.email || user.uid);
      await sendEmailVerification(user);
      startCooldownTimer(resendBtn, () => {}, 60);
      showAlert('Verification link resent! Check your inbox or spam folder.', true);
    } catch (err) {
      showAlert(formatFirebaseAuthError(err));
    }
  });

  checkBtn?.addEventListener('click', async () => {
    clearAlert();
    const user = auth.currentUser;
    if (!user) return;
    setButtonBusy(checkBtn, true, 'Checking...');
    try {
      await user.reload();
      if (isUserVerified(user)) {
        showAlert('Email verified! Opening NEXORA...', true);
        window.location.replace(getPostAuthDestination('/app.html'));
      } else {
        showAlert('Email is not verified yet. Please click the verification link sent to your inbox.');
        setButtonBusy(checkBtn, false);
      }
    } catch (err) {
      showAlert(formatFirebaseAuthError(err));
      setButtonBusy(checkBtn, false);
    }
  });

  logoutBtn?.addEventListener('click', async () => {
    await signOut(auth);
    window.location.replace('/login.html');
  });
}

function initForgotPasswordPage() {
  const form = document.getElementById('forgot-form');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearAlert();
    setFieldError('err-email', '');
    const email = document.getElementById('forgot-email')?.value?.trim() || '';
    const submitBtn = document.getElementById('forgot-submit-btn');

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setFieldError('err-email', 'Enter a valid email address.');
      return;
    }

    setButtonBusy(submitBtn, true, 'Sending...');
    try {
      await checkRateLimit('reset', email);
      await sendPasswordResetEmail(auth, email);
      showAlert(`Password reset email sent to ${email}.`, true);
    } catch (err) {
      showAlert(formatFirebaseAuthError(err));
    } finally {
      setButtonBusy(submitBtn, false);
    }
  });
}

function initResetPasswordPage() {
  const form = document.getElementById('reset-form');
  if (!form) return;

  const params = new URLSearchParams(window.location.search);
  const oobCode = params.get('oobCode') || '';
  const emailBanner = document.getElementById('reset-email-banner');

  if (!oobCode) {
    showAlert('Missing reset code. Please request a fresh password reset link.');
  } else {
    verifyPasswordResetCode(auth, oobCode)
      .then((email) => {
        if (emailBanner) emailBanner.textContent = `Resetting password for ${email}`;
      })
      .catch((err) => showAlert(formatFirebaseAuthError(err)));
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearAlert();
    setFieldError('err-password', '');
    const password = document.getElementById('reset-password')?.value || '';
    if (password.length < 6) {
      setFieldError('err-password', 'Password must be at least 6 characters.');
      return;
    }
    try {
      await confirmPasswordReset(auth, oobCode, password);
      showAlert('Password updated! Redirecting to sign in...', true);
      setTimeout(() => {
        window.location.replace('/login.html');
      }, 1000);
    } catch (err) {
      showAlert(formatFirebaseAuthError(err));
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  const page = document.body.dataset.page || '';
  if (['login', 'signup', 'forgot', 'reset'].includes(page)) {
    redirectIfAuthenticated({ defaultTarget: '/app.html', shouldRedirect: () => !authFlowInProgress });
  }

  try {
    const reason = new URLSearchParams(window.location.search).get('reason');
    if (reason === 'busy') {
      notifyUser('You cannot enter right now or the site is busy. Please try signing in again.', 'busy');
    }
  } catch {}

  initPasswordToggles();
  initMethodTabs();
  initSubmethodTabs();
  initGoogleButton();
  initEmailOtpFlow();
  initPasswordlessLinkForm();
  initPasswordAuthFlow();
  initPhoneAuthForm();
  initEmailLinkDetection();
  initVerifyPage();
  initForgotPasswordPage();
  initResetPasswordPage();
});
