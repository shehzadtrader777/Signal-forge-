import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { MultiAgentStateSyncEngine } from './agentSyncEngine';
import {
  DESIGN_SYSTEM_VARIANTS,
  MOTION_120HZ_SPRINGS,
  ORDERED_DESIGN_VARIANTS,
  resolveDensityPaddingClass,
  resolveStatusToneClasses,
} from './designSystem';

const ROOT_DIR = path.resolve(import.meta.dirname, '..', '..');

function readFile(relPath: string): string {
  return fs.readFileSync(path.resolve(ROOT_DIR, relPath), 'utf8');
}

test('MultiAgentStateSyncEngine enforces monotonic epochs, detects price/epoch drift, and reconciles all 7 agents to 0.0 bps', () => {
  const engine = new MultiAgentStateSyncEngine(5.0);

  // Initial synchronized commit at epoch 1
  const snap1 = engine.process({
    symbol: 'BTCUSDT',
    authoritativePrice: 92000,
    epoch: 1,
    nowMs: 1_700_000_001_000,
  });
  assert.equal(snap1.globalEpoch, 1);
  assert.equal(snap1.totalAgents, 7);
  assert.equal(snap1.synchronizedAgents, 7);
  assert.equal(snap1.maxDriftBps, 0);
  assert.equal(snap1.allAgentsLocked, true);
  assert.equal(snap1.totalDriftCorrections, 0);

  // Inject out-of-order epoch (0) + drifting SMC_FRVP price (92400 -> 43 bps) & stale PATTERN_SCANNER epoch
  const snap2 = engine.process({
    symbol: 'BTCUSDT',
    authoritativePrice: 92000,
    epoch: 0, // Must NOT regress below 1; monotonic guard advances to 2
    agentReports: {
      SMC_FRVP: { reportedPrice: 92400, reportedEpoch: 2 },
      PATTERN_SCANNER: { reportedPrice: 92000, reportedEpoch: 1 },
    },
    nowMs: 1_700_000_002_000,
  });

  assert.equal(snap2.globalEpoch, 2, 'Global epoch must advance monotonically even on stale commit input');
  assert.equal(snap2.totalDriftCorrections, 2, 'Both price-drifted and epoch-stale agents must be caught & corrected');
  assert.equal(snap2.maxDriftBps, 0, 'Post-reconciliation residual drift must be 0.0 bps across all agents');
  assert.equal(snap2.allAgentsLocked, true);

  const smc = snap2.agents.find((a) => a.agentId === 'SMC_FRVP');
  assert.equal(smc?.status, 'RECONCILING');
  assert.equal(smc?.driftCorrectionsCount, 1);
  assert.equal(smc?.reportedPrice, 92000);

  // Deterministic consensus hash changes across epochs
  assert.notEqual(snap1.consensusHash, snap2.consensusHash);

  // Force full reconciliation clears RECONCILING back to SYNCHRONIZED at next monotonic epoch
  const snap3 = engine.forceReconcileAll('ETHUSDT', 3250, 1_700_000_003_000);
  assert.equal(snap3.globalEpoch, 3);
  assert.equal(snap3.symbol, 'ETHUSDT');
  assert.equal(snap3.authoritativePrice, 3250);
  assert.ok(snap3.agents.every((a) => a.status === 'SYNCHRONIZED' && a.driftBps === 0));
});

