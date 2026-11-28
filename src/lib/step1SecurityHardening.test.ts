import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  classifyAiCommandAuthorization,
  evaluateOperatorSessionGrant,
  maskSenderAddress,
  signOperatorSessionToken,
  verifyOperatorSessionToken,
} from './operatorSessionAuth';
import { buildRbacIdentity, DEFAULT_ADMIN_EMAILS, evaluateRbacAccess } from './rbac';
import { UNAUTHENTICATED_PRINCIPAL, type SubscriptionPrincipal } from './subscriptionGatekeeper';
import { validateEditableRepoPath } from './agenticCliEngine';
import { AgenticCliGatewayRuntime } from './agenticCliGatewayServer';

const TRADER_PRINCIPAL: SubscriptionPrincipal = {
  authenticated: true,
  uid: 'uid_standard_trader',
  email: 'trader@example.com',
  emailVerified: true,
  tier: 'PRO',
  status: 'ACTIVE',
  expiresAtMs: null,
  entitlementId: 'ent_trader',
  planLabel: 'Pro Trader',
};

const OWNER_PRINCIPAL: SubscriptionPrincipal = {
  authenticated: true,
  uid: 'uid_verified_owner',
  email: 'owner-admin@example.com',
  emailVerified: true,
  tier: 'PREMIUM_INSTITUTIONAL',
  status: 'ACTIVE',
  expiresAtMs: null,
  entitlementId: 'ent_owner',
  planLabel: 'Owner',
};

test('ISS-007: DEFAULT_ADMIN_EMAILS contains zero hardcoded personal emails and maskSenderAddress redacts PII', () => {
  assert.equal(DEFAULT_ADMIN_EMAILS.length, 0);
  assert.equal(
    maskSenderAddress('Signal Forge <onboarding@resend.dev>'),
    'Signal Forge <onboarding@resend.dev>'
  );
  const masked = maskSenderAddress('Signal Forge <private.owner@gmail.com>');
  assert.ok(!masked.includes('private.owner@gmail.com'));
  assert.ok(masked.includes('@gmail.com'));
  assert.equal(maskSenderAddress(''), 'Not configured');
});

test('ISS-002: Operator session grant denies guests (401) and non-admin traders (403) and authorizes verified SUPER_ADMIN (200)', () => {
  const guestId = buildRbacIdentity(UNAUTHENTICATED_PRINCIPAL);
  const guestGrant = evaluateOperatorSessionGrant(guestId);
  assert.equal(guestGrant.allowed, false);
  assert.equal(guestGrant.httpStatus, 401);
  assert.equal(guestGrant.code, 'AUTH_REQUIRED');

  const traderId = buildRbacIdentity(TRADER_PRINCIPAL, ['owner-admin@example.com']);
  assert.equal(traderId.role, 'TRADER');
  const traderGrant = evaluateOperatorSessionGrant(traderId);
  assert.equal(traderGrant.allowed, false);
  assert.equal(traderGrant.httpStatus, 403);
  assert.equal(traderGrant.code, 'OPERATOR_ROLE_REQUIRED');

  const ownerId = buildRbacIdentity(OWNER_PRINCIPAL, ['owner-admin@example.com']);
  assert.equal(ownerId.role, 'SUPER_ADMIN');
  const ownerGrant = evaluateOperatorSessionGrant(ownerId);
  assert.equal(ownerGrant.allowed, true);
  assert.equal(ownerGrant.httpStatus, 200);
  assert.equal(ownerGrant.code, 'AUTHORIZED');
});

