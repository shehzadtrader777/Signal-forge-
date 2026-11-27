import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  Download,
  Lock,
  MessageSquare,
  RefreshCw,
  Share2,
  ShieldCheck,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';
import {
  MAX_CHART_UPLOAD_BYTES,
  type ChartPreScanVisualSignals,
  type ChartScenarioAnalysisReport,
  type ScannerMarketType,
  type ScannerTradingStyle,
} from '../lib/chartScannerEngine';
import {
  createClientDiagnosticId,
  detectBrowserMagicMime,
  mapHttpScannerError,
  mapNetworkScannerException,
  normalizeDeclaredImageMime,
  parseSafeApiResponse,
  type BilingualScannerError,
} from '../lib/chartScannerDiagnostics';
import type { PublicChartSharePreview } from '../lib/businessControlsAndAbuse';
import { formatCryptoPrice } from '../lib/marketData';

interface AiChartScannerModalProps {
  open: boolean;
  onClose: () => void;
}

interface ScannerAccountSnapshot {
  accountId: string;
  planTier: string;
  creditBalance: number;
  dailyScansUsed: number;
  dailyScanQuota: number;
  totalScansCompleted: number;
}

interface ScannerStatusPayload {
  ok: boolean;
  serviceName: string;
  sandboxOnly: boolean;
  productionBillingEnabled: boolean;
  orderExecutionAllowed: boolean;
  featureVisible: boolean;
  featureEnabledInSandbox: boolean;
  emergencySuspended: boolean;
  account: ScannerAccountSnapshot;
  referralCode: string;
  pool: {
    isolatedFromCoreTrading: boolean;
    activeRunningJobs: number;
    queuedJobsCount: number;
    dailyAiSpendUsd: number;
    dailyAiRemainingBudgetUsd: number;
    limits: {
      maxConcurrentJobs: number;
      maxQueueDepth: number;
      dailyAiCostBudgetUsd: number;
    };
  };
}

interface ValidatedUploadState {
  uploadId: string;
  fileName: string;
  widthPx: number;
  heightPx: number;
  byteLength: number;
  metadataStrippedBytes: number;
  autoDetected: {
    symbol: string | null;
    timeframe: string | null;
    exchange: string | null;
    requiresUserConfirmation: boolean;
  };
}

const TRADING_STYLES: readonly { id: ScannerTradingStyle; label: string; horizon: string }[] = [
  { id: 'QUICK_SCALPING', label: 'Quick Scalping', horizon: '2m – 15m' },
  { id: 'SCALPING', label: 'Scalping', horizon: '15m – 90m' },
  { id: 'INTRADAY', label: 'Intraday Trading', horizon: '2h – 12h' },
  { id: 'SWING', label: 'Swing Trading', horizon: '2d – 10d' },
  { id: 'POSITION', label: 'Position Trading', horizon: '2w – 8w' },
];

const WORKFLOW_STEPS = [
  'Upload',
  'Validate',
  'Access',
  'Style',
  'Confirm',
  'Queue',
  'Analyze',
  'Review',
  'Display',
  'Export',
] as const;

/**
 * Lightweight client-side canvas heuristic to inspect candlestick color structure
 * and grid lines before sending to the server's low-cost binary validator.
 */
async function inspectImageVisualSignals(dataUrl: string): Promise<ChartPreScanVisualSignals> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const w = Math.min(240, Math.max(64, img.naturalWidth || 240));
        const h = Math.min(160, Math.max(48, img.naturalHeight || 160));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve({
            chartLikelihoodScore: 72,
            hasCandlestickColorBands: true,
            hasGridOrAxisStructure: true,
            looksLikeMemeOrPhoto: false,
            isBlurryOrCropped: false,
          });
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        const { data } = ctx.getImageData(0, 0, w, h);
        let darkBgPixels = 0;
        let lightBgPixels = 0;
        let greenCandlePixels = 0;
        let redCandlePixels = 0;
        let midToneSkinOrPhotoPixels = 0;
        const total = w * h;

        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          // Recognize standard dark-mode (TradingView #131722, Binance #161a1e/#2b3139) and light-mode chart backgrounds
          if (r < 56 && g < 62 && b < 78) darkBgPixels += 1;
          else if (r > 220 && g > 220 && b > 220) lightBgPixels += 1;
          // Recognize both bright green (Binance #0ecb81) and teal/cyan (TradingView #26a69a) bullish candles
          if (
            (g > r + 25 && g > b + 8) ||
            (g > 110 && b > 100 && g - r > 48 && b - r > 35)
          ) {
            greenCandlePixels += 1;
          }
          // Recognize red/coral bearish candles (Binance #f6465d, TradingView #ef5350)
          if (r > g + 35 && r > b + 20) redCandlePixels += 1;
          if (r > 130 && g > 85 && g < 185 && b > 60 && b < 150 && Math.abs(r - g) < 55) {
            midToneSkinOrPhotoPixels += 1;
          }
        }

        const bgRatio = (darkBgPixels + lightBgPixels) / total;
        const candleRatio = (greenCandlePixels + redCandlePixels) / total;
        const photoRatio = midToneSkinOrPhotoPixels / total;
        const hasCandlestickColorBands =
          (greenCandlePixels > 10 && redCandlePixels > 10) ||
          greenCandlePixels > 28 ||
          redCandlePixels > 28;
        const hasGridOrAxisStructure = bgRatio > 0.30;
        const looksLikeMemeOrPhoto = photoRatio > 0.45 && !hasCandlestickColorBands;
        const isBlurryOrCropped = img.naturalWidth < 360 || img.naturalHeight < 220;

        let score = 35;
        if (hasGridOrAxisStructure) score += 28;
        if (hasCandlestickColorBands) score += 27;
        if (candleRatio > 0.004 && candleRatio < 0.4) score += 10;
        if (looksLikeMemeOrPhoto) score -= 45;
        if (isBlurryOrCropped) score -= 20;

        resolve({
          chartLikelihoodScore: Math.max(5, Math.min(98, score)),
          hasCandlestickColorBands,
          hasGridOrAxisStructure,
          looksLikeMemeOrPhoto,
          isBlurryOrCropped,
        });
      } catch {
        resolve({
          chartLikelihoodScore: 70,
          hasCandlestickColorBands: true,
          hasGridOrAxisStructure: true,
          looksLikeMemeOrPhoto: false,
          isBlurryOrCropped: false,
        });
      }
    };
    img.onerror = () => {
      resolve({
        chartLikelihoodScore: 15,
        hasCandlestickColorBands: false,
        hasGridOrAxisStructure: false,
        looksLikeMemeOrPhoto: true,
        isBlurryOrCropped: true,
      });
    };
    img.src = dataUrl;
  });
}

