import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  AdminBusinessControlEngine,
  ReferralAndShareEngine,
  evaluateAccountAbuseRisk,
  generateAiBusinessAdvisorySuggestions,
} from './businessControlsAndAbuse';

describe('Phases E, F & G — Anti-Abuse, Organic Sharing/Referrals & Admin Offer Controls', () => {
  it('never permanently bans users solely for sharing an IP address and exempts approved team seats', () => {
    const sharedIpOnly = evaluateAccountAbuseRisk({
      accountId: 'office_user_1',
      hashedIpBucket: 'ip_hash_office_subnet',
      hashedDeviceFingerprint: 'dev_unique_1',
      normalizedEmailKey: 'alice@company.com',
      uploadsInLast10Min: 2,
      accountsSharingIpBucket: 8,
      accountsSharingDevice: 1,
      priorTrialClaimedOnDevice: false,
      isApprovedTeamSeat: false,
    });
    assert.equal(sharedIpOnly.permanentIpBanApplied, false);
    assert.equal(sharedIpOnly.restriction, 'ALLOW'); // Shared IP alone capped at 18 < 25!

    const teamSeat = evaluateAccountAbuseRisk({
      accountId: 'team_seat_2',
      hashedIpBucket: 'ip_hash_office_subnet',
      hashedDeviceFingerprint: 'dev_shared_desk',
      normalizedEmailKey: 'bob@company.com',
      uploadsInLast10Min: 3,
      accountsSharingIpBucket: 12,
      accountsSharingDevice: 4,
      priorTrialClaimedOnDevice: true,
      isApprovedTeamSeat: true,
    });
    assert.equal(teamSeat.restriction, 'ALLOW');
    assert.equal(teamSeat.riskScore, 0);

    // Multi-signal abuse (self-referral + device trial evasion + upload flood) triggers hold with appeal eligibility
    const abusive = evaluateAccountAbuseRisk({
      accountId: 'farm_1',
      hashedIpBucket: 'ip_farm',
      hashedDeviceFingerprint: 'dev_farm',
      normalizedEmailKey: 'farm@example.com',
      referrerAccountId: 'farm_1',
      uploadsInLast10Min: 20,
      accountsSharingIpBucket: 5,
      accountsSharingDevice: 5,
      priorTrialClaimedOnDevice: true,
      isApprovedTeamSeat: false,
    });
    assert.equal(abusive.restriction, 'MANUAL_REVIEW_HOLD');
    assert.equal(abusive.permanentIpBanApplied, false);
    assert.equal(abusive.appealEligible, true);
  });

  it('creates privacy-safe user-initiated shares with disclosed referral links and blocks self/duplicate referral abuse', () => {
    const engine = new ReferralAndShareEngine();
    const preview = engine.createUserInitiatedSharePreview({
      shareId: 'shr_1001',
      ownerAccountId: 'owner_acct_1',
      analysisId: 'scan_1001',
      symbol: 'ETHUSDT',
      exchange: 'BINANCE',
      timeframe: '4h',
      tradingStyle: 'SWING',
      recommendation: 'CONDITIONAL_BULLISH',
      bullishRr: 2.8,
      bearishRr: 2.1,
      analyzedAtIso: '2026-11-23T14:00:00.000Z',
      baseUrl: 'https://signalforge.example.com',
      consentToShareSummary: true,
    });

    assert.equal(preview.includesPrivateScreenshot, false);
    assert.equal(preview.autoPostedToSocial, false);
    assert.ok(preview.shareUrl.includes(`ref=${preview.referralCode}`));
    assert.ok(preview.referralDisclosure.includes(preview.referralCode));

    // Self-referral MUST be blocked
    const selfClaim = engine.evaluateAndRecordReferralClaim({
      claimId: 'clm_self',
      referralCode: preview.referralCode,
      refereeAccountId: 'owner_acct_1',
      verifiedRegistration: true,
      qualifyingActionCompleted: true,
      sameDeviceOrEmailFlag: false,
    });
    assert.equal(selfClaim.rewardStatus, 'BLOCKED_FRAUD');
    assert.equal(selfClaim.rewardCreditsGranted, 0);

    // Legitimate verified referee with qualifying action receives bounded credits
    const validClaim = engine.evaluateAndRecordReferralClaim({
      claimId: 'clm_ok',
      referralCode: preview.referralCode,
      refereeAccountId: 'friend_acct_2',
      verifiedRegistration: true,
      qualifyingActionCompleted: true,
      sameDeviceOrEmailFlag: false,
    });
    assert.equal(validClaim.rewardStatus, 'GRANTED');
    assert.equal(validClaim.rewardCreditsGranted, 2);

    // Duplicate claim by same referee MUST be blocked
    const dupClaim = engine.evaluateAndRecordReferralClaim({
      claimId: 'clm_dup',
      referralCode: preview.referralCode,
      refereeAccountId: 'friend_acct_2',
      verifiedRegistration: true,
      qualifyingActionCompleted: true,
      sameDeviceOrEmailFlag: false,
    });
    assert.equal(dupClaim.rewardStatus, 'BLOCKED_FRAUD');
    assert.equal(dupClaim.rewardCreditsGranted, 0);
  });

  it('prevents AI Business Advisory Agent from publishing offers and enforces full Admin offer workflow + rollback', () => {
    const admin = new AdminBusinessControlEngine();
    const suggestions = generateAiBusinessAdvisorySuggestions({
      dailyAiSpendUsd: 1.2,
      dailyAiCostBudgetUsd: 25,
      estimatedCostPerScanUsd: 0.04,
      grantedReferralConversions: 3,
      blockedFraudAttempts: 2,
    });
    assert.ok(suggestions.length >= 2);
    assert.equal(suggestions[0].advisoryOnly, true);
    assert.equal(suggestions[0].canAutoPublish, false);
    assert.equal(suggestions[0].canModifyBilling, false);

    const offer = admin.createOfferFromSuggestionOrAdmin({
      offerId: 'off_sandbox_1',
      title: suggestions[0].title,
      targetPlan: suggestions[0].recommendedTargetPlan,
      discountType: suggestions[0].recommendedDiscountType,
      discountValue: suggestions[0].recommendedDiscountValue,
      startsAtIso: '2026-11-24T00:00:00.000Z',
      expiresAtIso: '2026-12-01T00:00:00.000Z',
      maxRedemptions: 25,
      campaignBudgetUsd: 150,
      estimatedCostPerUnitUsd: 3.8,
      createdBy: 'AI_ADVISORY_AGENT',
    });
    assert.equal(offer.stage, 'AI_SUGGESTION');
    assert.equal(offer.sandboxOnly, true);

    // AI agent CANNOT publish or confirm!
    const aiAttempt = admin.advanceOfferStage({
      offerId: offer.offerId,
      action: 'PUBLISH_SANDBOX',
      actor: 'AI_ADVISORY_AGENT',
      isAdminAuthorized: false,
    });
    assert.equal(aiAttempt.ok, false);

    // Admin cannot skip Cost Preview or Confirmation
    const skipAttempt = admin.advanceOfferStage({
      offerId: offer.offerId,
      action: 'PUBLISH_SANDBOX',
      actor: 'OWNER_ADMIN',
      isAdminAuthorized: true,
    });
    assert.equal(skipAttempt.ok, false);

    // Authorized full progression: ADMIN_REVIEW -> APPROVE_COST_PREVIEW -> CONFIRM -> PUBLISH_SANDBOX -> ROLLBACK
    assert.equal(
      admin.advanceOfferStage({
        offerId: offer.offerId,
        action: 'ADMIN_REVIEW',
        actor: 'OWNER_ADMIN',
        isAdminAuthorized: true,
      }).ok,
      true
    );
    assert.equal(
      admin.advanceOfferStage({
        offerId: offer.offerId,
        action: 'APPROVE_COST_PREVIEW',
        actor: 'OWNER_ADMIN',
        isAdminAuthorized: true,
      }).ok,
      true
    );
    assert.equal(
      admin.advanceOfferStage({
        offerId: offer.offerId,
        action: 'CONFIRM',
        actor: 'OWNER_ADMIN',
        isAdminAuthorized: true,
      }).ok,
      true
    );
    const pub = admin.advanceOfferStage({
      offerId: offer.offerId,
      action: 'PUBLISH_SANDBOX',
      actor: 'OWNER_ADMIN',
      isAdminAuthorized: true,
    });
    assert.equal(pub.ok, true);
    assert.equal(pub.offer?.stage, 'PUBLISHED_SANDBOX');
    assert.equal(pub.offer?.sandboxOnly, true);

    const dash = admin.getDashboardSnapshot();
    assert.equal(dash.publicPaidOfferActive, false);
    assert.equal(dash.config.productionBillingEnabled, false);

    // Rollback config & offer cleanly
    admin.updateConfig({ payPerScanPriceUsd: 1.49 }, 'OWNER_ADMIN');
    assert.equal(admin.getConfig().payPerScanPriceUsd, 1.49);
    assert.equal(admin.rollbackLastConfigChange('OWNER_ADMIN'), true);
    assert.equal(admin.getConfig().payPerScanPriceUsd, 0.99);
  });
});