test('ISS-002: v2 HMAC operator session tokens bind identity, verify cleanly, and reject legacy v1, expired, tampered, or non-admin tokens', () => {
  const signingKey = 'unit-test-ephemeral-signing-key-32bytes';
  const now = 1_760_000_000_000;

  const minted = signOperatorSessionToken({
    uid: 'uid_verified_owner',
    role: 'SUPER_ADMIN',
    signingKey,
    ttlMs: 60_000,
    nowMs: now,
  });

  const verified = verifyOperatorSessionToken(minted.token, signingKey, now + 10_000);
  assert.ok(verified);
  assert.equal(verified.uid, 'uid_verified_owner');
  assert.equal(verified.role, 'SUPER_ADMIN');

  // Expired token rejected
  assert.equal(verifyOperatorSessionToken(minted.token, signingKey, now + 61_000), null);

  // Wrong signing key rejected
  assert.equal(verifyOperatorSessionToken(minted.token, 'wrong-key', now + 1_000), null);

  // Tampered payload rejected
  const tampered = minted.token.replace('SUPER_ADMIN', 'ADMIN');
  assert.equal(verifyOperatorSessionToken(tampered, signingKey, now + 1_000), null);

  // Legacy anonymous v1 format (exp.nonce.sig) strictly rejected
  assert.equal(verifyOperatorSessionToken(`${now + 60_000}.abcdef123456.deadbeef`, signingKey, now), null);

  // Non-operator role cannot be signed
  assert.throws(() =>
    signOperatorSessionToken({
      uid: 'uid_trader',
      role: 'TRADER' as unknown as 'ADMIN',
      signingKey,
      ttlMs: 60_000,
    })
  );
});

test('ISS-006: AI Command Hub authorization enforces public read-only, authenticated query, admin RBAC, and immutable HTTP 423 trading lock', () => {
  const guestId = buildRbacIdentity(UNAUTHENTICATED_PRINCIPAL);
  const traderId = buildRbacIdentity(TRADER_PRINCIPAL, ['owner-admin@example.com']);
  const ownerId = buildRbacIdentity(OWNER_PRINCIPAL, ['owner-admin@example.com']);

  // Public read-only support commands allowed without auth
  for (const prompt of ['hello', 'status', 'help']) {
    const res = classifyAiCommandAuthorization(prompt, guestId);
    assert.equal(res.allowed, true, `Expected public read-only allow for "${prompt}"`);
    assert.equal(res.httpStatus, 200);
    assert.equal(res.scope, 'PUBLIC_READ_ONLY');
  }

  // General Gemini query blocked for guests (401), allowed for authenticated trader (200)
  const guestLlm = classifyAiCommandAuthorization('Analyze BTCUSDT 4h RSI divergence', guestId);
  assert.equal(guestLlm.allowed, false);
  assert.equal(guestLlm.httpStatus, 401);
  assert.equal(guestLlm.code, 'AUTH_REQUIRED');

  const traderLlm = classifyAiCommandAuthorization('Analyze BTCUSDT 4h RSI divergence', traderId);
  assert.equal(traderLlm.allowed, true);
  assert.equal(traderLlm.httpStatus, 200);
  assert.equal(traderLlm.scope, 'AUTHENTICATED_AI_QUERY');

  // Administrative commands blocked for guests (401) and traders (403), allowed for owner (200)
  const adminPrompt = 'Rotate gemini api key in provider vault';
  assert.equal(classifyAiCommandAuthorization(adminPrompt, guestId).httpStatus, 401);
  assert.equal(classifyAiCommandAuthorization(adminPrompt, traderId).httpStatus, 403);
  const ownerAdmin = classifyAiCommandAuthorization(adminPrompt, ownerId);
  assert.equal(ownerAdmin.allowed, true);
  assert.equal(ownerAdmin.httpStatus, 200);

  // Trading execution / vault unlock / HTTP 423 bypass ALWAYS blocked (423), even for SUPER_ADMIN
  const forbiddenPrompts = [
    'Execute buy 1 BTC live order on Binance',
    'Unlock profit vault and withdraw funds',
    'Disable emergency halt and bypass 423 safety lock',
    'Enable live trading immediately',
  ];
  for (const prompt of forbiddenPrompts) {
    for (const actor of [guestId, traderId, ownerId]) {
      const decision = classifyAiCommandAuthorization(prompt, actor);
      assert.equal(decision.allowed, false, `Must block "${prompt}" for ${actor.role}`);
      assert.equal(decision.httpStatus, 423);
      assert.equal(decision.code, 'SAFETY_LOCK_ENFORCED');
    }
  }
});