/**
 * Generates a clean, valid synthetic candlestick chart PNG on a client canvas
 * purely so visitors/evaluators can test the real upload -> validation -> live Binance analysis pipeline.
 */
function buildSampleChartPngDataUrl(symbol: string, timeframe: string): string {
  const canvas = document.createElement('canvas');
  canvas.width = 960;
  canvas.height = 540;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  ctx.fillStyle = '#0a0e1a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Subtle chart grid
  ctx.strokeStyle = '#1e293b';
  ctx.lineWidth = 1;
  for (let y = 60; y < 480; y += 60) {
    ctx.beginPath();
    ctx.moveTo(40, y);
    ctx.lineTo(880, y);
    ctx.stroke();
  }
  for (let x = 80; x < 880; x += 80) {
    ctx.beginPath();
    ctx.moveTo(x, 40);
    ctx.lineTo(x, 480);
    ctx.stroke();
  }

  // Deterministic candlestick series for visual chart signature
  let price = 310;
  const seed = Date.now() % 97;
  for (let i = 0; i < 48; i++) {
    const x = 64 + i * 16.5;
    const delta = Math.sin((i + seed) * 0.45) * 26 + Math.cos((i + seed) * 0.19) * 14;
    const open = price;
    const close = Math.max(100, Math.min(430, open - delta * 0.45));
    const high = Math.min(open, close) - (10 + ((i * 7 + seed) % 16));
    const low = Math.max(open, close) + (10 + ((i * 5 + seed) % 16));
    const bull = close < open;

    ctx.strokeStyle = bull ? '#10b981' : '#f43f5e';
    ctx.fillStyle = bull ? '#10b981' : '#f43f5e';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, high);
    ctx.lineTo(x, low);
    ctx.stroke();
    ctx.fillRect(x - 4.5, Math.min(open, close), 9, Math.max(4, Math.abs(close - open)));
    price = close;
  }

  // Axis text
  ctx.fillStyle = '#94a3b8';
  ctx.font = 'bold 16px monospace';
  ctx.fillText(`BINANCE:${symbol} · ${timeframe.toUpperCase()} · SAMPLE CHART SNAPSHOT`, 48, 34);
  return canvas.toDataURL('image/png');
}

