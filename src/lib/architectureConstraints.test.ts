import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const ROOT_DIR = path.resolve(import.meta.dirname, '..', '..');
const SRC_LIB_DIR = path.resolve(import.meta.dirname);

function readWorkspaceFile(relativePath: string): string {
  return fs.readFileSync(path.resolve(ROOT_DIR, relativePath), 'utf8');
}

test('src/lib modules enforce explicit relative imports and zero unresolvable paths or @/ aliases', () => {
  const libFiles = fs
    .readdirSync(SRC_LIB_DIR)
    .filter((file) => file.endsWith('.ts') && !file.endsWith('.d.ts'));

  assert.ok(libFiles.length >= 15, 'Expected core src/lib modules to exist');

  const importFromRegex = /from\s+['"]([^'"]+)['"]/g;
  for (const file of libFiles) {
    const content = fs.readFileSync(path.resolve(SRC_LIB_DIR, file), 'utf8');
    let match: RegExpExecArray | null;
    while ((match = importFromRegex.exec(content)) !== null) {
      const specifier = match[1];
      assert.equal(
        specifier.startsWith('@/'),
        false,
        `${file} must use relative imports instead of "@/" alias (${specifier}) for Vite + Node tsx dual-runtime compatibility`
      );
      if (specifier.startsWith('.')) {
        const resolvedBase = path.resolve(SRC_LIB_DIR, specifier);
        const exactExists = fs.existsSync(resolvedBase);
        const tsTarget = `${resolvedBase}.ts`;
        const tsExists = fs.existsSync(tsTarget);
        const exists =
          exactExists ||
          tsExists ||
          fs.existsSync(`${resolvedBase}.tsx`) ||
          fs.existsSync(path.join(resolvedBase, 'index.ts'));
        assert.ok(
          exists,
          `Unresolved relative import "${specifier}" in src/lib/${file}`
        );
      }
    }

    const namedImportRegex = /import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+['"](\.[^'"]+)['"]/g;
    let namedMatch: RegExpExecArray | null;
    while ((namedMatch = namedImportRegex.exec(content)) !== null) {
      const targetSpec = namedMatch[2];
      const targetPath = path.resolve(SRC_LIB_DIR, `${targetSpec}.ts`);
      if (!fs.existsSync(targetPath)) continue;
      const targetContent = fs.readFileSync(targetPath, 'utf8');
      const specifiers = namedMatch[1]
        .split(',')
        .map((s) => s.replace(/^\s*type\s+/, '').trim().split(/\s+as\s+/)[0].trim())
        .filter(Boolean);
      for (const sym of specifiers) {
        const exportCheck = new RegExp(
          `export\\s+(?:async\\s+)?(?:function|const|let|var|class|interface|type|enum)\\s+${sym}\\b|export\\s*\\{[^}]*\\b${sym}\\b`
        );
        assert.ok(
          exportCheck.test(targetContent),
          `Missing exported symbol "${sym}" from "${targetSpec}" required by src/lib/${file}`
        );
      }
    }
  }
});

test('package.json locks dependency versions without caret/tilde ranges and provides unified verify script', () => {
  const pkg = JSON.parse(readWorkspaceFile('package.json')) as {
    scripts?: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };

  assert.ok(
    pkg.scripts?.verify?.includes('tsx --test') &&
      pkg.scripts?.verify?.includes('npm run lint') &&
      pkg.scripts?.verify?.includes('npm run build'),
    'package.json scripts.verify must run unit tests, type checks, and production build together'
  );

  for (const section of ['dependencies', 'devDependencies'] as const) {
    const entries = Object.entries(pkg[section] ?? {});
    for (const [pkgName, version] of entries) {
      assert.ok(
        !/^[~^]/.test(version),
        `${section}.${pkgName} should use a locked exact version instead of "${version}"`
      );
    }
  }
});

test('vite.config.ts uses ESM-native import.meta.dirname rather than CommonJS __dirname', () => {
  const viteConfig = readWorkspaceFile('vite.config.ts');
  assert.ok(
    viteConfig.includes('import.meta.dirname'),
    'vite.config.ts must resolve aliases with ESM-native import.meta.dirname'
  );
  assert.equal(
    /\b__dirname\b/.test(viteConfig),
    false,
    'vite.config.ts must not reference CommonJS __dirname under ESM native configLoader'
  );
});