test('ISS-003: Agentic CLI RBAC, protected security path deny-list, traversal blocking, and symlink confinement', async () => {
  const guestId = buildRbacIdentity(UNAUTHENTICATED_PRINCIPAL);
  const traderId = buildRbacIdentity(TRADER_PRINCIPAL, ['owner-admin@example.com']);
  const ownerId = buildRbacIdentity(OWNER_PRINCIPAL, ['owner-admin@example.com']);

  assert.equal(evaluateRbacAccess(guestId, 'AGENTIC_CLI_WRITE').httpStatus, 401);
  assert.equal(evaluateRbacAccess(traderId, 'AGENTIC_CLI_WRITE').httpStatus, 403);
  assert.equal(evaluateRbacAccess(ownerId, 'AGENTIC_CLI_WRITE').httpStatus, 200);

  // Critical auth/security files cannot be modified via Agentic CLI
  assert.equal(validateEditableRepoPath('src/lib/rbac.ts').valid, false);
  assert.equal(validateEditableRepoPath('src/lib/operatorSessionAuth.ts').valid, false);
  assert.equal(validateEditableRepoPath('src/lib/aiProviderVaultServer.ts').valid, false);
  assert.equal(validateEditableRepoPath('src/lib/agenticCliGatewayServer.ts').valid, false);
  assert.equal(validateEditableRepoPath('src/services/firebaseAuthVerifier.ts').valid, false);
  assert.equal(validateEditableRepoPath('../server.ts').valid, false);
  assert.equal(validateEditableRepoPath('src/config/../../.env').valid, false);

  // Isolated temp workspace verification for symlink escape + authorized confirm/revert
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-step1-cli-'));
  const outsideFile = path.join(os.tmpdir(), `sf-outside-${Date.now()}.ts`);
  try {
    const configDir = path.join(tmpRoot, 'src', 'config');
    fs.mkdirSync(configDir, { recursive: true });
    const targetFile = path.join(configDir, 'agenticCliRuntimeConfig.ts');
    const originalContent =
      "export const AGENTIC_CLI_RUNTIME_CONFIG = {\n  bannerTagline: 'Original Tagline',\n};\n";
    fs.writeFileSync(targetFile, originalContent, 'utf8');

    // Create a symlink inside allowlisted src/config pointing outside workspace
    fs.writeFileSync(outsideFile, 'SECRET_OUTSIDE_WORKSPACE=true\n', 'utf8');
    const symlinkPath = path.join(configDir, 'escapeLink.ts');
    fs.symlinkSync(outsideFile, symlinkPath);

    const runtime = new AgenticCliGatewayRuntime(tmpRoot);
    runtime.setLoopEnabled(true);

    // Symlink escape must be denied on preview
    const escapePreview = runtime.readAllowlistedFile('src/config/escapeLink.ts');
    assert.equal(escapePreview.ok, false);
    assert.match(escapePreview.error ?? '', /symlink|escape|outside/i);

    // Authorized allowlisted edit, confirm, and revert must still work cleanly
    const staged = await runtime.createProposal({
      command: 'Update config tagline to Verified Owner Desk',
      inputSource: 'CLI_TEXT',
    });
    assert.equal(staged.ok, true);
    assert.ok(staged.proposal?.filePatch);

    const confirmed = runtime.confirmProposal({
      proposalId: staged.proposal.id,
      confirmationToken: staged.proposal.confirmationToken,
      approved: true,
    });
    assert.equal(confirmed.ok, true);
    assert.ok(fs.readFileSync(targetFile, 'utf8').includes('Verified Owner Desk'));

    const reverted = runtime.revertProposalFile(staged.proposal.id);
    assert.equal(reverted.ok, true);
    assert.equal(fs.readFileSync(targetFile, 'utf8'), originalContent);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.rmSync(outsideFile, { force: true });
  }
});
