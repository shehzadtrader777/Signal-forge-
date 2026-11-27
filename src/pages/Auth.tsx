import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  signInWithGoogle,
  signInWithEmail,
  signUpWithEmail,
} from '../lib/firebase';
import { formatFirebaseAuthError } from '../lib/firebaseAuthErrors';
import { useApp } from '../context/AppContext';

export function Auth() {
  const { user } = useApp();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [mode, setMode] = useState<'login' | 'signup'>(() => searchParams.get('mode') === 'signup' ? 'signup' : 'login');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleGoogle = async () => {
    setError(null);
    setInfo(null);
    setSubmitting(true);
    try {
      await signInWithGoogle();
      navigate('/');
    } catch (err: unknown) {
      const formatted = formatFirebaseAuthError(err);
      if (formatted.severity === 'info') {
        setInfo(formatted.message);
      } else {
        setError(formatted.message);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);

    if (!email.trim() || !password.trim()) {
      setError('Email and password are required.');
      return;
    }

    setSubmitting(true);
    try {
      if (mode === 'signup') {
        await signUpWithEmail(email.trim(), password, displayName);
        setInfo(
          'Account created. A verification email has been sent—please verify your email to enable cloud Firestore sync.'
        );
      } else {
        const loggedUser = await signInWithEmail(email.trim(), password);
        if (!loggedUser.emailVerified) {
          setInfo('Signed in. Please verify your email address for Firestore cloud sync.');
        } else {
          navigate('/');
        }
      }
    } catch (err: unknown) {
      const formatted = formatFirebaseAuthError(err);
      if (formatted.severity === 'info') {
        setInfo(formatted.message);
      } else {
        setError(formatted.message);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-md px-4 py-14">
      <div className="rounded-xl border border-slate-800/90 bg-[#111827] p-6 sm:p-8 space-y-6">
        <div>
          <span className="text-xs font-medium text-[#3b82f6]">Signal Forge Account</span>
          <h1 className="mt-1 font-display text-2xl font-bold text-white">
            {user
              ? 'Account Connected'
              : mode === 'login'
              ? 'Sign In to Signal Forge'
              : 'Create Trader Account'}
          </h1>
          <p className="mt-1 text-xs text-slate-400">
            Sync your Watchlist and Price Alerts securely with Firebase.
          </p>
        </div>

        {user && (
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 text-xs text-emerald-200 space-y-2">
            <p className="font-semibold">
              Signed in as {user.displayName || user.email}
            </p>
            <button
              type="button"
              onClick={() => navigate('/watchlist')}
              className="rounded-lg bg-[#3b82f6] px-4 py-2 text-xs font-semibold text-white hover:bg-blue-500 cursor-pointer"
            >
              Go to Watchlist
            </button>
          </div>
        )}

        <button
          type="button"
          disabled={submitting}
          onClick={handleGoogle}
          className="w-full flex items-center justify-center gap-2.5 rounded-lg bg-white px-4 py-2.5 text-xs font-bold text-slate-900 hover:bg-slate-100 transition-colors cursor-pointer"
        >
          <span>Continue with Google</span>
        </button>

        <div className="relative flex items-center py-1">
          <div className="flex-grow border-t border-slate-800" />
          <span className="mx-3 shrink text-[11px] text-slate-500">or use email</span>
          <div className="flex-grow border-t border-slate-800" />
        </div>

        <div className="flex rounded-lg border border-slate-800 bg-[#0a0e1a] p-1 text-xs">
          <button
            type="button"
            onClick={() => {
              setMode('login');
              setError(null);
            }}
            className={`flex-1 rounded-md py-1.5 font-semibold cursor-pointer ${
              mode === 'login' ? 'bg-[#3b82f6] text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            Sign In
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('signup');
              setError(null);
            }}
            className={`flex-1 rounded-md py-1.5 font-semibold cursor-pointer ${
              mode === 'signup' ? 'bg-[#3b82f6] text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            Sign Up
          </button>
        </div>

        <form onSubmit={handleEmailSubmit} className="space-y-4">
          {mode === 'signup' && (
            <div>
              <label htmlFor="auth-name" className="block text-xs font-medium text-slate-300 mb-1">
                Full Name
              </label>
              <input
                id="auth-name"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Amir Shehzad"
                className="w-full rounded-lg border border-slate-700 bg-[#0a0e1a] px-3 py-2 text-xs text-white focus:border-[#3b82f6] focus:outline-none"
              />
            </div>
          )}

          <div>
            <label htmlFor="auth-email" className="block text-xs font-medium text-slate-300 mb-1">
              Email Address
            </label>
            <input
              id="auth-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="trader@example.com"
              className="w-full rounded-lg border border-slate-700 bg-[#0a0e1a] px-3 py-2 text-xs text-white focus:border-[#3b82f6] focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="auth-password" className="block text-xs font-medium text-slate-300 mb-1">
              Password
            </label>
            <input
              id="auth-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Minimum 6 characters"
              className="w-full rounded-lg border border-slate-700 bg-[#0a0e1a] px-3 py-2 text-xs text-white focus:border-[#3b82f6] focus:outline-none"
            />
          </div>

          {error && (
            <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300" role="alert">
              {error}
            </p>
          )}
          {info && (
            <p className="rounded-lg border border-blue-500/30 bg-blue-500/10 p-3 text-xs text-blue-200" role="status">
              {info}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-lg bg-[#3b82f6] px-4 py-2.5 text-xs font-semibold text-white hover:bg-blue-500 transition-colors cursor-pointer"
          >
            {submitting
              ? 'Processing...'
              : mode === 'login'
              ? 'Sign In with Email'
              : 'Create Account'}
          </button>
        </form>
      </div>
    </div>
  );
}
