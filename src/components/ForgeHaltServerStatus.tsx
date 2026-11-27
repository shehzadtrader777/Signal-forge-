import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/apiClient';

/** Read-only cross-device status. Never authorizes order execution. */
export function ForgeHaltServerStatus() {
  const [status, setStatus] = useState<'checking' | 'halted' | 'not-halted' | 'unknown'>('checking');
  const [seal, setSeal] = useState<string | null>(null);
  const [lastVerified, setLastVerified] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    let lastRequestId = 0;
    async function check() {
      const requestId = ++lastRequestId;
      try {
        const res = await apiFetch('/api/forge-capital/failsafe/status', { method: 'GET', cache: 'no-store' });
        if (!res.ok) throw new Error('Unable to authenticate status');
        const json = await res.json() as { ok?: boolean; engaged?: boolean; sealId?: string | null };
        if (!json.ok || typeof json.engaged !== 'boolean') throw new Error('Invalid response');
        if (!mounted || requestId !== lastRequestId) return;
        setStatus(json.engaged ? 'halted' : 'not-halted');
        setSeal(json.sealId ?? null);
        setLastVerified(new Date().toLocaleTimeString());
      } catch {
        if (mounted && requestId === lastRequestId) {
          setStatus('unknown');
          setSeal(null);
        }
      }
    }
    void check();
    const timer = window.setInterval(() => { void check(); }, 10000);
    const focus = () => { void check(); };
    const visible = () => { if (document.visibilityState === 'visible') void check(); };
    window.addEventListener('focus', focus);
    document.addEventListener('visibilitychange', visible);
    return () => {
      mounted = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', focus);
      document.removeEventListener('visibilitychange', visible);
    };
  }, []);

  const halted = status === 'halted';
  const unknown = status === 'unknown' || status === 'checking';
  return (
    <div role="status" aria-live="polite" data-testid="forge-halt-server-status"
      className={`rounded-xl border px-4 py-3 text-sm ${halted
        ? 'border-rose-500 bg-rose-950/50 text-rose-100'
        : unknown
          ? 'border-amber-500/60 bg-amber-950/30 text-amber-100'
          : 'border-emerald-500/50 bg-emerald-950/20 text-emerald-100'}`}>
      <strong className="block">
        {halted ? 'EMERGENCY HALT — SERVER CONFIRMED'
          : unknown ? 'SERVER SAFETY STATUS NOT VERIFIED'
          : 'No active server-side emergency halt reported'}
      </strong>
      <span className="mt-1 block text-xs opacity-80">
        {halted ? `Seal: ${seal ?? 'active'} · Execution blocked`
          : unknown ? 'Do not assume trading is safe. Reconnect to verify.'
          : 'This status does not authorize live trading.'}
        {lastVerified && ` · Last verified ${lastVerified}`}
      </span>
    </div>
  );
}
