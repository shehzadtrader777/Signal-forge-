import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Check,
  Code2,
  Cpu,
  FileCode2,
  Mic,
  MicOff,
  Play,
  RotateCcw,
  ShieldCheck,
  Terminal,
  X,
} from 'lucide-react';
import { AGENTIC_CLI_RUNTIME_CONFIG } from '../config/agenticCliRuntimeConfig';
import type {
  AgenticCliLogEntry,
  AgenticCliProposal,
  GatewayModelConnector,
  UiModificationAction,
} from '../lib/agenticCliEngine';
import type { WidgetLayoutContract, WidgetMetadataSegment, WidgetMetricItem } from '../lib/designSystem';
import { useTradingArchitectureStore } from '../store/useTradingArchitectureStore';
import { useWorkspaceStore } from '../store/useWorkspaceStore';
import {
  ForgeInteractiveButton,
  ForgeMetricStrip,
  ForgeSegmentedControl,
  ForgeWidgetFrame,
  type SegmentedOption,
} from './ui/ForgeDesignSystem';

interface GatewaySnapshotResponse {
  readonly ok: boolean;
  readonly error?: string;
  readonly proposal?: AgenticCliProposal;
  readonly snapshot?: {
    readonly loopEnabled: boolean;
    readonly activeConnectorId: string;
    readonly connectors: readonly GatewayModelConnector[];
    readonly proposals: readonly AgenticCliProposal[];
    readonly logs: readonly AgenticCliLogEntry[];
    readonly workspaceEditableRoots: readonly string[];
  };
}

interface FilePreviewResponse {
  readonly ok: boolean;
  readonly relativePath: string;
  readonly content?: string;
  readonly sha256?: string;
  readonly error?: string;
}

interface BrowserSpeechRecognitionAlternative {
  readonly transcript: string;
}

interface BrowserSpeechRecognitionResult {
  readonly 0?: BrowserSpeechRecognitionAlternative;
}

interface BrowserSpeechRecognitionEvent {
  readonly results: ArrayLike<BrowserSpeechRecognitionResult>;
}