test('Multi-Design System tokens and 120Hz motion physics enforce strict type contracts across all 3 variants', () => {
  assert.deepEqual(ORDERED_DESIGN_VARIANTS, [
    'CYBER_AI',
    'INSTITUTIONAL_SLATE',
    'HIGH_CONTRAST_TERMINAL',
  ]);

  for (const variantId of ORDERED_DESIGN_VARIANTS) {
    const spec = DESIGN_SYSTEM_VARIANTS[variantId];
    assert.equal(spec.id, variantId);
    assert.ok(spec.label.length > 0);
    assert.ok(spec.surfaceClass.includes('forge-surface'));
    assert.ok(spec.activeTabBgClass.length > 0);
    assert.ok(spec.primaryButtonClass.length > 0);
  }

  // 120Hz springs must stay crisp (stiffness >= 400, mass < 1) and fast compositor curve <= 200ms
  assert.ok(MOTION_120HZ_SPRINGS.snappy.stiffness >= 400);
  assert.ok(MOTION_120HZ_SPRINGS.snappy.mass < 1);
  assert.ok(MOTION_120HZ_SPRINGS.compositorFast.duration <= 0.2);

  assert.equal(resolveStatusToneClasses('NOMINAL'), 'text-emerald-400');
  assert.equal(resolveStatusToneClasses('CRITICAL'), 'text-rose-400');
  assert.equal(resolveDensityPaddingClass('COMPACT'), 'px-4 py-3');
  assert.equal(resolveDensityPaddingClass('STANDARD'), 'px-5 py-4');
});

