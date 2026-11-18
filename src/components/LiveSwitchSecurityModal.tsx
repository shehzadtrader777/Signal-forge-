import { useState } from 'react';
import { KeyRound, Mail, ShieldAlert, X } from 'lucide-react';
import { type LiveOtpChallengeState, useApp } from '../context/AppContext';

interface LiveSwitchSecurityModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export function LiveSwitchSecurityModal({
  open,
  onClose,
  onSuccess,
}: LiveSwitchSecurityModalProps) {
  const { requestLiveSwitchOtp, confirmSwitchToLive } = useApp();
  const [challenge, setChallenge] = useState<LiveOtpChallengeState | null>(null);
  const [securityAnswer, setSecurityAnswer] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [sendingOtp, setSendingOtp] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const handleRequestOtp = async () => {
    setError(null);
    setSendingOtp(true);
    try {
      const res = await requestLiveSwitchOtp();
      if (!res.ok || !res.challenge) {
        setError(res.error || 'Could not dispatch email OTP challenge.');
        return;
      }
      setChallenge(res.challenge);
    } finally {
      setSendingOtp(false);
    }
  };

  const handleVerifySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!securityAnswer.trim().includes('?')) {
      setError('Security confirmation phrase must include a question mark (?).');
      return;
    }

    if (!challenge) {
      setError('Request an Email OTP verification code first.');
      return;
    }

    if (!/^\d{6}$/.test(otpCode.trim())) {
      setError('Enter the 6-digit numeric email OTP code.');
      return;
    }

    setVerifying(true);
    try {
      const res = await confirmSwitchToLive({
        challengeId: challenge.challengeId,
        securityAnswer: securityAnswer.trim(),
        otpCode: otpCode.trim(),
      });
      if (!res.ok) {
        setError(res.error || 'Verification failed.');
        return;
      }
      setSecurityAnswer('');
      setOtpCode('');
      setChallenge(null);
      onSuccess?.();
      onClose();
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="live-switch-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
    >
      <div className="w-full max-w-md rounded-xl border border-amber-500/40 bg-[#111827] shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-800 bg-[#0d1323] px-5 py-4">
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-amber-400" aria-hidden="true" />
            <h2
              id="live-switch-modal-title"
              className="font-display text-base font-bold text-white"
            >
              Live Futures Execution Security Gate
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Live Switch verification modal"
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white cursor-pointer"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <form onSubmit={handleVerifySubmit} className="p-5 space-y-4">
          <p className="text-xs leading-relaxed text-slate-300">
            Transitioning from <span className="font-semibold text-emerald-400">TESTNET</span> to{' '}
            <span className="font-semibold text-amber-400">LIVE USD-M Futures</span> requires both
            a question-mark (<span className="font-mono font-bold text-white">?</span>) intent
            confirmation and a 6-digit Email OTP verification.
          </p>

          <div>
            <label
              htmlFor="live-question-input"
              className="block text-xs font-semibold text-slate-200 mb-1.5"
            >
              1. Security Prompt Confirmation (Must include &lsquo;?&rsquo;)
            </label>
            <input
              id="live-question-input"
              type="text"
              value={securityAnswer}
              onChange={(e) => setSecurityAnswer(e.target.value)}
              placeholder="e.g., Switch to Live Execution?"
              className="w-full rounded-lg border border-slate-700 bg-[#0a0e1a] px-3 py-2 text-xs text-white placeholder-slate-500 focus:border-[#3b82f6] focus:outline-none"
            />
          </div>

          <div className="space-y-2 border-t border-slate-800 pt-3">
            <div className="flex items-center justify-between gap-2">
              <label
                htmlFor="live-otp-input"
                className="text-xs font-semibold text-slate-200"
              >
                2. Email 6-Digit OTP Verification
              </label>
              <button
                type="button"
                disabled={sendingOtp}
                onClick={handleRequestOtp}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#3b82f6]/50 bg-[#3b82f6]/15 px-3 py-1.5 text-[11px] font-semibold text-blue-300 hover:bg-[#3b82f6]/25 cursor-pointer disabled:opacity-60"
              >
                <Mail className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{sendingOtp ? 'Sending OTP...' : challenge ? 'Resend Email OTP' : 'Send Email OTP'}</span>
              </button>
            </div>

            {challenge && (
              <p className="text-[11px] text-slate-400">
                {challenge.emailSent
                  ? `OTP dispatched to ${challenge.recipient}.`
                  : `OTP challenge created for ${challenge.recipient}. Retrieve the 6-digit code from your configured email inbox or server operator log.`}
              </p>
            )}

            <div className="relative">
              <KeyRound
                className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500"
                aria-hidden="true"
              />
              <input
                id="live-otp-input"
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={otpCode}
                onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="Enter 6-digit OTP"
                className="w-full rounded-lg border border-slate-700 bg-[#0a0e1a] pl-9 pr-3 py-2 font-mono text-xs tracking-widest text-white placeholder-slate-500 focus:border-[#3b82f6] focus:outline-none"
              />
            </div>
          </div>

          {error && (
            <div
              role="alert"
              className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300"
            >
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-2.5 border-t border-slate-800 pt-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-700 bg-[#0a0e1a] px-4 py-2 text-xs font-semibold text-slate-300 hover:text-white cursor-pointer"
            >
              Stay on Testnet
            </button>
            <button
              type="submit"
              disabled={verifying}
              className="rounded-lg bg-amber-500 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-amber-400 transition-colors cursor-pointer disabled:opacity-60"
            >
              {verifying ? 'Verifying OTP...' : 'Authorize Live Mode'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
