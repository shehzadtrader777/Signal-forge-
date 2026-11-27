import type { DesignSystemVariant, WidgetDensity } from './designSystem';
import type { MonitorId, WorkspacePanelKey } from '../store/useWorkspaceStore';
import type { ExecutionControlMode } from './multiAgentTradingArchitecture';

export type ModelProviderId =
  | 'gemini'
  | 'local-deterministic'
  | 'openai-compatible'
  | 'anthropic';

export type GatewayConnectorStatus = 'READY' | 'NEEDS_SERVER_KEY' | 'STANDBY';

export interface GatewayModelConnector {
  readonly id: string;
  readonly provider: ModelProviderId;
  readonly modelId: string;
  readonly displayName: string;
  readonly envVarName: string | null;
  readonly supportsStructuredJson: boolean;
  readonly supportsVoiceParsing: boolean;
  readonly supportsCodeDiffs: boolean;
  readonly status: GatewayConnectorStatus;
  readonly latencyClass: 'SUB_10MS' | 'FAST' | 'DEEP_REASONING';
  readonly description: string;
}

export type UiModificationFunctionName =
  | 'ui.setThemeVariant'
  | 'ui.setDensity'
  | 'ui.toggleNeonGrid'
  | 'ui.switchMonitor'
  | 'ui.togglePanelVisibility'
  | 'ui.updateChartIndicators'
  | 'ui.setExecutionMode'
  | 'ui.navigate';

export interface UiModificationAction {
  readonly fn: UiModificationFunctionName;
  readonly label: string;
  readonly params: {
    readonly variant?: DesignSystemVariant;
    readonly density?: WidgetDensity;
    readonly enabled?: boolean;
    readonly monitorId?: MonitorId;
    readonly panelKey?: WorkspacePanelKey;
    readonly visible?: boolean;
    readonly showVwapOverlay?: boolean;
    readonly showBollingerBands?: boolean;
    readonly showEmaRibbon?: boolean;
    readonly emaFastPeriod?: number;
    readonly emaMidPeriod?: number;
    readonly emaSlowPeriod?: number;
    readonly executionMode?: ExecutionControlMode;
    readonly route?: '/' | '/signals' | '/portfolio' | '/backtesting' | '/settings' | '/signal-history';
  };
}

export interface FilePatchProposal {
  readonly targetPath: string;
  readonly searchText: string;
  readonly replaceText: string;
  readonly rationale: string;
  readonly unifiedDiff: string;
  readonly expectedFileSha256: string;
  readonly linesAdded: number;
  readonly linesRemoved: number;
}

export type ProposalStatus =
  | 'PENDING_CONFIRMATION'
  | 'EXECUTED'
  | 'REJECTED'
  | 'REVERTED';

export type ProposalKind = 'UI_MODIFICATION' | 'CODEBASE_EDIT' | 'COMPOSITE';

export interface AgenticCliProposal {
  readonly id: string;
  readonly confirmationToken: string;
  readonly status: ProposalStatus;
  readonly kind: ProposalKind;
  readonly inputSource: 'VOICE' | 'CLI_TEXT';
  readonly rawCommand: string;
  readonly orchestratorConnectorId: string;
  readonly orchestratorModel: string;
  readonly summary: string;
  readonly reasoning: string;
  readonly uiActions: readonly UiModificationAction[];
  readonly filePatch: FilePatchProposal | null;
  readonly createdAtIso: string;
  readonly resolvedAtIso: string | null;
  readonly appliedPostSha256: string | null;
  readonly canRevertFile: boolean;
}

export interface AgenticCliLogEntry {
  readonly id: string;
  readonly timestampIso: string;
  readonly level: 'INFO' | 'PROPOSAL' | 'CONFIRMED' | 'REJECTED' | 'REVERTED' | 'ERROR';
  readonly message: string;
  readonly proposalId?: string;
}

export const ALLOWED_EDITABLE_PREFIXES: readonly string[] = [
  'src/config/',
  'src/components/',
  'src/lib/',
  'src/store/',
  'src/pages/',
] as const;

