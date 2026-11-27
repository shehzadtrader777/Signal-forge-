import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock, KeyRound, Mail, ShieldAlert, X } from 'lucide-react';
import { type LiveOtpChallengeState, useApp } from '../context/AppContext';
import type { OtpProviderReadiness } from '../lib/otpChallenge';

interface LiveSwitchSecurityModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

interface OtpStatusResponse {
  ok: boolean;
  provider?: OtpProviderReadiness;
  cooldownAllowed?: boolean;
  retryAfterSec?: number;
  resendAvailableAt?: string;
}

export function LiveSwitchSecurityModal({
  open,
  onClose,
  onSuccess,
}: LiveSwitchSecurityModalProps) {
  const { requestLiveSwitchOtp, confirmSwitchToLive } = useApp();
  const [challenge, setChallenge] = useState<LiveOtpChallengeState | null>(null);
  const [providerStatus, setProviderStatus] = useState<OtpProviderReadiness | null>(null);
  const [securityAnswer, setSecurityAnswer] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [safetyChecked, setSafetyChecked] = useState(false);
  const [sendingOtp, setSendingOtp] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [cooldownUntilMs, setCooldownUntilMs] = useState<number>(0);
  const [attemptsRemaining, setAttemptsRemaining] = useState<number | null>(null);

  useEffect(() => {
    if (!open) return;
    let active = true;
    fetch('/api/security/live-otp/status')
      .then((res) => res.json())
      .then((data: OtpStatusResponse) => {
        if (!active) return;
        if (data.provider) setProviderStatus(data.provider);
        if (data.resendAvailableAt && !data.cooldownAllowed) {
          const parsed = Date.parse(data.resendAvailableAt);
          if (Number.isFinite(parsed)) setCooldownUntilMs(parsed);
        }
      })
      .catch(() => undefined);

    const interval = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [open]);

  if (!open) return null;

  const cooldownSec = Math.max(0, Math.ceil((cooldownUntilMs - nowMs) / 1000));
  const expiresAtMs = challenge ? Date.parse(challenge.expiresAt) : 0;
  const expirySec = challenge && Number.isFinite(expiresAtMs)
    ? Math.max(0, Math.ceil((expiresAtMs - nowMs) / 1000))
    : 0;
  const isExpired = Boolean(challenge && expirySec === 0);

  const formatCountdown = (sec: number) => {
    const mins = Math.floor(sec / 60);
    const rem = sec % 60;
    return `${mins}:${String(rem).padStart(2, '0')}`;
  };

  const handleRequestOtp = async () => {
    setError(null);
    setSendingOtp(true);
    try {
      const res = await requestLiveSwitchOtp();
      if (!res.ok || !res.challenge) {
        if (typeof res.retryAfterSec === 'number' && res.retryAfterSec > 0) {
          setCooldownUntilMs(Date.now() + res.retryAfterSec * 1000);
        }
        setError(res.error || 'Could not dispatch email OTP challenge.');
        return;
      }
      setChallenge(res.challenge);
      setAttemptsRemaining(res.challenge.attemptsRemaining ?? 5);
      if (res.challenge.resendAvailableAt) {
        const parsed = Date.parse(res.challenge.resendAvailableAt);
        if (Number.isFinite(parsed)) setCooldownUntilMs(parsed);
      } else {
        setCooldownUntilMs(Date.now() + 30_000);
      }
    } finally {
      setSendingOtp(false);
    }
  };

  const handleVerifySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!safetyChecked) {
      setError('Confirm the pre-flight safety checklist before authorizing Live mode.');
      return;
    }

    if (!securityAnswer.trim().includes('?')) {
      setError('Security confirmation phrase must include a question mark (?).');
      return;
    }

    if (!challenge) {
      setError('Request an Email OTP verification code first.');
      return;
    }

    if (isExpired) {
      setError('OTP challenge expired. Request a fresh 6-digit Email OTP.');
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
        safetyChecksCompleted: safetyChecked,
      });
      if (!res.ok) {
        if (typeof res.attemptsRemaining === 'number') {
          setAttemptsRemaining(res.attemptsRemaining);
        }
        setError(res.error || 'Verification failed.');
        return;
      }
      setSecurityAnswer('');
      setOtpCode('');
      setSafetyChecked(false);
      setChallenge(null);
      setAttemptsRemaining(null);
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
      data-testid="live-switch-security-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
    >
      <div className="w-full max-w-lg rounded-xl border border-amber-500/40 bg-[#111827] shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-800 bg-[#0d1323] px-5 py-4">
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-amber-400" aria-hidden="true" />
            <h2
              id="live-switch-modal-title"
              className="font-display text-base font-bold text-white"
            >
              Live Execution Security Gate
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
            Transitioning from <span className="font-semibold text-emerald-400">PAPER / TESTNET</span> to{' '}
            <span className="font-semibold text-amber-400">LIVE Execution</span> requires authenticated operator access, a question-mark (<span className="font-mono font-bold text-white">?</span>) intent phrase, completed safety checks, and a valid 6-digit Email OTP.
          </p>

          {/* Email Provider Diagnostic Banner */}
          {providerStatus && (
            <div
              data-testid="otp-provider-diagnostic"
              className={`rounded-lg border px-3 py-2.5 text-[11px] leading-relaxed ${
                providerStatus.resendApiKeyConfigured && providerStatus.customVerifiedSenderConfigured
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
                  : providerStatus.resendApiKeyConfigured
                  ? 'border-amber-500/35 bg-amber-500/10 text-amber-200'
                  : 'border-rose-500/40 bg-rose-500/10 text-rose-200'
              }`}
            >
              <div className="flex items-center gap-1.5 font-semibold mb-0.5">
                {providerStatus.resendApiKeyConfigured ? (
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                ) : (
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                )}
                <span>
                  OTP Delivery Target: {providerStatus.recipientMasked} · Sender: {providerStatus.senderAddress}
                </span>
              </div>
              <p className="opacity-90">{providerStatus.advisory}</p>
            </div>
          )}

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

          <div className="space-y-2.5 border-t border-slate-800 pt-3">
            <div className="flex items-center justify-between gap-2">
              <label
                htmlFor="live-otp-input"
                className="text-xs font-semibold text-slate-200"
              >
                2. Email 6-Digit OTP Verification
              </label>
              <button
                type="button"
                data-testid="request-live-otp-btn"
                disabled={sendingOtp || cooldownSec > 0}
                onClick={handleRequestOtp}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#3b82f6]/50 bg-[#3b82f6]/15 px-3 py-1.5 text-[11px] font-semibold text-blue-300 hover:bg-[#3b82f6]/25 cursor-pointer disabled:opacity-55 whitespace-nowrap"
              >
                <Mail className="h-3.5 w-3.5" aria-hidden="true" />
                <span>
                  {sendingOtp
                    ? 'Sending OTP...'
                    : cooldownSec > 0
                    ? `Resend in ${cooldownSec}s`
                    : challenge
                    ? 'Resend Email OTP'
                    : 'Send Email OTP'}
                </span>
              </button>
            </div>

            {challenge && (
              <div
                data-testid="otp-delivery-result"
                className={`rounded-lg border px-3 py-2 text-[11px] space-y-1 ${
                  challenge.emailSent
                    ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-200'
                    : 'border-rose-500/40 bg-rose-500/10 text-rose-200'
                }`}
              >
                <div className="flex items-center justify-between gap-2 font-mono">
                  <span className="font-semibold">
                    Status: {challenge.deliveryStatus || (challenge.emailSent ? 'DELIVERED' : 'DELIVERY_FAILED')}
                  </span>
                  <span className="inline-flex items-center gap-1 tabular-nums">
                    <Clock className="h-3 w-3" aria-hidden="true" />
                    {isExpired ? 'Expired' : `Expires ${formatCountdown(expirySec)}`}
                  </span>
                </div>
                <p>{challenge.deliveryDiagnostic}</p>
                {challenge.remediationHint && (
                  <p className="text-[10px] opacity-85">{challenge.remediationHint}</p>
                )}
              </div>
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

            {attemptsRemaining !== null && (
              <div className="text-[11px] font-mono text-slate-400 tabular-nums">
                Verification attempts remaining: {attemptsRemaining} / 5
              </div>
            )}
          </div>

          <label className="flex items-start gap-2.5 rounded-lg border border-slate-800 bg-[#0a0e1a] p-3 text-[11px] text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              data-testid="live-safety-checklist-checkbox"
              checked={safetyChecked}
              onChange={(e) => setSafetyChecked(e.target.checked)}
              className="mt-0.5 accent-amber-500"
            />
            <span>
              3. I confirm exchange risk caps, mandatory stop-loss rules, and emergency circuit breakers have been reviewed, and understand Live Trading remains locked unless verified OTP succeeds.
            </span>
          </label>

          {error && (
            <div
              role="alert"
              data-testid="live-switch-error"
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
              disabled={verifying || isExpired}
              className="rounded-lg bg-amber-500 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-amber-400 transition-colors cursor-pointer disabled:opacity-55"
            >
              {verifying ? 'Verifying OTP...' : 'Authorize Live Mode'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
