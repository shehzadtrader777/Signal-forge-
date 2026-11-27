import React, { useEffect, useRef } from 'react';
import { CandlestickSeries, createChart, ColorType } from 'lightweight-charts';
import type { Candle } from '../lib/marketData';

export interface SignalCandleChartProps {
  candles: readonly Candle[];
  entryPrice?: number | null;
  stopLoss?: number | null;
  takeProfits?: readonly number[];
  dataQuality?: 'LIVE' | 'CACHED' | 'STALE' | 'SIMULATED' | 'UNAVAILABLE';
}

/** Read-only, signal-specific candles. Never substitute fabricated live candles. */
export function SignalCandleChart({
  candles, entryPrice, stopLoss, takeProfits = [], dataQuality = 'UNAVAILABLE',
}: SignalCandleChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cleaned = candles.filter(c =>
    Number.isFinite(c.time) && Number.isFinite(c.open) &&
    Number.isFinite(c.high) && Number.isFinite(c.low) &&
    Number.isFinite(c.close) && c.time > 0 && c.low <= c.high &&
    c.open >= c.low && c.open <= c.high && c.close >= c.low && c.close <= c.high
  );
  const hasCandles = cleaned.length > 0;

  useEffect(() => {
    const host = containerRef.current;
    if (!host || !hasCandles) return;
    const chart = createChart(host, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: '#020617' }, textColor: '#cbd5e1' },
      grid: { vertLines: { color: '#172033' }, horzLines: { color: '#172033' } },
      timeScale: { timeVisible: true, secondsVisible: false },
      rightPriceScale: { borderColor: '#334155' },
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#16a34a', downColor: '#dc2626',
      borderUpColor: '#16a34a', borderDownColor: '#dc2626',
      wickUpColor: '#16a34a', wickDownColor: '#dc2626',
    });
    const unique = new Map<number, typeof cleaned[number]>();
    for (const c of cleaned) unique.set(c.time, c);
    const sorted = [...unique.values()].sort((a, b) => a.time - b.time);
    // Lightweight Charts requires strictly ascending, unique timestamps.
    series.setData(sorted.map(c => ({
      time: c.time as Parameters<typeof series.setData>[0][number]['time'],
      open: c.open, high: c.high, low: c.low, close: c.close,
    })));
    const lines = [
      { price: entryPrice, title: 'ENTRY', color: '#eab308' },
      { price: stopLoss, title: 'STOP LOSS', color: '#ef4444' },
      ...takeProfits.slice(0, 5).map((price, i) => ({ price, title: `TP${i + 1}`, color: '#22c55e' })),
    ];
    for (const line of lines) {
      if (typeof line.price === 'number' && Number.isFinite(line.price) && line.price > 0) {
        series.createPriceLine({
          price: line.price, color: line.color, lineWidth: 1,
          lineStyle: 2, axisLabelVisible: true, title: line.title,
        });
      }
    }
    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [candles, entryPrice, stopLoss, takeProfits, hasCandles]);

  if (!hasCandles) {
    return <div role="status" className="flex h-full min-h-48 items-center justify-center rounded-lg border border-slate-700 p-4 text-center text-sm text-slate-400">
      No verified candle data available for this signal. Chart unavailable.
    </div>;
  }

  return <div className="relative h-full min-h-48 w-full">
    <div ref={containerRef} className="h-full w-full" aria-label="Historical price candle chart" />
    {dataQuality !== 'LIVE' && <div className="pointer-events-none absolute left-2 top-2 rounded bg-slate-900/90 px-2 py-1 text-xs text-amber-300">
      {dataQuality === 'SIMULATED' ? 'SIMULATED DATA' : dataQuality === 'CACHED' ? 'CACHED DATA' : 'NOT VERIFIED LIVE'}
    </div>}
  </div>;
}
export default SignalCandleChart;