export const ALLOWED_EDITABLE_EXTENSIONS: readonly string[] = [
  '.ts',
  '.tsx',
  '.css',
  '.json',
] as const;

export const DENIED_PATH_PATTERNS: readonly RegExp[] = [
  /(^|\/)\.\.(\/|$)/,
  /(^|\/)\.env/i,
  /(^|\/)server\.ts$/i,
  /(^|\/)package(-lock)?\.json$/i,
  /(^|\/)firestore\.rules$/i,
  /(^|\/)firebase-applet-config\.json$/i,
  /(^|\/)node_modules(\/|$)/i,
  /(^|\/)\.git(\/|$)/i,
  /^src\/lib\/rbac\.ts$/i,
  /^src\/lib\/operatorSessionAuth\.ts$/i,
  /^src\/lib\/aiProviderVaultServer\.ts$/i,
  /^src\/lib\/agenticCliEngine\.ts$/i,
  /^src\/lib\/agenticCliGatewayServer\.ts$/i,
  /^src\/services\/firebaseAuthVerifier\.ts$/i,
];

export interface PathValidationResult {
  readonly valid: boolean;
  readonly normalizedRelativePath: string;
  readonly reason: string | null;
}

/**
 * Pure relative-path allowlist & traversal check used before server-side
 * path.resolve boundary verification.
 */
export function validateEditableRepoPath(rawPath: string): PathValidationResult {
  const trimmed = String(rawPath || '').trim().replace(/\\/g, '/').replace(/^\/+/, '');
  if (!trimmed) {
    return { valid: false, normalizedRelativePath: '', reason: 'Target path is required.' };
  }
  if (trimmed.includes('\0') || trimmed.includes(':')) {
    return { valid: false, normalizedRelativePath: trimmed, reason: 'Invalid characters in path.' };
  }
  for (const pattern of DENIED_PATH_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        valid: false,
        normalizedRelativePath: trimmed,
        reason: `Protected or restricted file path denied: ${trimmed}`,
      };
    }
  }
  const hasAllowedPrefix = ALLOWED_EDITABLE_PREFIXES.some((prefix) => trimmed.startsWith(prefix));
  if (!hasAllowedPrefix) {
    return {
      valid: false,
      normalizedRelativePath: trimmed,
      reason: `Path must reside under an allowlisted directory (${ALLOWED_EDITABLE_PREFIXES.join(', ')}).`,
    };
  }
  const hasAllowedExt = ALLOWED_EDITABLE_EXTENSIONS.some((ext) => trimmed.endsWith(ext));
  if (!hasAllowedExt) {
    return {
      valid: false,
      normalizedRelativePath: trimmed,
      reason: `Unsupported file extension. Allowed: ${ALLOWED_EDITABLE_EXTENSIONS.join(', ')}.`,
    };
  }
  return { valid: true, normalizedRelativePath: trimmed, reason: null };
}

export interface UnifiedDiffResult {
  readonly diff: string;
  readonly linesAdded: number;
  readonly linesRemoved: number;
}

/**
 * Computes a concise, readable unified diff preview between original and updated content.
 */
