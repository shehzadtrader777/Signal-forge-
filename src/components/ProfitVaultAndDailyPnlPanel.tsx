import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  ArrowDownToLine,
  CheckCircle2,
  Database,
  Download,
  Lock,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Unlock,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { apiFetch } from '../lib/apiClient';
import {
  saveDailyPnlRecordToFirestore,
  saveVaultLockerSnapshotToFirestore,
  subscribeDailyPnlRecords,
  type PersistedDailyPnlRecord,
} from '../lib/firebase';
import {
  USER_OVERRIDE_CONFIRMATION_PHRASES,
  type DailyPnlHistoryRecord,
  type ProfitScoopConfig,
  type ProfitThresholdMode,
  type ProfitVaultSnapshot,
  type VaultOverrideAction,
} from '../lib/profitVaultEngine';
import type { WidgetLayoutContract, WidgetMetricItem } from '../lib/designSystem';
import {
  ForgeInteractiveButton,
  ForgeMetricStrip,
  ForgeSegmentedControl,
  ForgeWidgetFrame,
} from './ui/ForgeDesignSystem';

import { ErrorBoundary } from './ErrorBoundary';

const LOCAL_STORAGE_KEY = 'signal_forge_daily_pnl_vault_v1';

const WIDGET_LAYOUT: WidgetLayoutContract = {
  widgetId: 'profit-scoop-vault-pnl',
  ariaLabel: 'High-Frequency Profit Scooping, Immutable Locker Vault & Daily PnL Tracker',
  colSpanDesktop: 12,
  elevation: 'SURFACE',
  gpuContain: true,
  showStreamRail: true,
};

const VAULT_BAR_CHART_MARGIN = { top: 8, right: 12, left: 0, bottom: 0 } as const;
const VAULT_BAR_RADIUS: [number, number, number, number] = [4, 4, 0, 0];
const VAULT_AXIS_TICK_STYLE = { fill: '#94a3b8', fontSize: 11, fontFamily: 'monospace' } as const;
const VAULT_AXIS_LINE_STYLE = { stroke: 'rgba(148,163,184,0.2)' } as const;
const VAULT_TOOLTIP_STYLE = {
  backgroundColor: '#0f172a',
  border: '1px solid rgba(56,189,248,0.35)',
  borderRadius: '8px',
  fontSize: '12px',
  fontFamily: 'monospace',
} as const;

type VaultPanelTab = 'VAULT_OVERRIDE' | 'DAILY_PNL' | 'IMMUTABLE_LEDGER';

interface LocalPersistedVaultCache {
  readonly savedAtIso: string;
  readonly snapshot: ProfitVaultSnapshot;
}

function loadCachedVaultSnapshot(): ProfitVaultSnapshot | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LocalPersistedVaultCache>;
    if (parsed && parsed.snapshot && Array.isArray(parsed.snapshot.dailyHistory)) {
      return parsed.snapshot;
    }
    return null;
  } catch {
    return null;
  }
}

function saveCachedVaultSnapshot(snapshot: ProfitVaultSnapshot): void {
  if (typeof window === 'undefined') return;
  try {
    const payload: LocalPersistedVaultCache = {
      savedAtIso: new Date().toISOString(),
      snapshot,
    };
    window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // ignore storage quota errors
  }
}

