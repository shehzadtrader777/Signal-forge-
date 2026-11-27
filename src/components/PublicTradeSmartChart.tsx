import { memo, useEffect, useMemo, useRef, useState } from 'react';
import {
  createChart,
  createSeriesMarkers,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  ColorType,
  CrosshairMode,
  LineStyle,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type MouseEventParams,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import { Camera, Check, Maximize2, Pencil, RotateCcw, ShieldAlert } from 'lucide-react';
import { useApp } from '../context/AppContext';
import {
  fetchCoinCandles,
  formatCryptoPrice,
  type Candle,
  type Timeframe,
} from '../lib/marketData';
import { calculateEMA } from '../lib/signals';
import {
  DEFAULT_DRIFT_THRESHOLD_PCT,
  reconcileCandleSeriesToLivePrice,
} from '../lib/wsDataEngine';
import type { CanonicalTradeRecord } from '../lib/tradeLifecycleLedger';
import {
  classifyTradeEnvironment,
  computeVerifiedTradePnl,
  resolveTradeChartOverlay,
} from '../lib/publicSmartChartModel';
import { computeTechnicalStructure } from '../lib/technicalStructureEngine';
import {
  buildSocialChartSnapshotSpec,
  type SocialSnapshotStage,
} from '../lib/socialChartSnapshot';

const CHART_TIMEFRAMES: readonly Timeframe[] = ['15m', '1h', '4h', '1d'];

interface UserTrendlinePoint {
  time: number;
  price: number;
}

interface PublicTradeSmartChartProps {
  trade: CanonicalTradeRecord;
}

/**
 * Interactive Smart Chart dedicated strictly to verified Trade ID inspection.
 * Reuses Signal Forge's Lightweight Charts v5 & verified market history pipeline
 * to plot actual candles, real S/R & BOS/CHoCH market structure, swing-anchored trendlines,
 * interactive user trendline drawing, Entry/SL/TP levels, execution/exit markers,
 * explicit strategy evidence & invalidation rules, and Stage 1 / Stage 2 social PNG export.
 */
export const PublicTradeSmartChart = memo(function PublicTradeSmartChart({
  trade,
}: PublicTradeSmartChartProps) {
  const { tickers } = useApp();
  const [timeframe, setTimeframe] = useState<Timeframe>(trade.timeframe);
  const [showEmaRibbon, setShowEmaRibbon] = useState<boolean>(true);
  const [showPatternOverlay, setShowPatternOverlay] = useState<boolean>(true);
  const [showStructureOverlay, setShowStructureOverlay] = useState<boolean>(true);
  const [drawingMode, setDrawingMode] = useState<boolean>(false);
  const [userTrendPoints, setUserTrendPoints] = useState<UserTrendlinePoint[]>([]);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [dataSource, setDataSource] = useState<'binance' | 'cache'>('cache');
  const [loading, setLoading] = useState<boolean>(true);
  const [snapshotNotice, setSnapshotNotice] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const markersPluginRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const emaFastRef = useRef<ISeriesApi<'Line'> | null>(null);
  const emaMidRef = useRef<ISeriesApi<'Line'> | null>(null);
  const emaSlowRef = useRef<ISeriesApi<'Line'> | null>(null);
  const autoTrendlineRef = useRef<ISeriesApi<'Line'> | null>(null);
  const userTrendlineRef = useRef<ISeriesApi<'Line'> | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const drawingModeRef = useRef<boolean>(false);
  drawingModeRef.current = drawingMode;

  useEffect(() => {
    setTimeframe(trade.timeframe);
    setSnapshotNotice(null);
    setUserTrendPoints([]);
    setDrawingMode(false);
  }, [trade.tradeId, trade.timeframe]);

  const envInfo = useMemo(() => classifyTradeEnvironment(trade), [trade]);
  const pnlInfo = useMemo(() => computeVerifiedTradePnl(trade), [trade]);
  const overlay = useMemo(() => resolveTradeChartOverlay(trade, candles), [trade, candles]);
  const structure = useMemo(() => computeTechnicalStructure(candles, trade), [candles, trade]);
  const stage2Spec = useMemo(
    () => buildSocialChartSnapshotSpec(trade, 'STAGE_2_CLOSED_RESULT', structure),
    [trade, structure]
  );

  const currentTicker = tickers[trade.pair];
  const refPriceRef = useRef<number>(currentTicker?.price ?? trade.entryPrice);
  refPriceRef.current =
    currentTicker?.price && currentTicker.price > 0 ? currentTicker.price : trade.entryPrice;
  const isLiveWsRef = useRef<boolean>(Boolean(currentTicker?.isLiveWs));
  isLiveWsRef.current = Boolean(currentTicker?.isLiveWs);

  // Initialize Lightweight Charts v5 instance once
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      width: container.clientWidth,
      height: 380,
      layout: {
        background: { type: ColorType.Solid, color: '#0b1120' },
        textColor: '#94a3b8',
        fontFamily: '"JetBrains Mono", monospace',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: 'rgba(30, 41, 59, 0.5)' },
        horzLines: { color: 'rgba(30, 41, 59, 0.5)' },
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

    const emaFast = chart.addSeries(LineSeries, {
      color: '#3b82f6',
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    const emaMid = chart.addSeries(LineSeries, {
      color: '#f59e0b',
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    const emaSlow = chart.addSeries(LineSeries, {
      color: '#a855f7',
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    const autoTrendline = chart.addSeries(LineSeries, {
      color: '#38bdf8',
      lineWidth: 2,
      lineStyle: LineStyle.Dashed,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    const userTrendline = chart.addSeries(LineSeries, {
      color: '#facc15',
      lineWidth: 2,
      lineStyle: LineStyle.Solid,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    markersPluginRef.current = createSeriesMarkers(candleSeries, []);
    volumeSeriesRef.current = volumeSeries;
    emaFastRef.current = emaFast;
    emaMidRef.current = emaMid;
    emaSlowRef.current = emaSlow;
    autoTrendlineRef.current = autoTrendline;
    userTrendlineRef.current = userTrendline;

    // Interactive click-to-draw 2-point trendline handler
    const onChartClick = (param: MouseEventParams<Time>) => {
      if (!drawingModeRef.current || !param.time || !param.point) return;
      const clickedPrice = candleSeries.coordinateToPrice(param.point.y);
      if (clickedPrice === null || !Number.isFinite(clickedPrice)) return;
      const clickedTime = Number(param.time);
      if (!Number.isFinite(clickedTime)) return;

      setUserTrendPoints((prev) => {
        if (prev.length === 0) return [{ time: clickedTime, price: clickedPrice }];
        if (prev.length === 1) {
          if (prev[0].time === clickedTime) return prev;
          const ordered = [prev[0], { time: clickedTime, price: clickedPrice }].sort(
            (a, b) => a.time - b.time
          );
          return ordered;
        }
        return [{ time: clickedTime, price: clickedPrice }];
      });
    };
    chart.subscribeClick(onChartClick);

    const observer = new ResizeObserver(() => {
      if (!containerRef.current || !chartRef.current) return;
      chartRef.current.applyOptions({ width: containerRef.current.clientWidth });
    });
    observer.observe(container);

    return () => {
      chart.unsubscribeClick(onChartClick);
      observer.disconnect();
      markersPluginRef.current?.detach();
      markersPluginRef.current = null;
      chart.remove();
      chartRef.current = null;
    };
  }, []);

  // Load actual historical market candles for this verified trade's pair & timeframe
  useEffect(() => {
    const abortCtrl = new AbortController();
    let mounted = true;
    setLoading(true);

    fetchCoinCandles(trade.pair, timeframe, 160, refPriceRef.current, abortCtrl.signal)
      .then((res) => {
        if (!mounted) return;
        const allowReconcile = res.source === 'cache' || isLiveWsRef.current;
        const rec =
          allowReconcile && refPriceRef.current > 0
            ? reconcileCandleSeriesToLivePrice(
                res.candles,
                refPriceRef.current,
                DEFAULT_DRIFT_THRESHOLD_PCT,
                res.source
              )
            : null;
        setCandles(rec?.reconciled ? rec.candles : res.candles);
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
  }, [trade.pair, timeframe]);

  // Render candles, volume, and EMA ribbon
  useEffect(() => {
    if (
      !candleSeriesRef.current ||
      !volumeSeriesRef.current ||
      !emaFastRef.current ||
      !emaMidRef.current ||
      !emaSlowRef.current ||
      candles.length === 0
    ) {
      return;
    }

    const lastClose = candles[candles.length - 1]?.close ?? 1;
    const precision = lastClose >= 100 ? 2 : lastClose >= 1 ? 4 : lastClose >= 0.01 ? 5 : 6;
    const minMove = Number((1 / Math.pow(10, precision)).toFixed(precision));
    const priceFormat = { type: 'price' as const, precision, minMove };

    candleSeriesRef.current.applyOptions({ priceFormat });
    emaFastRef.current.applyOptions({ priceFormat });
    emaMidRef.current.applyOptions({ priceFormat });
    emaSlowRef.current.applyOptions({ priceFormat });
    autoTrendlineRef.current?.applyOptions({ priceFormat });
    userTrendlineRef.current?.applyOptions({ priceFormat });

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
        color: c.close >= c.open ? 'rgba(16, 185, 129, 0.24)' : 'rgba(239, 68, 68, 0.24)',
      }))
    );

    if (showEmaRibbon) {
      const closes = candles.map((c) => c.close);
      const ema9 = calculateEMA(closes, 9);
      const ema21 = calculateEMA(closes, 21);
      const ema50 = calculateEMA(closes, 50);
      emaFastRef.current.setData(
        candles.map((c, idx) => ({ time: c.time as UTCTimestamp, value: ema9[idx] }))
      );
      emaMidRef.current.setData(
        candles.map((c, idx) => ({ time: c.time as UTCTimestamp, value: ema21[idx] }))
      );
      emaSlowRef.current.setData(
        candles.map((c, idx) => ({ time: c.time as UTCTimestamp, value: ema50[idx] }))
      );
    } else {
      emaFastRef.current.setData([]);
      emaMidRef.current.setData([]);
      emaSlowRef.current.setData([]);
    }

    chartRef.current?.timeScale().fitContent();
  }, [candles, showEmaRibbon]);

  // Render user-drawn interactive trendline
  useEffect(() => {
    if (!userTrendlineRef.current) return;
    if (userTrendPoints.length === 2) {
      userTrendlineRef.current.setData([
        { time: userTrendPoints[0].time as UTCTimestamp, value: userTrendPoints[0].price },
        { time: userTrendPoints[1].time as UTCTimestamp, value: userTrendPoints[1].price },
      ]);
    } else {
      userTrendlineRef.current.setData([]);
    }
  }, [userTrendPoints]);

  // Apply Entry, Stop Loss, Take Profit, Real S/R, Breakout/Pattern lines, Swing Trendline & Strictly Sorted Markers
  useEffect(() => {
    const series = candleSeriesRef.current;
    const markersPlugin = markersPluginRef.current;
    if (!series) return;

    for (const line of priceLinesRef.current) {
      try {
        series.removePriceLine(line);
      } catch {
        // ignore if already removed
      }
    }
    priceLinesRef.current = [];

    if (autoTrendlineRef.current) {
      if (showStructureOverlay && structure.trendline) {
        autoTrendlineRef.current.setData([
          {
            time: structure.trendline.startTime as UTCTimestamp,
            value: structure.trendline.startPrice,
          },
          {
            time: structure.trendline.endTime as UTCTimestamp,
            value: structure.trendline.endPrice,
          },
        ]);
      } else {
        autoTrendlineRef.current.setData([]);
      }
    }

    if (!overlay) {
      markersPlugin?.setMarkers([]);
      return;
    }

    const linesToRender = showPatternOverlay
      ? overlay.priceLines
      : overlay.priceLines.filter((l) => l.id !== 'breakout_level' && l.id !== 'pattern_zone_low');

    for (const cfg of linesToRender) {
      const lineStyle =
        cfg.style === 'solid'
          ? LineStyle.Solid
          : cfg.style === 'dotted'
          ? LineStyle.Dotted
          : LineStyle.Dashed;
      priceLinesRef.current.push(
        series.createPriceLine({
          price: cfg.price,
          color: cfg.color,
          lineWidth: cfg.lineWidth,
          lineStyle,
          axisLabelVisible: true,
          title: cfg.title,
        })
      );
    }

    // Add documented real OHLCV Support & Resistance lines
    if (showStructureOverlay) {
      if (structure.resistanceLevel) {
        priceLinesRef.current.push(
          series.createPriceLine({
            price: structure.resistanceLevel.price,
            color: 'rgba(244, 114, 182, 0.75)',
            lineWidth: 1,
            lineStyle: LineStyle.Dotted,
            axisLabelVisible: true,
            title: structure.resistanceLevel.label,
          })
        );
      }
      if (structure.supportLevel) {
        priceLinesRef.current.push(
          series.createPriceLine({
            price: structure.supportLevel.price,
            color: 'rgba(45, 212, 191, 0.75)',
            lineWidth: 1,
            lineStyle: LineStyle.Dotted,
            axisLabelVisible: true,
            title: structure.supportLevel.label,
          })
        );
      }
    }

    const baseMarkers = (
      showPatternOverlay ? overlay.markers : overlay.markers.filter((m) => m.id !== 'pattern')
    ).map<SeriesMarker<Time>>((m) => ({
      time: m.time as UTCTimestamp,
      position: m.position,
      color: m.color,
      shape: m.shape,
      text: m.text,
    }));

    const structureMarkers: SeriesMarker<Time>[] = showStructureOverlay
      ? structure.structureEvents.map((ev) => ({
          time: ev.time as UTCTimestamp,
          position: ev.direction === 'BULLISH' ? 'aboveBar' : 'belowBar',
          color: ev.direction === 'BULLISH' ? '#38bdf8' : '#fb923c',
          shape: 'circle',
          text: ev.label,
        }))
      : [];

    // Lightweight Charts v5 requires markers strictly ascending by time
    const allMarkers = [...baseMarkers, ...structureMarkers].sort(
      (a, b) => Number(a.time) - Number(b.time)
    );

    markersPlugin?.setMarkers(allMarkers);
  }, [overlay, showPatternOverlay, showStructureOverlay, structure]);

  const handleExportSnapshot = (stage: SocialSnapshotStage) => {
    const chart = chartRef.current;
    if (!chart) return;
    const spec = buildSocialChartSnapshotSpec(trade, stage, structure);

    try {
      const rawCanvas = chart.takeScreenshot();
      const out = document.createElement('canvas');
      const headerH = 98;
      const footerH = 44;
      out.width = Math.max(rawCanvas.width, 920);
      out.height = rawCanvas.height + headerH + footerH;
      const ctx = out.getContext('2d');
      if (!ctx) return;

      ctx.fillStyle = '#070b14';
      ctx.fillRect(0, 0, out.width, out.height);

      // Top brand & Trade ID banner (high-contrast mobile-readable)
      ctx.fillStyle = '#f8fafc';
      ctx.font = 'bold 18px sans-serif';
      ctx.fillText(spec.headline, 18, 28);

      ctx.fillStyle = '#94a3b8';
      ctx.font = '13px monospace';
      ctx.fillText(spec.subline, 18, 49);

      // Mobile-readable 4-column key metric strip
      const colW = Math.floor((out.width - 36) / spec.keyMetrics.length);
      spec.keyMetrics.forEach((metric, idx) => {
        const x = 18 + idx * colW;
        ctx.fillStyle = '#64748b';
        ctx.font = '11px sans-serif';
        ctx.fillText(metric.label.toUpperCase(), x, 70);

        ctx.fillStyle =
          metric.tone === 'bull'
            ? '#34d399'
            : metric.tone === 'bear'
            ? '#fb7185'
            : metric.tone === 'accent'
            ? '#38bdf8'
            : '#f8fafc';
        ctx.font = 'bold 14px monospace';
        ctx.fillText(metric.value, x, 88);
      });

      // Draw actual candlestick chart with overlays
      ctx.drawImage(rawCanvas, 0, headerH, out.width, rawCanvas.height);

      // Bottom technical structure & disclaimer strip
      ctx.fillStyle = '#cbd5e1';
      ctx.font = '11px monospace';
      ctx.fillText(spec.structureCaption, 18, headerH + rawCanvas.height + 18);
      ctx.fillStyle = '#64748b';
      ctx.font = '10px monospace';
      ctx.fillText(spec.footerDisclaimer, 18, headerH + rawCanvas.height + 34);

      const link = document.createElement('a');
      link.download = spec.fileName;
      link.href = out.toDataURL('image/png');
      link.click();

      setSnapshotNotice(
        `Exported ${
          spec.stage === 'STAGE_2_CLOSED_RESULT'
            ? 'Stage 2 Verified Result'
            : 'Stage 1 Approved Signal'
        } PNG (${spec.fileName}) for Telegram/Discord.`
      );
      window.setTimeout(() => setSnapshotNotice(null), 5000);
    } catch {
      setSnapshotNotice('Snapshot export unavailable until chart renders.');
    }
  };

  return (
    <div
      data-testid="public-trade-smart-chart"
      data-trade-id={trade.tradeId}
      data-pair={trade.pair}
      className="rounded-xl border border-slate-800 bg-[#0d1323] overflow-hidden"
    >
      {/* Chart Header & Interactive Controls */}
      <div className="border-b border-slate-800 px-4 py-3 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="min-w-0 space-y-0.5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-xs">
            <span className="font-bold text-white">
              {trade.pair} · {timeframe}
            </span>
            <span className="text-slate-600" aria-hidden="true">
              ·
            </span>
            <span className={dataSource === 'binance' ? 'text-emerald-400' : 'text-amber-300'}>
              {dataSource === 'binance' ? 'Verified Binance Market History' : 'Reference Market History'}
            </span>
            <span className="text-slate-600" aria-hidden="true">
              ·
            </span>
            <span className="text-cyan-300">Bias: {structure.trendBias}</span>
          </div>
          <div className="text-xs text-slate-300 truncate">
            Strategy: <span className="font-medium text-white">{trade.strategyName}</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 shrink-0">
          <div
            role="group"
            aria-label="Verified Trade Chart Timeframe"
            className="flex items-center gap-0.5 rounded-lg border border-slate-800 bg-[#0a0e1a] p-0.5"
          >
            {CHART_TIMEFRAMES.map((tf) => (
              <button
                key={tf}
                type="button"
                onClick={() => setTimeframe(tf)}
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
            data-testid="smart-chart-structure-toggle"
            onClick={() => setShowStructureOverlay((v) => !v)}
            aria-pressed={showStructureOverlay}
            className={`rounded-lg border px-2.5 py-1.5 font-mono text-xs transition-colors cursor-pointer whitespace-nowrap ${
              showStructureOverlay
                ? 'border-cyan-500/60 bg-cyan-500/15 text-cyan-200'
                : 'border-slate-800 bg-[#0a0e1a] text-slate-400 hover:text-white'
            }`}
          >
            S/R &amp; BOS
          </button>

          <button
            type="button"
            onClick={() => setShowPatternOverlay((v) => !v)}
            aria-pressed={showPatternOverlay}
            className={`rounded-lg border px-2.5 py-1.5 font-mono text-xs transition-colors cursor-pointer whitespace-nowrap ${
              showPatternOverlay
                ? 'border-purple-500/60 bg-purple-500/15 text-purple-300'
                : 'border-slate-800 bg-[#0a0e1a] text-slate-400 hover:text-white'
            }`}
          >
            Pattern
          </button>

          <button
            type="button"
            onClick={() => setShowEmaRibbon((v) => !v)}
            aria-pressed={showEmaRibbon}
            className={`rounded-lg border px-2.5 py-1.5 font-mono text-xs transition-colors cursor-pointer whitespace-nowrap ${
              showEmaRibbon
                ? 'border-blue-500/60 bg-blue-500/15 text-blue-300'
                : 'border-slate-800 bg-[#0a0e1a] text-slate-400 hover:text-white'
            }`}
          >
            EMA
          </button>

          <button
            type="button"
            data-testid="smart-chart-draw-trendline-btn"
            onClick={() => setDrawingMode((v) => !v)}
            aria-pressed={drawingMode}
            className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 font-mono text-xs transition-colors cursor-pointer whitespace-nowrap ${
              drawingMode
                ? 'border-amber-400 bg-amber-500/20 text-amber-200'
                : 'border-slate-800 bg-[#0a0e1a] text-slate-300 hover:text-white'
            }`}
          >
            <Pencil className="h-3 w-3" aria-hidden="true" />
            <span>{drawingMode ? 'Click 2 Bars' : 'Draw Trendline'}</span>
          </button>

          {userTrendPoints.length > 0 && (
            <button
              type="button"
              onClick={() => setUserTrendPoints([])}
              aria-label="Clear custom trendline"
              className="inline-flex items-center gap-1 rounded-lg border border-slate-800 bg-[#0a0e1a] px-2 py-1.5 text-xs text-slate-300 hover:text-white cursor-pointer"
            >
              <RotateCcw className="h-3 w-3" aria-hidden="true" />
            </button>
          )}

          <button
            type="button"
            onClick={() => chartRef.current?.timeScale().fitContent()}
            aria-label="Fit chart to verified trade history"
            className="inline-flex items-center gap-1 rounded-lg border border-slate-800 bg-[#0a0e1a] px-2.5 py-1.5 text-xs text-slate-300 hover:border-slate-600 hover:text-white transition-colors cursor-pointer whitespace-nowrap"
          >
            <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Fit</span>
          </button>

          <button
            type="button"
            data-testid="public-trade-chart-export-btn"
            onClick={() => handleExportSnapshot('STAGE_1_APPROVED_SIGNAL')}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-[#111827] px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:border-blue-500/60 hover:text-white transition-colors cursor-pointer whitespace-nowrap"
          >
            {snapshotNotice ? (
              <Check className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
            ) : (
              <Camera className="h-3.5 w-3.5 text-blue-400" aria-hidden="true" />
            )}
            <span>Stage 1 PNG</span>
          </button>

          {stage2Spec.isStage2Available && (
            <button
              type="button"
              data-testid="public-trade-chart-export-stage2-btn"
              onClick={() => handleExportSnapshot('STAGE_2_CLOSED_RESULT')}
              className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/45 bg-emerald-500/15 px-2.5 py-1.5 text-xs font-semibold text-emerald-200 hover:bg-emerald-500/25 transition-colors cursor-pointer whitespace-nowrap"
            >
              <Camera className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
              <span>Stage 2 Result PNG</span>
            </button>
          )}
        </div>
      </div>

      {/* Interactive Chart Canvas */}
      <div className="relative bg-[#0b1120] min-h-[380px]">
        <div
          ref={containerRef}
          data-testid="public-trade-chart-canvas"
          aria-label={`Verified Smart Chart for ${trade.tradeId} (${trade.pair} ${timeframe})`}
          className={`w-full h-[380px] ${drawingMode ? 'cursor-crosshair' : ''}`}
        />
        {loading && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-[#0b1120]/75 font-mono text-xs text-slate-300">
            Loading {trade.pair} ({timeframe}) history for {trade.tradeId}...
          </div>
        )}
        {drawingMode && (
          <div className="pointer-events-none absolute left-3 top-3 rounded-md border border-amber-400/50 bg-[#0a0e1a]/90 px-2.5 py-1 font-mono text-[11px] text-amber-200">
            Trendline Tool Active: {userTrendPoints.length === 0 ? 'Click first candle pivot' : userTrendPoints.length === 1 ? 'Click second candle pivot' : 'Trendline drawn (click again to redraw)'}
          </div>
        )}
      </div>

      {/* Technical Structure, Strategy Evidence & Invalidation Conditions */}
      <div className="border-t border-slate-800 bg-[#0a0e1a] px-4 py-3.5 space-y-3 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[11px] tabular-nums">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="text-sky-400">
              {trade.recordClass === 'SIGNAL_ONLY' ? 'Signal' : 'Entry'}: $
              {formatCryptoPrice(trade.actualExecutionPrice ?? trade.entryPrice)}
            </span>
            <span className="text-rose-400">SL: ${formatCryptoPrice(trade.stopLoss)}</span>
            <span className="text-emerald-400">TP: ${formatCryptoPrice(trade.takeProfit)}</span>
            {structure.supportLevel && (
              <span className="text-teal-300">
                SUP: ${formatCryptoPrice(structure.supportLevel.price)} ({structure.supportLevel.touches}x)
              </span>
            )}
            {structure.resistanceLevel && (
              <span className="text-pink-300">
                RES: ${formatCryptoPrice(structure.resistanceLevel.price)} ({structure.resistanceLevel.touches}x)
              </span>
            )}
          </div>
          <span className="text-slate-400">
            {envInfo.shortMode} · P&amp;L: {pnlInfo.displayLabel}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
          <div
            data-testid="smart-chart-strategy-evidence"
            className="rounded-lg border border-slate-800 bg-[#0d1323] p-3 space-y-1.5"
          >
            <div className="font-mono text-[11px] font-semibold text-cyan-300">
              Documented Technical Evidence (Verified OHLCV)
            </div>
            <ul className="space-y-1 text-[11px] text-slate-300 list-disc pl-4">
              {structure.strategyEvidence.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
              {trade.chartPattern && (
                <li>
                  <strong className="text-purple-300">{trade.chartPattern.name}:</strong>{' '}
                  {trade.chartPattern.summary}
                </li>
              )}
            </ul>
          </div>

          <div
            data-testid="smart-chart-invalidation-rules"
            className="rounded-lg border border-slate-800 bg-[#0d1323] p-3 space-y-1.5"
          >
            <div className="font-mono text-[11px] font-semibold text-amber-300 flex items-center gap-1.5">
              <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Explicit Invalidation Conditions</span>
            </div>
            <ul className="space-y-1 text-[11px] text-slate-300 list-disc pl-4">
              {structure.invalidationConditions.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          </div>
        </div>

        {overlay?.windowNotice && (
          <p className="text-[11px] text-amber-300">{overlay.windowNotice}</p>
        )}

        {snapshotNotice && (
          <p data-testid="smart-chart-snapshot-notice" className="text-[11px] font-mono text-emerald-400">
            {snapshotNotice}
          </p>
        )}
      </div>
    </div>
  );
});