export function computeUnifiedDiff(
  targetPath: string,
  beforeContent: string,
  afterContent: string
): UnifiedDiffResult {
  const beforeLines = beforeContent.split('\n');
  const afterLines = afterContent.split('\n');
  const maxLen = Math.max(beforeLines.length, afterLines.length);

  let firstDiff = -1;
  let lastDiff = -1;
  for (let i = 0; i < maxLen; i++) {
    if (beforeLines[i] !== afterLines[i]) {
      if (firstDiff === -1) firstDiff = i;
      lastDiff = i;
    }
  }

  if (firstDiff === -1) {
    return {
      diff: `--- a/${targetPath}\n+++ b/${targetPath}\n@@ no changes @@`,
      linesAdded: 0,
      linesRemoved: 0,
    };
  }

  const contextStart = Math.max(0, firstDiff - 2);
  const contextEnd = Math.min(maxLen - 1, lastDiff + 2);
  const out: string[] = [
    `--- a/${targetPath}`,
    `+++ b/${targetPath}`,
    `@@ -${contextStart + 1},${Math.max(1, contextEnd - contextStart + 1)} +${contextStart + 1},${Math.max(1, contextEnd - contextStart + 1)} @@`,
  ];

  let linesAdded = 0;
  let linesRemoved = 0;

  for (let i = contextStart; i <= contextEnd; i++) {
    const bLine = beforeLines[i];
    const aLine = afterLines[i];
    if (bLine === aLine) {
      if (bLine !== undefined) out.push(` ${bLine}`);
    } else {
      if (bLine !== undefined) {
        out.push(`-${bLine}`);
        linesRemoved += 1;
      }
      if (aLine !== undefined) {
        out.push(`+${aLine}`);
        linesAdded += 1;
      }
    }
  }

  return {
    diff: out.join('\n'),
    linesAdded,
    linesRemoved,
  };
}

export interface ApplyPatchResult {
  readonly ok: boolean;
  readonly updatedContent: string;
  readonly error: string | null;
}

/**
 * Applies a single exact search-and-replace mutation cleanly so edits are deterministic and auditable.
 */
export function applySingleSearchReplace(
  originalContent: string,
  searchText: string,
  replaceText: string
): ApplyPatchResult {
  if (!searchText) {
    return { ok: false, updatedContent: originalContent, error: 'searchText cannot be empty.' };
  }
  const idx = originalContent.indexOf(searchText);
  if (idx === -1) {
    return {
      ok: false,
      updatedContent: originalContent,
      error: 'Target search block not found in file.',
    };
  }
  const secondIdx = originalContent.indexOf(searchText, idx + searchText.length);
  if (secondIdx !== -1) {
    return {
      ok: false,
      updatedContent: originalContent,
      error: 'Target search block matched multiple locations; please provide more specific context.',
    };
  }
  const updatedContent =
    originalContent.slice(0, idx) + replaceText + originalContent.slice(idx + searchText.length);
  return { ok: true, updatedContent, error: null };
}

/**
 * Builds the modular Unified API Gateway connector registry based on server env availability.
 * Never returns secret values — only boolean readiness flags.
 */
export function buildGatewayConnectorCatalog(envFlags: {
  readonly hasGeminiKey: boolean;
  readonly hasOpenAiCompatKey: boolean;
  readonly hasAnthropicKey: boolean;
}): readonly GatewayModelConnector[] {
  return [
    {
      id: 'gemini-4-hydrogen',
      provider: 'gemini',
      modelId: 'gemini-4-hydrogen',
      displayName: 'Gemini 4 Hydrogen (Unified Primary)',
      envVarName: 'GEMINI_API_KEY',
      supportsStructuredJson: true,
      supportsVoiceParsing: true,
      supportsCodeDiffs: true,
      status: envFlags.hasGeminiKey ? 'READY' : 'NEEDS_SERVER_KEY',
      latencyClass: 'FAST',
      description:
        'Server-side @google/genai orchestrator with structured JSON tool-mapping for voice commands and local script patches.',
    },
    {
      id: 'gemini-3.1-flash-lite',
      provider: 'gemini',
      modelId: 'gemini-3.1-flash-lite',
      displayName: 'Gemini 3.1 Flash Lite (Low-Latency)',
      envVarName: 'GEMINI_API_KEY',
      supportsStructuredJson: true,
      supportsVoiceParsing: true,
      supportsCodeDiffs: true,
      status: envFlags.hasGeminiKey ? 'READY' : 'NEEDS_SERVER_KEY',
      latencyClass: 'FAST',
      description:
        'High-throughput Gemini model optimized for rapid voice-intent routing and UI state transitions.',
    },
    {
      id: 'local-deterministic-v1',
      provider: 'local-deterministic',
      modelId: 'signal-forge-intent-router-v1',
      displayName: 'Local Deterministic Router (Zero-Key)',
      envVarName: null,
      supportsStructuredJson: true,
      supportsVoiceParsing: true,
      supportsCodeDiffs: true,
      status: 'READY',
      latencyClass: 'SUB_10MS',
      description:
        'Built-in deterministic command & local script diff orchestrator requiring zero external credentials.',
    },
    {
      id: 'openai-compatible-slot',
      provider: 'openai-compatible',
      modelId: 'openai-compatible-chat',
      displayName: 'OpenAI-Compatible Modular Slot',
      envVarName: 'OPENAI_COMPAT_API_KEY',
      supportsStructuredJson: true,
      supportsVoiceParsing: true,
      supportsCodeDiffs: true,
      status: envFlags.hasOpenAiCompatKey ? 'READY' : 'STANDBY',
      latencyClass: 'FAST',
      description:
        'Pluggable gateway adapter for OpenAI-compatible inference endpoints configured via server environment.',
    },
    {
      id: 'anthropic-claude-slot',
      provider: 'anthropic',
      modelId: 'anthropic-messages',
      displayName: 'Anthropic Claude Modular Slot',
      envVarName: 'ANTHROPIC_API_KEY',
      supportsStructuredJson: true,
      supportsVoiceParsing: true,
      supportsCodeDiffs: true,
      status: envFlags.hasAnthropicKey ? 'READY' : 'STANDBY',
      latencyClass: 'DEEP_REASONING',
      description:
        'Pluggable gateway adapter for Claude reasoning models configured via server environment.',
    },
  ];
}