test('AppContext real-time WebSocket and SSE streams maintain frame buffering, health throttling, and App Live kill switches', () => {
  const appContext = readWorkspaceFile('src/context/AppContext.tsx');
  assert.ok(appContext.includes('WsFrameBuffer'), 'AppContext must buffer WS frames via WsFrameBuffer');
  assert.ok(
    appContext.includes('shouldSyncMonitorHealthUi'),
    'AppContext must throttle SSE monitor health state commits via shouldSyncMonitorHealthUi'
  );
  assert.ok(
    appContext.includes('WS_FLUSH_INTERVAL_MS'),
    'AppContext must flush WS batches on a calibrated timer cadence'
  );
  assert.ok(
    appContext.includes('if (!appLiveEnabled || !liveFeedModulesEnabled)'),
    'AppContext real-time intervals must check appLiveEnabled & liveFeedModulesEnabled gates'
  );
});

test('tsconfig.json enforces strict type safety (strict, noImplicitAny, noFallthroughCasesInSwitch)', () => {
  const tsconfig = JSON.parse(readWorkspaceFile('tsconfig.json')) as {
    compilerOptions?: {
      strict?: boolean;
      noImplicitAny?: boolean;
      noFallthroughCasesInSwitch?: boolean;
    };
  };

  assert.equal(tsconfig.compilerOptions?.strict, true, 'tsconfig.json must enforce "strict": true');
  assert.equal(
    tsconfig.compilerOptions?.noImplicitAny,
    true,
    'tsconfig.json must enforce "noImplicitAny": true'
  );
  assert.equal(
    tsconfig.compilerOptions?.noFallthroughCasesInSwitch,
    true,
    'tsconfig.json must enforce "noFallthroughCasesInSwitch": true'
  );
});

test('core logic, shared types, and Forge Capital UI modules maintain zero explicit "any" escape hatches', () => {
  const targetFiles = [
    ...fs
      .readdirSync(SRC_LIB_DIR)
      .filter((file) => file.endsWith('.ts') && !file.endsWith('.d.ts') && !file.endsWith('.test.ts'))
      .map((file) => `src/lib/${file}`),
    'src/types/index.ts',
    'src/components/ForgeCapitalHub.tsx',
    'src/components/LiveTestnetLedger.tsx',
  ];

  const anyPattern = /:\s*any\b|\bas\s+any\b/;
  for (const relPath of targetFiles) {
    const content = readWorkspaceFile(relPath);
    assert.equal(
      anyPattern.test(content),
      false,
      `${relPath} must not contain explicit ": any" or "as any" type escape hatches`
    );
  }
});

test('.github/workflows/ci.yml exists and enforces all Five Phases of the Hardening Sequence including Tripwire gate', () => {
  const ciWorkflow = readWorkspaceFile('.github/workflows/ci.yml');
  for (const requiredStep of [
    'npx tsx --test src/lib/architectureConstraints.test.ts',
    'npx tsx --test src/lib/pitFeed.test.ts src/lib/fillModel.test.ts src/lib/backtest.test.ts',
    'npm run lint',
    'npm run test',
    'npm run build',
    'npm run verify',
  ]) {
    assert.ok(
      ciWorkflow.includes(requiredStep),
      `.github/workflows/ci.yml must enforce gate command: ${requiredStep}`
    );
  }
});

test('L1 Data-Integrity Hard Constraints: zero raw WebSockets/CSVs outside L1 and all backtests run via TripwireFeed', () => {
  const uiFolders = ['src/components', 'src/pages', 'src/context'];
  for (const folder of uiFolders) {
    const absFolder = path.resolve(ROOT_DIR, folder);
    if (!fs.existsSync(absFolder)) continue;
    const walk = (dir: string): string[] => {
      const out: string[] = [];
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...walk(full));
        else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) out.push(full);
      }
      return out;
    };
    for (const filePath of walk(absFolder)) {
      const content = fs.readFileSync(filePath, 'utf8');
      assert.equal(
        /\bnew\s+(?:globalThis\.)?WebSocket\s*\(/.test(content),
        false,
        `${path.relative(ROOT_DIR, filePath)} must not open raw exchange WebSockets directly; route through L1 PITFeed/LiveFeed.`
      );
      assert.equal(
        /\bfs\.readFileSync\b|\bcsv-parse\b|\bpapaparse\b/.test(content),
        false,
        `${path.relative(ROOT_DIR, filePath)} must not read CSVs directly.`
      );
    }
  }

  const backtestSource = readWorkspaceFile('src/lib/backtest.ts');
  assert.ok(
    backtestSource.includes('TripwireFeed') && backtestSource.includes('BacktestFeed'),
    'src/lib/backtest.ts must execute all simulations through BacktestFeed + TripwireFeed.'
  );
  assert.equal(
    /candles\.slice\([^)]*\+\s*6\)/.test(backtestSource),
    false,
    'src/lib/backtest.ts must contain zero future-bar snapshot slices.'
  );
});

