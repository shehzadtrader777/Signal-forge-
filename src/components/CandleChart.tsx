import { memo, useEffect, useMemo, useRef, useState } from 'react';
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  ColorType,
  CrosshairMode,
  LineStyle,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts';
import { Search, SlidersHorizontal, Star } from 'lucide-react';
import {
  TRACKED_COINS,
  fetchCoinCandles,
  formatCryptoPrice,
  formatCompactUsd,
  type Candle,
  type Timeframe,
} from '../lib/marketData';
import { calculateEMA, calculateRSI } from '../lib/signals';
import { type SmcAgentAnalysis } from '../lib/smcAgent';
import { createLiveFeedKlineChannel } from '../lib/pitFeed';
import {
  DEFAULT_DRIFT_THRESHOLD_PCT,
  reconcileCandleSeriesToLivePrice,
} from '../lib/wsDataEngine';
import {
  TradingViewBinanceSyncArbiter,
  reanchorSeriesToBinanceWs,
  stitchBinanceTickToTradingViewBar,
  type PriceSyncTelemetry,
} from '../lib/priceSyncArbiter';
import { useApp } from '../context/AppContext';
import { useTradingArchitectureStore } from '../store/useTradingArchitectureStore';

const TIMEFRAMES: Timeframe[] = ['15m', '1h', '4h', '1d'];

interface CandleChartProps {
  timeframe: Timeframe;
  onTimeframeChange: (tf: Timeframe) => void;
  onCandlesLoaded?: (symbol: string, candles: Candle[]) => void;
  smcAnalysis?: SmcAgentAnalysis | null;
}

