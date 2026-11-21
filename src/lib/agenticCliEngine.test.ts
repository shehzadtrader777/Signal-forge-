import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  applySingleSearchReplace,
  buildGatewayConnectorCatalog,
  computeUnifiedDiff,
  orchestrateDeterministicCommand,
  validateEditableRepoPath,
} from './agenticCliEngine';
import { AgenticCliGatewayRuntime } from './agenticCliGatewayServer';

test('validateEditableRepoPath blocks path traversal, env files, server.ts, and non-allowlisted roots', () => {
  assert.equal(validateEditableRepoPath('../server.ts').valid, false);
  assert.equal(validateEditableRepoPath('src/config/../../.env').valid, false);
  assert.equal(validateEditableRepoPath('.env.production').valid, false);
  assert.equal(validateEditableRepoPath('server.ts').valid, false);
  assert.equal(validateEditableRepoPath('package.json').valid, false);
  assert.equal(validateEditableRepoPath('firestore.rules').valid, false);
  assert.equal(validateEditableRepoPath('src/config/agenticCliRuntimeConfig.ts').valid, true);
  assert.equal(validateEditableRepoPath('src/components/AgenticCliOrchestratorPanel.tsx').valid, true);
  assert.equal(validateEditableRepoPath('src/config/secret.sh').valid, false);
});

test('buildGatewayConnectorCatalog exposes modular model adapters cleanly without leaking secrets', () => {
  const catalog = buildGatewayConnectorCatalog({
    hasGeminiKey: true,
    hasOpenAiCompatKey: false,
    hasAnthropicKey: false,
  });
  const gemini = catalog.find((c) => c.id === 'gemini-4-hydrogen');
  const local = catalog.find((c) => c.id === 'local-deterministic-v1');
  const openai = catalog.find((c) => c.id === 'openai-compatible-slot');

  assert.equal(gemini?.status, 'READY');
  assert.equal(local?.status, 'READY');
  assert.equal(openai?.status, 'STANDBY');
  assert.ok(catalog.length >= 5);
});

test('orchestrateDeterministicCommand maps voice commands to UI modification functions and local script patches', () => {
  const uiPlan = orchestrateDeterministicCommand(
    'Switch design theme to Terminal, compact layout, and enable VWAP overlay'
  );
  assert.equal(uiPlan.uiActions.length, 3);
  assert.equal(uiPlan.uiActions[0].fn, 'ui.setThemeVariant');
  assert.equal(uiPlan.uiActions[0].params.variant, 'HIGH_CONTRAST_TERMINAL');
  assert.equal(uiPlan.uiActions[1].fn, 'ui.setDensity');
  assert.equal(uiPlan.uiActions[1].params.density, 'COMPACT');
  assert.equal(uiPlan.uiActions[2].fn, 'ui.updateChartIndicators');
  assert.equal(uiPlan.uiActions[2].params.showVwapOverlay, true);

  const sampleCfg = `export const AGENTIC_CLI_RUNTIME_CONFIG = {\n  bannerTagline: 'Old Tagline',\n};`;
  const patchPlan = orchestrateDeterministicCommand(
    'Update config tagline to "Quantum Command Desk"',
    sampleCfg
  );
  assert.ok(patchPlan.filePatchRequest);
  assert.equal(patchPlan.filePatchRequest?.targetPath, 'src/config/agenticCliRuntimeConfig.ts');
  assert.equal(patchPlan.filePatchRequest?.replaceText, `bannerTagline: 'Quantum Command Desk',`);
});

test('computeUnifiedDiff and applySingleSearchReplace generate exact auditable hunks', () => {
  const before = `line1\nbannerTagline: 'Alpha',\nline3`;
  const applied = applySingleSearchReplace(before, `bannerTagline: 'Alpha',`, `bannerTagline: 'Beta',`);
  assert.equal(applied.ok, true);
  const diff = computeUnifiedDiff('src/config/agenticCliRuntimeConfig.ts', before, applied.updatedContent);
  assert.equal(diff.linesAdded, 1);
  assert.equal(diff.linesRemoved, 1);
  assert.ok(diff.diff.includes(`-bannerTagline: 'Alpha',`));
  assert.ok(diff.diff.includes(`+bannerTagline: 'Beta',`));
});

test('AgenticCliGatewayRuntime enforces UI toggle gate, manual confirmation token, safe file write, and revert', async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-cli-test-'));
  try {
    const cfgDir = path.join(tmpRoot, 'src', 'config');
    fs.mkdirSync(cfgDir, { recursive: true });
    const cfgPath = path.join(cfgDir, 'agenticCliRuntimeConfig.ts');
    const originalFile = [
      'export const AGENTIC_CLI_RUNTIME_CONFIG = {',
      "  terminalTitle: 'Signal Forge Agentic CLI Orchestrator',",
      "  promptPrefix: 'sf-agent>',",
      "  bannerTagline: 'Initial Tagline',",
      '};',
      '',
    ].join('\n');
    fs.writeFileSync(cfgPath, originalFile, 'utf8');

    const runtime = new AgenticCliGatewayRuntime(tmpRoot);
    runtime.selectConnector('local-deterministic-v1');

    // 1. Blocked while UI toggle is OFF
    const blocked = await runtime.createProposal({
      command: 'Update config tagline to "Blocked Edit"',
      inputSource: 'VOICE',
    });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.statusCode, 409);

    // 2. Enable UI toggle -> stage proposal (file must remain untouched before manual confirmation!)
    runtime.setLoopEnabled(true);
    const staged = await runtime.createProposal({
      command: 'Update config tagline to "Verified Quantum Tagline"',
      inputSource: 'VOICE',
    });
    assert.equal(staged.ok, true);
    assert.ok(staged.proposal);
    assert.equal(staged.proposal?.status, 'PENDING_CONFIRMATION');
    assert.equal(fs.readFileSync(cfgPath, 'utf8'), originalFile, 'File must NOT change before confirmation');

    // 3. Reject invalid confirmation token
    const badConfirm = runtime.confirmProposal({
      proposalId: staged.proposal!.id,
      confirmationToken: 'invalid-token',
      approved: true,
    });
    assert.equal(badConfirm.ok, false);
    assert.equal(badConfirm.statusCode, 403);
    assert.equal(fs.readFileSync(cfgPath, 'utf8'), originalFile);

    // 4. Confirm with valid token -> file updates cleanly
    const confirmed = runtime.confirmProposal({
      proposalId: staged.proposal!.id,
      confirmationToken: staged.proposal!.confirmationToken,
      approved: true,
    });
    assert.equal(confirmed.ok, true);
    assert.equal(confirmed.proposal?.status, 'EXECUTED');
    assert.equal(confirmed.proposal?.canRevertFile, true);
    assert.ok(fs.readFileSync(cfgPath, 'utf8').includes(`bannerTagline: 'Verified Quantum Tagline',`));

    // 5. Revert restores exact original file content
    const reverted = runtime.revertProposalFile(staged.proposal!.id);
    assert.equal(reverted.ok, true);
    assert.equal(reverted.proposal?.status, 'REVERTED');
    assert.equal(fs.readFileSync(cfgPath, 'utf8'), originalFile);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});
