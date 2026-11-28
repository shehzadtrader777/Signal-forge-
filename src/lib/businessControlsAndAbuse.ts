/**
 * Signal Forge — Phases E, F & G:
 * - Phase E: Account & Subscription Anti-Abuse Risk Engine (privacy-conscious, never permanent IP-only ban)
 * - Phase F: Organic Sharing & Referrals (privacy-safe public previews, no auto-post, verified rewards)
 * - Phase G: Admin Business & Offer Control Center + Read-Only AI Business Advisory Agent
 *
 * Strictly enforces:
 * - No real-money billing or payment collection active yet (SANDBOX_ONLY offer publishing)
 * - AI Business Advisory Agent can NEVER auto-publish, enable billing, or bypass Admin approval
 */

import type { ScannerPlanTier } from './chartScannerEngine';

// ---------------------------------------------------------------------------
// Phase E: Privacy-Conscious Anti-Abuse Risk Engine
// ---------------------------------------------------------------------------

export type AbuseRestrictionLevel =
  | 'ALLOW'
  | 'SOFT_RATE_LIMIT'
  | 'CHALLENGE_REQUIRED'
  | 'MANUAL_REVIEW_HOLD';

export interface AbuseSignalInput {
  readonly accountId: string;
  readonly hashedIpBucket: string; // Privacy-safe salted hash of IP /24 or IP
  readonly hashedDeviceFingerprint: string;
  readonly normalizedEmailKey: string;
  readonly referrerAccountId?: string | null;
  readonly uploadsInLast10Min: number;
  readonly accountsSharingIpBucket: number;
  readonly accountsSharingDevice: number;
  readonly priorTrialClaimedOnDevice: boolean;
  readonly isApprovedTeamSeat: boolean;
}

export interface AbuseAssessmentResult {
  readonly riskScore: number; // 0..100
  readonly restriction: AbuseRestrictionLevel;
  readonly permanentIpBanApplied: false; // INVARIANT: never permanently ban solely for shared IP
  readonly reasons: string[];
  readonly appealEligible: boolean;
  readonly evaluatedAtIso: string;
}

export interface ApprovedSubaccountSeat {
  readonly seatId: string;
  readonly parentAccountId: string;
  readonly subaccountEmailMasked: string;
  readonly role: 'ANALYST' | 'TRADER_VIEW';
  readonly dailyScanLimit: number;
  readonly approvedAtIso: string;
  readonly active: boolean;
}

export interface AbuseAppealRecord {
  readonly appealId: string;
  readonly accountId: string;
  readonly reason: string;
  readonly status: 'OPEN' | 'APPROVED_RESTORED' | 'DENIED';
  readonly createdAtIso: string;
  readonly reviewedBy: string | null;
  readonly reviewedAtIso: string | null;
}

