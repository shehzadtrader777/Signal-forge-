import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function readSrc(relPath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relPath), 'utf8');
}

test('CandleChart live reconciliation useEffect does not depend on candles array (prevents live-WS self-loop)', () => {
  const src = readSrc('src/components/CandleChart.tsx');
  const marker = 'Automatic plotted-state discrepancy detection & reconciliation';
  const start = src.indexOf(marker);
  assert.ok(start > 0, 'Expected reconciliation effect comment in CandleChart.tsx');
  const slice = src.slice(start, start + 6000);
  const depMatch = slice.match(/\},\s*\[([\s\S]*?)\]\);/);
  assert.ok(depMatch, 'Expected dependency array on CandleChart reconciliation useEffect');
  const deps = depMatch[1]
    .split(',')
    .map((d) => d.trim())
    .filter(Boolean);
  assert.ok(
    !deps.includes('candles'),
    `CandleChart reconciliation useEffect must not depend on candles directly; found deps: ${deps.join(', ')}`
  );
  assert.ok(deps.includes('hasCandles'), 'Expected boolean hasCandles guard in deps');
  assert.ok(src.includes('lastReanchorKeyRef'), 'Expected lastReanchorKeyRef guard around full reanchor');
  assert.ok(src.includes('lastLiveTickKeyRef'), 'Expected lastLiveTickKeyRef deduplication guard');
});

test('FloatingWidgetDock inspectTradeId is stable across live ticker updates and deduplicates Trade ID lookups', () => {
  const src = readSrc('src/components/FloatingWidgetDock.tsx');
  const start = src.indexOf('const inspectTradeId = useCallback(');
  assert.ok(start > 0, 'Expected inspectTradeId callback in FloatingWidgetDock.tsx');
  const slice = src.slice(start, start + 2600);
  const cbEnd = slice.indexOf('// Instant Trade Result Snapshot presentation');
  assert.ok(cbEnd > 0);
  const cbBody = slice.slice(0, cbEnd);
  assert.ok(
    cbBody.includes('[setSelectedSymbol]'),
    'inspectTradeId must only depend on [setSelectedSymbol] via refs to prevent live ticker re-entry loops'
  );
  assert.ok(
    src.includes('lastAutoInspectedTokenRef'),
    'FloatingWidgetDock must deduplicate automatic Trade ID inspection with lastAutoInspectedTokenRef'
  );
});

test('FreqtradeUnifiedTerminal CORE_CODE effect does not self-depend on sourceCache', () => {
  const src = readSrc('src/components/FreqtradeUnifiedTerminal.tsx');
  const start = src.indexOf('const loadCoreSource = useCallback(');
  assert.ok(start > 0);
  const slice = src.slice(start, start + 1400);
  assert.ok(slice.includes('sourceCacheRef'), 'Expected sourceCacheRef in FreqtradeUnifiedTerminal');
  assert.ok(
    slice.includes('[activeTab, loadCoreSource, selectedModuleId]'),
    'CORE_CODE useEffect must not include sourceCache in dependency array'
  );
});

test('ProfitVaultAndDailyPnlPanel fetchVaultState uses configDirtyRef instead of configDirty dep', () => {
  const src = readSrc('src/components/ProfitVaultAndDailyPnlPanel.tsx');
  const start = src.indexOf('const fetchVaultState = useCallback(');
  assert.ok(start > 0);
  const slice = src.slice(start, start + 900);
  assert.ok(slice.includes('configDirtyRef.current'), 'Expected configDirtyRef.current inside fetchVaultState');
  assert.ok(
    slice.includes('[syncDraftsFromConfig]'),
    'fetchVaultState must not depend on configDirty state'
  );
});

