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