function formatUsdSigned(val: number, decimals = 2): string {
  const sign = val > 0 ? '+' : val < 0 ? '-' : '';
  return `${sign}$${Math.abs(val).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

function formatUsdPlain(val: number, decimals = 2): string {
  return `$${val.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

function formatPct4(val: number): string {
  const sign = val > 0 ? '+' : '';
  return `${sign}${val.toFixed(4)}%`;
}

function formatVaultYAxisTick(v: number): string {
  return `${v > 0 ? '+' : ''}${v.toFixed(2)}%`;
}

function formatVaultTooltip(value: unknown, name: unknown): [string, string] {
  const num = Number(value) || 0;
  if (name === 'returnPct') return [formatPct4(num), 'Daily Return'];
  return [formatUsdSigned(num, 4), String(name)];
}

function formatCsvValue(v: string | number): string {
  const str = String(v);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export const ProfitVaultAndDailyPnlPanel = memo(function ProfitVaultAndDailyPnlPanel() {
  const { appLiveEnabled, user, selectedSymbol } = useApp();
  const [vault, setVault] = useState<ProfitVaultSnapshot | null>(() => loadCachedVaultSnapshot());
  const [cloudDailyRecords, setCloudDailyRecords] = useState<readonly PersistedDailyPnlRecord[]>([]);
  const [activeTab, setActiveTab] = useState<VaultPanelTab>('VAULT_OVERRIDE');

  // Threshold form state
  const [enabledDraft, setEnabledDraft] = useState(true);
  const [modeDraft, setModeDraft] = useState<ProfitThresholdMode>('USD_FIXED');
  const [thresholdUsdDraft, setThresholdUsdDraft] = useState('250');
  const [thresholdPctDraft, setThresholdPctDraft] = useState('2.0');
  const [scoopRatioDraft, setScoopRatioDraft] = useState('100');
  const [configDirty, setConfigDirty] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);

  // Live realized gain logger state
  const [gainSymbol, setGainSymbol] = useState(selectedSymbol || 'BTCUSDT');
  const [gainUsdInput, setGainUsdInput] = useState('320.50');
  const [gainAgentInput, setGainAgentInput] = useState('PRE_PUMP_SUPPORT_DESK');
  const [recordingGain, setRecordingGain] = useState(false);

  // User-only manual override form state
  const [overrideAction, setOverrideAction] = useState<VaultOverrideAction>('RELEASE_TO_TRADING');
  const [overrideAmountInput, setOverrideAmountInput] = useState('100');
  const [confirmationPhraseInput, setConfirmationPhraseInput] = useState('');
  const [overrideReasonInput, setOverrideReasonInput] = useState('Scheduled portfolio rebalance');
  const [submittingOverride, setSubmittingOverride] = useState(false);

  const [feedback, setFeedback] = useState<{
    readonly tone: 'NOMINAL' | 'CRITICAL' | 'INFO';
    readonly text: string;
  } | null>(null);
  const [cloudSyncedAtIso, setCloudSyncedAtIso] = useState<string | null>(null);
  const [cloudSyncFailed, setCloudSyncFailed] = useState(false);

  const lastSyncedDailyHashRef = useRef<Map<string, string>>(new Map());
  const lastSyncedVaultVersionRef = useRef<number>(0);
  const syncInFlightRef = useRef<boolean>(false);
  const resyncRequestedRef = useRef<boolean>(false);
  const latestVaultRef = useRef<ProfitVaultSnapshot | null>(vault);
  latestVaultRef.current = vault;

  const verifiedUid = user && user.emailVerified ? user.uid : null;

  const vaultSyncSignature = useMemo(() => {
    if (!vault) return '';
    const historySig = vault.dailyHistory
      .slice(-14)
      .map((d) => `${d.dateKey}:${d.recordHash}`)
      .join('|');
    return `${vault.stateVersion}::${historySig}`;
  }, [vault]);

  const syncDraftsFromConfig = useCallback((cfg: ProfitScoopConfig) => {
    setEnabledDraft(cfg.enabled);
    setModeDraft(cfg.thresholdMode);
    setThresholdUsdDraft(String(cfg.profitThresholdUsd));
    setThresholdPctDraft(String(cfg.profitThresholdPct));
    setScoopRatioDraft(String(cfg.scoopExcessRatioPct));
    setConfigDirty(false);
  }, []);

  const configDirtyRef = useRef<boolean>(configDirty);
  configDirtyRef.current = configDirty;

  const fetchVaultState = useCallback(async () => {
    try {
      const res = await fetch('/api/vault/state');
      if (!res.ok) return;
      const data = (await res.json()) as {
        ok?: boolean;
        vault?: ProfitVaultSnapshot;
      };
      if (data?.ok && data.vault) {
        setVault(data.vault);
        saveCachedVaultSnapshot(data.vault);
        if (!configDirtyRef.current) {
          syncDraftsFromConfig(data.vault.config);
        }
      }
    } catch {
      // retain cached local snapshot cleanly
    }
  }, [syncDraftsFromConfig]);

  useEffect(() => {
    fetchVaultState();
  }, [fetchVaultState]);

  useEffect(() => {
    if (!appLiveEnabled) return;
    const id = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      fetchVaultState();
    }, 15_000);
    return () => window.clearInterval(id);
  }, [appLiveEnabled, fetchVaultState]);

  useEffect(() => {
    if (selectedSymbol) {
      setGainSymbol(selectedSymbol);
    }
  }, [selectedSymbol]);

  // Subscribe to verified user's cloud Daily PnL history in Firestore
  useEffect(() => {
    if (!verifiedUid) {
      setCloudDailyRecords([]);
      return;
    }
    const unsub = subscribeDailyPnlRecords(
      verifiedUid,
      (records) => {
        setCloudDailyRecords(records);
      },
      () => {
        // Firestore read error is logged by firebase.ts helper
      }
    );
    return () => unsub();
  }, [verifiedUid]);

  // Reset per-account cloud sync watermarks when signed-in user changes
  useEffect(() => {
    lastSyncedVaultVersionRef.current = 0;
    lastSyncedDailyHashRef.current.clear();
    setCloudSyncedAtIso(null);
    setCloudSyncFailed(false);
  }, [verifiedUid]);

  // Auto-persist high-precision Daily PnL records & Vault Locker state to Firestore when signed in
  // Single-flight serialized drain prevents overlapping polling passes from racing on Firestore writes.
  useEffect(() => {
    if (!verifiedUid || !vaultSyncSignature) return;

    let cancelled = false;

    const drainCloudSync = async () => {
      if (syncInFlightRef.current) {
        resyncRequestedRef.current = true;
        return;
      }
      syncInFlightRef.current = true;
      try {
        do {
          resyncRequestedRef.current = false;
          const currentVault = latestVaultRef.current;
          if (!currentVault || cancelled) break;
          let syncedAny = false;

          if (currentVault.stateVersion > lastSyncedVaultVersionRef.current) {
            await saveVaultLockerSnapshotToFirestore(verifiedUid, {
              thresholdMode: currentVault.config.thresholdMode,
              profitThresholdUsd: currentVault.config.profitThresholdUsd,
              profitThresholdPct: currentVault.config.profitThresholdPct,
              scoopExcessRatioPct: currentVault.config.scoopExcessRatioPct,
              enabled: currentVault.config.enabled,
              lockedVaultBalanceUsd: currentVault.lockedVaultBalanceUsd,
              totalScoopedLifetimeUsd: currentVault.totalScoopedLifetimeUsd,
              stateVersion: currentVault.stateVersion,
            });
            lastSyncedVaultVersionRef.current = currentVault.stateVersion;
            syncedAny = true;
          }

          const recentDays = currentVault.dailyHistory.slice(-14);
          for (const day of recentDays) {
            if (cancelled) break;
            if (lastSyncedDailyHashRef.current.get(day.dateKey) === day.recordHash) continue;
            await saveDailyPnlRecordToFirestore(verifiedUid, {
              dateKey: day.dateKey,
              startingEquityUsd: day.startingEquityUsd,
              endingEquityUsd: day.endingEquityUsd,
              realizedPnlUsd: day.realizedPnlUsd,
              returnPct: day.returnPct,
              scoopedToVaultUsd: day.scoopedToVaultUsd,
              manualReleasedUsd: day.manualReleasedUsd,
              tradeCount: day.tradeCount,
              winningTrades: day.winningTrades,
              losingTrades: day.losingTrades,
              winRatePct: day.winRatePct,
              recordHash: day.recordHash,
            });
            lastSyncedDailyHashRef.current.set(day.dateKey, day.recordHash);
            syncedAny = true;
          }
          if (syncedAny && !cancelled) {
            setCloudSyncedAtIso(new Date().toISOString());
          }
        } while (resyncRequestedRef.current && !cancelled);
        if (!cancelled) setCloudSyncFailed(false);
      } catch {
        // Do not claim successful Firestore persistence after a failed cloud write.
        if (!cancelled) {
          setCloudSyncFailed(true);
          setCloudSyncedAtIso(null);
        }
      } finally {
        syncInFlightRef.current = false;
      }
    };

    void drainCloudSync();
    return () => {
      cancelled = true;
    };
  }, [verifiedUid, vaultSyncSignature]);

  const handleSaveConfig = useCallback(async () => {
    setSavingConfig(true);
    setFeedback(null);
    try {
      const res = await apiFetch('/api/vault/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: enabledDraft,
          thresholdMode: modeDraft,
          profitThresholdUsd: Number(thresholdUsdDraft),
          profitThresholdPct: Number(thresholdPctDraft),
          scoopExcessRatioPct: Number(scoopRatioDraft),
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        vault?: ProfitVaultSnapshot;
        error?: string;
      };
      if (!res.ok || !data?.ok || !data.vault) {
        setFeedback({
          tone: 'CRITICAL',
          text: data?.error || 'Unable to update Profit Scooping threshold configuration.',
        });
        return;
      }
      setVault(data.vault);
      saveCachedVaultSnapshot(data.vault);
      syncDraftsFromConfig(data.vault.config);
      setFeedback({
        tone: 'NOMINAL',
        text: `Thresholds updated — auto-scooping ${
          data.vault.config.enabled ? 'ACTIVE' : 'PAUSED'
        } above ${formatUsdPlain(data.vault.effectiveThresholdUsd)} (${data.vault.config.scoopExcessRatioPct}% excess sweep).`,
      });
    } catch {
      setFeedback({ tone: 'CRITICAL', text: 'Network error saving vault configuration.' });
    } finally {
      setSavingConfig(false);
    }
  }, [
    enabledDraft,
    modeDraft,
    thresholdUsdDraft,
    thresholdPctDraft,
    scoopRatioDraft,
    syncDraftsFromConfig,
  ]);

  const handleRecordRealizedGain = useCallback(async () => {
    const parsedUsd = Number(gainUsdInput);
    if (!Number.isFinite(parsedUsd) || parsedUsd === 0) {
      setFeedback({
        tone: 'CRITICAL',
        text: 'Enter a valid non-zero realized PnL USD amount to settle.',
      });
      return;
    }
    setRecordingGain(true);
    setFeedback(null);
    try {
      const res = await apiFetch('/api/vault/record-gain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: gainSymbol.trim().toUpperCase() || 'BTCUSDT',
          realizedPnlUsd: parsedUsd,
          sourceAgent: gainAgentInput.trim() || 'CORE_EXECUTION_ENGINE',
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        vault?: ProfitVaultSnapshot;
        outcome?: {
          readonly scoopedNow: boolean;
          readonly scoopedAmountUsd: number;
          readonly ledgerEntry: { readonly entryId: string } | null;
        };
        error?: string;
      };
      if (!res.ok || !data?.ok || !data.vault) {
        setFeedback({
          tone: 'CRITICAL',
          text: data?.error || 'Failed to ingest realized trade PnL.',
        });
        return;
      }
      setVault(data.vault);
      saveCachedVaultSnapshot(data.vault);
      if (data.outcome?.scoopedNow) {
        setFeedback({
          tone: 'NOMINAL',
          text: `Settled ${formatUsdSigned(parsedUsd)} on ${gainSymbol.toUpperCase()} — auto-scooped ${formatUsdPlain(
            data.outcome.scoopedAmountUsd
          )} into Immutable Locker Vault (${data.outcome.ledgerEntry?.entryId ?? 'HASHED'}).`,
        });
      } else {
        setFeedback({
          tone: 'INFO',
          text: `Settled ${formatUsdSigned(parsedUsd)} on ${gainSymbol.toUpperCase()} — Daily PnL updated (${formatPct4(
            data.vault.todayPnl.returnPct
          )}). Zero-drift accounting verified.`,
        });
      }
    } catch {
      setFeedback({ tone: 'CRITICAL', text: 'Network error recording realized trade gain.' });
    } finally {
      setRecordingGain(false);
    }
  }, [gainSymbol, gainUsdInput, gainAgentInput]);

  const handleExecuteManualOverride = useCallback(async () => {
    const parsedAmount = Number(overrideAmountInput);
    if (!Number.isFinite(parsedAmount) || parsedAmount < 1) {
      setFeedback({ tone: 'CRITICAL', text: 'Override amount must be at least $1.00 USD.' });
      return;
    }
    setSubmittingOverride(true);
    setFeedback(null);
    try {
      const res = await apiFetch('/api/vault/manual-override', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actorType: 'AUTHENTICATED_USER',
          action: overrideAction,
          amountUsd: parsedAmount,
          confirmationPhrase: confirmationPhraseInput.trim(),
          reason: overrideReasonInput.trim() || 'User-authorized manual override',
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        code?: string;
        message?: string;
        error?: string;
        vault?: ProfitVaultSnapshot;
      };
      if (!res.ok || !data?.ok || !data.vault) {
        setFeedback({
          tone: 'CRITICAL',
          text: data?.error || data?.message || 'Manual override rejected by Locker Vault gate.',
        });
        return;
      }
      setVault(data.vault);
      saveCachedVaultSnapshot(data.vault);
      setConfirmationPhraseInput('');
      setFeedback({
        tone: 'NOMINAL',
        text: data.message || `Manual override executed for ${formatUsdPlain(parsedAmount)}.`,
      });
    } catch {
      setFeedback({ tone: 'CRITICAL', text: 'Network error invoking manual override protocol.' });
    } finally {
      setSubmittingOverride(false);
    }
  }, [overrideAction, overrideAmountInput, confirmationPhraseInput, overrideReasonInput]);

  const mergedDailyHistory: readonly DailyPnlHistoryRecord[] = useMemo(() => {
    const map = new Map<string, DailyPnlHistoryRecord>();
    for (const cloud of cloudDailyRecords) {
      map.set(cloud.dateKey, {
        dateKey: cloud.dateKey,
        startingEquityUsd: cloud.startingEquityUsd,
        endingEquityUsd: cloud.endingEquityUsd,
        realizedPnlUsd: cloud.realizedPnlUsd,
        returnPct: cloud.returnPct,
        scoopedToVaultUsd: cloud.scoopedToVaultUsd,
        manualReleasedUsd: cloud.manualReleasedUsd,
        tradeCount: cloud.tradeCount,
        winningTrades: cloud.winningTrades,
        losingTrades: cloud.losingTrades,
        winRatePct: cloud.winRatePct,
        largestWinUsd: 0,
        largestLossUsd: 0,
        recordHash: cloud.recordHash,
        updatedAtIso: new Date().toISOString(),
      });
    }
    if (vault) {
      for (const local of vault.dailyHistory) {
        map.set(local.dateKey, local);
      }
    }
    return Array.from(map.values()).sort((a, b) => a.dateKey.localeCompare(b.dateKey));
  }, [vault, cloudDailyRecords]);

  const handleExportDailyPnlCsv = useCallback(() => {
    if (mergedDailyHistory.length === 0) return;
    const headers = [
      'date_utc',
      'starting_equity_usd',
      'ending_equity_usd',
      'realized_pnl_usd',
      'return_pct',
      'scooped_to_vault_usd',
      'manual_released_usd',
      'trade_count',
      'winning_trades',
      'losing_trades',
      'win_rate_pct',
      'record_hash',
    ];
    const rows = mergedDailyHistory.map((d) =>
      [
        d.dateKey,
        d.startingEquityUsd.toFixed(4),
        d.endingEquityUsd.toFixed(4),
        d.realizedPnlUsd.toFixed(4),
        d.returnPct.toFixed(4),
        d.scoopedToVaultUsd.toFixed(4),
        d.manualReleasedUsd.toFixed(4),
        d.tradeCount,
        d.winningTrades,
        d.losingTrades,
        d.winRatePct.toFixed(2),
        d.recordHash,
      ]
        .map(formatCsvValue)
        .join(',')
    );
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `signal-forge-daily-pnl-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [mergedDailyHistory]);

  const requiredPhrase = USER_OVERRIDE_CONFIRMATION_PHRASES[overrideAction];

  const metrics: readonly WidgetMetricItem[] = useMemo(() => {
    if (!vault) {
      return [
        { id: 'locked-vault', label: 'Immutable Locker Vault', value: '$0.00', subtext: 'Initializing...', tone: 'INFO' },
        { id: 'active-trading', label: 'Active Trading Capital', value: '$25,000.00', subtext: 'Isolated from vault', tone: 'NOMINAL' },
        { id: 'today-pnl', label: 'Today Realized Return', value: '+0.0000%', subtext: '$0.0000 realized', tone: 'INFO' },
        { id: 'audit-drift', label: 'Accounting Drift', value: '$0.0000', subtext: 'Hash chain pending', tone: 'NOMINAL' },
      ];
    }
    return [
      {
        id: 'locked-vault',
        label: 'Immutable Locker Vault',
        value: formatUsdPlain(vault.lockedVaultBalanceUsd),
        subtext: `Scooped ${formatUsdPlain(vault.totalScoopedLifetimeUsd)} · User-Only Lock`,
        tone: 'NOMINAL',
      },
      {
        id: 'active-trading',
        label: 'Active Trading Capital',
        value: formatUsdPlain(vault.activeTradingBalanceUsd),
        subtext: `External reserve ${formatUsdPlain(vault.netExternalRebalancedUsd)} · Drift-Isolated`,
        tone: 'INFO',
      },
      {
        id: 'today-pnl',
        label: `Daily PnL (${vault.todayPnl.dateKey})`,
        value: formatPct4(vault.todayPnl.returnPct),
        subtext: `${formatUsdSigned(vault.todayPnl.realizedPnlUsd, 4)} · ${vault.todayPnl.tradeCount} trades (${vault.todayPnl.winRatePct.toFixed(1)}% WR)`,
        tone: vault.todayPnl.realizedPnlUsd >= 0 ? 'NOMINAL' : 'CRITICAL',
      },
      {
        id: 'audit-drift',
        label: 'Zero-Drift Invariant',
        value: `$${vault.integrity.reconciliationDriftUsd.toFixed(4)}`,
        subtext:
          vault.integrity.hashChainValid && vault.integrity.accountingInvariantValid
            ? `Hash Chain VERIFIED · v${vault.stateVersion}`
            : 'INTEGRITY ALERT',
        tone:
          vault.integrity.hashChainValid && vault.integrity.accountingInvariantValid
            ? 'NOMINAL'
            : 'CRITICAL',
      },
    ];
  }, [vault]);

  const tabOptions = useMemo(
    () => [
      { value: 'VAULT_OVERRIDE' as const, label: 'Vault & Override' },
      { value: 'DAILY_PNL' as const, label: `Daily PnL (${mergedDailyHistory.length}d)` },
      { value: 'IMMUTABLE_LEDGER' as const, label: `Immutable Ledger (${vault?.vaultLedger.length ?? 0})` },
    ],
    [mergedDailyHistory.length, vault?.vaultLedger.length]
  );

  const chartData = useMemo(
    () =>
      mergedDailyHistory.slice(-14).map((d) => ({
        date: d.dateKey.slice(5),
        fullDate: d.dateKey,
        returnPct: d.returnPct,
        realizedPnlUsd: d.realizedPnlUsd,
        scoopedToVaultUsd: d.scoopedToVaultUsd,
      })),
    [mergedDailyHistory]
  );

  const reverseLedger = useMemo(
    () => (vault ? [...vault.vaultLedger].reverse() : []),
    [vault]
  );

  return (
    <ForgeWidgetFrame
      layout={WIDGET_LAYOUT}
      title="High-Frequency Profit Scooping, Immutable Locker Vault & Daily PnL"
      icon={<Lock className="h-4 w-4 text-emerald-400" />}
      metadata={[
        {
          id: 'scoop-status',
          label: 'Auto-Scoop',
          value: vault?.config.enabled ? 'ACTIVE' : 'PAUSED',
          tone: vault?.config.enabled ? 'NOMINAL' : 'WARNING',
        },
        {
          id: 'cumulative-ret',
          label: 'Cumulative Return',
          value: vault ? formatPct4(vault.cumulativeReturnPct) : '+0.0000%',
          tone: (vault?.cumulativeReturnPct ?? 0) >= 0 ? 'NOMINAL' : 'CRITICAL',
        },
        {
          id: 'persistence-mode',
          label: 'Persistence',
          value: verifiedUid
            ? cloudSyncFailed
              ? 'Local Only · Cloud Sync Failed'
              : cloudSyncedAtIso
                ? 'Local + Firestore Synced'
                : 'Local + Firestore Pending'
            : 'Local Cache Active',
          tone: cloudSyncFailed ? 'WARNING' : 'INFO',
        },
      ]}
      actions={
        <ForgeSegmentedControl<VaultPanelTab>
          ariaLabel="Profit Vault Workspace View"
          layoutGroupId="profit-vault-tabs"
          options={tabOptions}
          value={activeTab}
          onChange={setActiveTab}
        />
      }
    >
      <div className="space-y-5">
        <p className="text-xs text-slate-400">
          Continuously sweeps realized profits exceeding your threshold into an agent-isolated Locker Vault with User-Only Manual Override and 4-decimal Daily PnL persistence.
        </p>
        <ForgeMetricStrip items={metrics} />

        {feedback && (
          <div
            role="status"
            className={`flex items-center gap-2.5 rounded-lg border px-3.5 py-2.5 text-xs ${
              feedback.tone === 'NOMINAL'
                ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-200'
                : feedback.tone === 'CRITICAL'
                ? 'border-rose-500/40 bg-rose-500/10 text-rose-200'
                : 'border-cyan-500/35 bg-cyan-500/10 text-cyan-200'
            }`}
          >
            {feedback.tone === 'CRITICAL' ? (
              <ShieldAlert className="h-4 w-4 shrink-0 text-rose-400" />
            ) : (
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
            )}
            <span className="font-mono leading-relaxed">{feedback.text}</span>
          </div>
        )}

        {activeTab === 'VAULT_OVERRIDE' && (
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            {/* Left Column: Threshold Configuration + Live Auto-Scoop Monitor */}
            <div className="space-y-4 rounded-xl border border-slate-800/80 bg-slate-950/65 p-4">
              <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
                <div className="flex items-center gap-2">
                  <SlidersHorizontal className="h-4 w-4 text-cyan-400" />
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-100">
                    Profit Scooping Threshold Engine
                  </h4>
                </div>
                <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-300">
                  <input
                    type="checkbox"
                    checked={enabledDraft}
                    onChange={(e) => {
                      setEnabledDraft(e.target.checked);
                      setConfigDirty(true);
                    }}
                    className="h-3.5 w-3.5 accent-emerald-500"
                  />
                  <span className="font-mono text-[11px]">
                    {enabledDraft ? 'SCOOP ENABLED' : 'SCOOP PAUSED'}
                  </span>
                </label>
              </div>

              {/* Live Threshold Progress Bar */}
              <div className="space-y-1.5 rounded-lg border border-slate-800/70 bg-slate-900/50 p-3">
                <div className="flex items-center justify-between text-[11px] font-mono">
                  <span className="text-slate-400">Accumulated Realized Gain Since Last Scoop</span>
                  <span className="font-semibold tabular-nums text-emerald-300">
                    {formatUsdPlain(vault?.accumulatedRealizedSinceLastScoopUsd ?? 0)} /{' '}
                    {formatUsdPlain(vault?.effectiveThresholdUsd ?? 250)}
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-emerald-400 transition-transform duration-200 origin-left"
                    style={{
                      transform: `scaleX(${Math.min(
                        1,
                        Math.max(0.02, (vault?.progressToThresholdPct ?? 0) / 100)
                      )})`,
                    }}
                  />
                </div>
                <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono">
                  <span>Progress: {(vault?.progressToThresholdPct ?? 0).toFixed(1)}%</span>
                  <span>Auto-Lock: IMMUTABLE (Agents Blocked)</span>
                </div>
              </div>

              {/* Threshold Inputs */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <label className="space-y-1">
                  <span className="block text-[11px] font-medium text-slate-400">Threshold Mode</span>
                  <select
                    aria-label="Profit Threshold Mode"
                    value={modeDraft}
                    onChange={(e) => {
                      setModeDraft(e.target.value as ProfitThresholdMode);
                      setConfigDirty(true);
                    }}
                    className="w-full rounded-lg border border-slate-700/80 bg-slate-900 px-2.5 py-2 text-xs text-slate-100 focus:border-cyan-500 focus:outline-none"
                  >
                    <option value="USD_FIXED">Fixed USD ($)</option>
                    <option value="PERCENT_OF_EQUITY">% of Active Equity</option>
                  </select>
                </label>

                {modeDraft === 'USD_FIXED' ? (
                  <label className="space-y-1">
                    <span className="block text-[11px] font-medium text-slate-400">
                      Threshold Limit ($)
                    </span>
                    <input
                      aria-label="Profit Threshold USD"
                      type="number"
                      min={10}
                      max={100000}
                      step={10}
                      value={thresholdUsdDraft}
                      onChange={(e) => {
                        setThresholdUsdDraft(e.target.value);
                        setConfigDirty(true);
                      }}
                      className="w-full rounded-lg border border-slate-700/80 bg-slate-900 px-2.5 py-2 font-mono text-xs tabular-nums text-slate-100 focus:border-cyan-500 focus:outline-none"
                    />
                  </label>
                ) : (
                  <label className="space-y-1">
                    <span className="block text-[11px] font-medium text-slate-400">
                      Threshold Limit (% Eq)
                    </span>
                    <input
                      aria-label="Profit Threshold Percent"
                      type="number"
                      min={0.25}
                      max={50}
                      step={0.25}
                      value={thresholdPctDraft}
                      onChange={(e) => {
                        setThresholdPctDraft(e.target.value);
                        setConfigDirty(true);
                      }}
                      className="w-full rounded-lg border border-slate-700/80 bg-slate-900 px-2.5 py-2 font-mono text-xs tabular-nums text-slate-100 focus:border-cyan-500 focus:outline-none"
                    />
                  </label>
                )}

                <label className="space-y-1">
                  <span className="block text-[11px] font-medium text-slate-400">
                    Excess Sweep (%)
                  </span>
                  <input
                    aria-label="Excess Sweep Ratio Percent"
                    type="number"
                    min={25}
                    max={100}
                    step={5}
                    value={scoopRatioDraft}
                    onChange={(e) => {
                      setScoopRatioDraft(e.target.value);
                      setConfigDirty(true);
                    }}
                    className="w-full rounded-lg border border-slate-700/80 bg-slate-900 px-2.5 py-2 font-mono text-xs tabular-nums text-slate-100 focus:border-cyan-500 focus:outline-none"
                  />
                </label>
              </div>

              <div className="flex items-center justify-end">
                <ForgeInteractiveButton
                  intent="primary"
                  label={savingConfig ? 'Saving...' : 'Save Scoop Thresholds'}
                  disabled={savingConfig}
                  onClick={handleSaveConfig}
                  icon={<ShieldCheck className="h-3.5 w-3.5" />}
                />
              </div>

              {/* Realized Trade Settlement Hook Tester */}
              <div className="border-t border-slate-800/80 pt-3.5 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-300">
                    Ingest Realized Trade Settlement
                  </span>
                  <span className="font-mono text-[10px] text-slate-400">
                    Auto-sweeps excess above {formatUsdPlain(vault?.effectiveThresholdUsd ?? 250)}
                  </span>
                </div>
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                  <input
                    aria-label="Settled Trade Symbol"
                    type="text"
                    value={gainSymbol}
                    onChange={(e) => setGainSymbol(e.target.value.toUpperCase())}
                    placeholder="BTCUSDT"
                    className="rounded-lg border border-slate-700/80 bg-slate-900 px-2.5 py-2 font-mono text-xs text-slate-100 focus:border-cyan-500 focus:outline-none"
                  />
                  <input
                    aria-label="Realized PnL USD"
                    type="number"
                    step="0.01"
                    value={gainUsdInput}
                    onChange={(e) => setGainUsdInput(e.target.value)}
                    placeholder="320.50"
                    className="rounded-lg border border-slate-700/80 bg-slate-900 px-2.5 py-2 font-mono text-xs tabular-nums text-slate-100 focus:border-cyan-500 focus:outline-none"
                  />
                  <input
                    aria-label="Source Execution Agent"
                    type="text"
                    value={gainAgentInput}
                    onChange={(e) => setGainAgentInput(e.target.value)}
                    placeholder="PRE_PUMP_SUPPORT_DESK"
                    className="rounded-lg border border-slate-700/80 bg-slate-900 px-2.5 py-2 font-mono text-xs text-slate-100 focus:border-cyan-500 focus:outline-none"
                  />
                </div>
                <div className="flex items-center justify-end">
                  <ForgeInteractiveButton
                    intent="secondary"
                    label={recordingGain ? 'Settling...' : 'Record Realized Gain & Evaluate Scoop'}
                    disabled={recordingGain}
                    onClick={handleRecordRealizedGain}
                    icon={<ArrowDownToLine className="h-3.5 w-3.5" />}
                  />
                </div>
              </div>
            </div>

            {/* Right Column: Strict User-Only Manual Override Protocol */}
            <div className="space-y-4 rounded-xl border border-amber-500/25 bg-slate-950/65 p-4">
              <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
                <div className="flex items-center gap-2">
                  <Unlock className="h-4 w-4 text-amber-400" />
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-100">
                    User-Only Manual Override Protocol
                  </h4>
                </div>
                <span className="font-mono text-[11px] text-amber-300">
                  Locked: {formatUsdPlain(vault?.lockedVaultBalanceUsd ?? 0)}
                </span>
              </div>

              <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2.5 text-[11px] leading-relaxed text-amber-200/90">
                Autonomous agents and execution bots are cryptographically blocked from releasing or
                rebalancing Locker Vault funds (<code className="font-mono">AGENT_OVERRIDE_FORBIDDEN</code>).
                Only the authenticated human operator with explicit phrase confirmation may move locked capital.
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="space-y-1">
                  <span className="block text-[11px] font-medium text-slate-400">Override Action</span>
                  <select
                    aria-label="Manual Override Action"
                    value={overrideAction}
                    onChange={(e) => {
                      setOverrideAction(e.target.value as VaultOverrideAction);
                      setConfirmationPhraseInput('');
                    }}
                    className="w-full rounded-lg border border-slate-700/80 bg-slate-900 px-2.5 py-2 text-xs text-slate-100 focus:border-amber-500 focus:outline-none"
                  >
                    <option value="RELEASE_TO_TRADING">Release to Active Trading</option>
                    <option value="REBALANCE_EXTERNAL">Rebalance to External Reserve</option>
                  </select>
                </label>

                <label className="space-y-1">
                  <span className="block text-[11px] font-medium text-slate-400">
                    Amount to Move (USD)
                  </span>
                  <input
                    aria-label="Manual Override Amount USD"
                    type="number"
                    min={1}
                    step={1}
                    value={overrideAmountInput}
                    onChange={(e) => setOverrideAmountInput(e.target.value)}
                    className="w-full rounded-lg border border-slate-700/80 bg-slate-900 px-2.5 py-2 font-mono text-xs tabular-nums text-slate-100 focus:border-amber-500 focus:outline-none"
                  />
                </label>
              </div>

              {/* Quick Allocation Fill Controls */}
              <div className="flex flex-wrap items-center gap-2 text-[11px]">
                <span className="text-slate-400">Quick fill:</span>
                {([0.25, 0.5, 1] as const).map((ratio) => {
                  const locked = vault?.lockedVaultBalanceUsd ?? 0;
                  const computed = Math.max(0, Math.floor(locked * ratio * 100) / 100);
                  return (
                    <button
                      key={ratio}
                      type="button"
                      disabled={computed < 1}
                      onClick={() => setOverrideAmountInput(computed.toFixed(2))}
                      className="rounded border border-slate-700/80 bg-slate-900 px-2 py-1 font-mono text-[11px] text-slate-300 transition-colors hover:border-amber-400/50 hover:text-amber-200 disabled:opacity-40"
                    >
                      {Math.round(ratio * 100)}% ({formatUsdPlain(computed)})
                    </button>
                  );
                })}
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="space-y-1">
                  <span className="block text-[11px] font-medium text-slate-400">
                    Type <code className="font-mono text-amber-300">{requiredPhrase}</code> to Confirm
                  </span>
                  <input
                    aria-label="Manual Override Confirmation Phrase"
                    type="text"
                    value={confirmationPhraseInput}
                    onChange={(e) => setConfirmationPhraseInput(e.target.value)}
                    placeholder={requiredPhrase}
                    className="w-full rounded-lg border border-slate-700/80 bg-slate-900 px-2.5 py-2 font-mono text-xs uppercase text-slate-100 focus:border-amber-500 focus:outline-none"
                  />
                </label>

                <label className="space-y-1">
                  <span className="block text-[11px] font-medium text-slate-400">
                    Audit Reason (Logged Immutably)
                  </span>
                  <input
                    aria-label="Manual Override Reason"
                    type="text"
                    value={overrideReasonInput}
                    onChange={(e) => setOverrideReasonInput(e.target.value)}
                    placeholder="Rebalance treasury reserve"
                    className="w-full rounded-lg border border-slate-700/80 bg-slate-900 px-2.5 py-2 text-xs text-slate-100 focus:border-amber-500 focus:outline-none"
                  />
                </label>
              </div>

              <div className="flex items-center justify-between pt-1">
                <span className="font-mono text-[11px] text-slate-400">
                  Operator: {user?.email || 'Local Verified Session'}
                </span>
                <ForgeInteractiveButton
                  intent="danger"
                  label={
                    submittingOverride
                      ? 'Executing...'
                      : overrideAction === 'RELEASE_TO_TRADING'
                      ? 'Release to Trading'
                      : 'Rebalance External'
                  }
                  disabled={
                    submittingOverride ||
                    confirmationPhraseInput.trim().toUpperCase() !== requiredPhrase ||
                    (vault?.lockedVaultBalanceUsd ?? 0) < 1
                  }
                  onClick={handleExecuteManualOverride}
                  icon={<Unlock className="h-3.5 w-3.5" />}
                />
              </div>
            </div>
          </div>
        )}

        {activeTab === 'DAILY_PNL' && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-xs text-slate-300">
                <Database className="h-4 w-4 text-cyan-400" />
                <span>
                  High-Precision 4-Decimal Daily Return History ({mergedDailyHistory.length} UTC sessions persisted)
                </span>
              </div>
              <ForgeInteractiveButton
                intent="secondary"
                label="Export CSV"
                onClick={handleExportDailyPnlCsv}
                disabled={mergedDailyHistory.length === 0}
                icon={<Download className="h-3.5 w-3.5" />}
              />
            </div>

            {/* Daily Return % Bar Chart */}
            <ErrorBoundary title="Daily PnL Chart Recovery">
              <div className="h-56 w-full min-w-0 rounded-xl border border-slate-800/80 bg-slate-950/65 p-3">
                <ResponsiveContainer width="100%" height={200} minWidth={0} debounce={50}>
                  <BarChart data={chartData} margin={VAULT_BAR_CHART_MARGIN}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.12)" />
                    <XAxis
                      dataKey="date"
                      tick={VAULT_AXIS_TICK_STYLE}
                      axisLine={VAULT_AXIS_LINE_STYLE}
                      tickLine={false}
                    />
                    <YAxis
                      tickFormatter={formatVaultYAxisTick}
                      tick={VAULT_AXIS_TICK_STYLE}
                      axisLine={VAULT_AXIS_LINE_STYLE}
                      tickLine={false}
                      width={62}
                    />
                    <ReferenceLine y={0} stroke="rgba(148,163,184,0.45)" />
                    <Tooltip
                      contentStyle={VAULT_TOOLTIP_STYLE}
                      formatter={formatVaultTooltip}
                    />
                    <Bar dataKey="returnPct" radius={VAULT_BAR_RADIUS} isAnimationActive={false}>
                      {chartData.map((entry) => (
                        <Cell
                          key={entry.fullDate}
                          fill={entry.returnPct >= 0 ? '#10b981' : '#f43f5e'}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </ErrorBoundary>

            {/* High-Precision Daily PnL Table */}
            <div className="overflow-x-auto rounded-xl border border-slate-800/80 bg-slate-950/65">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-800 text-[11px] uppercase tracking-wider text-slate-400">
                  <tr>
                    <th className="px-3.5 py-2.5">Date (UTC)</th>
                    <th className="px-3.5 py-2.5 text-right">Start Equity</th>
                    <th className="px-3.5 py-2.5 text-right">End Equity</th>
                    <th className="px-3.5 py-2.5 text-right">Realized PnL</th>
                    <th className="px-3.5 py-2.5 text-right">Daily Return %</th>
                    <th className="px-3.5 py-2.5 text-right">Scooped to Vault</th>
                    <th className="px-3.5 py-2.5 text-right">Trades / WR</th>
                    <th className="px-3.5 py-2.5 text-right">Record Hash</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-mono tabular-nums">
                  {[...mergedDailyHistory].reverse().map((day) => (
                    <tr key={day.dateKey} className="hover:bg-slate-900/50">
                      <td className="px-3.5 py-2.5 text-slate-200">{day.dateKey}</td>
                      <td className="px-3.5 py-2.5 text-right text-slate-400">
                        {formatUsdPlain(day.startingEquityUsd)}
                      </td>
                      <td className="px-3.5 py-2.5 text-right text-slate-200">
                        {formatUsdPlain(day.endingEquityUsd)}
                      </td>
                      <td
                        className={`px-3.5 py-2.5 text-right font-semibold ${
                          day.realizedPnlUsd >= 0 ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        {formatUsdSigned(day.realizedPnlUsd, 4)}
                      </td>
                      <td
                        className={`px-3.5 py-2.5 text-right font-semibold ${
                          day.returnPct >= 0 ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        {formatPct4(day.returnPct)}
                      </td>
                      <td className="px-3.5 py-2.5 text-right text-cyan-300">
                        {formatUsdPlain(day.scoopedToVaultUsd)}
                      </td>
                      <td className="px-3.5 py-2.5 text-right text-slate-300">
                        {day.tradeCount} ({day.winRatePct.toFixed(1)}%)
                      </td>
                      <td className="px-3.5 py-2.5 text-right text-[11px] text-slate-500">
                        0x{day.recordHash}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'IMMUTABLE_LEDGER' && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800/80 bg-slate-950/70 px-3.5 py-2.5 font-mono text-[11px] text-slate-300">
              <span>
                Hash Chain:{' '}
                <strong
                  className={
                    vault?.integrity.hashChainValid ? 'text-emerald-400' : 'text-rose-400'
                  }
                >
                  {vault?.integrity.hashChainValid ? 'VERIFIED (FNV-1a Linked)' : 'BROKEN'}
                </strong>
              </span>
              <span>
                Verified Entries: <strong>{vault?.integrity.verifiedEntriesCount ?? 0}</strong>
              </span>
              <span>
                Expected Capital:{' '}
                <strong>{formatUsdPlain(vault?.integrity.expectedTotalCapitalUsd ?? 25000)}</strong>
              </span>
              <span>
                Actual Capital:{' '}
                <strong>{formatUsdPlain(vault?.integrity.actualTotalCapitalUsd ?? 25000)}</strong>
              </span>
              <span>
                Drift:{' '}
                <strong className="text-emerald-400">
                  ${(vault?.integrity.reconciliationDriftUsd ?? 0).toFixed(4)}
                </strong>
              </span>
            </div>

            <div className="overflow-x-auto rounded-xl border border-slate-800/80 bg-slate-950/65">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-800 text-[11px] uppercase tracking-wider text-slate-400">
                  <tr>
                    <th className="px-3 py-2.5">Seq</th>
                    <th className="px-3 py-2.5">UTC Time</th>
                    <th className="px-3 py-2.5">Event</th>
                    <th className="px-3 py-2.5">Actor</th>
                    <th className="px-3 py-2.5 text-right">Amount</th>
                    <th className="px-3 py-2.5 text-right">Locked After</th>
                    <th className="px-3 py-2.5">Audit Note</th>
                    <th className="px-3 py-2.5 text-right">Entry Hash</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-mono tabular-nums">
                  {reverseLedger.map((entry) => (
                    <tr key={entry.entryId} className="hover:bg-slate-900/50">
                      <td className="px-3 py-2 text-slate-400">#{entry.sequence}</td>
                      <td className="px-3 py-2 text-slate-300">
                        {entry.timestampIso.replace('T', ' ').slice(0, 19)}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={
                            entry.kind === 'AUTO_SCOOP_LOCK'
                              ? 'text-emerald-400'
                              : entry.kind === 'THRESHOLD_CONFIG_UPDATE'
                              ? 'text-cyan-400'
                              : 'text-amber-300'
                          }
                        >
                          {entry.kind}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-slate-300">{entry.actorLabel}</td>
                      <td className="px-3 py-2 text-right font-semibold text-slate-100">
                        {entry.amountUsd > 0 ? formatUsdPlain(entry.amountUsd) : '—'}
                      </td>
                      <td className="px-3 py-2 text-right text-emerald-300">
                        {formatUsdPlain(entry.resultingLockedVaultUsd)}
                      </td>
                      <td className="px-3 py-2 font-sans text-[11px] text-slate-400 max-w-xs truncate">
                        {entry.note}
                      </td>
                      <td className="px-3 py-2 text-right text-[11px] text-slate-500">
                        0x{entry.entryHash}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </ForgeWidgetFrame>
  );
});