export interface DeterministicOrchestrationPlan {
  readonly summary: string;
  readonly reasoning: string;
  readonly uiActions: readonly UiModificationAction[];
  readonly filePatchRequest: {
    readonly targetPath: string;
    readonly searchText: string;
    readonly replaceText: string;
    readonly rationale: string;
  } | null;
}

/**
 * Maps voice transcripts or CLI commands into structured UI modification functions
 * and/or allowlisted local script editor patch proposals.
 */
export function orchestrateDeterministicCommand(
  rawCommand: string,
  currentConfigContent?: string
): DeterministicOrchestrationPlan {
  const command = String(rawCommand || '').trim();
  const lower = command.toLowerCase();
  const uiActions: UiModificationAction[] = [];

  // 1. Design variant / theme commands
  if (/\b(terminal|high contrast)\b/.test(lower)) {
    uiActions.push({
      fn: 'ui.setThemeVariant',
      label: 'Switch Design Variant -> High-Contrast Terminal',
      params: { variant: 'HIGH_CONTRAST_TERMINAL' },
    });
  } else if (/\b(institutional|slate)\b/.test(lower)) {
    uiActions.push({
      fn: 'ui.setThemeVariant',
      label: 'Switch Design Variant -> Institutional Slate',
      params: { variant: 'INSTITUTIONAL_SLATE' },
    });
  } else if (/\b(cyber|cyber ai|neon theme)\b/.test(lower)) {
    uiActions.push({
      fn: 'ui.setThemeVariant',
      label: 'Switch Design Variant -> Cyber-AI',
      params: { variant: 'CYBER_AI' },
    });
  }

  // 2. Layout density
  if (/\bcompact\b/.test(lower)) {
    uiActions.push({
      fn: 'ui.setDensity',
      label: 'Set Widget Density -> Compact',
      params: { density: 'COMPACT' },
    });
  } else if (/\bstandard density\b/.test(lower)) {
    uiActions.push({
      fn: 'ui.setDensity',
      label: 'Set Widget Density -> Standard',
      params: { density: 'STANDARD' },
    });
  }

  // 3. Neon grid overlay toggle
  if (/\b(hide|disable|turn off)\b.*\b(neon grid|grid)\b/.test(lower)) {
    uiActions.push({
      fn: 'ui.toggleNeonGrid',
      label: 'Disable Neon Grid Overlay',
      params: { enabled: false },
    });
  } else if (/\b(show|enable|turn on)\b.*\b(neon grid|grid)\b/.test(lower)) {
    uiActions.push({
      fn: 'ui.toggleNeonGrid',
      label: 'Enable Neon Grid Overlay',
      params: { enabled: true },
    });
  }

  // 4. Multi-screen display switching
  if (/\b(display 2|monitor 2|execution display)\b/.test(lower)) {
    uiActions.push({
      fn: 'ui.switchMonitor',
      label: 'Switch Workspace -> Display 2 (Execution)',
      params: { monitorId: 'DISPLAY_2' },
    });
  } else if (/\b(display 3|monitor 3|intelligence display)\b/.test(lower)) {
    uiActions.push({
      fn: 'ui.switchMonitor',
      label: 'Switch Workspace -> Display 3 (Intelligence)',
      params: { monitorId: 'DISPLAY_3' },
    });
  } else if (/\b(display 1|monitor 1|command display)\b/.test(lower)) {
    uiActions.push({
      fn: 'ui.switchMonitor',
      label: 'Switch Workspace -> Display 1 (Command)',
      params: { monitorId: 'DISPLAY_1' },
    });
  }

  // 5. Chart indicator overlays (VWAP, Bollinger, EMA)
  if (/\bvwap\b/.test(lower)) {
    const enable = !/\b(hide|disable|remove|off)\b/.test(lower);
    uiActions.push({
      fn: 'ui.updateChartIndicators',
      label: `${enable ? 'Enable' : 'Disable'} Session VWAP Chart Overlay`,
      params: { showVwapOverlay: enable },
    });
  }
  if (/\bbollinger\b/.test(lower)) {
    const enable = !/\b(hide|disable|remove|off)\b/.test(lower);
    uiActions.push({
      fn: 'ui.updateChartIndicators',
      label: `${enable ? 'Enable' : 'Disable'} Bollinger Bands (20, 2σ)`,
      params: { showBollingerBands: enable },
    });
  }
  if (/\bema\s*9\b/.test(lower)) {
    uiActions.push({
      fn: 'ui.updateChartIndicators',
      label: 'Configure Fast EMA Period -> 9',
      params: { emaFastPeriod: 9, showEmaRibbon: true },
    });
  }

  // 6. Execution authority mode
  if (/\b(supervised|manual override)\b/.test(lower)) {
    uiActions.push({
      fn: 'ui.setExecutionMode',
      label: 'Set Execution Authority -> Supervised Manual Override',
      params: { executionMode: 'SUPERVISED_MANUAL_OVERRIDE' },
    });
  } else if (/\b(fully autonomous|autonomous mode)\b/.test(lower)) {
    uiActions.push({
      fn: 'ui.setExecutionMode',
      label: 'Set Execution Authority -> Fully Autonomous',
      params: { executionMode: 'FULLY_AUTONOMOUS' },
    });
  }

  // 7. Navigation
  if (/\b(open|go to|navigate)\b.*\bsettings\b/.test(lower)) {
    uiActions.push({
      fn: 'ui.navigate',
      label: 'Navigate -> Settings & Command Hub',
      params: { route: '/settings' },
    });
  } else if (/\b(open|go to|navigate)\b.*\bbacktest/.test(lower)) {
    uiActions.push({
      fn: 'ui.navigate',
      label: 'Navigate -> Backtesting Studio',
      params: { route: '/backtesting' },
    });
  } else if (/\b(open|go to|navigate)\b.*\bportfolio\b/.test(lower)) {
    uiActions.push({
      fn: 'ui.navigate',
      label: 'Navigate -> Multi-Asset Portfolio',
      params: { route: '/portfolio' },
    });
  }

  // 8. Local Script Editor codebase edit commands
  let filePatchRequest: DeterministicOrchestrationPlan['filePatchRequest'] = null;
  const wantsFileEdit =
    /\b(edit|update|patch|modify|change|set)\b/.test(lower) &&
    (/\b(config|tagline|prompt|prefix|title|file|codebase|script)\b/.test(lower) ||
      /src\/[a-z0-9_/-]+\.(ts|tsx|css|json)/i.test(command));

  if (wantsFileEdit) {
    const explicitPathMatch = command.match(/(src\/[a-zA-Z0-9_/-]+\.(?:ts|tsx|css|json))/);
    const targetPath = explicitPathMatch
      ? explicitPathMatch[1]
      : 'src/config/agenticCliRuntimeConfig.ts';

    // Extract quoted value or "to <value>" clause
    const quotedMatch = command.match(/["']([^"']{2,90})["']/);
    const toClauseMatch = command.match(/\bto\s+([a-zA-Z0-9_\s>:·/-]{2,72})$/i);
    const desiredVal = (quotedMatch?.[1] ?? toClauseMatch?.[1] ?? 'Quantum Orchestrator Live')
      .replace(/['"`]/g, '')
      .trim();

    if (targetPath === 'src/config/agenticCliRuntimeConfig.ts') {
      const source = currentConfigContent ?? '';
      if (/\b(prefix|prompt)\b/.test(lower)) {
        const lineMatch = source.match(/promptPrefix:\s*'([^']*)'/);
        const currentLine = lineMatch
          ? `promptPrefix: '${lineMatch[1]}',`
          : `promptPrefix: 'sf-agent>',`;
        filePatchRequest = {
          targetPath,
          searchText: currentLine,
          replaceText: `promptPrefix: '${desiredVal}',`,
          rationale: `Update CLI promptPrefix in ${targetPath} to '${desiredVal}'.`,
        };
      } else if (/\btitle\b/.test(lower)) {
        const lineMatch = source.match(/terminalTitle:\s*'([^']*)'/);
        const currentLine = lineMatch
          ? `terminalTitle: '${lineMatch[1]}',`
          : `terminalTitle: 'Signal Forge Agentic CLI Orchestrator',`;
        filePatchRequest = {
          targetPath,
          searchText: currentLine,
          replaceText: `terminalTitle: '${desiredVal}',`,
          rationale: `Update terminalTitle in ${targetPath} to '${desiredVal}'.`,
        };
      } else {
        const lineMatch = source.match(/bannerTagline:\s*'([^']*)'/);
        const currentLine = lineMatch
          ? `bannerTagline: '${lineMatch[1]}',`
          : `bannerTagline: 'Unified Model Gateway · Voice-to-UI & Confirmed Local Script Editor',`;
        filePatchRequest = {
          targetPath,
          searchText: currentLine,
          replaceText: `bannerTagline: '${desiredVal}',`,
          rationale: `Update bannerTagline in ${targetPath} to '${desiredVal}'.`,
        };
      }
    } else {
      // Explicit search -> replace syntax: replace "A" with "B" in src/...
      const replaceMatch = command.match(/replace\s+["']([^"']+)["']\s+with\s+["']([^"']+)["']/i);
      if (replaceMatch) {
        filePatchRequest = {
          targetPath,
          searchText: replaceMatch[1],
          replaceText: replaceMatch[2],
          rationale: `Apply confirmed text replacement in ${targetPath}.`,
        };
      }
    }
  }

  if (uiActions.length === 0 && !filePatchRequest) {
    // Default safe UI inspection/indicator command hint when unrecognized
    return {
      summary: `Parsed command "${command}" — no direct UI or file mutations matched.`,
      reasoning:
        'Try commands like "Switch theme to Terminal and enable VWAP", "Switch to Display 2", or "Update config tagline to Quantum Command Desk".',
      uiActions: [],
      filePatchRequest: null,
    };
  }

  const parts: string[] = [];
  if (uiActions.length > 0) {
    parts.push(`${uiActions.length} UI modification function${uiActions.length > 1 ? 's' : ''}`);
  }
  if (filePatchRequest) {
    parts.push(`1 codebase patch (${filePatchRequest.targetPath})`);
  }

  return {
    summary: `Staged ${parts.join(' + ')} — awaiting manual operator confirmation.`,
    reasoning: `Orchestrator mapped "${command}" cleanly into deterministic executable operations behind the manual confirmation gate.`,
    uiActions,
    filePatchRequest,
  };
}
