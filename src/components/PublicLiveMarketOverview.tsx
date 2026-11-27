import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  ColorType,
  CrosshairMode,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts';
import { ArrowUpRight, TrendingDown, TrendingUp } from 'lucide-react';
import { useApp } from '../context/AppContext';
import {
  TRACKED_COINS,
  fetchCoinCandles,
  formatCompactUsd,
  formatCryptoPrice,
  type Candle,
  type Timeframe,
} from '../lib/marketData';
import { calculateEMA } from '../lib/signals';
import {
  DEFAULT_DRIFT_THRESHOLD_PCT,
  reconcileCandleSeriesToLivePrice,
} from '../lib/wsDataEngine';
import { computeTechnicalStructure } from '../lib/technicalStructureEngine';
import { LineStyle, type IPriceLine } from 'lightweight-charts';

const OVERVIEW_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'ADAUSDT'] as const;
const OVERVIEW_TIMEFRAMES: readonly Timeframe[] = ['15m', '1h', '4h', '1d'];

/**
 * Lightweight, verified-data Live Market Overview for the public homepage.
 * Displays pure market prices, candlesticks, and volume with zero fabricated trade results
 * or unrelated entry/exit annotations.
 */
export const PublicLiveMarketOverview = memo(function PublicLiveMarketOverview() {
  const { tickers } = useApp();
  const [selectedSymbol, setSelectedSymbol] = useState<string>('BTCUSDT');
  const [timeframe, setTimeframe] = useState<Timeframe>('1h');
  const [showEma21, setShowEma21] = useState<boolean>(true);
  const [showSrLevels, setShowSrLevels] = useState<boolean>(true);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [dataSource, setDataSource] = useState<'binance' | 'cache'>('cache');
  const [loading, setLoading] = useState<boolean>(true);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const emaSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const srPriceLinesRef = useRef<IPriceLine[]>([]);
  const candlesRef = useRef<Candle[]>(candles);
  candlesRef.current = candles;
  const lastLiveTickKeyRef = useRef<string>('');

  const marketStructure = useMemo(() => computeTechnicalStructure(candles), [candles]);

  const marketRows = useMemo(() => {
    return OVERVIEW_SYMBOLS.map((sym) => {
      const coin = TRACKED_COINS.find((c) => c.symbol === sym);
      const tk = tickers[sym];
      return {
        symbol: sym,
        baseAsset: coin?.baseAsset || sym.replace(/USDT$/i, ''),
        name: coin?.name || sym.replace(/USDT$/i, ''),
        price: tk?.price ?? coin?.referencePrice ?? 0,
        change24h: tk?.change24hPercent ?? 0,
        high24h: tk?.high24h ?? 0,
        low24h: tk?.low24h ?? 0,
        volume24hUsd: tk?.volume24hUsd ?? 0,
        isLive: Boolean(tk?.isLiveWs),
      };
    });
  }, [tickers]);

  const activeAsset = useMemo(
    () => marketRows.find((r) => r.symbol === selectedSymbol) ?? marketRows[0],
    [marketRows, selectedSymbol]
  );

  const activePriceRef = useRef<number>(activeAsset.price);
  activePriceRef.current = activeAsset.price;
  const activeIsLiveRef = useRef<boolean>(activeAsset.isLive);
  activeIsLiveRef.current = activeAsset.isLive;

  // Initialize Lightweight Charts v5 instance once
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      width: container.clientWidth,
      height: 320,
      layout: {
        background: { type: ColorType.Solid, color: '#0b1120' },
        textColor: '#94a3b8',
        fontFamily: '"JetBrains Mono", monospace',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: 'rgba(30, 41, 59, 0.45)' },
        horzLines: { color: 'rgba(30, 41, 59, 0.45)' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: '#3b82f6', width: 1, labelBackgroundColor: '#1e293b' },
        horzLine: { color: '#3b82f6', width: 1, labelBackgroundColor: '#1e293b' },
      },
      rightPriceScale: { borderColor: '#1e293b' },
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
      scaleMargins: { top: 0.82, bottom: 0 },
    });

    const emaSeries = chart.addSeries(LineSeries, {
      color: '#60a5fa',
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;
    emaSeriesRef.current = emaSeries;

    const observer = new ResizeObserver(() => {
      if (!containerRef.current || !chartRef.current) return;
      chartRef.current.applyOptions({ width: containerRef.current.clientWidth });
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
      chart.remove();
      chartRef.current = null;
    };
  }, []);

  // Fetch verified historical candles when symbol or timeframe changes
  useEffect(() => {
    const abortCtrl = new AbortController();
    let mounted = true;
    setLoading(true);
    lastLiveTickKeyRef.current = '';

    fetchCoinCandles(selectedSymbol, timeframe, 120, activePriceRef.current, abortCtrl.signal)
      .then((res) => {
        if (!mounted) return;
        const allowReconcile = res.source === 'cache' || activeIsLiveRef.current;
        const latestLive = activePriceRef.current;
        const reconciled =
          allowReconcile && latestLive > 0
            ? reconcileCandleSeriesToLivePrice(
                res.candles,
                latestLive,
                DEFAULT_DRIFT_THRESHOLD_PCT,
                res.source
              )
            : null;
        setCandles(reconciled?.reconciled ? reconciled.candles : res.candles);
        setDataSource(res.source);
        setLoading(false);
      })
      .catch(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
      abortCtrl.abort();
    };
  }, [selectedSymbol, timeframe]);

  // Render candles + volume + optional EMA 21
  useEffect(() => {
    if (
      !candleSeriesRef.current ||
      !volumeSeriesRef.current ||
      !emaSeriesRef.current ||
      candles.length === 0
    ) {
      return;
    }

    const lastClose = candles[candles.length - 1]?.close ?? 1;
    const precision = lastClose >= 100 ? 2 : lastClose >= 1 ? 4 : lastClose >= 0.01 ? 5 : 6;
    const minMove = Number((1 / Math.pow(10, precision)).toFixed(precision));
    const priceFormat = { type: 'price' as const, precision, minMove };

    candleSeriesRef.current.applyOptions({ priceFormat });
    emaSeriesRef.current.applyOptions({ priceFormat });

    candleSeriesRef.current.setData(
      candles.map((c) => ({
        time: c.time as UTCTimestamp,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      }))
    );

    volumeSeriesRef.current.setData(
      candles.map((c) => ({
        time: c.time as UTCTimestamp,
        value: c.volume,
        color: c.close >= c.open ? 'rgba(16, 185, 129, 0.22)' : 'rgba(239, 68, 68, 0.22)',
      }))
    );

    if (showEma21) {
      const ema21 = calculateEMA(
        candles.map((c) => c.close),
        21
      );
      emaSeriesRef.current.setData(
        candles.map((c, idx) => ({ time: c.time as UTCTimestamp, value: ema21[idx] }))
      );
    } else {
      emaSeriesRef.current.setData([]);
    }

    chartRef.current?.timeScale().fitContent();
  }, [candles, showEma21]);

  // Plot documented real OHLCV Support & Resistance levels (zero trade annotations)
  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series) return;
    for (const line of srPriceLinesRef.current) {
      try {
        series.removePriceLine(line);
      } catch {
        // ignore
      }
    }
    srPriceLinesRef.current = [];
    if (!showSrLevels) return;

    if (marketStructure.resistanceLevel) {
      srPriceLinesRef.current.push(
        series.createPriceLine({
          price: marketStructure.resistanceLevel.price,
          color: 'rgba(244, 114, 182, 0.72)',
          lineWidth: 1,
          lineStyle: LineStyle.Dotted,
          axisLabelVisible: true,
          title: marketStructure.resistanceLevel.label,
        })
      );
    }
    if (marketStructure.supportLevel) {
      srPriceLinesRef.current.push(
        series.createPriceLine({
          price: marketStructure.supportLevel.price,
          color: 'rgba(45, 212, 191, 0.72)',
          lineWidth: 1,
          lineStyle: LineStyle.Dotted,
          axisLabelVisible: true,
          title: marketStructure.supportLevel.label,
        })
      );
    }
  }, [marketStructure, showSrLevels]);

  const hasCandles = candles.length > 0;

  // Keep latest bar synced with live verified WS ticks without rewriting historical bars
  useEffect(() => {
    const currentCandles = candlesRef.current;
    if (
      loading ||
      !hasCandles ||
      !activeAsset.isLive ||
      !activeAsset.price ||
      currentCandles.length === 0 ||
      !candleSeriesRef.current
    ) {
      return;
    }
    const tickKey = `${selectedSymbol}_${timeframe}_${activeAsset.price}`;
    if (tickKey === lastLiveTickKeyRef.current) {
      return;
    }
    lastLiveTickKeyRef.current = tickKey;

    const last = currentCandles[currentCandles.length - 1];
    try {
      candleSeriesRef.current.update({
        time: last.time as UTCTimestamp,
        open: last.open,
        high: Math.max(last.high, activeAsset.price),
        low: Math.min(last.low, activeAsset.price),
        close: activeAsset.price,
      });
    } catch {
      // ignore if chart unmounted
    }
  }, [activeAsset.price, activeAsset.isLive, hasCandles, loading, selectedSymbol, timeframe]);

  const feedStatusText =
    dataSource === 'binance' && activeAsset.isLive
      ? 'Binance Spot · Live Verified'
      : dataSource === 'binance'
      ? 'Binance Verified Klines'
      : 'Reference Market Feed';

  return (
    <section
      id="live-market-overview"
      aria-label="Live Market Overview"
      data-testid="public-live-market-overview"
      className="scroll-mt-20 space-y-4"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="font-mono text-xs text-blue-400">Live Market Overview</div>
          <h2 className="font-display text-xl sm:text-2xl font-bold text-white tracking-tight">
            Verified Cryptocurrency Spot Markets
          </h2>
          <p className="mt-0.5 text-xs text-slate-400">
            Real-time price action and historical spot candles only. Trade annotations appear exclusively inside Trade ID Verification below.
          </p>
        </div>
        <Link
          to="/dashboard"
          className="inline-flex items-center gap-1 text-xs font-semibold text-blue-400 hover:text-blue-300 whitespace-nowrap"
        >
          <span>Open Full Trading Workspace</span>
          <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 items-stretch">
        {/* Main Lightweight Market Chart */}
        <div className="lg:col-span-8 rounded-xl border border-slate-800 bg-[#111827] overflow-hidden flex flex-col">
          <div className="border-b border-slate-800 bg-[#0d1323] px-4 py-3.5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
                <h3
                  data-testid="overview-active-asset"
                  className="font-display text-base sm:text-lg font-bold text-white tracking-tight"
                >
                  {activeAsset.name}
                </h3>
                <span className="font-mono text-xs text-slate-400">{activeAsset.symbol}</span>
                <span className="text-slate-600" aria-hidden="true">
                  ·
                </span>
                <span
                  data-testid="overview-feed-source"
                  className={`font-mono text-[11px] ${
                    dataSource === 'binance' ? 'text-emerald-400' : 'text-amber-300'
                  }`}
                >
                  {feedStatusText}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs tabular-nums">
                <span className="text-base font-bold text-white">
                  ${formatCryptoPrice(activeAsset.price)}
                </span>
                <span
                  className={`inline-flex items-center gap-1 font-semibold ${
                    activeAsset.change24h >= 0 ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                >
                  {activeAsset.change24h >= 0 ? (
                    <TrendingUp className="h-3.5 w-3.5" aria-hidden="true" />
                  ) : (
                    <TrendingDown className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                  {activeAsset.change24h >= 0 ? '+' : ''}
                  {activeAsset.change24h.toFixed(2)}% (24h)
                </span>
                <span className="text-slate-600" aria-hidden="true">
                  ·
                </span>
                <span className="text-slate-400">
                  Vol {activeAsset.volume24hUsd > 0 ? formatCompactUsd(activeAsset.volume24hUsd) : '—'}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <div
                role="group"
                aria-label="Live Market Overview Timeframe"
                className="flex items-center gap-0.5 rounded-lg border border-slate-800 bg-[#0a0e1a] p-0.5"
              >
                {OVERVIEW_TIMEFRAMES.map((tf) => (
                  <button
                    key={tf}
                    type="button"
                    data-testid={`overview-tf-${tf}`}
                    onClick={() => setTimeframe(tf)}
                    className={`rounded-md px-2.5 py-1 font-mono text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
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
                onClick={() => setShowEma21((v) => !v)}
                aria-pressed={showEma21}
                className={`rounded-lg border px-2.5 py-1.5 font-mono text-xs transition-colors cursor-pointer whitespace-nowrap ${
                  showEma21
                    ? 'border-blue-500/60 bg-blue-500/15 text-blue-300'
                    : 'border-slate-800 bg-[#0a0e1a] text-slate-400 hover:text-white'
                }`}
              >
                EMA 21
              </button>
              <button
                type="button"
                data-testid="overview-sr-toggle"
                onClick={() => setShowSrLevels((v) => !v)}
                aria-pressed={showSrLevels}
                className={`rounded-lg border px-2.5 py-1.5 font-mono text-xs transition-colors cursor-pointer whitespace-nowrap ${
                  showSrLevels
                    ? 'border-teal-500/60 bg-teal-500/15 text-teal-300'
                    : 'border-slate-800 bg-[#0a0e1a] text-slate-400 hover:text-white'
                }`}
              >
                S/R
              </button>
            </div>
          </div>

          <div className="relative bg-[#0b1120] flex-1 min-h-[320px]">
            <div
              ref={containerRef}
              data-testid="public-overview-chart-canvas"
              aria-label={`${activeAsset.symbol} ${timeframe} Live Market Candlestick Chart`}
              className="w-full h-[320px]"
            />
            {loading && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-[#0b1120]/70 text-xs font-mono text-slate-300">
                Loading verified {activeAsset.symbol} ({timeframe}) market data...
              </div>
            )}
          </div>

          <div className="border-t border-slate-800 bg-[#0d1323] px-4 py-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400 font-mono tabular-nums">
            <span>
              24h Range:{' '}
              {activeAsset.low24h > 0 && activeAsset.high24h > 0
                ? `$${formatCryptoPrice(activeAsset.low24h)} – $${formatCryptoPrice(activeAsset.high24h)}`
                : 'Awaiting 24h range'}
            </span>
            <span>Clean Market Data · No Unverified Signal Overlays</span>
          </div>
        </div>

        {/* Right: Interactive Major Pairs Market List */}
        <div className="lg:col-span-4 rounded-xl border border-slate-800 bg-[#111827] overflow-hidden flex flex-col">
          <div className="border-b border-slate-800 bg-[#0d1323] px-4 py-3 flex items-center justify-between">
            <span className="font-display text-sm font-bold text-white">Major Spot Pairs</span>
            <span className="font-mono text-[11px] text-slate-400">Select to inspect</span>
          </div>
          <div className="divide-y divide-slate-800/70 flex-1">
            {marketRows.map((row) => {
              const isSelected = row.symbol === activeAsset.symbol;
              return (
                <button
                  key={row.symbol}
                  type="button"
                  data-testid={`overview-pair-${row.baseAsset}`}
                  onClick={() => setSelectedSymbol(row.symbol)}
                  aria-pressed={isSelected}
                  className={`w-full px-4 py-3 flex items-center justify-between gap-3 text-left transition-colors cursor-pointer ${
                    isSelected
                      ? 'bg-blue-500/12 text-white'
                      : 'hover:bg-slate-800/40 text-slate-200'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-bold text-white">
                        {row.baseAsset}
                      </span>
                      <span className="text-xs text-slate-400 truncate">{row.name}</span>
                    </div>
                    <div className="mt-0.5 font-mono text-[10px] text-slate-500 tabular-nums">
                      Vol {row.volume24hUsd > 0 ? formatCompactUsd(row.volume24hUsd) : '—'} ·{' '}
                      {row.isLive ? 'Live' : 'Reference'}
                    </div>
                  </div>
                  <div className="text-right font-mono tabular-nums shrink-0">
                    <div className="text-xs font-semibold text-white">
                      ${formatCryptoPrice(row.price)}
                    </div>
                    <div
                      className={`text-[11px] font-semibold ${
                        row.change24h >= 0 ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      {row.change24h >= 0 ? '+' : ''}
                      {row.change24h.toFixed(2)}%
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
});