interface BrowserSpeechRecognitionInstance {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: BrowserSpeechRecognitionEvent) => void) | null;
  onerror: ((event: { readonly error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

type SpeechRecognitionCtor = new () => BrowserSpeechRecognitionInstance;

type CliPanelTab = 'ORCHESTRATOR' | 'GATEWAY' | 'EDITOR_AUDIT';

const WIDGET_LAYOUT: WidgetLayoutContract = {
  widgetId: 'agentic-cli-orchestrator',
  ariaLabel: 'Agentic CLI Loop, Unified AI Model Gateway & Confirmed Local Script Editor',
  colSpanDesktop: 12,
  elevation: 'SURFACE',
  gpuContain: true,
  showStreamRail: true,
};

const TAB_OPTIONS: readonly SegmentedOption<CliPanelTab>[] = [
  {
    value: 'ORCHESTRATOR',
    label: 'CLI & Voice Orchestrator',
    testId: 'agentic-cli-tab-orchestrator',
  },
  {
    value: 'GATEWAY',
    label: 'Unified API Gateway',
    testId: 'agentic-cli-tab-gateway',
  },
  {
    value: 'EDITOR_AUDIT',
    label: 'Local Script Editor & Audit',
    testId: 'agentic-cli-tab-editor',
  },
];

const QUICK_COMMAND_PRESETS: readonly { readonly id: string; readonly label: string; readonly command: string }[] = [
  {
    id: 'preset-theme-vwap',
    label: 'Terminal Theme + VWAP',
    command: 'Switch design theme to Terminal and enable VWAP overlay',
  },
  {
    id: 'preset-script-tagline',
    label: 'Patch Config Tagline',
    command: 'Update config tagline to Quantum Command Desk',
  },
  {
    id: 'preset-display-supervised',
    label: 'Display 2 + Supervised Mode',
    command: 'Switch to Display 2 and set supervised manual override',
  },
];

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const win = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return win.SpeechRecognition ?? win.webkitSpeechRecognition ?? null;
}

export const AgenticCliOrchestratorPanel = memo(function AgenticCliOrchestratorPanel() {
  const navigate = useNavigate();
  const updateCyberSettings = useWorkspaceStore((s) => s.updateCyberSettings);
  const setActiveMonitor = useWorkspaceStore((s) => s.setActiveMonitor);
  const setPanelVisibility = useWorkspaceStore((s) => s.setPanelVisibility);
  const updateIndicatorSuite = useTradingArchitectureStore((s) => s.updateIndicatorSuite);
  const setExecutionMode = useTradingArchitectureStore((s) => s.setExecutionMode);

  const [activeTab, setActiveTab] = useState<CliPanelTab>('ORCHESTRATOR');
  const [loopEnabled, setLoopEnabled] = useState<boolean>(false);
  const [activeConnectorId, setActiveConnectorId] = useState<string>('local-deterministic-v1');
  const [connectors, setConnectors] = useState<readonly GatewayModelConnector[]>([]);
  const [proposals, setProposals] = useState<readonly AgenticCliProposal[]>([]);
  const [logs, setLogs] = useState<readonly AgenticCliLogEntry[]>([]);
  const [editableRoots, setEditableRoots] = useState<readonly string[]>([
    'src/config/',
    'src/components/',
    'src/lib/',
    'src/store/',
    'src/pages/',
  ]);

  const [commandInput, setCommandInput] = useState<string>('');
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [statusNotice, setStatusNotice] = useState<{
    readonly tone: 'info' | 'success' | 'error';
    readonly text: string;
  } | null>(null);

  // Voice capture state
  const [isListening, setIsListening] = useState<boolean>(false);
  const recognitionRef = useRef<BrowserSpeechRecognitionInstance | null>(null);
  const voiceSupported = useMemo(() => getSpeechRecognitionCtor() !== null, []);

  // Local script editor preview state
  const [previewPath, setPreviewPath] = useState<string>('src/config/agenticCliRuntimeConfig.ts');
  const [fileContent, setFileContent] = useState<string>('');
  const [fileSha256, setFileSha256] = useState<string>('');
  const [fileError, setFileError] = useState<string | null>(null);
  const [manualSearchText, setManualSearchText] = useState<string>('');
  const [manualReplaceText, setManualReplaceText] = useState<string>('');

  const applySnapshot = useCallback((snap: GatewaySnapshotResponse['snapshot']) => {
    if (!snap) return;
    setLoopEnabled(snap.loopEnabled);
    setActiveConnectorId(snap.activeConnectorId);
    setConnectors(snap.connectors);
    setProposals(snap.proposals);
    setLogs(snap.logs);
    if (Array.isArray(snap.workspaceEditableRoots)) {
      setEditableRoots(snap.workspaceEditableRoots);
    }
  }, []);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/agentic-cli/status');
      if (!res.ok) return;
      const data = (await res.json()) as GatewaySnapshotResponse;
      if (data.ok && data.snapshot) {
        applySnapshot(data.snapshot);
      }
    } catch {
      // ignore transient network errors on initial hydration
    }
  }, [applySnapshot]);

  const fetchFilePreview = useCallback(async (targetPath: string) => {
    try {
      const res = await fetch(
        `/api/agentic-cli/file-preview?path=${encodeURIComponent(targetPath)}`
      );
      const data = (await res.json()) as FilePreviewResponse;
      if (data.ok && typeof data.content === 'string') {
        setFileContent(data.content);
        setFileSha256(data.sha256 ?? '');
        setFileError(null);
      } else {
        setFileError(data.error ?? 'Unable to load file preview.');
      }
    } catch {
      setFileError('Network error while loading file preview.');
    }
  }, []);

  useEffect(() => {
    void fetchStatus();
    void fetchFilePreview('src/config/agenticCliRuntimeConfig.ts');
  }, [fetchStatus, fetchFilePreview]);

  useEffect(() => {
    return () => {
      try {
        recognitionRef.current?.stop();
      } catch {
        // ignore stop errors on unmount
      }
    };
  }, []);

  const executeUiModificationActions = useCallback(
    (actions: readonly UiModificationAction[]) => {
      for (const act of actions) {
        switch (act.fn) {
          case 'ui.setThemeVariant':
            if (act.params.variant) {
              updateCyberSettings({ designVariant: act.params.variant });
            }
            break;
          case 'ui.setDensity':
            if (act.params.density) {
              updateCyberSettings({ density: act.params.density });
            }
            break;
          case 'ui.toggleNeonGrid':
            if (typeof act.params.enabled === 'boolean') {
              updateCyberSettings({ neonGridOverlay: act.params.enabled });
            }
            break;
          case 'ui.switchMonitor':
            if (act.params.monitorId) {
              setActiveMonitor(act.params.monitorId);
            }
            break;
          case 'ui.togglePanelVisibility':
            if (act.params.panelKey && typeof act.params.visible === 'boolean') {
              setPanelVisibility(act.params.panelKey, act.params.visible);
            }
            break;
          case 'ui.updateChartIndicators': {
            updateIndicatorSuite({
              ...(typeof act.params.showVwapOverlay === 'boolean'
                ? { showVwapOverlay: act.params.showVwapOverlay }
                : {}),
              ...(typeof act.params.showBollingerBands === 'boolean'
                ? { showBollingerBands: act.params.showBollingerBands }
                : {}),
              ...(typeof act.params.showEmaRibbon === 'boolean'
                ? { showEmaRibbon: act.params.showEmaRibbon }
                : {}),
              ...(typeof act.params.emaFastPeriod === 'number'
                ? { emaFastPeriod: act.params.emaFastPeriod }
                : {}),
            });
            break;
          }
          case 'ui.setExecutionMode':
            if (act.params.executionMode) {
              setExecutionMode(act.params.executionMode);
            }
            break;
          case 'ui.navigate':
            if (act.params.route) {
              navigate(act.params.route);
            }
            break;
        }
      }
    },
    [
      navigate,
      setActiveMonitor,
      setExecutionMode,
      setPanelVisibility,
      updateCyberSettings,
      updateIndicatorSuite,
    ]
  );

  const handleToggleLoop = useCallback(async () => {
    const nextEnabled = !loopEnabled;
    setBusyAction('toggle');
    setStatusNotice(null);
    try {
      const res = await fetch('/api/agentic-cli/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: nextEnabled }),
      });
      const data = (await res.json()) as GatewaySnapshotResponse;
      if (data.ok && data.snapshot) {
        applySnapshot(data.snapshot);
        setStatusNotice({
          tone: 'info',
          text: nextEnabled
            ? 'Agentic CLI Loop ARMED. Voice and CLI commands stage proposals for manual confirmation.'
            : 'Agentic CLI Loop DISARMED. Orchestration paused.',
        });
      } else {
        setStatusNotice({ tone: 'error', text: data.error ?? 'Failed to toggle Agentic CLI Loop.' });
      }
    } catch {
      setStatusNotice({ tone: 'error', text: 'Failed to reach Agentic CLI gateway.' });
    } finally {
      setBusyAction(null);
    }
  }, [applySnapshot, loopEnabled]);

  const handleSelectConnector = useCallback(
    async (connectorId: string) => {
      setBusyAction(`connector:${connectorId}`);
      setStatusNotice(null);
      try {
        const res = await fetch('/api/agentic-cli/gateway/select', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ connectorId }),
        });
        const data = (await res.json()) as GatewaySnapshotResponse;
        if (data.ok && data.snapshot) {
          applySnapshot(data.snapshot);
          setStatusNotice({
            tone: 'success',
            text: `Unified API Gateway routed to connector '${connectorId}'.`,
          });
        } else {
          setStatusNotice({ tone: 'error', text: data.error ?? 'Failed to switch gateway connector.' });
        }
      } catch {
        setStatusNotice({ tone: 'error', text: 'Network error switching gateway connector.' });
      } finally {
        setBusyAction(null);
      }
    },
    [applySnapshot]
  );

  const submitProposal = useCallback(
    async (
      rawCommand: string,
      inputSource: 'VOICE' | 'CLI_TEXT',
      explicitFilePatch?: {
        readonly targetPath: string;
        readonly searchText: string;
        readonly replaceText: string;
        readonly rationale?: string;
      }
    ) => {
      const trimmed = rawCommand.trim();
      if (!trimmed) {
        setStatusNotice({ tone: 'error', text: 'Enter a CLI or voice command before staging.' });
        return;
      }
      setBusyAction('propose');
      setStatusNotice(null);
      try {
        const res = await fetch('/api/agentic-cli/propose', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            command: trimmed,
            inputSource,
            explicitFilePatch,
          }),
        });
        const data = (await res.json()) as GatewaySnapshotResponse;
        if (data.snapshot) {
          applySnapshot(data.snapshot);
        }
        if (data.ok && data.proposal) {
          setCommandInput('');
          setActiveTab('ORCHESTRATOR');
          setStatusNotice({
            tone: 'info',
            text: `Staged ${data.proposal.id} (${data.proposal.kind}) — review changes below and click Confirm & Execute.`,
          });
        } else {
          setStatusNotice({
            tone: 'error',
            text: data.error ?? 'Orchestrator rejected command proposal.',
          });
        }
      } catch {
        setStatusNotice({ tone: 'error', text: 'Network error staging CLI proposal.' });
      } finally {
        setBusyAction(null);
      }
    },
    [applySnapshot]
  );

  const handleConfirmProposal = useCallback(
    async (proposal: AgenticCliProposal) => {
      setBusyAction(`confirm:${proposal.id}`);
      setStatusNotice(null);
      try {
        const res = await fetch('/api/agentic-cli/confirm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            proposalId: proposal.id,
            confirmationToken: proposal.confirmationToken,
            approved: true,
          }),
        });
        const data = (await res.json()) as GatewaySnapshotResponse;
        if (data.snapshot) {
          applySnapshot(data.snapshot);
        }
        if (data.ok && data.proposal) {
          if (data.proposal.uiActions.length > 0) {
            executeUiModificationActions(data.proposal.uiActions);
          }
          if (data.proposal.filePatch) {
            void fetchFilePreview(data.proposal.filePatch.targetPath);
          }
          setStatusNotice({
            tone: 'success',
            text: `Executed ${data.proposal.id}${
              data.proposal.filePatch
                ? ` — patched ${data.proposal.filePatch.targetPath}`
                : ''
            }${
              data.proposal.uiActions.length > 0
                ? ` — applied ${data.proposal.uiActions.length} UI action(s)`
                : ''
            }.`,
          });
        } else {
          setStatusNotice({
            tone: 'error',
            text: data.error ?? 'Manual confirmation failed.',
          });
        }
      } catch {
        setStatusNotice({ tone: 'error', text: 'Network error during manual confirmation.' });
      } finally {
        setBusyAction(null);
      }
    },
    [applySnapshot, executeUiModificationActions, fetchFilePreview]
  );

  const handleRejectProposal = useCallback(
    async (proposalId: string) => {
      setBusyAction(`reject:${proposalId}`);
      setStatusNotice(null);
      try {
        const res = await fetch('/api/agentic-cli/reject', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ proposalId }),
        });
        const data = (await res.json()) as GatewaySnapshotResponse;
        if (data.snapshot) {
          applySnapshot(data.snapshot);
        }
        if (data.ok) {
          setStatusNotice({
            tone: 'info',
            text: `Rejected proposal ${proposalId}. Zero changes executed.`,
          });
        } else {
          setStatusNotice({ tone: 'error', text: data.error ?? 'Failed to reject proposal.' });
        }
      } catch {
        setStatusNotice({ tone: 'error', text: 'Network error rejecting proposal.' });
      } finally {
        setBusyAction(null);
      }
    },
    [applySnapshot]
  );

  const handleRevertProposalFile = useCallback(
    async (proposal: AgenticCliProposal) => {
      setBusyAction(`revert:${proposal.id}`);
      setStatusNotice(null);
      try {
        const res = await fetch('/api/agentic-cli/revert', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ proposalId: proposal.id }),
        });
        const data = (await res.json()) as GatewaySnapshotResponse;
        if (data.snapshot) {
          applySnapshot(data.snapshot);
        }
        if (data.ok) {
          if (proposal.filePatch) {
            void fetchFilePreview(proposal.filePatch.targetPath);
          }
          setStatusNotice({
            tone: 'success',
            text: `Reverted ${proposal.filePatch?.targetPath ?? 'file'} to pre-edit snapshot.`,
          });
        } else {
          setStatusNotice({ tone: 'error', text: data.error ?? 'Failed to revert file.' });
        }
      } catch {
        setStatusNotice({ tone: 'error', text: 'Network error reverting file.' });
      } finally {
        setBusyAction(null);
      }
    },
    [applySnapshot, fetchFilePreview]
  );

  const handleToggleVoiceCapture = useCallback(() => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      setStatusNotice({
        tone: 'info',
        text: 'Browser Web Speech API is unavailable in this environment — type or pick a preset command below.',
      });
      return;
    }
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }
    if (!loopEnabled) {
      setStatusNotice({
        tone: 'error',
        text: 'Arm the Agentic CLI Loop toggle first before capturing voice commands.',
      });
      return;
    }

    const recognition = new Ctor();
    recognition.lang = 'en-US';
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript?.trim() ?? '';
      if (transcript) {
        setCommandInput(transcript);
        void submitProposal(transcript, 'VOICE');
      }
    };
    recognition.onerror = (event) => {
      setIsListening(false);
      setStatusNotice({
        tone: 'error',
        text: `Voice capture stopped (${event.error ?? 'microphone unavailable'}).`,
      });
    };
    recognition.onend = () => {
      setIsListening(false);
    };
    recognitionRef.current = recognition;
    setIsListening(true);
    recognition.start();
  }, [isListening, loopEnabled, submitProposal]);

  const activeConnector = useMemo(
    () => connectors.find((c) => c.id === activeConnectorId) ?? null,
    [activeConnectorId, connectors]
  );

  const pendingCount = useMemo(
    () => proposals.filter((p) => p.status === 'PENDING_CONFIRMATION').length,
    [proposals]
  );

  const executedCount = useMemo(
    () => proposals.filter((p) => p.status === 'EXECUTED').length,
    [proposals]
  );

  const metadata: readonly WidgetMetadataSegment[] = useMemo(
    () => [
      { id: 'brand', label: 'Agentic CLI & Unified Gateway' },
      {
        id: 'loop',
        label: 'Loop',
        value: loopEnabled ? 'ARMED' : 'STANDBY',
        tone: loopEnabled ? 'NOMINAL' : 'WARNING',
      },
      {
        id: 'connector',
        label: 'Model',
        value: activeConnector?.modelId ?? activeConnectorId,
        tone: 'INFO',
      },
      {
        id: 'gate',
        label: 'Confirmation Gate',
        value: 'MANUAL REQUIRED',
        tone: 'NOMINAL',
      },
    ],
    [activeConnector?.modelId, activeConnectorId, loopEnabled]
  );

  const metricItems: readonly WidgetMetricItem[] = useMemo(
    () => [
      {
        id: 'loop-state',
        label: 'Orchestrator Loop',
        value: loopEnabled ? 'ACTIVE · LISTENING' : 'STANDBY · GATED',
        subtext: AGENTIC_CLI_RUNTIME_CONFIG.promptPrefix,
        tone: loopEnabled ? 'NOMINAL' : 'WARNING',
      },
      {
        id: 'gateway-model',
        label: 'Unified Gateway Adapter',
        value: activeConnector
          ? activeConnector.displayName.replace(/\s*\([^)]*\)\s*$/, '')
          : activeConnectorId,
        subtext: `${connectors.filter((c) => c.status === 'READY').length}/${Math.max(
          connectors.length,
          5
        )} connectors ready`,
        tone: 'INFO',
      },
      {
        id: 'pending-queue',
        label: 'Awaiting Confirmation',
        value: String(pendingCount),
        subtext: 'Zero auto-apply without token',
        tone: pendingCount > 0 ? 'WARNING' : 'NOMINAL',
      },
      {
        id: 'executed-count',
        label: 'Confirmed Executions',
        value: String(executedCount),
        subtext: `${editableRoots.length} allowlisted src/ roots`,
        tone: 'NOMINAL',
      },
    ],
    [
      activeConnector?.displayName,
      activeConnectorId,
      connectors,
      editableRoots.length,
      executedCount,
      loopEnabled,
      pendingCount,
    ]
  );

  return (
    <ForgeWidgetFrame
      layout={WIDGET_LAYOUT}
      title={AGENTIC_CLI_RUNTIME_CONFIG.terminalTitle}
      icon={<Terminal className="h-5 w-5 text-cyan-400 shrink-0" aria-hidden="true" />}
      metadata={metadata}
      testId="agentic-cli-orchestrator-panel"
      actions={
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            role="switch"
            aria-checked={loopEnabled}
            data-testid="agentic-cli-loop-toggle"
            disabled={busyAction === 'toggle'}
            onClick={() => void handleToggleLoop()}
            className={`inline-flex items-center gap-2.5 rounded-lg border px-3.5 py-2 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap focus-visible:outline-2 focus-visible:outline-cyan-400 ${
              loopEnabled
                ? 'border-emerald-500/60 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/25'
                : 'border-slate-700 bg-[#050914] text-slate-300 hover:border-cyan-500/50 hover:text-white'
            }`}
          >
            <span
              aria-hidden="true"
              className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${
                loopEnabled ? 'bg-emerald-500' : 'bg-slate-700'
              }`}
            >
              <span
                className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
                  loopEnabled ? 'translate-x-3.5' : 'translate-x-0.5'
                }`}
              />
            </span>
            <span>Agentic CLI Loop: {loopEnabled ? 'ON' : 'OFF'}</span>
          </button>

          <ForgeSegmentedControl
            ariaLabel="Agentic CLI Orchestrator Views"
            layoutGroupId="agentic-cli-tabs"
            options={TAB_OPTIONS}
            value={activeTab}
            onChange={setActiveTab}
          />
        </div>
      }
    >
      <div className="space-y-5">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between text-xs text-slate-400">
          <span className="truncate">{AGENTIC_CLI_RUNTIME_CONFIG.bannerTagline}</span>
          <span className="font-mono text-[11px] text-emerald-400 shrink-0 flex items-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Manual Confirmation Gate Enforced · Timing-Safe Token</span>
          </span>
        </div>

        <ForgeMetricStrip items={metricItems} columns={4} />

        {statusNotice && (
          <div
            role="status"
            data-testid="agentic-cli-status-notice"
            className={`rounded-lg border px-4 py-2.5 text-xs font-medium ${
              statusNotice.tone === 'error'
                ? 'border-rose-500/40 bg-rose-500/10 text-rose-200'
                : statusNotice.tone === 'success'
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
                : 'border-cyan-500/40 bg-cyan-500/10 text-cyan-200'
            }`}
          >
            {statusNotice.text}
          </div>
        )}

        {activeTab === 'ORCHESTRATOR' && (
          <div className="space-y-5">
            {/* Voice + CLI Command Bar */}
            <div className="rounded-lg border border-slate-800 bg-[#050914] p-4 space-y-3">
              <div className="flex flex-col gap-2.5 lg:flex-row lg:items-center">
                <div className="flex flex-1 items-center gap-2 rounded-lg border border-slate-700/90 bg-[#0a1020] px-3 py-2 focus-within:border-cyan-400">
                  <span className="font-mono text-xs font-semibold text-cyan-400 shrink-0">
                    {AGENTIC_CLI_RUNTIME_CONFIG.promptPrefix}
                  </span>
                  <input
                    type="text"
                    value={commandInput}
                    onChange={(e) => setCommandInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !busyAction) {
                        void submitProposal(commandInput, 'CLI_TEXT');
                      }
                    }}
                    placeholder={
                      loopEnabled
                        ? 'Speak or type a UI / codebase command (e.g., "Switch theme to Terminal and enable VWAP")'
                        : 'Turn ON the Agentic CLI Loop toggle above to arm voice & CLI orchestration...'
                    }
                    data-testid="agentic-cli-input"
                    className="w-full bg-transparent text-xs text-white placeholder-slate-500 focus:outline-none font-mono"
                  />
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <ForgeInteractiveButton
                    label={isListening ? 'Stop Voice' : 'Voice Command'}
                    icon={
                      isListening ? (
                        <MicOff className="h-3.5 w-3.5 text-rose-300" />
                      ) : (
                        <Mic className="h-3.5 w-3.5 text-cyan-300" />
                      )
                    }
                    intent={isListening ? 'danger' : 'secondary'}
                    onClick={handleToggleVoiceCapture}
                    disabled={!loopEnabled}
                    testId="agentic-cli-voice-btn"
                  />

                  <ForgeInteractiveButton
                    label={busyAction === 'propose' ? 'Staging...' : 'Stage Proposal'}
                    icon={<Play className="h-3.5 w-3.5" />}
                    intent="primary"
                    onClick={() => void submitProposal(commandInput, 'CLI_TEXT')}
                    disabled={!loopEnabled || busyAction === 'propose' || !commandInput.trim()}
                    testId="agentic-cli-propose-btn"
                  />
                </div>
              </div>

              {/* Quick Preset Voice / CLI Prompts */}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-800/80">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[11px] font-medium text-slate-400">Quick Commands:</span>
                  {QUICK_COMMAND_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      data-testid={preset.id}
                      disabled={!loopEnabled || busyAction === 'propose'}
                      onClick={() => void submitProposal(preset.command, 'VOICE')}
                      className="rounded-md border border-slate-800 bg-[#0b1326] px-2.5 py-1 text-[11px] font-medium text-slate-300 hover:border-cyan-500/50 hover:text-cyan-200 transition-colors cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed"
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
                <span className="text-[11px] font-mono text-slate-500">
                  {voiceSupported ? 'Web Speech API Ready' : 'Voice Input: CLI Text Mode'}
                </span>
              </div>
            </div>

            {/* Manual Confirmation Gate Queue */}
            <div data-testid="agentic-cli-confirmation-queue" className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                  Manual Confirmation Queue &amp; Diff Inspector
                </h3>
                <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                  {pendingCount} pending · {proposals.length} total
                </span>
              </div>

              {proposals.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-800 bg-[#050914]/60 px-4 py-6 text-center text-xs text-slate-400">
                  {loopEnabled
                    ? 'No staged changes yet. Issue a voice or CLI command above to preview UI actions or local script diffs before execution.'
                    : 'Agentic CLI Loop is currently OFF. Toggle it ON above to route voice or CLI commands through the Unified API Gateway.'}
                </div>
              ) : (
                <div className="space-y-3">
                  {proposals.slice(0, 8).map((prop) => {
                    const isPending = prop.status === 'PENDING_CONFIRMATION';
                    return (
                      <div
                        key={prop.id}
                        data-testid={`proposal-card-${prop.status.toLowerCase()}`}
                        className={`rounded-lg border p-4 space-y-3 ${
                          isPending
                            ? 'border-amber-500/50 bg-[#0b1224]'
                            : prop.status === 'EXECUTED'
                            ? 'border-emerald-500/35 bg-[#07101c]'
                            : prop.status === 'REVERTED'
                            ? 'border-cyan-500/35 bg-[#07101c]'
                            : 'border-slate-800 bg-[#060b16] opacity-80'
                        }`}
                      >
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                          <div className="space-y-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono">
                              <span
                                className={`font-bold ${
                                  isPending
                                    ? 'text-amber-300'
                                    : prop.status === 'EXECUTED'
                                    ? 'text-emerald-400'
                                    : prop.status === 'REVERTED'
                                    ? 'text-cyan-300'
                                    : 'text-rose-400'
                                }`}
                              >
                                {prop.status}
                              </span>
                              <span className="text-slate-600">·</span>
                              <span className="text-slate-400">{prop.kind}</span>
                              <span className="text-slate-600">·</span>
                              <span className="text-cyan-400">{prop.orchestratorModel}</span>
                              <span className="text-slate-600">·</span>
                              <span className="text-slate-500">{prop.inputSource}</span>
                            </div>
                            <p className="text-sm font-semibold text-white">
                              &ldquo;{prop.rawCommand}&rdquo;
                            </p>
                            <p className="text-xs text-slate-300">{prop.summary}</p>
                            <p className="text-[11px] text-slate-400">{prop.reasoning}</p>
                          </div>

                          <div className="flex flex-wrap items-center gap-2 shrink-0">
                            {isPending && (
                              <>
                                <ForgeInteractiveButton
                                  label={
                                    busyAction === `confirm:${prop.id}`
                                      ? 'Executing...'
                                      : 'Confirm & Execute'
                                  }
                                  icon={<Check className="h-3.5 w-3.5" />}
                                  intent="primary"
                                  onClick={() => void handleConfirmProposal(prop)}
                                  disabled={busyAction !== null}
                                  testId="agentic-cli-confirm-btn"
                                />
                                <ForgeInteractiveButton
                                  label="Reject"
                                  icon={<X className="h-3.5 w-3.5" />}
                                  intent="danger"
                                  onClick={() => void handleRejectProposal(prop.id)}
                                  disabled={busyAction !== null}
                                  testId="agentic-cli-reject-btn"
                                />
                              </>
                            )}

                            {prop.status === 'EXECUTED' && prop.canRevertFile && (
                              <ForgeInteractiveButton
                                label={
                                  busyAction === `revert:${prop.id}`
                                    ? 'Reverting...'
                                    : 'Revert File'
                                }
                                icon={<RotateCcw className="h-3.5 w-3.5" />}
                                intent="secondary"
                                onClick={() => void handleRevertProposalFile(prop)}
                                disabled={busyAction !== null}
                                testId="agentic-cli-revert-btn"
                              />
                            )}
                          </div>
                        </div>

                        {/* Mapped UI Modification Functions */}
                        {prop.uiActions.length > 0 && (
                          <div className="rounded-md border border-slate-800/90 bg-[#050914] p-3 space-y-1.5">
                            <div className="text-[11px] font-semibold text-cyan-300">
                              Mapped UI Modification Functions ({prop.uiActions.length})
                            </div>
                            <div className="space-y-1">
                              {prop.uiActions.map((act, idx) => (
                                <div
                                  key={`${prop.id}_ui_${idx}`}
                                  className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono"
                                >
                                  <span className="text-emerald-300">{act.fn}</span>
                                  <span className="text-slate-300 font-sans">{act.label}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Local Script Editor Unified Diff Preview */}
                        {prop.filePatch && (
                          <div
                            data-testid="agentic-cli-diff-preview"
                            className="rounded-md border border-slate-800 bg-[#030712] overflow-hidden"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 bg-[#081020] px-3 py-1.5 text-[11px] font-mono">
                              <span className="text-cyan-300 flex items-center gap-1.5">
                                <FileCode2 className="h-3.5 w-3.5" aria-hidden="true" />
                                <span>{prop.filePatch.targetPath}</span>
                              </span>
                              <span className="text-slate-400 tabular-nums">
                                <span className="text-emerald-400">
                                  +{prop.filePatch.linesAdded}
                                </span>{' '}
                                /{' '}
                                <span className="text-rose-400">
                                  -{prop.filePatch.linesRemoved}
                                </span>{' '}
                                · pre-sha {prop.filePatch.expectedFileSha256.slice(0, 10)}
                              </span>
                            </div>
                            <pre className="overflow-x-auto p-3 text-[11px] leading-relaxed font-mono">
                              {prop.filePatch.unifiedDiff.split('\n').map((line, i) => {
                                const lineClass = line.startsWith('+') && !line.startsWith('+++')
                                  ? 'text-emerald-300 bg-emerald-500/10 block px-1'
                                  : line.startsWith('-') && !line.startsWith('---')
                                  ? 'text-rose-300 bg-rose-500/10 block px-1'
                                  : line.startsWith('@@')
                                  ? 'text-cyan-400 block px-1'
                                  : 'text-slate-400 block px-1';
                                return (
                                  <span key={`${prop.id}_d_${i}`} className={lineClass}>
                                    {line}
                                  </span>
                                );
                              })}
                            </pre>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'GATEWAY' && (
          <div data-testid="agentic-cli-gateway-panel" className="space-y-4">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-200">
                  Modular Model Connectors (Server-Side Unified API Gateway)
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Switch active orchestration models dynamically without frontend code changes. Provider keys remain strictly in server environment secrets.
                </p>
              </div>
              <span className="font-mono text-[11px] text-cyan-400 shrink-0">
                Active: {activeConnectorId}
              </span>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
              {connectors.map((conn) => {
                const isSelected = conn.id === activeConnectorId;
                return (
                  <div
                    key={conn.id}
                    data-testid={`gateway-connector-${conn.id}`}
                    className={`rounded-lg border p-4 flex flex-col justify-between gap-3 ${
                      isSelected
                        ? 'border-cyan-400/70 bg-[#0b162c]'
                        : 'border-slate-800 bg-[#050914]'
                    }`}
                  >
                    <div className="space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <Cpu className="h-4 w-4 text-cyan-400 shrink-0" aria-hidden="true" />
                          <span className="text-xs font-bold text-white truncate">
                            {conn.displayName}
                          </span>
                        </div>
                        <span
                          className={`font-mono text-[10px] font-semibold shrink-0 ${
                            conn.status === 'READY'
                              ? 'text-emerald-400'
                              : conn.status === 'NEEDS_SERVER_KEY'
                              ? 'text-amber-300'
                              : 'text-slate-400'
                          }`}
                        >
                          {conn.status}
                        </span>
                      </div>

                      <div className="font-mono text-[11px] text-slate-400">
                        {conn.provider} · {conn.modelId} · {conn.latencyClass}
                      </div>

                      <p className="text-xs text-slate-300 leading-relaxed">{conn.description}</p>

                      <div className="font-mono text-[10px] text-slate-500">
                        Secret Binding: {conn.envVarName ?? 'None (Zero-Key Local Adapter)'}
                      </div>
                    </div>

                    <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between gap-2">
                      <span className="text-[11px] text-slate-400">
                        JSON · Voice · Diffs
                      </span>
                      <ForgeInteractiveButton
                        label={isSelected ? 'Active Route' : 'Route Active'}
                        intent={isSelected ? 'primary' : 'secondary'}
                        disabled={isSelected || busyAction === `connector:${conn.id}`}
                        onClick={() => void handleSelectConnector(conn.id)}
                        testId={`gateway-select-${conn.id}`}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {activeTab === 'EDITOR_AUDIT' && (
          <div data-testid="agentic-cli-editor-panel" className="grid grid-cols-1 gap-4 lg:grid-cols-12">
            {/* Allowlisted File Preview & Manual Patch Stager */}
            <div className="lg:col-span-7 rounded-lg border border-slate-800 bg-[#050914] p-4 space-y-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-2 text-xs font-semibold text-white">
                  <Code2 className="h-4 w-4 text-cyan-400" aria-hidden="true" />
                  <span>Allowlisted Local Script Viewer</span>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={previewPath}
                    onChange={(e) => setPreviewPath(e.target.value)}
                    data-testid="agentic-cli-file-path-input"
                    className="rounded-md border border-slate-700 bg-[#0a1020] px-2.5 py-1 text-xs font-mono text-white focus:border-cyan-400 focus:outline-none w-80 max-w-full"
                  />
                  <ForgeInteractiveButton
                    label="Inspect"
                    intent="secondary"
                    onClick={() => void fetchFilePreview(previewPath)}
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-slate-400">
                <span>Allowed roots: {editableRoots.join(', ')}</span>
                {fileSha256 && <span>SHA-256: {fileSha256.slice(0, 16)}</span>}
              </div>

              {fileError ? (
                <div className="rounded-md border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-200">
                  {fileError}
                </div>
              ) : (
                <pre
                  data-testid="agentic-cli-file-preview-content"
                  className="max-h-60 overflow-auto rounded-md border border-slate-800 bg-[#030712] p-3 text-[11px] leading-relaxed font-mono text-slate-200"
                >
                  {fileContent || 'Loading file preview...'}
                </pre>
              )}

              <div className="border-t border-slate-800 pt-3 space-y-2.5">
                <div className="text-[11px] font-semibold text-slate-300">
                  Stage Direct Search &amp; Replace Patch (Still Requires Manual Confirmation)
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <input
                    type="text"
                    value={manualSearchText}
                    onChange={(e) => setManualSearchText(e.target.value)}
                    placeholder="Exact search text in target file..."
                    className="rounded-md border border-slate-700 bg-[#0a1020] px-2.5 py-1.5 text-xs font-mono text-white placeholder-slate-500 focus:border-cyan-400 focus:outline-none"
                  />
                  <input
                    type="text"
                    value={manualReplaceText}
                    onChange={(e) => setManualReplaceText(e.target.value)}
                    placeholder="Replacement text..."
                    className="rounded-md border border-slate-700 bg-[#0a1020] px-2.5 py-1.5 text-xs font-mono text-white placeholder-slate-500 focus:border-cyan-400 focus:outline-none"
                  />
                </div>
                <ForgeInteractiveButton
                  label="Stage Local Script Diff"
                  intent="primary"
                  disabled={!loopEnabled || !manualSearchText.trim() || busyAction === 'propose'}
                  onClick={() =>
                    void submitProposal(`Patch ${previewPath}`, 'CLI_TEXT', {
                      targetPath: previewPath,
                      searchText: manualSearchText,
                      replaceText: manualReplaceText,
                      rationale: `Direct search/replace staged via Local Script Editor on ${previewPath}.`,
                    })
                  }
                />
              </div>
            </div>

            {/* Agentic CLI Audit Log */}
            <div className="lg:col-span-5 rounded-lg border border-slate-800 bg-[#050914] p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-200">
                  Orchestrator Audit Trail
                </h3>
                <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                  {logs.length} events
                </span>
              </div>

              <div className="max-h-96 overflow-y-auto space-y-2 pr-1">
                {logs.map((entry) => (
                  <div
                    key={entry.id}
                    className="rounded-md border border-slate-800/80 bg-[#080f1f] px-3 py-2 text-[11px] space-y-0.5"
                  >
                    <div className="flex items-center justify-between gap-2 font-mono">
                      <span
                        className={
                          entry.level === 'CONFIRMED'
                            ? 'text-emerald-400 font-semibold'
                            : entry.level === 'ERROR' || entry.level === 'REJECTED'
                            ? 'text-rose-400 font-semibold'
                            : entry.level === 'PROPOSAL'
                            ? 'text-amber-300 font-semibold'
                            : entry.level === 'REVERTED'
                            ? 'text-cyan-300 font-semibold'
                            : 'text-slate-400 font-semibold'
                        }
                      >
                        {entry.level}
                      </span>
                      <span className="text-slate-500 tabular-nums">
                        {new Date(entry.timestampIso).toLocaleTimeString()}
                      </span>
                    </div>
                    <p className="text-slate-300 leading-snug">{entry.message}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </ForgeWidgetFrame>
  );
});
