import { useCallback, useEffect, useState } from 'react';
import {
  AlertOctagon,
  Briefcase,
  CheckCircle2,
  Cpu,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  Sparkles,
  Users,
} from 'lucide-react';
import { apiFetch } from '../lib/apiClient';
import type {
  AbuseAppealRecord,
  AdminAuditLogEntry,
  AdminPremiumControlConfig,
  AiBusinessAdvisorySuggestion,
  ApprovedSubaccountSeat,
  OfferCampaignRecord,
} from '../lib/businessControlsAndAbuse';

interface AdminBusinessOverviewPayload {
  ok: boolean;
  config: AdminPremiumControlConfig;
  publicPaidOfferActive: boolean;
  sandboxNotice: string;
  offers: OfferCampaignRecord[];
  approvedSubaccounts: ApprovedSubaccountSeat[];
  appeals: AbuseAppealRecord[];
  auditLog: AdminAuditLogEntry[];
  pool: {
    isolatedFromCoreTrading: boolean;
    activeRunningJobs: number;
    queuedJobsCount: number;
    dailyAiSpendUsd: number;
    dailyAiRemainingBudgetUsd: number;
    dailyProviderCalls: number;
    totalTrackedAccounts: number;
    limits: {
      maxConcurrentJobs: number;
      maxQueueDepth: number;
      dailyAiCostBudgetUsd: number;
      dailyProviderCallBudget: number;
      estimatedCostPerScanUsd: number;
      emergencySuspended: boolean;
    };
  };
  referrals: {
    totalSharesCreated: number;
    totalClaimsRecorded: number;
    grantedConversions: number;
    blockedFraudAttempts: number;
    totalReferralCreditsIssued: number;
    remainingReferralCreditsBudget: number;
  };
  advisorySuggestions: AiBusinessAdvisorySuggestion[];
}

