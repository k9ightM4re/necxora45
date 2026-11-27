import React, { useState } from 'react';
import { useNexora } from '../../context/NexoraContext';
import { googleSignIn } from '../../services/firebase';
import { X, Eye, EyeOff, AlertCircle, Loader2, Mail, CheckCircle2, Shield } from 'lucide-react';

export const AuthModal: React.FC = () => {
  const { activeModal, closeModal, setCurrentUser, addMember, serverMembers, switchCurrentUser } = useNexora();
  const [isRegister, setIsRegister] = useState(false);
  const [authMode, setAuthMode] = useState<'password' | 'otp'>('password');
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Dedicated login-otp states
  const [otpEmailInput, setOtpEmailInput] = useState('');
  const [otpCodeInput, setOtpCodeInput] = useState('');
  const [otpStep, setOtpStep] = useState<'request' | 'verify'>('request');
  const [isSendingOtp, setIsSendingOtp] = useState(false);
  const [isVerifyingOtp, setIsVerifyingOtp] = useState(false);
  const [devOtpCode, setDevOtpCode] = useState<string | null>(null);
  const [otpSuccessMsg, setOtpSuccessMsg] = useState<string | null>(null);

  if (activeModal !== 'auth') return null;

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);

    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password.trim()) {
      setAuthError('Please enter both your email/username and password.');
      return;
    }

    const baseUsername = trimmedEmail.includes('@')
      ? trimmedEmail.split('@')[0].toLowerCase().replace(/[^a-z0-9_]/g, '')
      : trimmedEmail.toLowerCase().replace(/[^a-z0-9_]/g, '');

    if (isRegister) {
      const cleanName = displayName.trim() || baseUsername || 'Member';
      const newMember = addMember({
        username: baseUsername || `user_${Date.now().toString().slice(-4)}`,
        displayName: cleanName,
        avatar: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&auto=format&fit=crop&q=80',
        bio: 'NEXORA Community Member',
        status: 'online',
        customStatus: 'Just joined NEXORA',
        badges: ['✨ Member'],
        roleTitle: 'Member',
        accentColor: '#7667F7',
      });
      switchCurrentUser(newMember);
    } else {
      const existing = serverMembers.find(
        m => m.username.toLowerCase() === baseUsername || m.displayName.toLowerCase() === trimmedEmail.toLowerCase()
      );
      if (existing) {
        switchCurrentUser(existing);
      } else {
        setCurrentUser(prev => ({
          ...prev,
          username: baseUsername || prev.username,
          displayName: baseUsername || prev.displayName,
          status: 'online',
        }));
      }
    }

    setEmail('');
    setDisplayName('');
    setPassword('');
    closeModal();
  };

  const handleGoogleLogin = async () => {
    setAuthError(null);
    setIsGoogleLoading(true);
    try {
      const res = await googleSignIn();
      const username = res.email
        ? res.email.split('@')[0].toLowerCase().replace(/[^a-z0-9_]/g, '')
        : res.displayName.toLowerCase().replace(/[^a-z0-9_]/g, '');

      setCurrentUser(prev => ({
        ...prev,
        id: res.uid || prev.id,
        displayName: res.displayName,
        username: username || prev.username,
        avatar: res.photoURL,
        status: 'online',
        roleTitle: 'Verified Google User',
        badges: ['✅ Google Verified'],
      }));
      closeModal();
    } catch (err: any) {
      setAuthError(err?.message || 'Google Sign-In failed. Please try again.');
    } finally {
      setIsGoogleLoading(false);
    }
  };

  const handleSendEmailOtp = async () => {
    setAuthError(null);
    setOtpSuccessMsg(null);
    const trimmed = otpEmailInput.trim().toLowerCase();
    if (!trimmed || !trimmed.includes('@')) {
      setAuthError('Please enter a valid email address for OTP verification.');
      return;
    }

    setIsSendingOtp(true);
    try {
      const res = await fetch('/api/auth/send-email-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: trimmed, kind: isRegister ? 'signup' : 'login' }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to send OTP code.');
      }

      setDevOtpCode(data.devCode || null);
      setOtpStep('verify');
      setOtpSuccessMsg(`Verification code sent to ${trimmed}.`);
    } catch (err: any) {
      setAuthError(err?.message || 'Could not send verification OTP.');
    } finally {
      setIsSendingOtp(false);
    }
  };

  const handleVerifyEmailOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setOtpSuccessMsg(null);

    const trimmedEmail = otpEmailInput.trim().toLowerCase();
    const code = otpCodeInput.trim();

    if (!/^\d{6}$/.test(code)) {
      setAuthError('Please enter the valid 6-digit verification code.');
      return;
    }

    setIsVerifyingOtp(true);
    setOtpSuccessMsg('Verifying code & establishing secure session...');
    try {
      const res = await fetch('/api/auth/verify-email-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: trimmedEmail, otp: code }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Invalid or expired OTP code.');
      }

      setOtpSuccessMsg('Authentication successful! Launching workspace...');
      const baseUsername = trimmedEmail.split('@')[0].toLowerCase().replace(/[^a-z0-9_]/g, '');
      const newMember = addMember({
        username: baseUsername || `user_${Date.now().toString().slice(-4)}`,
        displayName: baseUsername || 'OTP Member',
        avatar: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&auto=format&fit=crop&q=80',
        bio: 'Verified via Email OTP',
        status: 'online',
        customStatus: 'Authenticated via Email OTP',
        badges: ['🛡️ OTP Verified'],
        roleTitle: 'Verified Member',
        accentColor: '#16A34A',
      });
      switchCurrentUser(newMember);
      setTimeout(() => {
        closeModal();
      }, 400);
    } catch (err: any) {
      setAuthError(err?.message || 'OTP verification failed.');
      setIsVerifyingOtp(false);
      setOtpSuccessMsg(null);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-modal-title"
    >
      <div className="bg-[#191C24] border border-[#2b303d] rounded-3xl w-full max-w-2xl overflow-hidden shadow-2xl relative select-none flex flex-col md:flex-row">
        {/* Close Button */}
        <button
          type="button"
          onClick={closeModal}
          aria-label="Close sign in dialog"
          className="absolute top-4 right-4 z-20 p-1.5 rounded-full bg-black/40 text-[#9B9EAC] hover:text-white transition-colors cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Left: Login Form */}
        <div className="flex-1 p-6 md:p-8 space-y-4">
          <div>
            <h2 id="auth-modal-title" className="text-xl font-extrabold text-white">
              {isRegister ? 'Create an account' : 'Welcome back!'}
            </h2>
            <p className="text-xs text-[#9B9EAC] mt-1">
              {isRegister
                ? 'Join NEXORA and connect with your communities!'
                : "We're so excited to see you again!"}
            </p>
          </div>

          {authError && (
            <div className="p-3 rounded-xl bg-[#EF4444]/15 border border-[#EF4444]/40 text-xs text-[#FCA5A5] flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-[#EF4444] flex-shrink-0 mt-0.5" />
              <span>{authError}</span>
            </div>
          )}

          {otpSuccessMsg && (
            <div className="p-3 rounded-xl bg-[#16A34A]/15 border border-[#16A34A]/40 text-xs text-[#86EFAC] flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 text-[#16A34A] flex-shrink-0 mt-0.5" />
              <span>{otpSuccessMsg}</span>
            </div>
          )}

          {/* Google Workspace Sign-In */}
          <button
            type="button"
            onClick={handleGoogleLogin}
            disabled={isGoogleLoading}
            className="w-full h-11 bg-white text-[#1f232f] hover:bg-gray-100 disabled:opacity-60 rounded-xl font-bold text-xs flex items-center justify-center gap-3 shadow-lg transition-colors cursor-pointer"
          >
            {isGoogleLoading ? (
              <Loader2 className="w-4 h-4 animate-spin text-[#4285F4]" />
            ) : (
              <svg className="w-4 h-4" viewBox="0 0 48 48" aria-hidden="true">
                <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
                <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
                <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
                <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
              </svg>
            )}
            <span>{isGoogleLoading ? 'Connecting to Google...' : 'Continue with Google'}</span>
          </button>

          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-[#262A36]" />
            <span className="text-[10px] font-bold text-[#717585] uppercase tracking-wider">or</span>
            <div className="flex-1 h-px bg-[#262A36]" />
          </div>

          {/* Mode Switcher: Password vs Login OTP */}
          <div className="grid grid-cols-2 gap-1 bg-[#111318] p-1 rounded-xl border border-[#262A36]">
            <button
              type="button"
              onClick={() => { setAuthMode('password'); setAuthError(null); }}
              className={`py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                authMode === 'password' ? 'bg-[#7667F7] text-white shadow' : 'text-[#9B9EAC] hover:text-white'
              }`}
            >
              🔑 Password
            </button>
            <button
              type="button"
              onClick={() => { setAuthMode('otp'); setAuthError(null); }}
              className={`py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                authMode === 'otp' ? 'bg-[#7667F7] text-white shadow' : 'text-[#9B9EAC] hover:text-white'
              }`}
            >
              ✉️ Email OTP
            </button>
          </div>

          {authMode === 'password' ? (
            <form onSubmit={handleLogin} className="space-y-3">
              {isRegister && (
                <div>
                  <label
                    htmlFor="auth-display-name"
                    className="block text-[10px] font-extrabold text-[#717585] uppercase tracking-wider mb-1"
                  >
                    DISPLAY NAME
                  </label>
                  <input
                    id="auth-display-name"
                    type="text"
                    required
                    value={displayName}
                    onChange={e => setDisplayName(e.target.value)}
                    placeholder="Your display name"
                    className="w-full bg-[#111318] border border-[#262A36] focus:border-[#7667F7] rounded-xl px-3 py-2 text-xs text-white focus:outline-none"
                  />
                </div>
              )}

              <div>
                <label
                  htmlFor="auth-email"
                  className="block text-[10px] font-extrabold text-[#717585] uppercase tracking-wider mb-1"
                >
                  EMAIL OR USERNAME
                </label>
                <input
                  id="auth-email"
                  type="text"
                  required
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="name@example.com"
                  className="w-full bg-[#111318] border border-[#262A36] focus:border-[#7667F7] rounded-xl px-3 py-2 text-xs text-white focus:outline-none"
                />
              </div>

              <div>
                <label
                  htmlFor="auth-password"
                  className="block text-[10px] font-extrabold text-[#717585] uppercase tracking-wider mb-1"
                >
                  PASSWORD
                </label>
                <div className="relative">
                  <input
                    id="auth-password"
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    className="w-full bg-[#111318] border border-[#262A36] focus:border-[#7667F7] rounded-xl px-3 pr-9 py-2 text-xs text-white focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute right-3 top-2.5 text-[#717585] hover:text-white cursor-pointer"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                className="w-full py-2.5 bg-[#7667F7] hover:bg-[#6353f4] text-xs font-bold text-white rounded-xl shadow-lg shadow-[#7667F7]/30 transition-all mt-2 cursor-pointer"
              >
                {isRegister ? 'Create Account' : 'Log In'}
              </button>
            </form>
          ) : (
            /* Dedicated 'login-otp' sub-view */
            <div className="space-y-3">
              <div>
                <label
                  htmlFor="login-otp-email"
                  className="block text-[10px] font-extrabold text-[#717585] uppercase tracking-wider mb-1"
                >
                  PHONE / EMAIL INPUT FIELD
                </label>
                <div className="relative">
                  <Mail className="absolute left-3 top-2.5 w-4 h-4 text-[#717585]" />
                  <input
                    id="login-otp-email"
                    type="email"
                    value={otpEmailInput}
                    onChange={e => setOtpEmailInput(e.target.value)}
                    placeholder="you@example.com"
                    disabled={otpStep === 'verify'}
                    className="w-full bg-[#111318] border border-[#262A36] focus:border-[#7667F7] rounded-xl pl-9 pr-3 py-2 text-xs text-white focus:outline-none disabled:opacity-60"
                  />
                </div>
              </div>

              {otpStep === 'request' ? (
                <button
                  type="button"
                  onClick={handleSendEmailOtp}
                  disabled={isSendingOtp}
                  className="w-full py-2.5 bg-[#7667F7] hover:bg-[#6353f4] text-xs font-bold text-white rounded-xl shadow-lg shadow-[#7667F7]/30 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
                >
                  {isSendingOtp ? <Loader2 className="w-4 h-4 animate-spin" /> : <Shield className="w-4 h-4" />}
                  <span>{isSendingOtp ? 'Sending OTP...' : 'Send Email OTP Code'}</span>
                </button>
              ) : (
                <form onSubmit={handleVerifyEmailOtp} className="space-y-3">
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label
                        htmlFor="login-otp-code"
                        className="block text-[10px] font-extrabold text-[#717585] uppercase tracking-wider"
                      >
                        6-DIGIT OTP VERIFICATION CODE
                      </label>
                      <button
                        type="button"
                        onClick={() => { setOtpStep('request'); setOtpCodeInput(''); setDevOtpCode(null); }}
                        className="text-[10px] text-[#7667F7] hover:underline cursor-pointer"
                      >
                        Change Email
                      </button>
                    </div>
                    <input
                      id="login-otp-code"
                      type="text"
                      inputMode="numeric"
                      maxLength={6}
                      required
                      disabled={isVerifyingOtp}
                      value={otpCodeInput}
                      onChange={e => setOtpCodeInput(e.target.value)}
                      placeholder="000000"
                      className="w-full bg-[#111318] border border-[#262A36] focus:border-[#7667F7] rounded-xl px-3 py-2.5 text-sm font-mono tracking-widest text-center text-white focus:outline-none disabled:opacity-50"
                    />
                  </div>

                  {devOtpCode && (
                    <div className="p-2.5 bg-[#7667F7]/10 border border-[#7667F7]/30 rounded-xl text-[11px] text-[#A5B4FC] flex items-center justify-between">
                      <span>Test / Preview Code:</span>
                      <code className="font-mono font-bold tracking-widest bg-black/40 px-2 py-0.5 rounded text-white">{devOtpCode}</code>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={isVerifyingOtp}
                    className="w-full py-2.5 bg-[#16A34A] hover:bg-[#15803D] text-xs font-bold text-white rounded-xl shadow-lg shadow-[#16A34A]/30 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
                  >
                    {isVerifyingOtp ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                    <span>{isVerifyingOtp ? 'Processing verification...' : 'Verify OTP & Log In'}</span>
                  </button>
                </form>
              )}
            </div>
          )}

          <p className="text-xs text-[#9B9EAC]">
            {isRegister ? 'Already have an account? ' : 'Need an account? '}
            <button
              type="button"
              onClick={() => {
                setIsRegister(!isRegister);
                setAuthError(null);
              }}
              className="text-[#7667F7] font-semibold hover:underline cursor-pointer"
            >
              {isRegister ? 'Log In' : 'Register'}
            </button>
          </p>
        </div>

        {/* Right: QR Code Login preview */}
        <div className="w-full md:w-64 bg-[#111318] p-6 md:p-8 flex flex-col items-center justify-center text-center border-t md:border-t-0 md:border-l border-[#262A36]">
          <div className="p-3 bg-white rounded-2xl shadow-xl mb-4">
            <svg className="w-36 h-36" viewBox="0 0 100 100" aria-label="QR Code for mobile sign in">
              <rect width="100" height="100" fill="white" />
              <rect x="10" y="10" width="24" height="24" fill="black" />
              <rect x="14" y="14" width="16" height="16" fill="white" />
              <rect x="18" y="18" width="8" height="8" fill="black" />

              <rect x="66" y="10" width="24" height="24" fill="black" />
              <rect x="70" y="14" width="16" height="16" fill="white" />
              <rect x="74" y="18" width="8" height="8" fill="black" />

              <rect x="10" y="66" width="24" height="24" fill="black" />
              <rect x="14" y="70" width="16" height="16" fill="white" />
              <rect x="18" y="74" width="8" height="8" fill="black" />

              <rect x="42" y="10" width="16" height="10" fill="black" />
              <rect x="42" y="24" width="10" height="10" fill="black" />
              <rect x="10" y="42" width="10" height="16" fill="black" />
              <rect x="24" y="42" width="10" height="10" fill="black" />
              <rect x="42" y="42" width="16" height="16" fill="#7667F7" />
              <rect x="66" y="42" width="12" height="12" fill="black" />
              <rect x="82" y="42" width="8" height="16" fill="black" />
              <rect x="42" y="66" width="10" height="24" fill="black" />
              <rect x="56" y="74" width="16" height="16" fill="black" />
              <rect x="76" y="66" width="14" height="10" fill="black" />
            </svg>
          </div>

          <h3 className="text-sm font-extrabold text-white">Log in with QR Code</h3>
          <p className="text-[11px] text-[#9B9EAC] mt-1">
            Scan this with the <b>NEXORA mobile app</b> to log in instantly.
          </p>
        </div>
      </div>
    </div>
  );
};