test('Recharts ResponsiveContainer instances enforce minWidth={0} and debounce to avoid React 19 resize update loops', () => {
  for (const file of [
    'src/components/ProfitVaultAndDailyPnlPanel.tsx',
    'src/components/portfolio/AssetAllocationCharts.tsx',
    'src/pages/Backtesting.tsx',
  ]) {
    const src = readSrc(file);
    const matches = [...src.matchAll(/<ResponsiveContainer\b[^>]*>/g)];
    assert.ok(matches.length > 0, `Expected ResponsiveContainer in ${file}`);
    for (const m of matches) {
      assert.ok(
        m[0].includes('minWidth={0}') && m[0].includes('debounce={50}'),
        `${file} ResponsiveContainer missing minWidth={0} debounce={50}: ${m[0]}`
      );
    }
  }
});

test('motion.* components never pass inline object literals to animation/gesture props (React 19 + motion/react v12 safety)', () => {
  const roots = [
    path.resolve(process.cwd(), 'src/components'),
    path.resolve(process.cwd(), 'src/pages'),
  ];
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (full.endsWith('.tsx')) files.push(full);
    }
  };
  roots.forEach(walk);

  const inlineMotionPropRe = /\b(initial|animate|exit|transition|whileTap|whileHover|style)=\{\{/;
  const violations: string[] = [];

  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    if (!src.includes('<motion.')) continue;
    const lines = src.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (!/<motion\./.test(lines[i])) continue;
      const chunk = lines.slice(i, i + 16).join('\n');
      const endIdx = chunk.indexOf('>');
      const tag = endIdx > 0 ? chunk.slice(0, endIdx + 1) : chunk;
      if (inlineMotionPropRe.test(tag)) {
        violations.push(`${path.relative(process.cwd(), file)}:${i + 1}`);
      }
    }
  }

  assert.deepEqual(
    violations,
    [],
    `Found inline object literals on motion.* elements (hoist to module-level constants): ${violations.join(', ')}`
  );
});

test('PublicLiveMarketOverview live-WS tick effect avoids candles array dependency and deduplicates ticks', () => {
  const src = readSrc('src/components/PublicLiveMarketOverview.tsx');
  assert.ok(src.includes('candlesRef'), 'Expected candlesRef in PublicLiveMarketOverview');
  assert.ok(src.includes('lastLiveTickKeyRef'), 'Expected lastLiveTickKeyRef in PublicLiveMarketOverview');
  const marker = 'Keep latest bar synced with live verified WS ticks';
  const start = src.indexOf(marker);
  assert.ok(start > 0);
  const slice = src.slice(start, start + 1400);
  const depMatch = slice.match(/\},\s*\[([\s\S]*?)\]\);/);
  assert.ok(depMatch);
  const deps = depMatch[1]
    .split(',')
    .map((d) => d.trim())
    .filter(Boolean);
  assert.ok(
    !deps.includes('candles'),
    `PublicLiveMarketOverview live tick useEffect must not depend on candles array: ${deps.join(', ')}`
  );
  assert.ok(deps.includes('hasCandles'), 'Expected boolean hasCandles guard in deps');
});

test('App.tsx passes memoized side menu handlers to prevent SideMenuDrawer effect churn during live ticks', () => {
  const src = readSrc('src/App.tsx');
  assert.ok(
    src.includes('handleCloseSideMenu = useCallback'),
    'Expected memoized handleCloseSideMenu in App.tsx'
  );
  assert.ok(
    src.includes('<SideMenuDrawer open={sideMenuOpen} onClose={handleCloseSideMenu} />'),
    'SideMenuDrawer must receive memoized handleCloseSideMenu'
  );
});

test('AgentLoopTelemetryPanel does not poll when disabled or when browser tab is hidden', () => {
  const src = readSrc('src/components/AgentLoopTelemetryPanel.tsx');
  assert.ok(src.includes('if (!appLiveEnabled) return;'), 'Telemetry must not poll when live app activity is disabled');
  assert.ok(
    src.includes("typeof document !== 'undefined' && document.hidden"),
    'Telemetry timer must skip polling in hidden tabs'
  );
  assert.ok(src.includes('window.clearInterval(id)'), 'Telemetry timer must be cleaned up');
  assert.ok(src.includes('void fetchTelemetry()'), 'Timer must explicitly handle an ignored async refresh');
  assert.ok(src.includes('const REFRESH_BTN_TAP ='), 'Motion tap props must remain stable across renders');
});