export function AdminBusinessControlCenter() {
  const [data, setData] = useState<AdminBusinessOverviewPayload | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);

  // Team subaccount form state
  const [seatEmail, setSeatEmail] = useState<string>('');
  const [seatRole, setSeatRole] = useState<'ANALYST' | 'TRADER_VIEW'>('ANALYST');
  const [seatDailyLimit, setSeatDailyLimit] = useState<number>(10);

  const loadOverview = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch('/api/admin/business/overview');
      if (!res.ok) {
        setFeedback({ tone: 'err', text: `Admin authorization required (HTTP ${res.status}).` });
        return;
      }
      const json = (await res.json()) as AdminBusinessOverviewPayload;
      if (json.ok) setData(json);
    } catch {
      setFeedback({ tone: 'err', text: 'Failed to load Admin Business Control Center.' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  const updateBusinessConfig = async (payload: Record<string, unknown>, message: string) => {
    setSaving(true);
    setFeedback(null);
    try {
      const res = await apiFetch('/api/admin/business/config', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setFeedback({ tone: 'err', text: json?.error || 'Configuration update failed.' });
        return;
      }
      setFeedback({ tone: 'ok', text: message });
      await loadOverview();
    } catch {
      setFeedback({ tone: 'err', text: 'Network error updating business config.' });
    } finally {
      setSaving(false);
    }
  };

  const handleCreateOfferFromAdvisory = async (s: AiBusinessAdvisorySuggestion) => {
    setSaving(true);
    setFeedback(null);
    try {
      const res = await apiFetch('/api/admin/business/offers', {
        method: 'POST',
        body: JSON.stringify({
          title: s.title,
          targetPlan: s.recommendedTargetPlan,
          discountType: s.recommendedDiscountType,
          discountValue: s.recommendedDiscountValue,
          maxRedemptions: s.recommendedMaxRedemptions,
          campaignBudgetUsd: Math.max(25, Math.ceil(s.estimatedCampaignCostUsd * 1.25)),
          estimatedCostPerUnitUsd:
            s.recommendedMaxRedemptions > 0
              ? Number((s.estimatedCampaignCostUsd / s.recommendedMaxRedemptions).toFixed(2))
              : 1,
          fromAiSuggestion: true,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setFeedback({ tone: 'err', text: json?.error || 'Failed to create sandbox offer draft.' });
        return;
      }
      setFeedback({
        tone: 'ok',
        text: `Offer ${json.offer.offerId} queued at AI_SUGGESTION stage. Human Admin review, cost preview, and confirmation required before Sandbox publish.`,
      });
      await loadOverview();
    } catch {
      setFeedback({ tone: 'err', text: 'Network error creating offer draft.' });
    } finally {
      setSaving(false);
    }
  };

  const handleAdvanceOffer = async (
    offerId: string,
    action: 'ADMIN_REVIEW' | 'APPROVE_COST_PREVIEW' | 'CONFIRM' | 'PUBLISH_SANDBOX' | 'PAUSE' | 'ROLLBACK'
  ) => {
    setSaving(true);
    setFeedback(null);
    try {
      const res = await apiFetch('/api/admin/business/offers', {
        method: 'POST',
        body: JSON.stringify({ mode: 'ADVANCE', offerId, action }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setFeedback({ tone: 'err', text: json?.error || `Offer action ${action} blocked.` });
        return;
      }
      setFeedback({ tone: 'ok', text: `Offer ${offerId} advanced to ${json.offer.stage}.` });
      await loadOverview();
    } catch {
      setFeedback({ tone: 'err', text: 'Network error advancing offer workflow.' });
    } finally {
      setSaving(false);
    }
  };

  const handleAddSubaccount = async () => {
    if (!seatEmail.trim()) return;
    setSaving(true);
    setFeedback(null);
    try {
      const res = await apiFetch('/api/admin/business/subaccounts', {
        method: 'POST',
        body: JSON.stringify({
          email: seatEmail.trim(),
          role: seatRole,
          dailyScanLimit: seatDailyLimit,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setFeedback({ tone: 'err', text: json?.error || 'Could not approve subaccount seat.' });
        return;
      }
      setSeatEmail('');
      setFeedback({ tone: 'ok', text: `Approved team seat ${json.seat.seatId} added.` });
      await loadOverview();
    } catch {
      setFeedback({ tone: 'err', text: 'Network error adding team seat.' });
    } finally {
      setSaving(false);
    }
  };

  const handleReviewAppeal = async (appealId: string, decision: 'APPROVED_RESTORED' | 'DENIED') => {
    setSaving(true);
    setFeedback(null);
    try {
      const res = await apiFetch(`/api/admin/business/appeals/${encodeURIComponent(appealId)}`, {
        method: 'POST',
        body: JSON.stringify({ decision }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setFeedback({ tone: 'err', text: json?.error || 'Appeal decision failed.' });
        return;
      }
      setFeedback({ tone: 'ok', text: `Appeal ${appealId} updated to ${decision}.` });
      await loadOverview();
    } catch {
      setFeedback({ tone: 'err', text: 'Network error reviewing appeal.' });
    } finally {
      setSaving(false);
    }
  };

  const cfg = data?.config;

  return (
    <section
      data-testid="admin-business-control-center"
      aria-label="Admin Premium, Quotas and Offer Control Center"
      className="space-y-6"
    >
      {/* Prominent Sandbox-Only Safety Banner */}
      <div
        data-testid="admin-sandbox-only-banner"
        className="rounded-xl border border-amber-500/40 bg-amber-950/30 px-5 py-3.5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
      >
        <div className="flex items-start gap-2.5 text-xs text-amber-200">
          <ShieldAlert className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" aria-hidden="true" />
          <div>
            <strong className="font-mono text-amber-100">
              SANDBOX ONLY — NO PUBLIC PAID OFFER OR PAYMENT COLLECTION ACTIVE.
            </strong>{' '}
            All pricing, quotas, referral credit rules, and promotional campaigns operate strictly in sandbox mode until external billing verification and explicit administrator launch approval.
          </div>
        </div>
        <button
          type="button"
          onClick={() => void loadOverview()}
          disabled={loading}
          className="self-start sm:self-auto inline-flex items-center gap-1.5 min-h-[38px] rounded-lg border border-amber-500/40 bg-[#0a0e1a] px-3 py-1.5 text-xs font-semibold text-amber-200 hover:text-white cursor-pointer shrink-0"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
          <span>Refresh</span>
        </button>
      </div>

      {feedback && (
        <div
          role="status"
          data-testid="admin-business-feedback"
          className={`rounded-lg border px-4 py-2.5 text-xs flex items-center gap-2 ${
            feedback.tone === 'ok'
              ? 'border-emerald-500/40 bg-emerald-950/30 text-emerald-200'
              : 'border-rose-500/40 bg-rose-950/30 text-rose-200'
          }`}
        >
          <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{feedback.text}</span>
        </div>
      )}

      {/* Main Controls + Isolated Worker Pool */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Service Controls & Emergency Kill Switch */}
        <div className="lg:col-span-7 rounded-xl border border-slate-800 bg-[#111827] overflow-hidden">
          <div className="border-b border-slate-800 bg-[#0d1323] px-5 py-4 flex items-center justify-between gap-2">
            <div>
              <div className="font-mono text-xs text-blue-400">Admin Premium Control</div>
              <h2 className="font-display text-base font-bold text-white flex items-center gap-2">
                <Briefcase className="h-4 w-4 text-blue-400" aria-hidden="true" />
                <span>Feature Visibility, Pricing &amp; Emergency Controls</span>
              </h2>
            </div>
            <button
              type="button"
              disabled={saving}
              onClick={() =>
                void updateBusinessConfig({ rollback: true }, 'Rolled back to previous business config snapshot.')
              }
              className="inline-flex items-center gap-1.5 min-h-[36px] rounded-lg border border-slate-700 bg-[#0a0e1a] px-3 py-1.5 text-xs font-semibold text-slate-300 hover:border-blue-500 hover:text-white cursor-pointer"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Rollback Config</span>
            </button>
          </div>

          {cfg && (
            <div className="p-5 space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="flex items-center justify-between gap-3 rounded-lg border border-slate-800 bg-[#0a0e1a] px-3.5 py-3 cursor-pointer">
                  <span className="font-semibold text-slate-100">Sandbox Feature Active</span>
                  <input
                    type="checkbox"
                    data-testid="admin-toggle-sandbox-enabled"
                    disabled={saving}
                    checked={cfg.featureEnabledInSandbox}
                    onChange={(e) =>
                      void updateBusinessConfig(
                        { featureEnabledInSandbox: e.target.checked },
                        `AI Chart Scanner sandbox ${e.target.checked ? 'enabled' : 'paused'}.`
                      )
                    }
                    className="h-4 w-4 accent-blue-500"
                  />
                </label>

                <label className="flex items-center justify-between gap-3 rounded-lg border border-slate-800 bg-[#0a0e1a] px-3.5 py-3 cursor-pointer">
                  <span className="font-semibold text-slate-100">Show Upload Button on Public Chart</span>
                  <input
                    type="checkbox"
                    data-testid="admin-toggle-public-visibility"
                    disabled={saving}
                    checked={cfg.featureVisibleOnPublicChart}
                    onChange={(e) =>
                      void updateBusinessConfig(
                        { featureVisibleOnPublicChart: e.target.checked },
                        `Public Chart Upload CTA ${e.target.checked ? 'shown' : 'hidden'}.`
                      )
                    }
                    className="h-4 w-4 accent-blue-500"
                  />
                </label>
              </div>

              {/* Emergency Suspension Button */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-lg border border-rose-500/35 bg-rose-950/20 px-4 py-3">
                <div>
                  <div className="font-semibold text-rose-200 flex items-center gap-1.5">
                    <AlertOctagon className="h-4 w-4 text-rose-400" aria-hidden="true" />
                    <span>Emergency Scanner Suspension</span>
                  </div>
                  <p className="text-[11px] text-slate-400">
                    Immediately halts customer chart scans and offer publishing without interrupting core trading or monitoring.
                  </p>
                </div>
                <button
                  type="button"
                  data-testid="admin-emergency-suspend-btn"
                  disabled={saving}
                  onClick={() =>
                    void updateBusinessConfig(
                      { emergencySuspended: !cfg.emergencySuspended },
                      cfg.emergencySuspended
                        ? 'Emergency suspension cleared.'
                        : 'Emergency suspension ACTIVATED — customer chart scans halted.'
                    )
                  }
                  className={`min-h-[40px] rounded-lg px-4 py-2 text-xs font-semibold cursor-pointer shrink-0 ${
                    cfg.emergencySuspended
                      ? 'bg-emerald-600 text-white hover:bg-emerald-500'
                      : 'bg-rose-600 text-white hover:bg-rose-500'
                  }`}
                >
                  {cfg.emergencySuspended ? 'Resume Service' : 'Emergency Suspend'}
                </button>
              </div>

              {/* Sandbox Plan Quotas (Strictly Capped — No Unlimited) */}
              <div className="space-y-2">
                <div className="font-mono text-[11px] text-slate-400 uppercase tracking-wider">
                  Plan Tiers &amp; Daily Quotas (Billing Locked Off · No Unlimited Scans)
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse font-mono text-[11px] tabular-nums">
                    <thead>
                      <tr className="border-b border-slate-800 text-slate-400">
                        <th className="py-2 pr-3 font-sans">Plan Tier</th>
                        <th className="py-2 pr-3">Price (Sandbox)</th>
                        <th className="py-2 pr-3">Credits</th>
                        <th className="py-2 pr-3">Daily Cap</th>
                        <th className="py-2">Billing</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/70">
                      {cfg.plans.map((p) => (
                        <tr key={p.tier}>
                          <td className="py-2 pr-3 font-sans font-semibold text-white">{p.label}</td>
                          <td className="py-2 pr-3 text-slate-200">${p.priceUsd.toFixed(2)}</td>
                          <td className="py-2 pr-3 text-blue-300">{p.includedCredits}</td>
                          <td className="py-2 pr-3 text-slate-200">{p.dailyScanQuota}/day</td>
                          <td className="py-2 text-amber-300">INACTIVE</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Isolated Analysis Pool & Referral Analytics */}
        <div className="lg:col-span-5 space-y-6">
          <div className="rounded-xl border border-slate-800 bg-[#111827] p-5 space-y-3">
            <div className="flex items-center gap-2 font-display text-sm font-bold text-white">
              <Cpu className="h-4 w-4 text-blue-400" aria-hidden="true" />
              <span>Isolated Analysis Worker Pool &amp; Cost Budget</span>
            </div>
            <dl className="grid grid-cols-2 gap-3 font-mono text-xs tabular-nums">
              <div className="rounded-lg border border-slate-800 bg-[#0d1323] p-3">
                <dt className="font-sans text-[11px] text-slate-400">Concurrency Cap</dt>
                <dd className="mt-1 font-bold text-white">
                  {data?.pool.activeRunningJobs ?? 0} / {data?.pool.limits.maxConcurrentJobs ?? 2}
                </dd>
              </div>
              <div className="rounded-lg border border-slate-800 bg-[#0d1323] p-3">
                <dt className="font-sans text-[11px] text-slate-400">Daily AI Spend</dt>
                <dd className="mt-1 font-bold text-emerald-400">
                  ${(data?.pool.dailyAiSpendUsd ?? 0).toFixed(2)} / $
                  {(data?.pool.limits.dailyAiCostBudgetUsd ?? 25).toFixed(0)}
                </dd>
              </div>
              <div className="rounded-lg border border-slate-800 bg-[#0d1323] p-3">
                <dt className="font-sans text-[11px] text-slate-400">Provider Calls Today</dt>
                <dd className="mt-1 font-bold text-slate-100">
                  {data?.pool.dailyProviderCalls ?? 0} / {data?.pool.limits.dailyProviderCallBudget ?? 500}
                </dd>
              </div>
              <div className="rounded-lg border border-slate-800 bg-[#0d1323] p-3">
                <dt className="font-sans text-[11px] text-slate-400">Core Trading Isolation</dt>
                <dd className="mt-1 font-bold text-emerald-400">SEPARATE POOL</dd>
              </div>
            </dl>
          </div>

          <div className="rounded-xl border border-slate-800 bg-[#111827] p-5 space-y-3">
            <div className="font-display text-sm font-bold text-white">
              Organic Sharing &amp; Referral Fraud Telemetry
            </div>
            <dl className="grid grid-cols-2 gap-3 font-mono text-xs tabular-nums">
              <div className="rounded-lg border border-slate-800 bg-[#0d1323] p-3">
                <dt className="font-sans text-[11px] text-slate-400">Shares Created</dt>
                <dd className="mt-1 font-bold text-white">{data?.referrals.totalSharesCreated ?? 0}</dd>
              </div>
              <div className="rounded-lg border border-slate-800 bg-[#0d1323] p-3">
                <dt className="font-sans text-[11px] text-slate-400">Verified Conversions</dt>
                <dd className="mt-1 font-bold text-emerald-400">
                  {data?.referrals.grantedConversions ?? 0}
                </dd>
              </div>
              <div className="rounded-lg border border-slate-800 bg-[#0d1323] p-3">
                <dt className="font-sans text-[11px] text-slate-400">Blocked Fraud Claims</dt>
                <dd className="mt-1 font-bold text-rose-400">
                  {data?.referrals.blockedFraudAttempts ?? 0}
                </dd>
              </div>
              <div className="rounded-lg border border-slate-800 bg-[#0d1323] p-3">
                <dt className="font-sans text-[11px] text-slate-400">Credits Budget Left</dt>
                <dd className="mt-1 font-bold text-blue-300">
                  {data?.referrals.remainingReferralCreditsBudget ?? 500}
                </dd>
              </div>
            </dl>
          </div>
        </div>
      </div>

      {/* AI Business Advisory Agent (Read-Only) + Offer Approval Workflow */}
      <div className="rounded-xl border border-slate-800 bg-[#111827] overflow-hidden">
        <div className="border-b border-slate-800 bg-[#0d1323] px-5 py-4 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="font-mono text-xs text-blue-400">
              AI Business Advisory Agent · Read-Only Suggestions Only
            </div>
            <h3 className="font-display text-base font-bold text-white flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-blue-400" aria-hidden="true" />
              <span>Promotional Suggestions &amp; Admin Offer Approval Workflow</span>
            </h3>
          </div>
          <span className="font-mono text-[11px] text-amber-300">
            AI Cannot Auto-Publish or Enable Billing
          </span>
        </div>

        <div className="p-5 space-y-5 text-xs">
          {/* Advisory Cards */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {(data?.advisorySuggestions ?? []).map((s) => (
              <article
                key={s.suggestionId}
                className="rounded-lg border border-slate-800 bg-[#0d1323] p-4 flex flex-col justify-between gap-3"
              >
                <div className="space-y-1.5">
                  <div className="font-mono text-[10px] text-blue-400">
                    ADVISORY ONLY · EST. MAX COST ${s.estimatedCampaignCostUsd.toFixed(2)}
                  </div>
                  <h4 className="font-display text-sm font-bold text-white">{s.title}</h4>
                  <p className="text-slate-400 leading-relaxed">{s.rationale}</p>
                </div>
                <button
                  type="button"
                  data-testid={`create-offer-from-${s.suggestionId}`}
                  disabled={saving}
                  onClick={() => void handleCreateOfferFromAdvisory(s)}
                  className="self-start min-h-[38px] rounded-lg border border-blue-500/60 bg-blue-500/15 px-3.5 py-1.5 text-xs font-semibold text-blue-200 hover:bg-blue-500/25 cursor-pointer"
                >
                  Create Draft Offer for Admin Review
                </button>
              </article>
            ))}
          </div>

          {/* Offer Campaigns Lifecycle Table */}
          <div className="space-y-2">
            <div className="font-mono text-[11px] text-slate-400 uppercase tracking-wider">
              Offer Workflow: AI Suggestion &rarr; Admin Review &rarr; Cost Preview &rarr; Confirm &rarr; Sandbox Publish &rarr; Pause / Rollback
            </div>
            {data && data.offers.length > 0 ? (
              <div className="space-y-2.5">
                {data.offers.map((offer) => (
                  <div
                    key={offer.offerId}
                    data-testid={`offer-row-${offer.offerId}`}
                    className="rounded-lg border border-slate-800 bg-[#0a0e1a] p-3.5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between"
                  >
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2 font-mono text-[11px]">
                        <span className="font-bold text-white">{offer.offerId}</span>
                        <span className="text-blue-300">{offer.stage}</span>
                        <span className="text-amber-300">SANDBOX ONLY</span>
                      </div>
                      <div className="font-semibold text-slate-100">{offer.title}</div>
                      <div className="font-mono text-[11px] text-slate-400 tabular-nums">
                        Est. Max Cost ${offer.estimatedMaxCostUsd.toFixed(2)} / Budget $
                        {offer.campaignBudgetUsd.toFixed(2)} · Max {offer.maxRedemptions} redemptions
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        disabled={saving || offer.reviewedByAdmin}
                        onClick={() => void handleAdvanceOffer(offer.offerId, 'ADMIN_REVIEW')}
                        className="rounded border border-slate-700 bg-[#111827] px-2.5 py-1.5 text-[11px] font-semibold text-slate-200 hover:border-blue-500 disabled:opacity-40 cursor-pointer"
                      >
                        1. Review
                      </button>
                      <button
                        type="button"
                        disabled={saving || offer.costPreviewApproved}
                        onClick={() => void handleAdvanceOffer(offer.offerId, 'APPROVE_COST_PREVIEW')}
                        className="rounded border border-slate-700 bg-[#111827] px-2.5 py-1.5 text-[11px] font-semibold text-slate-200 hover:border-blue-500 disabled:opacity-40 cursor-pointer"
                      >
                        2. Cost Preview
                      </button>
                      <button
                        type="button"
                        disabled={saving || !offer.costPreviewApproved || offer.confirmedByAdmin}
                        onClick={() => void handleAdvanceOffer(offer.offerId, 'CONFIRM')}
                        className="rounded border border-slate-700 bg-[#111827] px-2.5 py-1.5 text-[11px] font-semibold text-slate-200 hover:border-blue-500 disabled:opacity-40 cursor-pointer"
                      >
                        3. Confirm
                      </button>
                      <button
                        type="button"
                        disabled={saving || !offer.confirmedByAdmin || offer.stage === 'PUBLISHED_SANDBOX'}
                        onClick={() => void handleAdvanceOffer(offer.offerId, 'PUBLISH_SANDBOX')}
                        className="rounded bg-[#3b82f6] px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-blue-500 disabled:opacity-40 cursor-pointer"
                      >
                        4. Publish Sandbox
                      </button>
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => void handleAdvanceOffer(offer.offerId, 'ROLLBACK')}
                        className="rounded border border-rose-500/40 bg-rose-950/30 px-2.5 py-1.5 text-[11px] font-semibold text-rose-200 hover:bg-rose-900/40 cursor-pointer"
                      >
                        Rollback
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-slate-400">
                No promotional offer drafts queued yet. Convert an AI Advisory Suggestion above to test the multi-step Admin approval lifecycle.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Approved Team Subaccounts & Abuse Appeals */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 text-xs">
        <div className="rounded-xl border border-slate-800 bg-[#111827] p-5 space-y-4">
          <div className="flex items-center gap-2 font-display text-sm font-bold text-white">
            <Users className="h-4 w-4 text-blue-400" aria-hidden="true" />
            <span>Approved Team Subaccounts (Shared-IP Safe)</span>
          </div>
          <p className="text-[11px] text-slate-400">
            Approved seats under an organization subscription share office/household networks cleanly without triggering anti-abuse penalties.
          </p>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="email"
              value={seatEmail}
              onChange={(e) => setSeatEmail(e.target.value)}
              placeholder="analyst@team.example"
              className="flex-1 min-h-[38px] rounded-lg border border-slate-700 bg-[#0a0e1a] px-3 py-1.5 text-xs text-white"
            />
            <select
              value={seatRole}
              onChange={(e) => setSeatRole(e.target.value as 'ANALYST' | 'TRADER_VIEW')}
              className="min-h-[38px] rounded-lg border border-slate-700 bg-[#0a0e1a] px-2.5 py-1.5 font-mono text-xs text-white"
            >
              <option value="ANALYST">ANALYST</option>
              <option value="TRADER_VIEW">TRADER_VIEW</option>
            </select>
            <input
              type="number"
              min={1}
              max={50}
              value={seatDailyLimit}
              onChange={(e) => setSeatDailyLimit(Math.max(1, Number(e.target.value) || 10))}
              aria-label="Seat daily scan limit"
              className="w-20 min-h-[38px] rounded-lg border border-slate-700 bg-[#0a0e1a] px-2.5 py-1.5 font-mono text-xs text-white tabular-nums"
            />
            <button
              type="button"
              disabled={saving || !seatEmail.trim()}
              onClick={() => void handleAddSubaccount()}
              className="min-h-[38px] rounded-lg bg-[#3b82f6] px-3.5 text-xs font-semibold text-white hover:bg-blue-500 disabled:opacity-45 cursor-pointer"
            >
              Approve Seat
            </button>
          </div>
          {data && data.approvedSubaccounts.length > 0 && (
            <ul className="space-y-1.5 font-mono text-[11px]">
              {data.approvedSubaccounts.map((seat) => (
                <li
                  key={seat.seatId}
                  className="flex items-center justify-between rounded border border-slate-800 bg-[#0a0e1a] px-3 py-2"
                >
                  <span className="text-slate-200">
                    {seat.subaccountEmailMasked} · {seat.role}
                  </span>
                  <span className="text-emerald-400">{seat.dailyScanLimit} scans/day</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-xl border border-slate-800 bg-[#111827] p-5 space-y-4">
          <div className="font-display text-sm font-bold text-white">
            Anti-Abuse Review Queue &amp; User Appeals
          </div>
          <p className="text-[11px] text-slate-400">
            Shared IP addresses never receive permanent bans. Flagged accounts can submit an appeal for human administrator review.
          </p>
          {data && data.appeals.length > 0 ? (
            <ul className="space-y-2">
              {data.appeals.map((appeal) => (
                <li
                  key={appeal.appealId}
                  className="rounded-lg border border-slate-800 bg-[#0a0e1a] p-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <div className="font-mono text-[11px] text-blue-300">
                      {appeal.appealId} · {appeal.status}
                    </div>
                    <div className="text-slate-200">{appeal.reason}</div>
                  </div>
                  {appeal.status === 'OPEN' && (
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => void handleReviewAppeal(appeal.appealId, 'APPROVED_RESTORED')}
                        className="rounded bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-emerald-500 cursor-pointer"
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => void handleReviewAppeal(appeal.appealId, 'DENIED')}
                        className="rounded border border-rose-500/40 bg-rose-950/30 px-2.5 py-1 text-[11px] font-semibold text-rose-200 cursor-pointer"
                      >
                        Deny
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <div className="rounded-lg border border-dashed border-slate-800 bg-[#0a0e1a]/50 p-4 text-center text-slate-400">
              No pending anti-abuse appeals.
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
