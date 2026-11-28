import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  COMMAND_HUB_SHORTCUTS,
  buildTradeResultSnapshotFromExecution,
  buildTradeResultSnapshotFromVerified,
  computeBackdropDimOpacity,
  computeWaveformBarHeights,
  extractTradeIdToken,
  resolveDockPresentationMode,
  resolveShortcutFromQuery,
  sanitizeAllowedRoute,
} from './aiCommandHubEngine';
import { createPublicVerifiedTradeRecord, verifyPublicTradeId } from './multiAgentTradingArchitecture';

describe('AI Command Hub Engine (Gemini 4 Hydrogen)', () => {
  it('computes progressive dynamic dimming opacity across visual states', () => {
    const idle = computeBackdropDimOpacity('IDLE');
    const expanded = computeBackdropDimOpacity('EXPANDED');
    const result = computeBackdropDimOpacity('RESULT');
    const processing = computeBackdropDimOpacity('PROCESSING');
    const listening = computeBackdropDimOpacity('LISTENING');

    assert.equal(idle, 0);
    assert.ok(expanded > 0 && expanded < processing);
    assert.ok(result >= expanded && result <= processing);
    assert.ok(listening >= processing && listening <= 0.85);
  });

  it('generates bounded symmetric waveform amplitudes that respond to active voice/processing states', () => {
    const idleBars = computeWaveformBarHeights('IDLE', 0.5, 20);
    const listenBars = computeWaveformBarHeights('LISTENING', 1.2, 20);
    const procBars = computeWaveformBarHeights('PROCESSING', 2.4, 20);

    assert.equal(idleBars.length, 20);
    assert.equal(listenBars.length, 20);
    assert.equal(procBars.length, 20);

    for (const v of [...idleBars, ...listenBars, ...procBars]) {
      assert.ok(v >= 0.14 && v <= 1.0, `Amplitude ${v} out of [0.14, 1.0]`);
    }

    const avg = (arr: readonly number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
    assert.ok(avg(listenBars) > avg(idleBars), 'LISTENING waveform must have higher energy than IDLE');
    assert.ok(avg(procBars) > avg(idleBars), 'PROCESSING waveform must have higher energy than IDLE');
  });

  it('extracts cryptographic Trade IDs and builds instant Trade Result Snapshots', () => {
    assert.equal(extractTradeIdToken('verify sf-trd-btc-9901 please'), 'SF-TRD-BTC-9901');
    assert.equal(extractTradeIdToken('check BTCUSDT price'), null);

    const first = createPublicVerifiedTradeRecord({
      sequenceNumber: 1,
      symbol: 'BTCUSDT',
      direction: 'BUY',
      market: 'SPOT',
      entryPrice: 91_420,
      stopLoss: 89_900,
      takeProfit: 96_800,
      confidence: 92,
      stage: 'CONFIRMED_SETUP',
      patternLabel: 'SMC BOS + FRVP HVN',
      realizedPnlPct: 4.18,
    });
    const verification = verifyPublicTradeId(first.tradeId, [first]);
    const snap = buildTradeResultSnapshotFromVerified(
      first,
      verification.verified,
      verification.integrityStatus
    );

    assert.equal(snap.id, first.tradeId);
    assert.equal(snap.symbol, first.symbol);
    assert.equal(snap.verified, true);
    assert.ok(snap.visualSnapshotSvgDataUri?.startsWith('data:image/svg+xml'));

    const execSnap = buildTradeResultSnapshotFromExecution(
      {
        id: 'ORD-42',
        symbol: 'ETHUSDT',
        direction: 'BUY',
        entryPrice: 3000,
        stopLoss: 2940,
        takeProfit: 3180,
        status: 'OPEN',
        notionalUsd: 1500,
        marketType: 'SPOT',
      },
      3090
    );
    assert.equal(execSnap.pnlPct, 3);
    assert.equal(execSnap.rrLabel, '1:3.0');
    assert.equal(execSnap.routeTarget, '/portfolio');
  });

  it('consolidates pre-login navigation shortcuts and enforces strict route allowlisting', () => {
    const primaryCount = COMMAND_HUB_SHORTCUTS.filter((s) => s.tier === 'PRIMARY').length;
    const extendedCount = COMMAND_HUB_SHORTCUTS.filter((s) => s.tier === 'EXTENDED').length;
    assert.equal(primaryCount, 4);
    assert.ok(extendedCount >= 8);

    assert.equal(resolveShortcutFromQuery('open settings')?.route, '/settings');
    assert.equal(resolveShortcutFromQuery('go to backtesting')?.route, '/backtesting');
    assert.equal(resolveShortcutFromQuery('signals')?.route, '/signals');

    assert.equal(sanitizeAllowedRoute('/settings'), '/settings');
    assert.equal(sanitizeAllowedRoute('https://evil.example'), null);
    assert.equal(sanitizeAllowedRoute('/admin-secret'), null);
  });

  it('switches cleanly between pre-login static waveform button and logged-in draggable AI hub', () => {
    assert.equal(resolveDockPresentationMode(false), 'PRE_LOGIN_STATIC_WAVEFORM');
    assert.equal(resolveDockPresentationMode(true), 'LOGGED_IN_DRAGGABLE_HUB');
  });
});