test('no_raw_price_access: zero risk-path or UI modules open raw WebSockets or hit raw REST ticker endpoints directly', () => {
  const riskAndExecModules = [
    'src/lib/riskEngine.ts',
    'src/lib/fillModel.ts',
    'src/lib/forgeCapitalHub.ts',
    'src/lib/systemicLayers.ts',
    'src/lib/backtest.ts',
    'src/lib/walkForwardOrchestrator.ts',
    'src/lib/pgV4Gate.ts',
    'src/lib/autonomousSafeguards.ts',
    'src/lib/coordinator.ts',
    'src/lib/masterCoordinator.ts',
    'src/lib/dataIntegrityRuntime.ts',
  ];

  const rawTickerPattern =
    /\bnew\s+(?:globalThis\.)?WebSocket\s*\(|\/api\/v3\/ticker|\/api\/v3\/klines|\/fapi\/v1\/premiumIndex|\/dapi\/v1\/premiumIndex|stream\.binance\.com|fstream\.binance\.com|dstream\.binance\.com/;

  for (const relPath of riskAndExecModules) {
    const content = readWorkspaceFile(relPath);
    assert.equal(
      rawTickerPattern.test(content),
      false,
      `${relPath} violates no_raw_price_access: risk/execution modules must consume prices exclusively via CertifiedPriceOracle / PITFeed.`
    );
  }

  for (const folder of ['src/components', 'src/pages', 'src/context']) {
    const absFolder = path.resolve(ROOT_DIR, folder);
    if (!fs.existsSync(absFolder)) continue;
    const walk = (dir: string): string[] => {
      const out: string[] = [];
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...walk(full));
        else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) out.push(full);
      }
      return out;
    };
    for (const filePath of walk(absFolder)) {
      const content = fs.readFileSync(filePath, 'utf8');
      assert.equal(
        /\bnew\s+(?:globalThis\.)?WebSocket\s*\(|\/fapi\/v1\/premiumIndex|\/dapi\/v1\/premiumIndex/.test(content),
        false,
        `${path.relative(ROOT_DIR, filePath)} violates no_raw_price_access: UI modules cannot bypass backend/CPS.`
      );
    }
  }
});

test('rr_single_compute: planned_rr is computed ONCE in Check 1 (signal_emission) and NEVER recomputed in Check 2 or Check 3', () => {
  const riskEngineSource = readWorkspaceFile('src/lib/riskEngine.ts');

  const check1Idx = riskEngineSource.indexOf('export function checkRRSignalEmission(');
  const check2Idx = riskEngineSource.indexOf('export function checkRRRiskGate(');
  const check3Idx = riskEngineSource.indexOf('export function checkRROrderIntent(');
  const afterCheck3Idx = riskEngineSource.indexOf('export function evaluateThreeStageRRGate(');

  assert.ok(check1Idx > 0 && check2Idx > check1Idx && check3Idx > check2Idx && afterCheck3Idx > check3Idx);

  const check1Body = riskEngineSource.slice(check1Idx, check2Idx);
  const check2Body = riskEngineSource.slice(check2Idx, check3Idx);
  const check3Body = riskEngineSource.slice(check3Idx, afterCheck3Idx);

  assert.equal(
    /\bcomputePlannedRR\s*\(/.test(check1Body),
    true,
    'Check 1 (checkRRSignalEmission) must be the single caller of computePlannedRR().'
  );

  for (const [label, body] of [
    ['checkRRRiskGate (Check 2)', check2Body],
    ['checkRROrderIntent (Check 3)', check3Body],
  ] as const) {
    assert.equal(
      /\bcomputePlannedRR\s*\(/.test(body),
      false,
      `rr_single_compute violated: ${label} must NEVER call computePlannedRR().`
    );
    assert.equal(
      /rewardDistance\s*\/\s*stopDistance/.test(body),
      false,
      `rr_single_compute violated: ${label} must NEVER recompute rewardDistance / stopDistance.`
    );
  }

  // Also ensure FillModel & ForgeCapitalHub do not call computePlannedRR post-signal
  for (const relPath of ['src/lib/fillModel.ts', 'src/lib/forgeCapitalHub.ts']) {
    const content = readWorkspaceFile(relPath);
    assert.equal(
      /\bcomputePlannedRR\s*\(/.test(content),
      false,
      `rr_single_compute violated: ${relPath} must never call computePlannedRR().`
    );
  }
});