export const CandleChart = memo(function CandleChart({
  timeframe,
  onTimeframeChange,
  onCandlesLoaded,
  smcAnalysis,
}: CandleChartProps) {
  const {
    selectedSymbol,
    setSelectedSymbol,
    tickers,
    watchlist,
    toggleWatchlist,
    allKnownCoins,
    syncVersion,
    liveFeedModulesEnabled,
    reportPriceReconciliation,
  } = useApp();
  const indicatorSuite = useTradingArchitectureStore((s) => s.indicatorSuite);
  const updateIndicatorSuite = useTradingArchitectureStore((s) => s.updateIndicatorSuite);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [indicatorsPopoverOpen, setIndicatorsPopoverOpen] = useState(false);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [dataSource, setDataSource] = useState<'binance' | 'cache'>('cache');
  const [loading, setLoading] = useState(true);
  const [syncTelemetry, setSyncTelemetry] = useState<PriceSyncTelemetry | null>(null);

  const showEma = indicatorSuite.showEmaRibbon;
  const showSmc = indicatorSuite.showSmcOverlay;

  const chartContainerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const emaFastSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const emaMidSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const emaSlowSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const vwapSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const bbUpperSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const bbLowerSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const smcPriceLinesRef = useRef<IPriceLine[]>([]);
  const lastKlinePriceRef = useRef<number | undefined>(undefined);
  const lastReconcileKeyRef = useRef<string>('');
  const upgradedCacheKeyRef = useRef<string>('');
  const syncArbiterRef = useRef<TradingViewBinanceSyncArbiter>(new TradingViewBinanceSyncArbiter());

  const currentTicker = tickers[selectedSymbol];
  const currentCoin =
    allKnownCoins.find((c) => c.symbol === selectedSymbol) ||
    ({
      symbol: selectedSymbol,
      baseAsset: selectedSymbol.replace(/USDT$/i, ''),
      name: currentTicker?.name || selectedSymbol.replace(/USDT$/i, ''),
      referencePrice: currentTicker?.price ?? TRACKED_COINS[0].referencePrice,
      dailyVolatility: 0.05,
    });
  const isWatched = watchlist.includes(selectedSymbol);

  const referencePriceRef = useRef(currentTicker?.price ?? currentCoin.referencePrice);
  referencePriceRef.current =
    currentTicker?.price && currentTicker.price > 0
      ? currentTicker.price
      : currentCoin.referencePrice;
  const onCandlesLoadedRef = useRef(onCandlesLoaded);
  onCandlesLoadedRef.current = onCandlesLoaded;
  const reportReconciliationRef = useRef(reportPriceReconciliation);
  reportReconciliationRef.current = reportPriceReconciliation;

  const filteredCoins = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return allKnownCoins;
    return allKnownCoins.filter(
      (c) =>
        c.symbol.toLowerCase().includes(q) ||
        c.baseAsset.toLowerCase().includes(q) ||
        c.name.toLowerCase().includes(q)
    );
  }, [searchQuery, allKnownCoins]);

  // Initialize TradingView Lightweight Chart once
  useEffect(() => {
    const container = chartContainerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      width: container.clientWidth,
      height: 410,
      layout: {
        background: { type: ColorType.Solid, color: '#0d1323' },
        textColor: '#94a3b8',
        fontFamily: '"JetBrains Mono", monospace',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: 'rgba(30, 41, 59, 0.55)' },
        horzLines: { color: 'rgba(30, 41, 59, 0.55)' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: '#3b82f6', width: 1, labelBackgroundColor: '#1e293b' },
        horzLine: { color: '#3b82f6', width: 1, labelBackgroundColor: '#1e293b' },
      },
      rightPriceScale: {
        borderColor: '#1e293b',
      },
      timeScale: {
        borderColor: '#1e293b',
        timeVisible: true,
        secondsVisible: false,
      },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#10b981',
      downColor: '#ef4444',
      borderVisible: false,
      wickUpColor: '#10b981',
      wickDownColor: '#ef4444',
    });

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: '',
    });
    volumeSeries.priceScale().applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    });

    const emaFastSeries = chart.addSeries(LineSeries, {
      color: '#3b82f6',
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    const emaMidSeries = chart.addSeries(LineSeries, {
      color: '#f59e0b',
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    const emaSlowSeries = chart.addSeries(LineSeries, {
      color: '#a855f7',
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    const vwapSeries = chart.addSeries(LineSeries, {
      color: '#06b6d4',
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    const bbUpperSeries = chart.addSeries(LineSeries, {
      color: 'rgba(148, 163, 184, 0.55)',
      lineWidth: 1,
      lineStyle: LineStyle.Dotted,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    const bbLowerSeries = chart.addSeries(LineSeries, {
      color: 'rgba(148, 163, 184, 0.55)',
      lineWidth: 1,
      lineStyle: LineStyle.Dotted,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;
    emaFastSeriesRef.current = emaFastSeries;
    emaMidSeriesRef.current = emaMidSeries;
    emaSlowSeriesRef.current = emaSlowSeries;
    vwapSeriesRef.current = vwapSeries;
    bbUpperSeriesRef.current = bbUpperSeries;
    bbLowerSeriesRef.current = bbLowerSeries;

    const handleResize = () => {
      if (!chartContainerRef.current || !chartRef.current) return;
      chartRef.current.applyOptions({ width: chartContainerRef.current.clientWidth });
    };

    const observer = new ResizeObserver(handleResize);
    observer.observe(container);

    return () => {
      observer.disconnect();
      chart.remove();
      chartRef.current = null;
    };
  }, []);

  // Load candles whenever coin, timeframe, or forced resync version changes
  useEffect(() => {
    let active = true;
    setLoading(true);
    lastKlinePriceRef.current = undefined;
    lastReconcileKeyRef.current = '';

    const anchorPrice = referencePriceRef.current;
    fetchCoinCandles(selectedSymbol, timeframe, 160, anchorPrice).then((res) => {
      if (!active) return;
      const latestLive = referencePriceRef.current;
      const rec =
        latestLive && latestLive > 0
          ? reconcileCandleSeriesToLivePrice(
              res.candles,
              latestLive,
              DEFAULT_DRIFT_THRESHOLD_PCT,
              res.source
            )
          : null;
      const initialCandles = rec && rec.reconciled ? rec.candles : res.candles;
      const effectiveSource =
        rec?.mode === 'full_reanchor' ? 'binance' : res.source;

      setCandles(initialCandles);
      setDataSource(effectiveSource);
      setLoading(false);
      if (rec?.reconciled) {
        reportReconciliationRef.current?.({
          symbol: selectedSymbol,
          scope: 'CHART_CANDLES',
          discrepancyPct: rec.discrepancyPct,
          thresholdPct: DEFAULT_DRIFT_THRESHOLD_PCT,
          previousPrice: rec.previousClose ?? anchorPrice,
          authoritativePrice: latestLive,
          mode: rec.mode,
        });
      }
      if (onCandlesLoadedRef.current) {
        onCandlesLoadedRef.current(selectedSymbol, initialCandles);
      }
    });

    return () => {
      active = false;
    };
  }, [selectedSymbol, timeframe, syncVersion]);

  // Push candle + expanded indicator suite data to Lightweight Charts series
  useEffect(() => {
    if (
      !candleSeriesRef.current ||
      !volumeSeriesRef.current ||
      !emaFastSeriesRef.current ||
      !emaMidSeriesRef.current ||
      !emaSlowSeriesRef.current ||
      !vwapSeriesRef.current ||
      !bbUpperSeriesRef.current ||
      !bbLowerSeriesRef.current ||
      candles.length === 0
    ) {
      return;
    }

    const formattedCandles = candles.map((c) => ({
      time: c.time as UTCTimestamp,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));

    const formattedVolume = candles.map((c) => ({
      time: c.time as UTCTimestamp,
      value: c.volume,
      color: c.close >= c.open ? 'rgba(16, 185, 129, 0.25)' : 'rgba(239, 68, 68, 0.25)',
    }));

    const closes = candles.map((c) => c.close);
    const emaFast = calculateEMA(closes, indicatorSuite.emaFastPeriod);
    const emaMid = calculateEMA(closes, indicatorSuite.emaMidPeriod);
    const emaSlow = calculateEMA(closes, indicatorSuite.emaSlowPeriod);

    const lastClose = candles[candles.length - 1]?.close ?? 1;
    const precision = lastClose >= 100 ? 2 : lastClose >= 1 ? 4 : lastClose >= 0.01 ? 5 : 6;
    const minMove = Number((1 / Math.pow(10, precision)).toFixed(precision));
    const priceFmt = { type: 'price' as const, precision, minMove };
    candleSeriesRef.current.applyOptions({ priceFormat: priceFmt });
    emaFastSeriesRef.current.applyOptions({ priceFormat: priceFmt });
    emaMidSeriesRef.current.applyOptions({ priceFormat: priceFmt });
    emaSlowSeriesRef.current.applyOptions({ priceFormat: priceFmt });
    vwapSeriesRef.current.applyOptions({ priceFormat: priceFmt });
    bbUpperSeriesRef.current.applyOptions({ priceFormat: priceFmt });
    bbLowerSeriesRef.current.applyOptions({ priceFormat: priceFmt });

    candleSeriesRef.current.setData(formattedCandles);
    volumeSeriesRef.current.setData(formattedVolume);

    if (indicatorSuite.showEmaRibbon) {
      emaFastSeriesRef.current.setData(
        candles.map((c, idx) => ({ time: c.time as UTCTimestamp, value: emaFast[idx] }))
      );
      emaMidSeriesRef.current.setData(
        candles.map((c, idx) => ({ time: c.time as UTCTimestamp, value: emaMid[idx] }))
      );
      emaSlowSeriesRef.current.setData(
        candles.map((c, idx) => ({ time: c.time as UTCTimestamp, value: emaSlow[idx] }))
      );
    } else {
      emaFastSeriesRef.current.setData([]);
      emaMidSeriesRef.current.setData([]);
      emaSlowSeriesRef.current.setData([]);
    }

    if (indicatorSuite.showVwapOverlay) {
      let cumPv = 0;
      let cumVol = 0;
      const vwapPoints = candles.map((c) => {
        const typical = (c.high + c.low + c.close) / 3;
        const vol = Math.max(c.volume, 1e-6);
        cumPv += typical * vol;
        cumVol += vol;
        return { time: c.time as UTCTimestamp, value: cumPv / cumVol };
      });
      vwapSeriesRef.current.setData(vwapPoints);
    } else {
      vwapSeriesRef.current.setData([]);
    }

    if (indicatorSuite.showBollingerBands && candles.length >= 20) {
      const bbPeriod = 20;
      const upperPoints: Array<{ time: UTCTimestamp; value: number }> = [];
      const lowerPoints: Array<{ time: UTCTimestamp; value: number }> = [];
      for (let i = bbPeriod - 1; i < candles.length; i++) {
        let sum = 0;
        for (let j = i - bbPeriod + 1; j <= i; j++) sum += closes[j];
        const mean = sum / bbPeriod;
        let sqSum = 0;
        for (let j = i - bbPeriod + 1; j <= i; j++) {
          const diff = closes[j] - mean;
          sqSum += diff * diff;
        }
        const sd = Math.sqrt(sqSum / bbPeriod);
        upperPoints.push({ time: candles[i].time as UTCTimestamp, value: mean + 2 * sd });
        lowerPoints.push({ time: candles[i].time as UTCTimestamp, value: mean - 2 * sd });
      }
      bbUpperSeriesRef.current.setData(upperPoints);
      bbLowerSeriesRef.current.setData(lowerPoints);
    } else {
      bbUpperSeriesRef.current.setData([]);
      bbLowerSeriesRef.current.setData([]);
    }

    chartRef.current?.timeScale().fitContent();
  }, [candles, indicatorSuite]);

  const smcLevelSignature = useMemo(() => {
    if (!showSmc || !smcAnalysis || candles.length === 0) return '';
    return [
      smcAnalysis.symbol,
      smcAnalysis.direction,
      smcAnalysis.volumeProfile.poc,
      smcAnalysis.volumeProfile.vah,
      smcAnalysis.volumeProfile.val,
      smcAnalysis.entryPrice,
      smcAnalysis.stopLoss,
      smcAnalysis.activeOrderBlock?.mid ?? 0,
      smcAnalysis.targetLiquidityPool,
    ].join('|');
  }, [showSmc, smcAnalysis, candles.length]);

  const appliedSmcSigRef = useRef<string>('');

  // Render SMC + Fixed Range Volume Profile price levels on the candlestick chart
  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series) return;
    if (smcLevelSignature && smcLevelSignature === appliedSmcSigRef.current) {
      return;
    }
    appliedSmcSigRef.current = smcLevelSignature;

    for (const line of smcPriceLinesRef.current) {
      try {
        series.removePriceLine(line);
      } catch {
        // ignore if already removed on chart dispose
      }
    }
    smcPriceLinesRef.current = [];

    if (!showSmc || !smcAnalysis || candles.length === 0) return;

    const linesToAdd: Array<{
      price: number;
      color: string;
      lineWidth: 1 | 2;
      lineStyle: LineStyle;
      title: string;
    }> = [
      {
        price: smcAnalysis.volumeProfile.poc,
        color: '#f59e0b',
        lineWidth: 2,
        lineStyle: LineStyle.Dashed,
        title: 'POC',
      },
      {
        price: smcAnalysis.volumeProfile.vah,
        color: '#60a5fa',
        lineWidth: 1,
        lineStyle: LineStyle.Dotted,
        title: 'VAH',
      },
      {
        price: smcAnalysis.volumeProfile.val,
        color: '#60a5fa',
        lineWidth: 1,
        lineStyle: LineStyle.Dotted,
        title: 'VAL',
      },
      {
        price: smcAnalysis.entryPrice,
        color: '#3b82f6',
        lineWidth: 1,
        lineStyle: LineStyle.Solid,
        title: `${smcAnalysis.direction} Entry`,
      },
      {
        price: smcAnalysis.stopLoss,
        color: '#ef4444',
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        title: 'SMC SL',
      },
    ];

    if (smcAnalysis.activeOrderBlock) {
      linesToAdd.push({
        price: smcAnalysis.activeOrderBlock.mid,
        color: smcAnalysis.activeOrderBlock.type === 'Bullish OB' ? '#10b981' : '#f43f5e',
        lineWidth: 2,
        lineStyle: LineStyle.Solid,
        title: smcAnalysis.activeOrderBlock.zoneRole,
      });
    }

    if (smcAnalysis.targetLiquidityPool > 0) {
      linesToAdd.push({
        price: smcAnalysis.targetLiquidityPool,
        color: '#22c55e',
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        title: smcAnalysis.direction === 'BUY' ? 'Prev High Target' : 'Prev Low Target',
      });
    }

    for (const cfg of linesToAdd) {
      if (!Number.isFinite(cfg.price) || cfg.price <= 0) continue;
      smcPriceLinesRef.current.push(
        series.createPriceLine({
          price: cfg.price,
          color: cfg.color,
          lineWidth: cfg.lineWidth,
          lineStyle: cfg.lineStyle,
          axisLabelVisible: true,
          title: cfg.title,
        })
      );
    }
  }, [smcLevelSignature, showSmc, smcAnalysis, candles.length]);

  // Route live kline updates strictly through L1 PITFeed LiveKlineChannel, anchored to Binance WS parity
  useEffect(() => {
    if (!liveFeedModulesEnabled) {
      return;
    }
    const channel = createLiveFeedKlineChannel({
      symbol: selectedSymbol,
      timeframe,
      initialLastPrice: lastKlinePriceRef.current,
      onBarUpdate: (bar) => {
        if (!candleSeriesRef.current) return;
        const authoritativeWsPrice = referencePriceRef.current;
        const effectiveBar =
          Number.isFinite(authoritativeWsPrice) && authoritativeWsPrice > 0
            ? stitchBinanceTickToTradingViewBar(bar, authoritativeWsPrice).updatedBar
            : bar;
        lastKlinePriceRef.current = effectiveBar.close;
        const ts = effectiveBar.time as UTCTimestamp;
        candleSeriesRef.current.update({
          time: ts,
          open: effectiveBar.open,
          high: effectiveBar.high,
          low: effectiveBar.low,
          close: effectiveBar.close,
        });
        volumeSeriesRef.current?.update({
          time: ts,
          value: effectiveBar.volume,
          color:
            effectiveBar.close >= effectiveBar.open
              ? 'rgba(16, 185, 129, 0.25)'
              : 'rgba(239, 68, 68, 0.25)',
        });
      },
    });
    return () => {
      channel.stop();
    };
  }, [selectedSymbol, timeframe, liveFeedModulesEnabled]);

  // Automatic plotted-state discrepancy detection & immediate reconciliation with live authoritative price
  useEffect(() => {
    const livePrice = currentTicker?.price;
    if (loading || candles.length === 0 || !livePrice || !Number.isFinite(livePrice) || livePrice <= 0) {
      return;
    }

    const rec = reconcileCandleSeriesToLivePrice(
      candles,
      livePrice,
      DEFAULT_DRIFT_THRESHOLD_PCT,
      dataSource
    );

    if (rec.reconciled) {
      const guardKey = `${selectedSymbol}_${timeframe}_${Math.round(livePrice * 1e4)}_${rec.mode}`;
      if (guardKey !== lastReconcileKeyRef.current) {
        lastReconcileKeyRef.current = guardKey;
        setCandles(rec.candles);
        if (rec.mode === 'full_reanchor') {
          setDataSource('binance');
        }
        onCandlesLoadedRef.current?.(selectedSymbol, rec.candles);
        reportReconciliationRef.current?.({
          symbol: selectedSymbol,
          scope: 'CHART_CANDLES',
          discrepancyPct: rec.discrepancyPct,
          thresholdPct: DEFAULT_DRIFT_THRESHOLD_PCT,
          previousPrice: rec.previousClose ?? livePrice,
          authoritativePrice: livePrice,
          mode: rec.mode,
        });
      }
      return;
    }

    // If chart initialized from fallback cache before WS arrived, upgrade once to live exchange klines
    if (dataSource === 'cache' && currentTicker?.isLiveWs) {
      const upgradeKey = `${selectedSymbol}_${timeframe}`;
      if (upgradedCacheKeyRef.current !== upgradeKey) {
        upgradedCacheKeyRef.current = upgradeKey;
        fetchCoinCandles(selectedSymbol, timeframe, 160, livePrice).then((fresh) => {
          const synced = reconcileCandleSeriesToLivePrice(
            fresh.candles,
            livePrice,
            DEFAULT_DRIFT_THRESHOLD_PCT,
            fresh.source
          );
          setCandles(synced.candles);
          setDataSource(fresh.source);
          onCandlesLoadedRef.current?.(selectedSymbol, synced.candles);
        });
      }
    }

    if (!liveFeedModulesEnabled || !candleSeriesRef.current) return;
    const last = candles[candles.length - 1];
    const stitched = stitchBinanceTickToTradingViewBar(last, livePrice);
    if (stitched.requiresFullReanchor) {
      const reanchored = reanchorSeriesToBinanceWs(candles, livePrice);
      setCandles(reanchored);
      onCandlesLoadedRef.current?.(selectedSymbol, reanchored);
    } else {
      try {
        candleSeriesRef.current.update({
          time: stitched.updatedBar.time as UTCTimestamp,
          open: stitched.updatedBar.open,
          high: stitched.updatedBar.high,
          low: stitched.updatedBar.low,
          close: stitched.updatedBar.close,
        });
      } catch {
        // ignore if chart series disposed
      }
    }
    lastKlinePriceRef.current = livePrice;
    const nextTelemetry = syncArbiterRef.current.recordTick(
      selectedSymbol,
      last.close,
      livePrice,
      stitched.parityStatus !== 'LOCKED'
    );
    setSyncTelemetry(nextTelemetry);
  }, [
    candles,
    currentTicker?.price,
    currentTicker?.isLiveWs,
    dataSource,
    loading,
    selectedSymbol,
    timeframe,
    liveFeedModulesEnabled,
  ]);

  const latestCandle = candles[candles.length - 1];
  const displayPrice = currentTicker?.price ?? latestCandle?.close ?? currentCoin.referencePrice;
  const changePct = currentTicker?.change24hPercent ?? 0;

  const liveRsiValue = useMemo(() => {
    if (candles.length < indicatorSuite.rsiPeriod + 1) return null;
    return Number(
      calculateRSI(
        candles.map((c) => c.close),
        indicatorSuite.rsiPeriod
      ).toFixed(1)
    );
  }, [candles, indicatorSuite.rsiPeriod]);

  return (
    <div className="cyber-surface rounded-xl border overflow-hidden">
      {/* Top Toolbar: Coin Info, Search Bar, Timeframe Switcher */}
      <div className="flex flex-col gap-3 border-b border-slate-800/80 p-4 xl:flex-row xl:items-center xl:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="font-display text-xl font-bold text-white tracking-tight truncate">
              {currentCoin.name}
            </h2>
            <span className="font-mono text-xs text-slate-400">{currentCoin.symbol}</span>
            <button
              type="button"
              onClick={() => toggleWatchlist(selectedSymbol)}
              aria-label={isWatched ? `Remove ${selectedSymbol} from watchlist` : `Add ${selectedSymbol} to watchlist`}
              className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                isWatched
                  ? 'bg-amber-500/15 text-amber-400 hover:bg-amber-500/25'
                  : 'bg-slate-800/80 text-slate-400 hover:text-white'
              }`}
            >
              <Star className={`h-3.5 w-3.5 ${isWatched ? 'fill-amber-400' : ''}`} />
              <span>{isWatched ? 'Saved' : 'Watch'}</span>
            </button>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-slate-400">
            <span className="font-mono text-lg font-semibold text-white tabular-nums">
              ${formatCryptoPrice(displayPrice)}
            </span>
            <span
              className={`font-mono font-semibold tabular-nums whitespace-nowrap ${
                changePct >= 0 ? 'text-emerald-400' : 'text-rose-400'
              }`}
            >
              {changePct >= 0 ? '+' : ''}
              {changePct.toFixed(2)}% (24h)
            </span>
            <span aria-hidden="true">·</span>
            <span className="tabular-nums whitespace-nowrap">
              Vol {formatCompactUsd(currentTicker?.volume24hUsd ?? 850_000_000)}
            </span>
            <span aria-hidden="true">·</span>
            <span className="whitespace-nowrap">
              {!liveFeedModulesEnabled
                ? 'Spot Feed Paused'
                : dataSource === 'binance' || currentTicker?.isLiveWs
                ? 'Binance Spot'
                : 'Spot Sync'}
            </span>
            <span aria-hidden="true">·</span>
            <span
              data-testid="tv-ws-parity-badge"
              className="font-mono text-[11px] text-cyan-300 tabular-nums whitespace-nowrap"
            >
              TV↔WS {syncTelemetry ? `${syncTelemetry.discrepancyBps.toFixed(1)} bps · ${syncTelemetry.parityStatus}` : '0.0 bps · LOCKED'}
            </span>
          </div>
        </div>

        {/* Search Input + Timeframe Controls */}
        <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 shrink-0">
          <div className="relative w-full sm:w-44">
            <label htmlFor="coin-search-input" className="sr-only">
              Search cryptocurrency coin
            </label>
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
              aria-hidden="true"
            />
            <input
              id="coin-search-input"
              type="text"
              value={searchQuery}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setTimeout(() => setSearchFocused(false), 180)}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search coin..."
              className="w-full rounded-lg border border-slate-800 bg-[#0a0e1a] py-1.5 pl-8 pr-2.5 text-xs text-white placeholder:text-slate-500 focus:border-[#3b82f6] focus:outline-none"
            />
            {searchFocused && (
              <div
                role="listbox"
                aria-label="Coin Search Results"
                className="absolute left-0 right-0 top-full z-30 mt-1 max-h-60 overflow-y-auto rounded-lg border border-slate-700 bg-[#0d1323] p-1 shadow-xl"
              >
                {filteredCoins.length === 0 ? (
                  <div className="px-3 py-2 text-xs text-slate-400">No matching pairs</div>
                ) : (
                  filteredCoins.map((coin) => {
                    const snap = tickers[coin.symbol];
                    return (
                      <button
                        key={coin.symbol}
                        type="button"
                        role="option"
                        aria-selected={coin.symbol === selectedSymbol}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          setSelectedSymbol(coin.symbol);
                          setSearchQuery('');
                          setSearchFocused(false);
                        }}
                        className="flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-xs hover:bg-slate-800/80 cursor-pointer"
                      >
                        <div>
                          <span className="font-semibold text-white">{coin.baseAsset}</span>
                          <span className="ml-2 text-slate-400">{coin.name}</span>
                        </div>
                        <span className="font-mono tabular-nums text-slate-200">
                          ${formatCryptoPrice(snap?.price ?? coin.referencePrice)}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            )}
          </div>

          <div
            role="group"
            aria-label="Chart Timeframe"
            className="flex items-center gap-0.5 rounded-lg border border-slate-800 bg-[#0a0e1a] p-0.5 shrink-0"
          >
            {TIMEFRAMES.map((tf) => (
              <button
                key={tf}
                type="button"
                onClick={() => onTimeframeChange(tf)}
                className={`rounded-md px-2 py-1 font-mono text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                  timeframe === tf
                    ? 'bg-[#3b82f6] text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {tf}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => updateIndicatorSuite({ showEmaRibbon: !showEma })}
            className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
              showEma
                ? 'border-[#3b82f6]/60 bg-[#3b82f6]/15 text-blue-300'
                : 'border-slate-800 bg-[#0a0e1a] text-slate-400 hover:text-white'
            }`}
          >
            EMA {indicatorSuite.emaFastPeriod}/{indicatorSuite.emaMidPeriod}/{indicatorSuite.emaSlowPeriod}
          </button>

          <button
            type="button"
            onClick={() => updateIndicatorSuite({ showSmcOverlay: !showSmc })}
            className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
              showSmc
                ? 'border-amber-500/60 bg-amber-500/15 text-amber-300'
                : 'border-slate-800 bg-[#0a0e1a] text-slate-400 hover:text-white'
            }`}
          >
            SMC / FRVP
          </button>

          <div className="relative">
            <button
              type="button"
              data-testid="chart-indicators-btn"
              onClick={() => setIndicatorsPopoverOpen((v) => !v)}
              aria-expanded={indicatorsPopoverOpen}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                indicatorsPopoverOpen
                  ? 'border-cyan-400/60 bg-cyan-500/15 text-cyan-200'
                  : 'border-slate-800 bg-[#0a0e1a] text-slate-300 hover:border-cyan-500/40 hover:text-white'
              }`}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Indicators</span>
            </button>

            {indicatorsPopoverOpen && (
              <div
                data-testid="chart-indicators-popover"
                className="absolute right-0 top-full z-30 mt-1.5 w-72 rounded-xl border border-cyan-500/30 bg-[#0a1020] p-3.5 shadow-2xl space-y-3"
              >
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-mono uppercase tracking-wider text-cyan-300 font-semibold">
                    Indicator Suite
                  </span>
                  <button
                    type="button"
                    onClick={() => setIndicatorsPopoverOpen(false)}
                    className="text-[11px] text-slate-400 hover:text-white cursor-pointer"
                  >
                    Done
                  </button>
                </div>

                {/* Custom EMA Period Selectors */}
                <div className="grid grid-cols-3 gap-2">
                  <label className="space-y-1">
                    <span className="block text-[10px] font-mono text-blue-400">EMA Fast</span>
                    <select
                      aria-label="EMA Fast Period"
                      value={indicatorSuite.emaFastPeriod}
                      onChange={(e) =>
                        updateIndicatorSuite({ emaFastPeriod: Number(e.target.value) })
                      }
                      className="w-full rounded-md border border-slate-700 bg-[#070d1b] px-2 py-1 font-mono text-xs text-white"
                    >
                      <option value={9}>9</option>
                      <option value={12}>12</option>
                      <option value={21}>21</option>
                    </select>
                  </label>
                  <label className="space-y-1">
                    <span className="block text-[10px] font-mono text-amber-400">EMA Mid</span>
                    <select
                      aria-label="EMA Mid Period"
                      value={indicatorSuite.emaMidPeriod}
                      onChange={(e) =>
                        updateIndicatorSuite({ emaMidPeriod: Number(e.target.value) })
                      }
                      className="w-full rounded-md border border-slate-700 bg-[#070d1b] px-2 py-1 font-mono text-xs text-white"
                    >
                      <option value={34}>34</option>
                      <option value={50}>50</option>
                      <option value={55}>55</option>
                    </select>
                  </label>
                  <label className="space-y-1">
                    <span className="block text-[10px] font-mono text-purple-400">EMA Slow</span>
                    <select
                      aria-label="EMA Slow Period"
                      value={indicatorSuite.emaSlowPeriod}
                      onChange={(e) =>
                        updateIndicatorSuite({ emaSlowPeriod: Number(e.target.value) })
                      }
                      className="w-full rounded-md border border-slate-700 bg-[#070d1b] px-2 py-1 font-mono text-xs text-white"
                    >
                      <option value={100}>100</option>
                      <option value={150}>150</option>
                      <option value={200}>200</option>
                    </select>
                  </label>
                </div>

                {/* Overlay Toggles */}
                <div className="space-y-1.5 text-xs">
                  <label className="flex items-center justify-between rounded-md border border-slate-800 bg-[#070d1b] px-2.5 py-1.5 cursor-pointer">
                    <span className="text-slate-200">RSI ({indicatorSuite.rsiPeriod}) Momentum Strip</span>
                    <input
                      type="checkbox"
                      checked={indicatorSuite.showRsiStrip}
                      onChange={(e) => updateIndicatorSuite({ showRsiStrip: e.target.checked })}
                      className="accent-cyan-400"
                    />
                  </label>
                  <label className="flex items-center justify-between rounded-md border border-slate-800 bg-[#070d1b] px-2.5 py-1.5 cursor-pointer">
                    <span className="text-slate-200">Session VWAP Overlay</span>
                    <input
                      type="checkbox"
                      checked={indicatorSuite.showVwapOverlay}
                      onChange={(e) => updateIndicatorSuite({ showVwapOverlay: e.target.checked })}
                      className="accent-cyan-400"
                    />
                  </label>
                  <label className="flex items-center justify-between rounded-md border border-slate-800 bg-[#070d1b] px-2.5 py-1.5 cursor-pointer">
                    <span className="text-slate-200">Bollinger Bands (20, 2σ)</span>
                    <input
                      type="checkbox"
                      checked={indicatorSuite.showBollingerBands}
                      onChange={(e) =>
                        updateIndicatorSuite({ showBollingerBands: e.target.checked })
                      }
                      className="accent-cyan-400"
                    />
                  </label>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* TradingView Lightweight Chart Canvas */}
      <div className="relative bg-[#0d1323]">
        {loading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#0d1323]/75 text-xs text-slate-300">
            Loading {selectedSymbol} ({timeframe}) chart...
          </div>
        )}
        <div
          ref={chartContainerRef}
          data-testid="tv-candle-chart"
          className="w-full h-[410px]"
        />
      </div>

      {/* Clean Legend Footer with Extended EMA + Live RSI(14) + VWAP/BB Readout */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800/80 px-4 py-2.5 text-xs text-slate-400">
        <div className="flex flex-wrap items-center gap-3">
          <span>Candles: {selectedSymbol}</span>
          {showEma && (
            <>
              <span aria-hidden="true">·</span>
              <span className="text-blue-400 font-mono">EMA {indicatorSuite.emaFastPeriod}</span>
              <span aria-hidden="true">·</span>
              <span className="text-amber-400 font-mono">EMA {indicatorSuite.emaMidPeriod}</span>
              <span aria-hidden="true">·</span>
              <span className="text-purple-400 font-mono">EMA {indicatorSuite.emaSlowPeriod}</span>
            </>
          )}
          {indicatorSuite.showVwapOverlay && (
            <>
              <span aria-hidden="true">·</span>
              <span className="text-cyan-400 font-mono">VWAP</span>
            </>
          )}
          {indicatorSuite.showBollingerBands && (
            <>
              <span aria-hidden="true">·</span>
              <span className="text-slate-300 font-mono">BB(20,2)</span>
            </>
          )}
          {indicatorSuite.showRsiStrip && liveRsiValue !== null && (
            <>
              <span aria-hidden="true">·</span>
              <span
                data-testid="chart-rsi-readout"
                className={`font-mono font-semibold tabular-nums ${
                  liveRsiValue >= 70
                    ? 'text-rose-400'
                    : liveRsiValue <= 30
                    ? 'text-emerald-400'
                    : 'text-cyan-300'
                }`}
              >
                RSI({indicatorSuite.rsiPeriod}) {liveRsiValue.toFixed(1)}
                {liveRsiValue >= 70 ? ' OB' : liveRsiValue <= 30 ? ' OS' : ''}
              </span>
            </>
          )}
          {showSmc && smcAnalysis && (
            <>
              <span aria-hidden="true">·</span>
              <span className="text-amber-300 font-mono tabular-nums">
                POC ${formatCryptoPrice(smcAnalysis.volumeProfile.poc)}
              </span>
              <span aria-hidden="true">·</span>
              <span className="text-emerald-400">
                {smcAnalysis.structure.lastEvent} ({smcAnalysis.structure.bias})
              </span>
            </>
          )}
        </div>
        {latestCandle && (
          <div className="flex flex-wrap items-center gap-3 font-mono tabular-nums">
            <span>O: ${formatCryptoPrice(latestCandle.open)}</span>
            <span>H: ${formatCryptoPrice(latestCandle.high)}</span>
            <span>L: ${formatCryptoPrice(latestCandle.low)}</span>
            <span>C: ${formatCryptoPrice(latestCandle.close)}</span>
          </div>
        )}
      </div>
    </div>
  );
});