export function AiChartScannerModal({ open, onClose }: AiChartScannerModalProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [status, setStatus] = useState<ScannerStatusPayload | null>(null);
  const [uploadState, setUploadState] = useState<ValidatedUploadState | null>(null);
  const [previewDataUrl, setPreviewDataUrl] = useState<string | null>(null);
  const [report, setReport] = useState<ChartScenarioAnalysisReport | null>(null);
  const [sharePreview, setSharePreview] = useState<PublicChartSharePreview | null>(null);

  const [symbol, setSymbol] = useState<string>('BTCUSDT');
  const [exchange, setExchange] = useState<string>('BINANCE');
  const [timeframe, setTimeframe] = useState<string>('1h');
  const [marketType, setMarketType] = useState<ScannerMarketType>('SPOT');
  const [tradingStyle, setTradingStyle] = useState<ScannerTradingStyle>('INTRADAY');
  const [userRiskLimitUsd, setUserRiskLimitUsd] = useState<number>(50);
  const [marketConfirmed, setMarketConfirmed] = useState<boolean>(false);

  const [followUpQuestion, setFollowUpQuestion] = useState<string>('');
  const [followUpReplies, setFollowUpReplies] = useState<Array<{ q: string; a: string }>>([]);
  const [shareConsent, setShareConsent] = useState<boolean>(false);
  const [copiedShare, setCopiedShare] = useState<boolean>(false);

  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [errorDetail, setErrorDetail] = useState<BilingualScannerError | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);
  const [lastValidationDiagId, setLastValidationDiagId] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/scanner/status', { credentials: 'same-origin' });
      if (!res.ok) return;
      const data = (await res.json()) as ScannerStatusPayload;
      if (data.ok) setStatus(data);
    } catch {
      // Ignore transient load error
    }
  }, []);

  useEffect(() => {
    if (open) {
      void fetchStatus();
    }
  }, [open, fetchStatus]);

  const currentStepIndex = useMemo(() => {
    if (sharePreview) return 9;
    if (report) return 8;
    if (busyAction === 'analyze') return 6;
    if (uploadState && marketConfirmed) return 4;
    if (uploadState) return 3;
    if (busyAction === 'upload') return 1;
    return 0;
  }, [uploadState, marketConfirmed, busyAction, report, sharePreview]);

  const submitBinaryImageUpload = async (params: {
    blob: Blob;
    previewUrl: string;
    fileName: string;
    declaredMimeType: string;
  }) => {
    setBusyAction('upload');
    setErrorDetail(null);
    setInfoMsg(null);
    setReport(null);
    setSharePreview(null);
    setFollowUpReplies([]);

    // Client-side early size guard matching server MAX_CHART_UPLOAD_BYTES (5 MB) so mobile users
    // get instant clear feedback instead of hitting proxy 413 HTML errors.
    if (params.blob.size === 0 || params.blob.size > MAX_CHART_UPLOAD_BYTES) {
      setUploadState(null);
      setErrorDetail({
        category: 'PAYLOAD_TOO_LARGE',
        code: 'REJECTED_SIZE_LIMIT',
        titleEn: 'Image File Too Large (Max 5 MB)',
        titleUr: 'تصویر کا سائز بہت بڑا ہے (زیادہ سے زیادہ 5 MB)',
        messageEn: `Selected file is ${(params.blob.size / (1024 * 1024)).toFixed(
          2
        )} MB. Chart screenshots must be under 5 MB (PNG, JPEG, or WebP). Zero credits charged.`,
        messageUr: `منتخب فائل ${(params.blob.size / (1024 * 1024)).toFixed(
          2
        )} MB ہے۔ چارٹ اسکرین شاٹ 5 MB سے کم (PNG، JPEG یا WebP) ہونا چاہیے۔ کوئی کریڈٹ نہیں کاٹا گیا۔`,
        diagnosticId: createClientDiagnosticId('SF-VAL'),
        httpStatus: 413,
        creditsCharged: 0,
      });
      setBusyAction(null);
      return;
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 25_000);

    try {
      const headerBuf = new Uint8Array(await params.blob.slice(0, 16).arrayBuffer());
      const magicMime = detectBrowserMagicMime(headerBuf);
      const normalizedMime = normalizeDeclaredImageMime({
        declaredMime: params.declaredMimeType,
        fileName: params.fileName,
        magicMime,
      });
      const visualSignals = await inspectImageVisualSignals(params.previewUrl);

      // Send raw binary directly (avoids +33% base64 JSON inflation on mobile screenshots)
      const transportContentType =
        normalizedMime === 'image/png' ||
        normalizedMime === 'image/jpeg' ||
        normalizedMime === 'image/webp'
          ? normalizedMime
          : 'application/octet-stream';

      const res = await fetch('/api/scanner/upload', {
        method: 'POST',
        credentials: 'same-origin',
        signal: controller.signal,
        headers: {
          'Content-Type': transportContentType,
          'X-Declared-Mime': normalizedMime,
          'X-File-Name': encodeURIComponent(params.fileName.slice(0, 140)),
          'X-Visual-Signals': JSON.stringify(visualSignals),
        },
        body: params.blob,
      });

      const parsed = await parseSafeApiResponse(res);
      if (!parsed.ok || !parsed.data || parsed.data.ok !== true) {
        setUploadState(null);
        setErrorDetail(mapHttpScannerError(parsed, 'upload'));
        return;
      }

      const data = parsed.data as {
        uploadId: string;
        diagnosticId?: string;
        metadataStrippedBytes?: number;
        meta: { widthPx: number; heightPx: number; byteLength: number };
        autoDetected: ValidatedUploadState['autoDetected'];
      };

      setPreviewDataUrl(params.previewUrl);
      setLastValidationDiagId(data.diagnosticId || parsed.diagnosticId || null);
      setUploadState({
        uploadId: data.uploadId,
        fileName: params.fileName,
        widthPx: data.meta.widthPx,
        heightPx: data.meta.heightPx,
        byteLength: data.meta.byteLength,
        metadataStrippedBytes: data.metadataStrippedBytes ?? 0,
        autoDetected: data.autoDetected,
      });
      if (data.autoDetected?.symbol) setSymbol(data.autoDetected.symbol);
      if (data.autoDetected?.timeframe) setTimeframe(data.autoDetected.timeframe);
      if (data.autoDetected?.exchange) setExchange(data.autoDetected.exchange);
      setMarketConfirmed(false);
      setInfoMsg(
        `Private chart validated (${data.meta.widthPx}×${data.meta.heightPx}px · ${
          data.metadataStrippedBytes ?? 0
        } metadata bytes stripped · 0 credits charged). Select trading style and confirm market parameters below.`
      );
      void fetchStatus();
    } catch (err) {
      setUploadState(null);
      setErrorDetail(
        mapNetworkScannerException(err, {
          isOffline: typeof navigator !== 'undefined' && navigator.onLine === false,
          stage: 'upload',
        })
      );
    } finally {
      window.clearTimeout(timeoutId);
      setBusyAction(null);
    }
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      if (!result) {
        setErrorDetail({
          category: 'VALIDATION_REJECTED',
          code: 'EMPTY_FILE_READ',
          titleEn: 'Could Not Read Selected File',
          titleUr: 'منتخب فائل پڑھی نہیں جا سکی',
          messageEn: 'The browser could not read this file. Please choose a valid PNG, JPEG, or WebP screenshot. Zero credits charged.',
          messageUr: 'براؤزر یہ فائل نہیں پڑھ سکا۔ براہِ کرم درست PNG، JPEG یا WebP اسکرین شاٹ دوبارہ منتخب کریں۔ کوئی کریڈٹ نہیں کاٹا گیا۔',
          diagnosticId: createClientDiagnosticId('SF-VAL'),
          httpStatus: null,
          creditsCharged: 0,
        });
        return;
      }
      void submitBinaryImageUpload({
        blob: file,
        previewUrl: result,
        fileName: file.name,
        declaredMimeType: file.type || '',
      });
    };
    reader.onerror = () => {
      setErrorDetail({
        category: 'VALIDATION_REJECTED',
        code: 'FILE_READER_ERROR',
        titleEn: 'Mobile File Access Failed',
        titleUr: 'موبائل فائل کھولنے میں ناکامی',
        messageEn: 'Could not read the selected image from device storage. Save the screenshot locally and retry. Zero credits charged.',
        messageUr: 'موبائل اسٹوریج سے تصویر نہیں پڑھی جا سکی۔ براہِ کرم اسکرین شاٹ گیلری میں محفوظ کر کے دوبارہ کوشش کریں۔ کوئی کریڈٹ نہیں کاٹا گیا۔',
        diagnosticId: createClientDiagnosticId('SF-VAL'),
        httpStatus: null,
        creditsCharged: 0,
      });
    };
    reader.readAsDataURL(file);
  };

  const handleLoadSampleChart = async () => {
    const sampleUrl = buildSampleChartPngDataUrl(symbol, timeframe);
    if (!sampleUrl) return;
    try {
      const blobRes = await fetch(sampleUrl);
      const blob = await blobRes.blob();
      void submitBinaryImageUpload({
        blob,
        previewUrl: sampleUrl,
        fileName: `binance_${symbol}_${timeframe}_sample.png`,
        declaredMimeType: 'image/png',
      });
    } catch (err) {
      setErrorDetail(mapNetworkScannerException(err, { stage: 'upload' }));
    }
  };

  const handleRunAnalysis = async () => {
    if (!uploadState) return;
    setBusyAction('analyze');
    setErrorDetail(null);
    setInfoMsg(null);
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 30_000);
    try {
      const res = await fetch('/api/scanner/analyze', {
        method: 'POST',
        credentials: 'same-origin',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uploadId: uploadState.uploadId,
          symbol,
          exchange,
          timeframe,
          marketType,
          tradingStyle,
          userRiskLimitUsd,
          marketConfirmed,
        }),
      });
      const parsed = await parseSafeApiResponse(res);
      if (!parsed.ok || !parsed.data || parsed.data.ok !== true) {
        setErrorDetail(mapHttpScannerError(parsed, 'analyze'));
        return;
      }
      const data = parsed.data as {
        report: ChartScenarioAnalysisReport;
        account?: ScannerAccountSnapshot;
        pool?: ScannerStatusPayload['pool'];
        referralCode?: string;
      };
      setReport(data.report);
      setFollowUpReplies([]);
      setSharePreview(null);
      setShareConsent(false);
      setStatus((prev) =>
        prev
          ? {
              ...prev,
              account: data.account ?? prev.account,
              pool: data.pool ?? prev.pool,
              referralCode: data.referralCode ?? prev.referralCode,
            }
          : prev
      );
    } catch (err) {
      setErrorDetail(
        mapNetworkScannerException(err, {
          isOffline: typeof navigator !== 'undefined' && navigator.onLine === false,
          stage: 'analyze',
        })
      );
    } finally {
      window.clearTimeout(timeoutId);
      setBusyAction(null);
    }
  };

  const handleAskFollowUp = async () => {
    if (!report || !followUpQuestion.trim()) return;
    setBusyAction('followup');
    setErrorDetail(null);
    try {
      const res = await fetch('/api/scanner/followup', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          analysisId: report.analysisId,
          question: followUpQuestion.trim(),
          customRiskUsd: userRiskLimitUsd,
        }),
      });
      const parsed = await parseSafeApiResponse(res);
      if (!parsed.ok || !parsed.data || parsed.data.ok !== true) {
        setErrorDetail(mapHttpScannerError(parsed, 'followup'));
        return;
      }
      setFollowUpReplies((prev) => [
        ...prev,
        { q: followUpQuestion.trim(), a: String(parsed.data?.answer || '') },
      ]);
      setReport((prev) => (prev ? { ...prev, followUpsUsed: prev.followUpsUsed + 1 } : prev));
      setFollowUpQuestion('');
    } catch (err) {
      setErrorDetail(
        mapNetworkScannerException(err, {
          isOffline: typeof navigator !== 'undefined' && navigator.onLine === false,
          stage: 'followup',
        })
      );
    } finally {
      setBusyAction(null);
    }
  };

  const handleRecheck = async () => {
    if (!report) return;
    setBusyAction('recheck');
    setErrorDetail(null);
    setInfoMsg(null);
    try {
      const res = await fetch('/api/scanner/recheck', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ analysisId: report.analysisId }),
      });
      const parsed = await parseSafeApiResponse(res);
      if (!parsed.ok || !parsed.data || parsed.data.ok !== true) {
        if (parsed.status === 409) {
          setInfoMsg(
            String(
              parsed.data?.error || 'No new candle closed yet — zero credits charged.'
            )
          );
        } else {
          setErrorDetail(mapHttpScannerError(parsed, 'recheck'));
        }
        return;
      }
      setReport(parsed.data.report as ChartScenarioAnalysisReport);
      if (parsed.data.account) {
        setStatus((prev) =>
          prev ? { ...prev, account: parsed.data!.account as ScannerAccountSnapshot } : prev
        );
      }
      setInfoMsg('Scenario refreshed on newly closed candle.');
    } catch (err) {
      setErrorDetail(
        mapNetworkScannerException(err, {
          isOffline: typeof navigator !== 'undefined' && navigator.onLine === false,
          stage: 'recheck',
        })
      );
    } finally {
      setBusyAction(null);
    }
  };

  const handleCreateSharePreview = async () => {
    if (!report || !shareConsent) return;
    setBusyAction('share');
    setErrorDetail(null);
    try {
      const res = await fetch('/api/scanner/share', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          analysisId: report.analysisId,
          consentToShareSummary: true,
        }),
      });
      const parsed = await parseSafeApiResponse(res);
      if (!parsed.ok || !parsed.data || parsed.data.ok !== true) {
        setErrorDetail(mapHttpScannerError(parsed, 'share'));
        return;
      }
      setSharePreview(parsed.data.preview as PublicChartSharePreview);
    } catch (err) {
      setErrorDetail(
        mapNetworkScannerException(err, {
          isOffline: typeof navigator !== 'undefined' && navigator.onLine === false,
          stage: 'share',
        })
      );
    } finally {
      setBusyAction(null);
    }
  };

  const handleDownloadReport = () => {
    if (!report) return;
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `signal-forge-scenario-${report.symbol}-${report.timeframe}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCopyShare = async () => {
    if (!sharePreview) return;
    try {
      await navigator.clipboard.writeText(
        `${sharePreview.captionText}\n${sharePreview.shareUrl}\n${sharePreview.referralDisclosure}`
      );
      setCopiedShare(true);
      setTimeout(() => setCopiedShare(false), 2000);
    } catch {
      setCopiedShare(false);
    }
  };

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="AI Chart Scanner and Scenario Lab"
      data-testid="ai-chart-scanner-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-3 sm:p-5 overflow-y-auto"
    >
      <div className="relative my-auto w-full max-w-5xl max-h-[92vh] overflow-y-auto rounded-xl border border-slate-700 bg-[#0d1323] text-slate-100 shadow-2xl">
        {/* Top Modal Header */}
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-slate-800 bg-[#0a0e1a] px-5 py-4">
          <div className="space-y-1 min-w-0">
            <div className="font-mono text-[11px] text-blue-400">
              AI Chart Scanner &amp; Scenario Lab · Read-Only Sandbox Preview
            </div>
            <h2 className="font-display text-lg sm:text-xl font-bold text-white tracking-tight">
              Upload Private Chart for Conditional Multi-Agent Scenario Analysis
            </h2>
            <p className="text-xs text-slate-400">
              No payment collection active · No order execution from uploaded screenshots · Uploaded images stay strictly private.
            </p>
          </div>
          <button
            type="button"
            data-testid="close-chart-scanner-btn"
            onClick={onClose}
            aria-label="Close AI Chart Scanner"
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-700 bg-[#111827] text-slate-300 hover:border-slate-500 hover:text-white cursor-pointer shrink-0"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {/* 10-Stage Workflow Progress Strip */}
        <div className="border-b border-slate-800 bg-[#0a0e1a]/70 px-5 py-2.5 overflow-x-auto">
          <ol className="flex items-center gap-2 min-w-max font-mono text-[11px]">
            {WORKFLOW_STEPS.map((label, idx) => (
              <li
                key={label}
                className={`flex items-center gap-1.5 ${
                  idx <= currentStepIndex ? 'text-blue-300 font-semibold' : 'text-slate-500'
                }`}
              >
                <span
                  className={`inline-flex h-4 w-4 items-center justify-center rounded text-[10px] ${
                    idx <= currentStepIndex
                      ? 'bg-[#3b82f6] text-white'
                      : 'border border-slate-700 text-slate-500'
                  }`}
                >
                  {idx + 1}
                </span>
                <span>{label}</span>
                {idx < WORKFLOW_STEPS.length - 1 && (
                  <span className="text-slate-700" aria-hidden="true">
                    /
                  </span>
                )}
              </li>
            ))}
          </ol>
        </div>

        <div className="p-5 space-y-5">
          {/* Sandbox Quota & Isolated Worker Pool Bar */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono tabular-nums">
            <div className="rounded-lg border border-slate-800 bg-[#111827] p-3">
              <div className="font-sans text-[11px] text-slate-400">Sandbox Credits</div>
              <div
                data-testid="scanner-credit-balance"
                className="mt-1 font-bold text-white"
              >
                {status?.account.creditBalance ?? 3} credits
              </div>
            </div>
            <div className="rounded-lg border border-slate-800 bg-[#111827] p-3">
              <div className="font-sans text-[11px] text-slate-400">Daily Quota (Capped)</div>
              <div className="mt-1 font-bold text-blue-300">
                {status?.account.dailyScansUsed ?? 0} / {status?.account.dailyScanQuota ?? 3}
              </div>
            </div>
            <div className="rounded-lg border border-slate-800 bg-[#111827] p-3">
              <div className="font-sans text-[11px] text-slate-400">Isolated Worker Pool</div>
              <div className="mt-1 font-bold text-emerald-400">
                {status?.pool.activeRunningJobs ?? 0}/{status?.pool.limits.maxConcurrentJobs ?? 2} active
              </div>
            </div>
            <div className="rounded-lg border border-slate-800 bg-[#111827] p-3">
              <div className="font-sans text-[11px] text-slate-400">Execution Safety</div>
              <div className="mt-1 font-bold text-amber-300">READ-ONLY ONLY</div>
            </div>
          </div>

          {errorDetail && (
            <div
              role="alert"
              data-testid="scanner-error-banner"
              className="rounded-lg border border-rose-500/45 bg-rose-950/35 px-4 py-3 text-xs text-rose-100 space-y-2"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-2 min-w-0">
                  <AlertTriangle className="h-4 w-4 text-rose-400 shrink-0 mt-0.5" aria-hidden="true" />
                  <div className="space-y-1 min-w-0">
                    <div className="font-semibold text-rose-100">
                      {errorDetail.titleEn}
                      {errorDetail.httpStatus ? ` · HTTP ${errorDetail.httpStatus}` : ''}
                    </div>
                    <p className="text-rose-200/95 leading-relaxed">{errorDetail.messageEn}</p>
                    <p
                      dir="rtl"
                      lang="ur"
                      data-testid="scanner-error-urdu"
                      className="text-rose-100/95 leading-relaxed font-sans pt-1 border-t border-rose-500/20"
                    >
                      <span className="font-semibold">{errorDetail.titleUr}:</span>{' '}
                      {errorDetail.messageUr}
                    </p>
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 pt-1 font-mono text-[10px] text-rose-300/90">
                <span>
                  Code: {errorDetail.code} · Credits Charged: {errorDetail.creditsCharged}
                </span>
                <span data-testid="scanner-error-diagnostic-id">
                  Ref ID: {errorDetail.diagnosticId}
                </span>
              </div>
            </div>
          )}

          {infoMsg && (
            <div
              role="status"
              data-testid="scanner-info-banner"
              className="rounded-lg border border-blue-500/40 bg-blue-950/30 px-4 py-3 text-xs text-blue-200 flex items-start justify-between gap-2"
            >
              <div className="flex items-start gap-2">
                <ShieldCheck className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
                <span>{infoMsg}</span>
              </div>
              {lastValidationDiagId && (
                <span className="font-mono text-[10px] text-blue-300/80 shrink-0">
                  Ref: {lastValidationDiagId}
                </span>
              )}
            </div>
          )}

          {/* Step 1-5: Upload & Market Confirmation */}
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
            {/* Upload Panel */}
            <div className="lg:col-span-5 rounded-xl border border-slate-800 bg-[#111827] p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-display text-sm font-bold text-white">
                  1. Upload Private Chart Screenshot
                </h3>
                <span className="inline-flex items-center gap-1 font-mono text-[10px] text-emerald-400">
                  <Lock className="h-3 w-3" aria-hidden="true" />
                  Private Only
                </span>
              </div>

              <p className="text-[11px] text-slate-400 leading-relaxed">
                Accepted: PNG, JPEG, WEBP (max 5 MB, min 320&times;200px). Real magic-byte inspection strips metadata and rejects non-charts with <strong className="text-slate-200">0 credits charged</strong>.
              </p>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={handleFileChange}
                className="sr-only"
                data-testid="scanner-file-input"
              />

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busyAction !== null}
                  onClick={() => fileInputRef.current?.click()}
                  data-testid="scanner-select-file-btn"
                  className="flex-1 min-h-[44px] inline-flex items-center justify-center gap-2 rounded-lg bg-[#3b82f6] px-4 py-2 text-xs font-semibold text-white hover:bg-blue-500 disabled:opacity-50 cursor-pointer"
                >
                  <Upload className="h-4 w-4" aria-hidden="true" />
                  <span>{busyAction === 'upload' ? 'Validating...' : 'Choose Chart Image'}</span>
                </button>
                <button
                  type="button"
                  disabled={busyAction !== null}
                  onClick={() => void handleLoadSampleChart()}
                  data-testid="scanner-sample-chart-btn"
                  className="min-h-[44px] inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-700 bg-[#0a0e1a] px-3 py-2 text-xs font-semibold text-slate-200 hover:border-blue-500 hover:text-white cursor-pointer"
                >
                  <Sparkles className="h-3.5 w-3.5 text-blue-400" aria-hidden="true" />
                  <span>Sample Valid Chart</span>
                </button>
              </div>

              {previewDataUrl && uploadState && (
                <div className="space-y-2 pt-1">
                  <img
                    src={previewDataUrl}
                    alt="Uploaded private chart preview"
                    className="w-full h-36 object-cover rounded-lg border border-slate-800 bg-[#0a0e1a]"
                  />
                  <div className="font-mono text-[10px] text-slate-400 flex flex-wrap justify-between gap-1">
                    <span>{uploadState.fileName}</span>
                    <span>
                      {uploadState.widthPx}&times;{uploadState.heightPx}px · Stripped{' '}
                      {uploadState.metadataStrippedBytes}B
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Trading Style & Explicit Market Confirmation */}
            <div className="lg:col-span-7 rounded-xl border border-slate-800 bg-[#111827] p-4 space-y-4">
              <h3 className="font-display text-sm font-bold text-white">
                2. Trading Style &amp; Explicit Market Confirmation
              </h3>

              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                {TRADING_STYLES.map((st) => (
                  <button
                    key={st.id}
                    type="button"
                    data-testid={`scanner-style-${st.id}`}
                    onClick={() => setTradingStyle(st.id)}
                    className={`rounded-lg border p-2 text-left transition-colors cursor-pointer ${
                      tradingStyle === st.id
                        ? 'border-[#3b82f6] bg-[#3b82f6]/15 text-white'
                        : 'border-slate-800 bg-[#0a0e1a] text-slate-400 hover:border-slate-600'
                    }`}
                  >
                    <div className="text-[11px] font-semibold leading-tight">{st.label}</div>
                    <div className="font-mono text-[10px] text-slate-400 mt-0.5">{st.horizon}</div>
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 text-xs">
                <div>
                  <label htmlFor="scanner-exchange" className="block text-[11px] text-slate-400 mb-1">
                    Exchange
                  </label>
                  <select
                    id="scanner-exchange"
                    value={exchange}
                    onChange={(e) => setExchange(e.target.value)}
                    className="w-full min-h-[38px] rounded-lg border border-slate-700 bg-[#0a0e1a] px-2.5 py-1.5 font-mono text-xs text-white"
                  >
                    <option value="BINANCE">BINANCE</option>
                    <option value="BYBIT">BYBIT</option>
                    <option value="OKX">OKX</option>
                    <option value="KRAKEN">KRAKEN</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="scanner-symbol" className="block text-[11px] text-slate-400 mb-1">
                    Symbol
                  </label>
                  <input
                    id="scanner-symbol"
                    data-testid="scanner-symbol-input"
                    type="text"
                    value={symbol}
                    onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                    className="w-full min-h-[38px] rounded-lg border border-slate-700 bg-[#0a0e1a] px-2.5 py-1.5 font-mono text-xs text-white"
                  />
                </div>
                <div>
                  <label htmlFor="scanner-timeframe" className="block text-[11px] text-slate-400 mb-1">
                    Timeframe
                  </label>
                  <select
                    id="scanner-timeframe"
                    value={timeframe}
                    onChange={(e) => setTimeframe(e.target.value)}
                    className="w-full min-h-[38px] rounded-lg border border-slate-700 bg-[#0a0e1a] px-2.5 py-1.5 font-mono text-xs text-white"
                  >
                    <option value="5m">5m</option>
                    <option value="15m">15m</option>
                    <option value="1h">1h</option>
                    <option value="4h">4h</option>
                    <option value="1d">1d</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="scanner-market-type" className="block text-[11px] text-slate-400 mb-1">
                    Market
                  </label>
                  <select
                    id="scanner-market-type"
                    value={marketType}
                    onChange={(e) => setMarketType(e.target.value as ScannerMarketType)}
                    className="w-full min-h-[38px] rounded-lg border border-slate-700 bg-[#0a0e1a] px-2.5 py-1.5 font-mono text-xs text-white"
                  >
                    <option value="SPOT">SPOT</option>
                    <option value="FUTURES">FUTURES</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="scanner-risk-usd" className="block text-[11px] text-slate-400 mb-1">
                    Risk Limit ($)
                  </label>
                  <input
                    id="scanner-risk-usd"
                    type="number"
                    min={5}
                    max={50000}
                    value={userRiskLimitUsd}
                    onChange={(e) => setUserRiskLimitUsd(Math.max(5, Number(e.target.value) || 50))}
                    className="w-full min-h-[38px] rounded-lg border border-slate-700 bg-[#0a0e1a] px-2.5 py-1.5 font-mono text-xs text-white tabular-nums"
                  />
                </div>
              </div>

              <label className="flex items-start gap-2.5 rounded-lg border border-slate-800 bg-[#0a0e1a] p-3 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  data-testid="scanner-confirm-market-checkbox"
                  checked={marketConfirmed}
                  onChange={(e) => setMarketConfirmed(e.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-blue-500 shrink-0"
                />
                <span className="text-slate-300 leading-snug">
                  I confirm <strong className="text-white">{exchange}:{symbol} ({timeframe} · {marketType})</strong> and understand this produces read-only conditional scenarios with zero automatic order execution.
                </span>
              </label>

              <button
                type="button"
                data-testid="scanner-run-analysis-btn"
                disabled={!uploadState || !marketConfirmed || busyAction !== null}
                onClick={handleRunAnalysis}
                className="w-full min-h-[44px] rounded-lg bg-[#3b82f6] px-4 py-2.5 text-xs font-semibold text-white hover:bg-blue-500 disabled:opacity-45 transition-colors cursor-pointer"
              >
                {busyAction === 'analyze'
                  ? 'Running Isolated Multi-Agent Scenario Analysis...'
                  : 'Run Read-Only Multi-Agent Analysis (1 Sandbox Credit)'}
              </button>
            </div>
          </div>

          {/* Step 8-10: Conditional Scenarios, 4-Agent Reviews, Follow-Up, Recheck & User-Initiated Share */}
          {report && (
            <div data-testid="scanner-analysis-report" className="space-y-5 border-t border-slate-800 pt-5">
              {/* Verdict Header */}
              <div className="rounded-xl border border-slate-700 bg-[#111827] p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-1">
                  <div className="font-mono text-xs text-blue-400">
                    {report.exchange}:{report.symbol} · {report.timeframe} · {report.marketType} ·{' '}
                    {report.tradingStyle} · {report.dataSource} ({report.dataFreshness})
                  </div>
                  <h3 className="font-display text-base font-bold text-white flex items-center gap-2">
                    <span>Recommendation:</span>
                    <span
                      data-testid="scanner-recommendation"
                      className={
                        report.recommendation === 'WAIT_NO_TRADE'
                          ? 'text-amber-300'
                          : report.recommendation === 'CONDITIONAL_BULLISH'
                          ? 'text-emerald-400'
                          : 'text-rose-400'
                      }
                    >
                      {report.recommendation.replace(/_/g, ' ')}
                    </span>
                  </h3>
                  {report.waitReason && (
                    <p className="text-xs text-amber-200">{report.waitReason}</p>
                  )}
                  <div className="font-mono text-[11px] text-slate-400 tabular-nums">
                    Mark ${formatCryptoPrice(report.referenceMarkPrice)} · Horizon{' '}
                    {report.estimatedHoldingHorizon} · Expires{' '}
                    {new Date(report.scenarioExpiresAtIso).toUTCString().slice(5, 22)} UTC
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={handleDownloadReport}
                    className="min-h-[40px] inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-[#0a0e1a] px-3 py-2 text-xs font-semibold text-slate-200 hover:border-blue-500 hover:text-white cursor-pointer"
                  >
                    <Download className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Download JSON</span>
                  </button>
                  <button
                    type="button"
                    disabled={busyAction !== null}
                    onClick={handleRecheck}
                    className="min-h-[40px] inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-[#0a0e1a] px-3 py-2 text-xs font-semibold text-slate-200 hover:border-blue-500 hover:text-white cursor-pointer"
                  >
                    <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Recheck New Candle</span>
                  </button>
                </div>
              </div>

              {/* Bullish & Bearish Conditional Scenario Cards */}
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 text-xs">
                {[
                  { branch: report.bullishScenario, accent: 'emerald', title: 'Conditional Bullish Scenario' },
                  { branch: report.bearishScenario, accent: 'rose', title: 'Conditional Bearish Scenario' },
                ].map(({ branch, accent, title }) => (
                  <article
                    key={branch.bias}
                    className="rounded-xl border border-slate-800 bg-[#111827] p-4 space-y-3"
                  >
                    <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                      <h4
                        className={`font-display text-sm font-bold ${
                          accent === 'emerald' ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        {title}
                      </h4>
                      <span className="font-mono font-bold text-blue-300 tabular-nums">
                        R:R 1:{branch.riskRewardRatio}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-300">{branch.confirmationTrigger}</p>
                    <dl className="grid grid-cols-2 gap-2 font-mono text-[11px] tabular-nums">
                      <div className="rounded bg-[#0a0e1a] p-2">
                        <dt className="font-sans text-[10px] text-slate-400">Entry Zone</dt>
                        <dd className="text-white font-semibold">
                          ${formatCryptoPrice(branch.entryZoneLow)} – ${formatCryptoPrice(branch.entryZoneHigh)}
                        </dd>
                      </div>
                      <div className="rounded bg-[#0a0e1a] p-2">
                        <dt className="font-sans text-[10px] text-slate-400">Stop Loss / Invalidation</dt>
                        <dd className="text-rose-400 font-semibold">
                          ${formatCryptoPrice(branch.stopLoss)}
                        </dd>
                      </div>
                      <div className="rounded bg-[#0a0e1a] p-2">
                        <dt className="font-sans text-[10px] text-slate-400">TP1 / TP2 / TP3</dt>
                        <dd className="text-emerald-400 font-semibold">
                          ${formatCryptoPrice(branch.takeProfitTargets[0])} / $
                          {formatCryptoPrice(branch.takeProfitTargets[1])} / $
                          {formatCryptoPrice(branch.takeProfitTargets[2])}
                        </dd>
                      </div>
                      <div className="rounded bg-[#0a0e1a] p-2">
                        <dt className="font-sans text-[10px] text-slate-400">Max Risk at Limit</dt>
                        <dd className="text-amber-300 font-semibold">
                          -${branch.estimatedDollarLossAtRiskLimit.toFixed(2)} USD
                        </dd>
                      </div>
                    </dl>
                  </article>
                ))}
              </div>

              {/* 4-Agent Read-Only Reviews */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 text-[11px]">
                {(
                  [
                    ['Market Agent', report.agentReviews.marketAgent],
                    ['Strategy Agent', report.agentReviews.strategyAgent],
                    ['Risk Agent', report.agentReviews.riskAgent],
                    ['Audit Agent', report.agentReviews.auditAgent],
                  ] as const
                ).map(([agentName, summary]) => (
                  <div
                    key={agentName}
                    className="rounded-lg border border-slate-800 bg-[#111827] p-3 space-y-1"
                  >
                    <div className="font-mono font-bold text-blue-300">{agentName}</div>
                    <p className="text-slate-300 leading-relaxed">{summary}</p>
                  </div>
                ))}
              </div>

              {/* Lightweight Follow-Up & User-Initiated Privacy-Safe Share */}
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {/* Lightweight Follow-Up (Max 3) */}
                <div className="rounded-xl border border-slate-800 bg-[#111827] p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="font-display text-sm font-bold text-white flex items-center gap-1.5">
                      <MessageSquare className="h-4 w-4 text-blue-400" aria-hidden="true" />
                      <span>Lightweight Follow-Up</span>
                    </h4>
                    <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                      {report.followUpsUsed} / {report.maxFollowUps} used
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      data-testid="scanner-followup-input"
                      value={followUpQuestion}
                      onChange={(e) => setFollowUpQuestion(e.target.value)}
                      placeholder="Ask position size, invalidation, or TP spacing..."
                      className="flex-1 min-h-[40px] rounded-lg border border-slate-700 bg-[#0a0e1a] px-3 py-1.5 text-xs text-white"
                    />
                    <button
                      type="button"
                      data-testid="scanner-followup-btn"
                      disabled={
                        busyAction !== null ||
                        !followUpQuestion.trim() ||
                        report.followUpsUsed >= report.maxFollowUps
                      }
                      onClick={handleAskFollowUp}
                      className="min-h-[40px] rounded-lg bg-[#3b82f6] px-3.5 text-xs font-semibold text-white hover:bg-blue-500 disabled:opacity-45 cursor-pointer"
                    >
                      Ask
                    </button>
                  </div>
                  {followUpReplies.length > 0 && (
                    <div className="space-y-2 text-xs">
                      {followUpReplies.map((item, i) => (
                        <div
                          key={i}
                          className="rounded-lg border border-slate-800 bg-[#0a0e1a] p-2.5 space-y-1"
                        >
                          <div className="font-semibold text-blue-300">Q: {item.q}</div>
                          <div className="text-slate-300">{item.a}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* User-Initiated Share + Referral Code */}
                <div className="rounded-xl border border-slate-800 bg-[#111827] p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="font-display text-sm font-bold text-white flex items-center gap-1.5">
                      <Share2 className="h-4 w-4 text-blue-400" aria-hidden="true" />
                      <span>Share Chart / Share Result</span>
                    </h4>
                    <span className="font-mono text-[10px] text-emerald-400">No Auto-Post</span>
                  </div>
                  <p className="text-[11px] text-slate-400">
                    Generates a privacy-safe summary link with your disclosed referral code ({status?.referralCode ?? 'SF-REF'}). Your private uploaded chart image is never exposed.
                  </p>
                  <label className="flex items-start gap-2 text-xs cursor-pointer">
                    <input
                      type="checkbox"
                      data-testid="scanner-share-consent"
                      checked={shareConsent}
                      onChange={(e) => setShareConsent(e.target.checked)}
                      className="mt-0.5 h-4 w-4 accent-blue-500 shrink-0"
                    />
                    <span className="text-slate-300">
                      I consent to create a public summary preview link (private image remains excluded).
                    </span>
                  </label>
                  <button
                    type="button"
                    data-testid="scanner-create-share-btn"
                    disabled={!shareConsent || busyAction !== null}
                    onClick={handleCreateSharePreview}
                    className="min-h-[40px] rounded-lg border border-blue-500/60 bg-blue-500/15 px-3.5 py-2 text-xs font-semibold text-blue-200 hover:bg-blue-500/25 disabled:opacity-45 cursor-pointer"
                  >
                    Generate Share Preview Link
                  </button>

                  {sharePreview && (
                    <div
                      data-testid="scanner-share-preview-box"
                      className="rounded-lg border border-emerald-500/40 bg-emerald-950/20 p-3 space-y-2 text-[11px]"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-emerald-300 flex items-center gap-1">
                          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                          Privacy-Safe Link Ready
                        </span>
                        <button
                          type="button"
                          onClick={() => void handleCopyShare()}
                          className="inline-flex items-center gap-1 font-semibold text-blue-300 hover:text-white cursor-pointer"
                        >
                          {copiedShare ? (
                            <>
                              <Check className="h-3.5 w-3.5" aria-hidden="true" />
                              Copied
                            </>
                          ) : (
                            <>
                              <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                              Copy Link
                            </>
                          )}
                        </button>
                      </div>
                      <div className="font-mono text-slate-200 break-all">{sharePreview.shareUrl}</div>
                      <div className="text-slate-400">{sharePreview.referralDisclosure}</div>
                    </div>
                  )}
                </div>
              </div>

              <p className="text-[11px] text-slate-500 border-t border-slate-800 pt-3">
                {report.disclaimer}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