test('120Hz Rendering Pipeline & Strict Modularity Audit: GPU scrolling, CSS containment, compositor-only drawers, and React.memo across all dashboard widgets', () => {
  // 1. Global CSS must NOT use background-attachment: fixed (blocks 120Hz compositor scrolling)
  const css = readFile('src/index.css');
  assert.equal(
    /background-attachment\s*:\s*fixed/.test(css),
    false,
    'src/index.css must avoid background-attachment: fixed to maintain 120Hz GPU-composited scroll'
  );
  assert.ok(css.includes('.forge-widget-contain'), 'src/index.css must define .forge-widget-contain CSS containment');
  assert.ok(css.includes('contain: layout style'), '.forge-widget-contain must isolate layout & style recalculation');

  // 2. MultiScreenWorkspaceBar must NOT animate layout height ('auto')
  const wsBar = readFile('src/components/MultiScreenWorkspaceBar.tsx');
  assert.equal(
    /height\s*:\s*['"]auto['"]/.test(wsBar),
    false,
    'MultiScreenWorkspaceBar must use compositor-only ForgeAnimatedDrawer rather than animating layout height'
  );
  assert.ok(wsBar.includes('ForgeAnimatedDrawer') && wsBar.includes('ForgeSegmentedControl'));

  // 3. Strict zero explicit `any` across design system, UI widget kit, sync engine, and workspace store
  const strictFiles = [
    'src/lib/designSystem.ts',
    'src/lib/agentSyncEngine.ts',
    'src/lib/profitVaultEngine.ts',
    'src/lib/tokenBucketLimiter.ts',
    'src/lib/multiAgentDebateEngine.ts',
    'src/lib/commandControlHub.ts',
    'src/lib/multiAgentTradingArchitecture.ts',
    'src/lib/globalSearchIndex.ts',
    'src/lib/agenticCliEngine.ts',
    'src/lib/agenticCliGatewayServer.ts',
    'src/lib/fableOrchestratorEngine.ts',
    'src/lib/fableOrchestratorServer.ts',
    'src/lib/freqtradeCoreEngine.ts',
    'src/lib/freqtradeCoreServer.ts',
    'src/lib/hybridArchitectureEngine.ts',
    'src/lib/hybridArchitectureServer.ts',
    'src/config/agenticCliRuntimeConfig.ts',
    'src/components/ui/ForgeDesignSystem.tsx',
    'src/components/AgentSyncAndRenderAuditPanel.tsx',
    'src/components/ProfitVaultAndDailyPnlPanel.tsx',
    'src/components/MultiAgentDebateAndSelfHealingPanel.tsx',
    'src/components/CommandControlSettingsHub.tsx',
    'src/components/FloatingWidgetDock.tsx',
    'src/components/FloatingTelegramChannel.tsx',
    'src/components/LivePriceStrip.tsx',
    'src/components/FooterSocialAndContact.tsx',
    'src/components/GlobalSearchModal.tsx',
    'src/components/MultiAgentCommandOrchestratorPanel.tsx',
    'src/components/AgenticCliOrchestratorPanel.tsx',
    'src/components/FableOrchestratorPanel.tsx',
    'src/components/FreqtradeUnifiedTerminal.tsx',
    'src/components/HybridArchitectureConsole.tsx',
    'src/store/useWorkspaceStore.ts',
    'src/store/useCommandControlStore.ts',
    'src/store/useTradingArchitectureStore.ts',
  ];
  const anyRegex = /:\s*any\b|\bas\s+any\b/;
  for (const rel of strictFiles) {
    assert.equal(
      anyRegex.test(readFile(rel)),
      false,
      `${rel} must maintain strict TypeScript v5+ definitions with zero explicit "any"`
    );
  }

  // 4. All primary real-time dashboard widgets must be strictly memoized with React.memo
  const memoizedWidgets = [
    'src/components/ui/ForgeDesignSystem.tsx',
    'src/components/MultiScreenWorkspaceBar.tsx',
    'src/components/SystemControlsBar.tsx',
    'src/components/AgentLoopTelemetryPanel.tsx',
    'src/components/AgentSyncAndRenderAuditPanel.tsx',
    'src/components/ModularProfitTakingPanel.tsx',
    'src/components/CandleChart.tsx',
    'src/components/SignalCard.tsx',
    'src/components/SignalDetailModal.tsx',
    'src/components/OrderBookDepthPanel.tsx',
    'src/components/SmcVolumeProfilePanel.tsx',
    'src/components/PatternScannerPanel.tsx',
    'src/components/SentinelAgentPanel.tsx',
    'src/components/ForgeCapitalHub.tsx',
    'src/components/ModularBacktestMatrixPanel.tsx',
    'src/components/ProfitVaultAndDailyPnlPanel.tsx',
    'src/components/MultiAgentDebateAndSelfHealingPanel.tsx',
    'src/components/CommandControlSettingsHub.tsx',
    'src/components/FloatingWidgetDock.tsx',
    'src/components/FloatingTelegramChannel.tsx',
    'src/components/LivePriceStrip.tsx',
    'src/components/FooterSocialAndContact.tsx',
    'src/components/GlobalSearchModal.tsx',
    'src/components/MultiAgentCommandOrchestratorPanel.tsx',
    'src/components/AgenticCliOrchestratorPanel.tsx',
    'src/components/FableOrchestratorPanel.tsx',
    'src/components/FreqtradeUnifiedTerminal.tsx',
    'src/components/HybridArchitectureConsole.tsx',
  ];

  for (const widgetPath of memoizedWidgets) {
    const content = readFile(widgetPath);
    assert.ok(
      /\bmemo\s*\(/.test(content),
      `${widgetPath} must wrap exported widget component with React.memo to lock 120Hz rendering`
    );
  }
});

test('UI Roadmap Refactor Audit: continuous animated ticker, zero top voice controls, consolidated bottom voice widget, sticky WhatsApp/Telegram footer, social icons, and email icon', () => {
  const css = readFile('src/index.css');
  assert.ok(css.includes('@keyframes forgeTickerScroll'), 'index.css must define continuous marquee animation');
  assert.ok(css.includes('.forge-ticker-track'), 'index.css must define .forge-ticker-track');

  const ticker = readFile('src/components/LivePriceStrip.tsx');
  assert.ok(ticker.includes('forge-ticker-track'), 'LivePriceStrip must use continuous marquee track');

  const topBar = readFile('src/components/GlobalAppLiveBar.tsx');
  assert.equal(topBar.includes('voice-ptt-btn'), false, 'Top header must NOT render redundant voice controls');
  assert.equal(topBar.includes('voice-always-listening-btn'), false, 'Top header must NOT render Always-Listening button');
  assert.equal(topBar.includes('voice-emergency-stop-btn'), false, 'Top header must NOT render Voice Stop button');

  const bottomVoice = readFile('src/components/FloatingWidgetDock.tsx');
  assert.ok(bottomVoice.includes('overlay-ptt-btn'), 'Bottom voice widget must include Push-to-Talk');
  assert.ok(bottomVoice.includes('overlay-always-listening-btn'), 'Bottom voice widget must include Always-On');
  assert.ok(bottomVoice.includes('overlay-standby-btn'), 'Bottom voice widget must include Standby');
  assert.ok(bottomVoice.includes('overlay-emergency-toggle-btn'), 'Bottom voice widget must include Emergency Stop/Resume');
  assert.ok(bottomVoice.includes('voice-overlay-audit-log'), 'Bottom voice widget must include consolidated Audit Log');

  const app = readFile('src/App.tsx');
  assert.ok(app.includes('sticky bottom-0'), 'App must pin sticky footer bar');
  assert.ok(app.includes('sticky-footer-whatsapp-widget'), 'Sticky footer must pin WhatsApp widget');
  assert.ok(app.includes('<FloatingTelegramChannel />'), 'Sticky footer must pin Telegram widget');
  assert.ok(app.includes('<FooterSocialIconsRow />'), 'Footer must include clickable social media icons row');
  assert.ok(app.includes('<DedicatedEmailIconLink'), 'Footer must render dedicated email icon link');
  assert.equal(
    app.includes('amirshehzad2647tcs@gmail.com'),
    false,
    'Footer must not display raw email text directly in App.tsx'
  );
});

test('Codebase Refactoring Audit: obsolete FloatingWhatsApp & VoiceCommandAgentPanel pruned and signal_forge_core modules exist', () => {
  assert.equal(
    fs.existsSync(path.resolve(ROOT_DIR, 'src/components/FloatingWhatsApp.tsx')),
    false,
    'Obsolete FloatingWhatsApp.tsx must remain removed'
  );
  assert.equal(
    fs.existsSync(path.resolve(ROOT_DIR, 'src/components/VoiceCommandAgentPanel.tsx')),
    false,
    'Obsolete VoiceCommandAgentPanel.tsx must remain removed'
  );
  for (const rel of [
    'signal_forge_core/exchange/ccxt_router.py',
    'signal_forge_core/engine/dry_run_engine.py',
    'signal_forge_core/rpc/telegram_rpc.py',
    'signal_forge_core/main.py',
    'signal_forge_core/config.example.json',
  ]) {
    assert.equal(
      fs.existsSync(path.resolve(ROOT_DIR, rel)),
      true,
      `Refactored core module ${rel} must exist`
    );
  }
});

test('Hybrid Python+Rust Core & Footer Gemini Attribution Audit: verifies hybrid_core Rust/Python files, Amir Shahzad credit, Gemini logo, and exact disclaimer', () => {
  for (const rel of [
    'hybrid_core/rust_engine/Cargo.toml',
    'hybrid_core/rust_engine/src/main.rs',
    'hybrid_core/rust_engine/src/ipc_ring.rs',
    'hybrid_core/rust_engine/src/mmap_feed.rs',
    'hybrid_core/rust_engine/src/order_book.rs',
    'hybrid_core/python_control_plane/ipc_bridge.py',
    'hybrid_core/python_control_plane/agent_orchestrator.py',
    'hybrid_core/python_control_plane/mmap_backtester.py',
    'hybrid_core/python_control_plane/validation_and_risk.py',
    'hybrid_core/python_control_plane/main.py',
  ]) {
    assert.equal(
      fs.existsSync(path.resolve(ROOT_DIR, rel)),
      true,
      `Hybrid core module ${rel} must exist`
    );
  }

  const footerComp = readFile('src/components/FooterSocialAndContact.tsx');
  assert.ok(footerComp.includes('Co-developed with Gemini'));
  assert.ok(footerComp.includes('Amir Shahzad'));
  assert.ok(footerComp.includes('official-gemini-logo'));
  assert.ok(
    footerComp.includes(
      'This system was architected with the assistance of Gemini, an AI assistant. Trading in financial markets involves substantial risk of capital loss. This tool provides analytical automation but does not guarantee profitability; continuous monitoring and strict risk management remain the sole responsibility of the user.'
    )
  );

  const app = readFile('src/App.tsx');
  assert.ok(app.includes('<GeminiCollaborationAttribution />'));
});


