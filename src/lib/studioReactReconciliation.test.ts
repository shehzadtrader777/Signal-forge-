import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = (path: string) => fs.readFileSync(path, 'utf8');

test('Studio Profit Taking fix is preserved without a profiles-array effect dependency', () => {
  const code = src('src/components/ModularProfitTakingPanel.tsx');
  assert.match(code, /quantizedLivePrice/);
  assert.match(code, /profilesVersionSig/);
  assert.match(code, /window\.setTimeout/);
  assert.doesNotMatch(code, /\[selectedAgentId, simAtrPct, simPeakR, livePrice, profiles, runLiveEvaluation\]/);
});

test('Studio backtest matrix repair uses a stable callback and parameter ref', () => {
  const code = src('src/components/ModularBacktestMatrixPanel.tsx');
  assert.match(code, /const paramsRef = useRef\(params\)/);
  assert.match(code, /void runMatrix\(paramsRef\.current\)/);
  assert.match(code, /\}, \[runMatrix\]\)/);
});

test('Studio agent polling throttles hidden tabs and has cleanup', () => {
  const code = src('src/components/AgentLoopTelemetryPanel.tsx');
  assert.match(code, /document\.hidden/);
  assert.match(code, /12_000/);
  assert.match(code, /clearInterval\(id\)/);
});

test('Studio motion props and navigation callbacks avoid unstable inline identities', () => {
  const ui = src('src/components/MultiScreenWorkspaceBar.tsx');
  assert.match(ui, /whileTap=\{PRESET_BTN_TAP\}/);
  assert.match(ui, /whileTap=\{PANEL_BTN_TAP\}/);
  const app = src('src/App.tsx');
  assert.match(app, /handleOpenSideMenu = useCallback/);
  assert.match(app, /handleCloseSideMenu = useCallback/);
});

test('Studio app route reconciliation preserves protected landing and scroll manager', () => {
  const app = src('src/App.tsx');
  assert.match(app, /import \{ PremiumLanding \} from '\.\/pages\/PremiumLanding'/);
  assert.match(app, /import \{ PlansPreview \} from '\.\/pages\/PlansPreview'/);
  assert.match(app, /location\.pathname === '\/welcome'\) return <PremiumLanding \/>/);
  assert.match(app, /location\.pathname === '\/pricing'\) return <PlansPreview \/>/);
  assert.equal((app.match(/<RouteScrollManager \/>/g) || []).length, 1,
    'Route scroll manager must mount once, under BrowserRouter');
  const browserRouter = app.indexOf('<BrowserRouter>');
  const scrollManager = app.indexOf('<RouteScrollManager />');
  const appProvider = app.indexOf('<AppProvider>');
  assert.ok(browserRouter >= 0 && browserRouter < scrollManager && scrollManager < appProvider,
    'Route scroll behavior should be available across all pages, including pre-login landing');
});

test('Studio backtest UI retains synthetic-scenario honesty disclosure', () => {
  const matrix = src('src/components/ModularBacktestMatrixPanel.tsx');
  assert.match(matrix, /data-testid="synthetic-matrix-disclosure"/);
  assert.match(matrix, /Synthetic scenario model — not a verified historical backtest\./);
  assert.match(matrix, /Returns, win rates and the leading agent are illustrative/);
  assert.match(matrix, /out-of-sample checks/);
  assert.match(matrix, /const paramsRef = useRef\(params\)/);
  assert.match(matrix, /void runMatrix\(paramsRef\.current\)/);
});

test('Studio navigation and alerts preserve expanded GitHub route and symbol universe', () => {
  const menu = src('src/components/SideMenuDrawer.tsx');
  assert.ok(menu.includes("{ to: '/welcome', label: 'Welcome & Super Guide'"));
  assert.ok(menu.includes("{ to: '/pricing', label: 'Plans & Roadmap'"));
  const alerts = src('src/pages/Alerts.tsx');
  assert.ok(alerts.includes('buildBacktestResearchUniverse(allKnownCoins, topGainers, Object.keys(tickers))'));
  assert.ok(alerts.includes('alertUniverse.map((c) => ('));
  assert.ok(!alerts.includes('TRACKED_COINS.map((c) => ('), 'Do not regress to the fixed legacy alert universe');
});

test('Studio runtime reconciliation preserves fail-closed Rust IPC and pre-pump safeguards', () => {
  const runtime = src('src/lib/hybridArchitectureServer.ts');
  assert.ok(runtime.includes("parsed.phase1_ipc?.ok === true && transport === 'RUST_UDS_IPC'"));
  assert.ok(runtime.includes('ok: ipcVerified'), 'Fallback transport must not count as successful Rust IPC');
  const rust = src('hybrid_core/rust_engine/src/main.rs');
  assert.ok(rust.includes('stream.set_read_timeout(Some(Duration::from_secs(2)))'));
  assert.ok(rust.includes('stream.set_write_timeout(Some(Duration::from_secs(2)))'));
  assert.ok(rust.includes('!max_position_pct.is_finite()'));
  assert.ok(rust.includes('!max_leverage.is_finite()'));
  assert.ok(rust.includes('!hard_drawdown_pct.is_finite()'));
  assert.ok(rust.includes('NON_FINITE_RISK_ENVELOPE'));
  const pipeline = src('src/lib/executionPipeline.ts');
  assert.ok(pipeline.includes('autoExecuteEligible: false,'));
  assert.ok(pipeline.includes("verificationStatus: 'UNVERIFIED_VOLUME'"));
});