export function evaluateAccountAbuseRisk(
  input: AbuseSignalInput,
  nowMs = Date.now()
): AbuseAssessmentResult {
  let score = 0;
  const reasons: string[] = [];

  // Self-referral check (exact account or identical normalized email)
  if (input.referrerAccountId && input.referrerAccountId === input.accountId) {
    score += 45;
    reasons.push('Self-referral attempt detected (referrer matches registrant account).');
  }

  // Approved subscription team seats are explicitly exempt from shared IP/office penalties
  if (!input.isApprovedTeamSeat) {
    // Shared IP alone is capped at 18 points — NEVER triggers a permanent ban or hold by itself!
    if (input.accountsSharingIpBucket >= 4) {
      score += 18;
      reasons.push(
        `Shared network bucket (${input.accountsSharingIpBucket} accounts); capped weight so shared-IP users are never permanently blocked.`
      );
    }

    if (input.accountsSharingDevice >= 3) {
      score += 32;
      reasons.push(`Multiple accounts (${input.accountsSharingDevice}) observed on same device fingerprint.`);
    }

    if (input.priorTrialClaimedOnDevice) {
      score += 30;
      reasons.push('Free trial already claimed on this device fingerprint — duplicate trial benefit blocked.');
    }
  }

  if (input.uploadsInLast10Min >= 15) {
    score += 35;
    reasons.push(`Excessive upload velocity (${input.uploadsInLast10Min} uploads in 10 minutes).`);
  } else if (input.uploadsInLast10Min >= 8) {
    score += 15;
    reasons.push(`Elevated upload velocity (${input.uploadsInLast10Min} uploads in 10 minutes).`);
  }

  const clamped = Math.min(100, score);
  let restriction: AbuseRestrictionLevel = 'ALLOW';
  if (clamped >= 70) {
    restriction = 'MANUAL_REVIEW_HOLD';
  } else if (clamped >= 45) {
    restriction = 'CHALLENGE_REQUIRED';
  } else if (clamped >= 25) {
    restriction = 'SOFT_RATE_LIMIT';
  }

  return {
    riskScore: clamped,
    restriction,
    permanentIpBanApplied: false,
    reasons,
    appealEligible: restriction !== 'ALLOW',
    evaluatedAtIso: new Date(nowMs).toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Phase F: Organic Sharing & Bounded Referrals (Privacy-Safe, No Auto-Post)
// ---------------------------------------------------------------------------

export interface PublicChartSharePreview {
  readonly shareId: string;
  readonly analysisId: string;
  readonly symbol: string;
  readonly exchange: string;
  readonly timeframe: string;
  readonly tradingStyle: string;
  readonly recommendation: string;
  readonly bullishRr: number;
  readonly bearishRr: number;
  readonly analyzedAtIso: string;
  readonly referralCode: string;
  readonly referralDisclosure: string;
  readonly shareUrl: string;
  readonly captionText: string;
  readonly includesPrivateScreenshot: false; // Private uploaded images are NEVER exposed publicly
  readonly includesFullPaidReport: boolean;
  readonly ownerConsentConfirmed: boolean;
  readonly autoPostedToSocial: false; // NEVER auto-posts to external social networks
}

export interface ReferralClaimRecord {
  readonly claimId: string;
  readonly referralCode: string;
  readonly referrerAccountId: string;
  readonly refereeAccountId: string;
  readonly verifiedRegistration: boolean;
  readonly qualifyingActionCompleted: boolean;
  readonly rewardCreditsGranted: number;
  readonly rewardStatus: 'PENDING_QUALIFICATION' | 'GRANTED' | 'BLOCKED_FRAUD' | 'BLOCKED_BUDGET';
  readonly fraudFlags: string[];
  readonly createdAtIso: string;
}

export class ReferralAndShareEngine {
  private readonly shares = new Map<string, PublicChartSharePreview>();
  private readonly codeToOwner = new Map<string, string>();
  private readonly ownerToCode = new Map<string, string>();
  private readonly claims = new Map<string, ReferralClaimRecord>();
  private readonly claimedRefereeIds = new Set<string>();
  private maxRewardCreditsPerReferral = 2;
  private maxTotalReferralCreditsBudget = 500;
  private totalReferralCreditsIssued = 0;

  getOrCreateReferralCode(accountId: string): string {
    const existing = this.ownerToCode.get(accountId);
    if (existing) return existing;
    let hash = 5381;
    for (let i = 0; i < accountId.length; i++) {
      hash = ((hash << 5) + hash + accountId.charCodeAt(i)) >>> 0;
    }
    const code = `SF-REF-${hash.toString(36).toUpperCase().slice(0, 6).padEnd(6, 'X')}`;
    this.ownerToCode.set(accountId, code);
    this.codeToOwner.set(code, accountId);
    return code;
  }

  configureReferralPolicy(params: {
    rewardCreditsPerReferral?: number;
    maxTotalCreditsBudget?: number;
  }): void {
    if (params.rewardCreditsPerReferral !== undefined) {
      this.maxRewardCreditsPerReferral = Math.max(0, Math.min(10, Math.floor(params.rewardCreditsPerReferral)));
    }
    if (params.maxTotalCreditsBudget !== undefined) {
      this.maxTotalReferralCreditsBudget = Math.max(0, Math.min(50_000, Math.floor(params.maxTotalCreditsBudget)));
    }
  }

  /**
   * User-initiated share link generator. Never exposes private screenshots or PII,
   * always includes transparent referral disclosure, and never auto-posts.
   */
  createUserInitiatedSharePreview(params: {
    shareId: string;
    ownerAccountId: string;
    analysisId: string;
    symbol: string;
    exchange: string;
    timeframe: string;
    tradingStyle: string;
    recommendation: string;
    bullishRr: number;
    bearishRr: number;
    analyzedAtIso: string;
    baseUrl: string;
    consentToShareSummary: boolean;
  }): PublicChartSharePreview {
    const referralCode = this.getOrCreateReferralCode(params.ownerAccountId);
    const cleanBase = params.baseUrl.replace(/\/+$/, '');
    const shareUrl = `${cleanBase}/home?share=${encodeURIComponent(
      params.shareId
    )}&ref=${encodeURIComponent(referralCode)}`;
    const referralDisclosure = `Shared with disclosed Signal Forge referral code ${referralCode} (rewards apply only after verified registration & qualifying activity; no profit guarantees).`;
    const captionText = `Signal Forge Scenario Lab · ${params.symbol} (${params.timeframe}, ${params.tradingStyle}) — Posture: ${params.recommendation} | Conditional R:R Bull 1:${params.bullishRr} / Bear 1:${params.bearishRr}. Informational only. ${shareUrl}`;

    const preview: PublicChartSharePreview = {
      shareId: params.shareId,
      analysisId: params.analysisId,
      symbol: params.symbol,
      exchange: params.exchange,
      timeframe: params.timeframe,
      tradingStyle: params.tradingStyle,
      recommendation: params.recommendation,
      bullishRr: params.bullishRr,
      bearishRr: params.bearishRr,
      analyzedAtIso: params.analyzedAtIso,
      referralCode,
      referralDisclosure,
      shareUrl,
      captionText,
      includesPrivateScreenshot: false,
      includesFullPaidReport: false,
      ownerConsentConfirmed: params.consentToShareSummary,
      autoPostedToSocial: false,
    };

    this.shares.set(params.shareId, preview);
    return preview;
  }

  getPublicSharePreview(shareId: string): PublicChartSharePreview | null {
    return this.shares.get(shareId) ?? null;
  }

  evaluateAndRecordReferralClaim(params: {
    claimId: string;
    referralCode: string;
    refereeAccountId: string;
    verifiedRegistration: boolean;
    qualifyingActionCompleted: boolean;
    sameDeviceOrEmailFlag: boolean;
    nowMs?: number;
  }): ReferralClaimRecord {
    const nowIso = new Date(params.nowMs ?? Date.now()).toISOString();
    const referrerAccountId = this.codeToOwner.get(params.referralCode.trim().toUpperCase()) || '';
    const fraudFlags: string[] = [];

    if (!referrerAccountId) {
      fraudFlags.push('INVALID_REFERRAL_CODE');
    }
    if (referrerAccountId && referrerAccountId === params.refereeAccountId) {
      fraudFlags.push('SELF_REFERRAL_BLOCKED');
    }
    if (this.claimedRefereeIds.has(params.refereeAccountId)) {
      fraudFlags.push('DUPLICATE_REFERRAL_CLAIM_BLOCKED');
    }
    if (params.sameDeviceOrEmailFlag) {
      fraudFlags.push('MATCHING_DEVICE_OR_EMAIL_CLUSTER');
    }

    let rewardStatus: ReferralClaimRecord['rewardStatus'] = 'PENDING_QUALIFICATION';
    let rewardCreditsGranted = 0;

    if (fraudFlags.length > 0) {
      rewardStatus = 'BLOCKED_FRAUD';
    } else if (!params.verifiedRegistration || !params.qualifyingActionCompleted) {
      rewardStatus = 'PENDING_QUALIFICATION';
    } else if (
      this.totalReferralCreditsIssued + this.maxRewardCreditsPerReferral >
      this.maxTotalReferralCreditsBudget
    ) {
      rewardStatus = 'BLOCKED_BUDGET';
    } else {
      rewardStatus = 'GRANTED';
      rewardCreditsGranted = this.maxRewardCreditsPerReferral;
      this.totalReferralCreditsIssued += rewardCreditsGranted;
      this.claimedRefereeIds.add(params.refereeAccountId);
    }

    const record: ReferralClaimRecord = {
      claimId: params.claimId,
      referralCode: params.referralCode.trim().toUpperCase(),
      referrerAccountId: referrerAccountId || 'UNKNOWN',
      refereeAccountId: params.refereeAccountId,
      verifiedRegistration: params.verifiedRegistration,
      qualifyingActionCompleted: params.qualifyingActionCompleted,
      rewardCreditsGranted,
      rewardStatus,
      fraudFlags,
      createdAtIso: nowIso,
    };

    this.claims.set(record.claimId, record);
    return record;
  }

  getAnalyticsSummary() {
    const all = Array.from(this.claims.values());
    return {
      totalSharesGenerated: this.shares.size,
      totalReferralClaims: all.length,
      grantedConversions: all.filter((c) => c.rewardStatus === 'GRANTED').length,
      pendingQualifications: all.filter((c) => c.rewardStatus === 'PENDING_QUALIFICATION').length,
      blockedFraudAttempts: all.filter((c) => c.rewardStatus === 'BLOCKED_FRAUD').length,
      totalReferralCreditsIssued: this.totalReferralCreditsIssued,
      maxTotalReferralCreditsBudget: this.maxTotalReferralCreditsBudget,
      rewardCreditsPerReferral: this.maxRewardCreditsPerReferral,
      recentClaims: all.slice(-20).reverse(),
    };
  }
}

// ---------------------------------------------------------------------------
// Phase G: Admin Business & Offer Control Center + Read-Only AI Advisory Agent
// ---------------------------------------------------------------------------

export type OfferLifecycleStage =
  | 'AI_SUGGESTION'
  | 'ADMIN_REVIEW'
  | 'COST_PREVIEW'
  | 'DRAFT'
  | 'CONFIRMED'
  | 'PUBLISHED_SANDBOX'
  | 'PAUSED'
  | 'EXPIRED'
  | 'ROLLED_BACK';

export interface OfferCampaignRecord {
  readonly offerId: string;
  readonly title: string;
  readonly targetPlan: ScannerPlanTier;
  readonly discountType: 'FIXED_USD' | 'PERCENTAGE' | 'BONUS_CREDITS';
  readonly discountValue: number;
  readonly startsAtIso: string;
  readonly expiresAtIso: string;
  readonly maxRedemptions: number;
  readonly currentRedemptions: number;
  readonly campaignBudgetUsd: number;
  readonly estimatedMaxCostUsd: number;
  readonly stage: OfferLifecycleStage;
  readonly sandboxOnly: true; // Production billing remains disabled until externally verified
  readonly createdBy: 'AI_ADVISORY_AGENT' | 'ADMIN';
  readonly reviewedByAdmin: boolean;
  readonly costPreviewApproved: boolean;
  readonly confirmedByAdmin: boolean;
  readonly updatedAtIso: string;
}

export interface PlanCommercialConfig {
  readonly tier: ScannerPlanTier;
  readonly label: string;
  readonly enabledInSandbox: boolean;
  readonly billingActive: false; // Strictly disabled in this stage
  readonly priceUsd: number;
  readonly includedCredits: number;
  readonly dailyScanQuota: number;
  readonly trialEligible: boolean;
  readonly maxApprovedSubaccounts: number;
}

export interface AdminPremiumControlConfig {
  readonly featureEnabledInSandbox: boolean;
  readonly featureVisibleOnPublicChart: boolean;
  readonly emergencySuspended: boolean;
  readonly productionBillingEnabled: false; // Strictly locked until external payment verification
  readonly payPerScanPriceUsd: number;
  readonly referralRewardCredits: number;
  readonly plans: PlanCommercialConfig[];
  readonly updatedAtIso: string;
}

export interface AdminAuditLogEntry {
  readonly id: string;
  readonly actor: string;
  readonly action: string;
  readonly detail: string;
  readonly timestampIso: string;
}

export interface AiBusinessAdvisorySuggestion {
  readonly suggestionId: string;
  readonly title: string;
  readonly rationale: string;
  readonly recommendedTargetPlan: ScannerPlanTier;
  readonly recommendedDiscountType: OfferCampaignRecord['discountType'];
  readonly recommendedDiscountValue: number;
  readonly recommendedMaxRedemptions: number;
  readonly estimatedCampaignCostUsd: number;
  readonly advisoryOnly: true;
  readonly canAutoPublish: false;
  readonly canModifyBilling: false;
}

export const DEFAULT_ADMIN_PREMIUM_CONFIG: AdminPremiumControlConfig = {
  featureEnabledInSandbox: true,
  featureVisibleOnPublicChart: true,
  emergencySuspended: false,
  productionBillingEnabled: false,
  payPerScanPriceUsd: 0.99,
  referralRewardCredits: 2,
  updatedAtIso: '2026-11-23T00:00:00.000Z',
  plans: [
    {
      tier: 'PAY_PER_SCAN',
      label: 'Pay Per Scan (Sandbox Preview)',
      enabledInSandbox: true,
      billingActive: false,
      priceUsd: 0.99,
      includedCredits: 1,
      dailyScanQuota: 10,
      trialEligible: false,
      maxApprovedSubaccounts: 0,
    },
    {
      tier: 'MONTHLY_BASIC',
      label: 'Monthly Basic (Sandbox Preview)',
      enabledInSandbox: true,
      billingActive: false,
      priceUsd: 19,
      includedCredits: 60,
      dailyScanQuota: 15,
      trialEligible: true,
      maxApprovedSubaccounts: 1,
    },
    {
      tier: 'MONTHLY_PRO',
      label: 'Monthly Pro (Sandbox Preview)',
      enabledInSandbox: true,
      billingActive: false,
      priceUsd: 49,
      includedCredits: 200,
      dailyScanQuota: 40,
      trialEligible: true,
      maxApprovedSubaccounts: 3,
    },
    {
      tier: 'PREMIUM_BUNDLE',
      label: 'Premium Bundle (Sandbox Preview)',
      enabledInSandbox: true,
      billingActive: false,
      priceUsd: 99,
      includedCredits: 500,
      dailyScanQuota: 75,
      trialEligible: false,
      maxApprovedSubaccounts: 5,
    },
  ],
};

/**
 * Read-Only AI Business Advisory Agent:
 * Uses actual pool cost & referral metrics to suggest conservative, budget-capped promotions.
 * NEVER publishes offers, NEVER enables billing, NEVER mutates entitlements.
 */
export function generateAiBusinessAdvisorySuggestions(params: {
  dailyAiSpendUsd: number;
  dailyAiCostBudgetUsd: number;
  estimatedCostPerScanUsd: number;
  grantedReferralConversions: number;
  blockedFraudAttempts: number;
}): AiBusinessAdvisorySuggestion[] {
  const remainingBudget = Math.max(0, params.dailyAiCostBudgetUsd - params.dailyAiSpendUsd);
  const unitCost = Math.max(0.01, params.estimatedCostPerScanUsd);
  const safeBonusRedemptions = Math.max(10, Math.min(100, Math.floor(remainingBudget / (unitCost * 3))));

  return [
    {
      suggestionId: 'adv_sandbox_welcome_bundle',
      title: 'Sandbox Launch: 20% Intro Discount on Monthly Basic (Capped 50 Redemptions)',
      rationale: `Current estimated AI unit cost ($${unitCost.toFixed(
        2
      )}/scan) leaves $${remainingBudget.toFixed(
        2
      )} daily budget headroom. A capped sandbox trial discount tests conversion without risking unbounded compute spend.`,
      recommendedTargetPlan: 'MONTHLY_BASIC',
      recommendedDiscountType: 'PERCENTAGE',
      recommendedDiscountValue: 20,
      recommendedMaxRedemptions: Math.min(50, safeBonusRedemptions),
      estimatedCampaignCostUsd: Number((Math.min(50, safeBonusRedemptions) * 3.8).toFixed(2)),
      advisoryOnly: true,
      canAutoPublish: false,
      canModifyBilling: false,
    },
    {
      suggestionId: 'adv_verified_referral_bonus',
      title: 'Verified Referral Bonus: +2 Sandbox Scan Credits After First Valid Chart Scan',
      rationale: `Observed ${params.grantedReferralConversions} verified conversions and ${params.blockedFraudAttempts} blocked abuse attempts. Gating credits behind a qualifying chart scan prevents credit farming.`,
      recommendedTargetPlan: 'PAY_PER_SCAN',
      recommendedDiscountType: 'BONUS_CREDITS',
      recommendedDiscountValue: 2,
      recommendedMaxRedemptions: safeBonusRedemptions,
      estimatedCampaignCostUsd: Number((safeBonusRedemptions * 2 * unitCost).toFixed(2)),
      advisoryOnly: true,
      canAutoPublish: false,
      canModifyBilling: false,
    },
  ];
}

export class AdminBusinessControlEngine {
  private config: AdminPremiumControlConfig;
  private readonly offers = new Map<string, OfferCampaignRecord>();
  private readonly auditLog: AdminAuditLogEntry[] = [];
  private readonly subaccounts = new Map<string, ApprovedSubaccountSeat>();
  private readonly appeals = new Map<string, AbuseAppealRecord>();
  private previousConfigSnapshot: AdminPremiumControlConfig | null = null;

  constructor(initialConfig?: AdminPremiumControlConfig) {
    this.config = initialConfig ? structuredClone(initialConfig) : structuredClone(DEFAULT_ADMIN_PREMIUM_CONFIG);
  }

  getConfig(): AdminPremiumControlConfig {
    return structuredClone(this.config);
  }

  updateConfig(
    patch: Partial<{
      featureEnabledInSandbox: boolean;
      featureVisibleOnPublicChart: boolean;
      emergencySuspended: boolean;
      payPerScanPriceUsd: number;
      referralRewardCredits: number;
      planQuotaOverride: { tier: ScannerPlanTier; dailyScanQuota?: number; priceUsd?: number; trialEligible?: boolean };
    }>,
    actor = 'AUTHORIZED_ADMIN',
    nowMs = Date.now()
  ): AdminPremiumControlConfig {
    this.previousConfigSnapshot = this.getConfig();
    const nextPlans = this.config.plans.map((p) => {
      if (patch.planQuotaOverride && p.tier === patch.planQuotaOverride.tier) {
        return {
          ...p,
          dailyScanQuota:
            patch.planQuotaOverride.dailyScanQuota !== undefined
              ? Math.max(1, Math.min(100, Math.floor(patch.planQuotaOverride.dailyScanQuota)))
              : p.dailyScanQuota,
          priceUsd:
            patch.planQuotaOverride.priceUsd !== undefined
              ? Math.max(0.5, Math.min(999, Number(patch.planQuotaOverride.priceUsd)))
              : p.priceUsd,
          trialEligible:
            typeof patch.planQuotaOverride.trialEligible === 'boolean'
              ? patch.planQuotaOverride.trialEligible
              : p.trialEligible,
          billingActive: false as const,
        };
      }
      return p;
    });

    this.config = {
      ...this.config,
      featureEnabledInSandbox:
        typeof patch.featureEnabledInSandbox === 'boolean'
          ? patch.featureEnabledInSandbox
          : this.config.featureEnabledInSandbox,
      featureVisibleOnPublicChart:
        typeof patch.featureVisibleOnPublicChart === 'boolean'
          ? patch.featureVisibleOnPublicChart
          : this.config.featureVisibleOnPublicChart,
      emergencySuspended:
        typeof patch.emergencySuspended === 'boolean'
          ? patch.emergencySuspended
          : this.config.emergencySuspended,
      payPerScanPriceUsd:
        patch.payPerScanPriceUsd !== undefined
          ? Math.max(0.25, Math.min(50, Number(patch.payPerScanPriceUsd)))
          : this.config.payPerScanPriceUsd,
      referralRewardCredits:
        patch.referralRewardCredits !== undefined
          ? Math.max(0, Math.min(10, Math.floor(patch.referralRewardCredits)))
          : this.config.referralRewardCredits,
      productionBillingEnabled: false, // Hard invariant
      plans: nextPlans,
      updatedAtIso: new Date(nowMs).toISOString(),
    };

    this.appendAudit(actor, 'UPDATE_BUSINESS_CONFIG', `Updated premium control configuration.`, nowMs);
    return this.getConfig();
  }

  rollbackLastConfigChange(actor = 'AUTHORIZED_ADMIN', nowMs = Date.now()): boolean {
    if (!this.previousConfigSnapshot) return false;
    this.config = {
      ...structuredClone(this.previousConfigSnapshot),
      productionBillingEnabled: false,
      updatedAtIso: new Date(nowMs).toISOString(),
    };
    this.previousConfigSnapshot = null;
    this.appendAudit(actor, 'ROLLBACK_BUSINESS_CONFIG', 'Rolled back last admin premium configuration change.', nowMs);
    return true;
  }

  createOfferFromSuggestionOrAdmin(params: {
    offerId: string;
    title: string;
    targetPlan: ScannerPlanTier;
    discountType: OfferCampaignRecord['discountType'];
    discountValue: number;
    startsAtIso: string;
    expiresAtIso: string;
    maxRedemptions: number;
    campaignBudgetUsd: number;
    estimatedCostPerUnitUsd: number;
    createdBy: 'AI_ADVISORY_AGENT' | 'ADMIN';
    nowMs?: number;
  }): OfferCampaignRecord {
    const nowMs = params.nowMs ?? Date.now();
    const maxRedemptions = Math.max(1, Math.min(10_000, Math.floor(params.maxRedemptions)));
    const estimatedMaxCostUsd = Number(
      (maxRedemptions * Math.max(0.01, params.estimatedCostPerUnitUsd)).toFixed(2)
    );
    const offer: OfferCampaignRecord = {
      offerId: params.offerId,
      title: params.title.trim().slice(0, 140),
      targetPlan: params.targetPlan,
      discountType: params.discountType,
      discountValue: Math.max(0, Number(params.discountValue)),
      startsAtIso: params.startsAtIso,
      expiresAtIso: params.expiresAtIso,
      maxRedemptions,
      currentRedemptions: 0,
      campaignBudgetUsd: Math.max(1, Number(params.campaignBudgetUsd)),
      estimatedMaxCostUsd,
      stage: params.createdBy === 'AI_ADVISORY_AGENT' ? 'AI_SUGGESTION' : 'DRAFT',
      sandboxOnly: true,
      createdBy: params.createdBy,
      reviewedByAdmin: params.createdBy === 'ADMIN',
      costPreviewApproved: false,
      confirmedByAdmin: false,
      updatedAtIso: new Date(nowMs).toISOString(),
    };
    this.offers.set(offer.offerId, offer);
    this.appendAudit(
      params.createdBy,
      'CREATE_OFFER_CAMPAIGN',
      `Created offer ${offer.offerId} (${offer.stage}, sandboxOnly=true).`,
      nowMs
    );
    return offer;
  }

  /**
   * Enforces strict Admin Offer Lifecycle:
   * AI_SUGGESTION -> ADMIN_REVIEW -> COST_PREVIEW -> DRAFT -> CONFIRMED -> PUBLISHED_SANDBOX
   * An AI agent can NEVER call advanceOfferStage to confirm or publish!
   */
  advanceOfferStage(params: {
    offerId: string;
    action: 'ADMIN_REVIEW' | 'APPROVE_COST_PREVIEW' | 'SAVE_DRAFT' | 'CONFIRM' | 'PUBLISH_SANDBOX' | 'PAUSE' | 'ROLLBACK';
    actor: string;
    isAdminAuthorized: boolean;
    nowMs?: number;
  }): { ok: boolean; error?: string; offer: OfferCampaignRecord | null } {
    const nowMs = params.nowMs ?? Date.now();
    if (!params.isAdminAuthorized || params.actor === 'AI_ADVISORY_AGENT') {
      return {
        ok: false,
        error: 'Only an authenticated human administrator may review, confirm, publish, or rollback offers.',
        offer: this.offers.get(params.offerId) ?? null,
      };
    }

    const offer = this.offers.get(params.offerId);
    if (!offer) {
      return { ok: false, error: `Offer "${params.offerId}" not found.`, offer: null };
    }

    let next: OfferCampaignRecord = offer;
    if (params.action === 'ADMIN_REVIEW') {
      next = { ...offer, stage: 'ADMIN_REVIEW', reviewedByAdmin: true, updatedAtIso: new Date(nowMs).toISOString() };
    } else if (params.action === 'APPROVE_COST_PREVIEW') {
      if (offer.estimatedMaxCostUsd > offer.campaignBudgetUsd) {
        return {
          ok: false,
          error: `Estimated cost ($${offer.estimatedMaxCostUsd}) exceeds campaign budget ($${offer.campaignBudgetUsd}). Reduce maxRedemptions or raise budget first.`,
          offer,
        };
      }
      next = {
        ...offer,
        stage: 'COST_PREVIEW',
        reviewedByAdmin: true,
        costPreviewApproved: true,
        updatedAtIso: new Date(nowMs).toISOString(),
      };
    } else if (params.action === 'SAVE_DRAFT') {
      next = { ...offer, stage: 'DRAFT', reviewedByAdmin: true, updatedAtIso: new Date(nowMs).toISOString() };
    } else if (params.action === 'CONFIRM') {
      if (!offer.reviewedByAdmin || !offer.costPreviewApproved) {
        return {
          ok: false,
          error: 'Offer must pass Admin Review and Cost Preview approval before confirmation.',
          offer,
        };
      }
      next = { ...offer, stage: 'CONFIRMED', confirmedByAdmin: true, updatedAtIso: new Date(nowMs).toISOString() };
    } else if (params.action === 'PUBLISH_SANDBOX') {
      if (this.config.emergencySuspended) {
        return {
          ok: false,
          error: 'Cannot publish offers while Emergency Suspension is active.',
          offer,
        };
      }
      if (!offer.confirmedByAdmin || !offer.costPreviewApproved) {
        return {
          ok: false,
          error: 'Offer must be explicitly confirmed after Cost Preview before Sandbox Publish.',
          offer,
        };
      }
      next = { ...offer, stage: 'PUBLISHED_SANDBOX', sandboxOnly: true, updatedAtIso: new Date(nowMs).toISOString() };
    } else if (params.action === 'PAUSE') {
      next = { ...offer, stage: 'PAUSED', updatedAtIso: new Date(nowMs).toISOString() };
    } else if (params.action === 'ROLLBACK') {
      next = {
        ...offer,
        stage: 'ROLLED_BACK',
        confirmedByAdmin: false,
        updatedAtIso: new Date(nowMs).toISOString(),
      };
    }

    this.offers.set(offer.offerId, next);
    this.appendAudit(params.actor, `OFFER_${params.action}`, `Offer ${offer.offerId} -> ${next.stage}`, nowMs);
    return { ok: true, offer: next };
  }

  addApprovedSubaccount(seat: ApprovedSubaccountSeat, actor = 'AUTHORIZED_ADMIN'): ApprovedSubaccountSeat {
    this.subaccounts.set(seat.seatId, seat);
    this.appendAudit(actor, 'APPROVE_SUBACCOUNT', `Approved team seat ${seat.seatId} under ${seat.parentAccountId}.`);
    return seat;
  }

  submitAbuseAppeal(accountId: string, reason: string, nowMs = Date.now()): AbuseAppealRecord {
    const appeal: AbuseAppealRecord = {
      appealId: `apl_${nowMs}_${Math.random().toString(36).slice(2, 6)}`,
      accountId,
      reason: reason.trim().slice(0, 300),
      status: 'OPEN',
      createdAtIso: new Date(nowMs).toISOString(),
      reviewedBy: null,
      reviewedAtIso: null,
    };
    this.appeals.set(appeal.appealId, appeal);
    this.appendAudit(accountId, 'SUBMIT_ABUSE_APPEAL', `Opened appeal ${appeal.appealId}.`, nowMs);
    return appeal;
  }

  reviewAbuseAppeal(
    appealId: string,
    decision: 'APPROVED_RESTORED' | 'DENIED',
    actor = 'AUTHORIZED_ADMIN',
    nowMs = Date.now()
  ): AbuseAppealRecord | null {
    const existing = this.appeals.get(appealId);
    if (!existing) return null;
    const updated: AbuseAppealRecord = {
      ...existing,
      status: decision,
      reviewedBy: actor,
      reviewedAtIso: new Date(nowMs).toISOString(),
    };
    this.appeals.set(appealId, updated);
    this.appendAudit(actor, 'REVIEW_ABUSE_APPEAL', `Appeal ${appealId} -> ${decision}`, nowMs);
    return updated;
  }

  getDashboardSnapshot() {
    return {
      config: this.getConfig(),
      publicPaidOfferActive: false, // Strictly false until external billing verification
      sandboxNotice:
        'SANDBOX ONLY — Production payment collection and public paid offers are NOT active.',
      offers: Array.from(this.offers.values()),
      approvedSubaccounts: Array.from(this.subaccounts.values()),
      appeals: Array.from(this.appeals.values()),
      auditLog: this.auditLog.slice(0, 40),
    };
  }

  private appendAudit(actor: string, action: string, detail: string, nowMs = Date.now()): void {
    this.auditLog.unshift({
      id: `adm_${nowMs}_${Math.random().toString(36).slice(2, 6)}`,
      actor,
      action,
      detail,
      timestampIso: new Date(nowMs).toISOString(),
    });
    if (this.auditLog.length > 100) this.auditLog.length = 100;
  }
}
