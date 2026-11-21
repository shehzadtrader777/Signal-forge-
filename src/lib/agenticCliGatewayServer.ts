import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { GoogleGenAI, Type } from '@google/genai';
import {
  applySingleSearchReplace,
  buildGatewayConnectorCatalog,
  computeUnifiedDiff,
  orchestrateDeterministicCommand,
  validateEditableRepoPath,
  type AgenticCliLogEntry,
  type AgenticCliProposal,
  type FilePatchProposal,
  type GatewayModelConnector,
  type ProposalKind,
  type UiModificationAction,
} from './agenticCliEngine';

interface StoredRollbackRecord {
  readonly proposalId: string;
  readonly targetPath: string;
  readonly previousContent: string;
  readonly previousSha256: string;
}

export interface AgenticCliGatewaySnapshot {
  readonly loopEnabled: boolean;
  readonly activeConnectorId: string;
  readonly connectors: readonly GatewayModelConnector[];
  readonly proposals: readonly AgenticCliProposal[];
  readonly logs: readonly AgenticCliLogEntry[];
  readonly workspaceEditableRoots: readonly string[];
}

function sha256Hex(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

function safeTokenEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(String(a || ''), 'utf8');
  const bufB = Buffer.from(String(b || ''), 'utf8');
  if (bufA.length === 0 || bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Server-side Unified API Gateway & Safe Local Script Editor.
 *
 * Security boundaries:
 * - API keys stay strictly in server-side process.env (never returned to browser).
 * - All local script writes enforce path.resolve + trailing path.sep workspace
 *   confinement and strict directory/extension allowlisting.
 * - Zero shell execution (no exec/spawn).
 * - Every proposed UI or codebase mutation requires a cryptographic one-time
 *   confirmationToken verified via timingSafeEqual before execution.
 */
export class AgenticCliGatewayRuntime {
  private readonly workspaceRoot: string;
  private loopEnabled = false;
  private activeConnectorId: string;
  private readonly proposals: AgenticCliProposal[] = [];
  private readonly logs: AgenticCliLogEntry[] = [];
  private readonly rollbacks = new Map<string, StoredRollbackRecord>();

  constructor(workspaceRoot: string) {
    this.workspaceRoot = path.resolve(workspaceRoot);
    this.activeConnectorId = this.hasGeminiKey() ? 'gemini-4-hydrogen' : 'local-deterministic-v1';
    this.appendLog(
      'INFO',
      `Unified API Gateway initialized (active connector: ${this.activeConnectorId}). Agentic CLI loop standby.`
    );
  }

  private hasGeminiKey(): boolean {
    const key = String(process.env.GEMINI_API_KEY || '').trim();
    return key.length > 8 && key !== 'MY_GEMINI_API_KEY';
  }

  private getConnectors(): readonly GatewayModelConnector[] {
    return buildGatewayConnectorCatalog({
      hasGeminiKey: this.hasGeminiKey(),
      hasOpenAiCompatKey: Boolean(String(process.env.OPENAI_COMPAT_API_KEY || '').trim()),
      hasAnthropicKey: Boolean(String(process.env.ANTHROPIC_API_KEY || '').trim()),
    });
  }

  private appendLog(
    level: AgenticCliLogEntry['level'],
    message: string,
    proposalId?: string
  ): void {
    this.logs.unshift({
      id: `cli_log_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`,
      timestampIso: new Date().toISOString(),
      level,
      message,
      proposalId,
    });
    if (this.logs.length > 60) {
      this.logs.length = 60;
    }
  }

  private resolveSafeWorkspaceFile(rawRelativePath: string): {
    readonly ok: boolean;
    readonly relativePath: string;
    readonly absolutePath: string;
    readonly error: string | null;
  } {
    const check = validateEditableRepoPath(rawRelativePath);
    if (!check.valid) {
      return {
        ok: false,
        relativePath: check.normalizedRelativePath,
        absolutePath: '',
        error: check.reason ?? 'Disallowed path.',
      };
    }
    const resolved = path.resolve(this.workspaceRoot, check.normalizedRelativePath);
    const rootBoundary = this.workspaceRoot.endsWith(path.sep)
      ? this.workspaceRoot
      : `${this.workspaceRoot}${path.sep}`;
    if (!resolved.startsWith(rootBoundary)) {
      return {
        ok: false,
        relativePath: check.normalizedRelativePath,
        absolutePath: '',
        error: 'Path traversal boundary check failed.',
      };
    }
    return {
      ok: true,
      relativePath: check.normalizedRelativePath,
      absolutePath: resolved,
      error: null,
    };
  }

  getSnapshot(): AgenticCliGatewaySnapshot {
    return {
      loopEnabled: this.loopEnabled,
      activeConnectorId: this.activeConnectorId,
      connectors: this.getConnectors(),
      proposals: this.proposals.slice(0, 25),
      logs: this.logs.slice(0, 40),
      workspaceEditableRoots: ['src/config/', 'src/components/', 'src/lib/', 'src/store/', 'src/pages/'],
    };
  }

  setLoopEnabled(enabled: boolean): AgenticCliGatewaySnapshot {
    this.loopEnabled = Boolean(enabled);
    this.appendLog(
      'INFO',
      this.loopEnabled
        ? `Agentic CLI Loop ARMED via UI toggle (gateway connector: ${this.activeConnectorId}). Manual confirmation enforced on all edits.`
        : 'Agentic CLI Loop DISARMED via UI toggle. Voice & script orchestration paused.'
    );
    return this.getSnapshot();
  }

  selectConnector(connectorId: string): { ok: boolean; error?: string; snapshot: AgenticCliGatewaySnapshot } {
    const connectors = this.getConnectors();
    const match = connectors.find((c) => c.id === connectorId);
    if (!match) {
      return {
        ok: false,
        error: `Unknown gateway connector '${connectorId}'.`,
        snapshot: this.getSnapshot(),
      };
    }
    this.activeConnectorId = match.id;
    this.appendLog('INFO', `Unified API Gateway routed to connector '${match.displayName}' (${match.modelId}).`);
    return { ok: true, snapshot: this.getSnapshot() };
  }

  readAllowlistedFile(rawRelativePath: string): {
    ok: boolean;
    relativePath: string;
    content?: string;
    sha256?: string;
    error?: string;
  } {
    const resolved = this.resolveSafeWorkspaceFile(rawRelativePath);
    if (!resolved.ok) {
      return { ok: false, relativePath: resolved.relativePath, error: resolved.error ?? 'Denied path' };
    }
    if (!fs.existsSync(resolved.absolutePath)) {
      return { ok: false, relativePath: resolved.relativePath, error: 'File not found in workspace.' };
    }
    const content = fs.readFileSync(resolved.absolutePath, 'utf8');
    return {
      ok: true,
      relativePath: resolved.relativePath,
      content,
      sha256: sha256Hex(content),
    };
  }

  private async runGeminiOrchestrator(
    modelId: string,
    rawCommand: string,
    currentConfigSnippet: string
  ): Promise<{
    summary: string;
    reasoning: string;
    uiActions: readonly UiModificationAction[];
    filePatchRequest: {
      targetPath: string;
      searchText: string;
      replaceText: string;
      rationale: string;
    } | null;
  }> {
    const apiKey = String(process.env.GEMINI_API_KEY || '').trim();
    if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
      throw new Error(
        'GEMINI_API_KEY is not configured on the server. Add your key in Settings > Secrets or switch the Unified API Gateway to Local Deterministic Router.'
      );
    }

    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });

    const systemInstruction = [
      'You are the Signal Forge Agentic CLI Orchestrator.',
      'Convert the user voice/CLI command into structured UI modification actions and/or a single safe local script patch.',
      'Allowed UI functions: ui.setThemeVariant (variant: CYBER_AI | INSTITUTIONAL_SLATE | HIGH_CONTRAST_TERMINAL), ui.setDensity (density: COMPACT | STANDARD), ui.toggleNeonGrid (enabled: boolean), ui.switchMonitor (monitorId: DISPLAY_1 | DISPLAY_2 | DISPLAY_3), ui.updateChartIndicators (showVwapOverlay, showBollingerBands, showEmaRibbon, emaFastPeriod), ui.setExecutionMode (executionMode: FULLY_AUTONOMOUS | SUPERVISED_MANUAL_OVERRIDE), ui.navigate (route: / | /signals | /portfolio | /backtesting | /settings | /signal-history).',
      'For codebase edits, prefer src/config/agenticCliRuntimeConfig.ts unless another allowlisted src/ path is explicitly named. Return exact searchText from the provided file snippet and replaceText.',
      'Keep summary and reasoning concise (under 2 sentences each).',
    ].join(' ');

    const response = await ai.models.generateContent({
      model: modelId,
      contents: `User command: "${rawCommand}"\n\nCurrent src/config/agenticCliRuntimeConfig.ts:\n${currentConfigSnippet}`,
      config: {
        systemInstruction,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            summary: { type: Type.STRING },
            reasoning: { type: Type.STRING },
            uiActions: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  fn: { type: Type.STRING },
                  label: { type: Type.STRING },
                  variant: { type: Type.STRING },
                  density: { type: Type.STRING },
                  enabled: { type: Type.BOOLEAN },
                  monitorId: { type: Type.STRING },
                  showVwapOverlay: { type: Type.BOOLEAN },
                  showBollingerBands: { type: Type.BOOLEAN },
                  showEmaRibbon: { type: Type.BOOLEAN },
                  emaFastPeriod: { type: Type.INTEGER },
                  executionMode: { type: Type.STRING },
                  route: { type: Type.STRING },
                },
                required: ['fn', 'label'],
              },
            },
            filePatch: {
              type: Type.OBJECT,
              properties: {
                targetPath: { type: Type.STRING },
                searchText: { type: Type.STRING },
                replaceText: { type: Type.STRING },
                rationale: { type: Type.STRING },
              },
            },
          },
          required: ['summary', 'reasoning'],
        },
      },
    });

    const text = (response.text ?? '{}').trim();
    const parsed = JSON.parse(text) as {
      summary?: string;
      reasoning?: string;
      uiActions?: Array<Record<string, unknown>>;
      filePatch?: {
        targetPath?: string;
        searchText?: string;
        replaceText?: string;
        rationale?: string;
      };
    };

    const allowedFns = new Set<UiModificationAction['fn']>([
      'ui.setThemeVariant',
      'ui.setDensity',
      'ui.toggleNeonGrid',
      'ui.switchMonitor',
      'ui.togglePanelVisibility',
      'ui.updateChartIndicators',
      'ui.setExecutionMode',
      'ui.navigate',
    ]);

    const uiActions: UiModificationAction[] = [];
    for (const rawAct of parsed.uiActions ?? []) {
      const fn = String(rawAct.fn || '') as UiModificationAction['fn'];
      if (!allowedFns.has(fn)) continue;
      uiActions.push({
        fn,
        label: String(rawAct.label || fn),
        params: {
          variant:
            rawAct.variant === 'CYBER_AI' ||
            rawAct.variant === 'INSTITUTIONAL_SLATE' ||
            rawAct.variant === 'HIGH_CONTRAST_TERMINAL'
              ? rawAct.variant
              : undefined,
          density:
            rawAct.density === 'COMPACT' || rawAct.density === 'STANDARD'
              ? rawAct.density
              : undefined,
          enabled: typeof rawAct.enabled === 'boolean' ? rawAct.enabled : undefined,
          monitorId:
            rawAct.monitorId === 'DISPLAY_1' ||
            rawAct.monitorId === 'DISPLAY_2' ||
            rawAct.monitorId === 'DISPLAY_3'
              ? rawAct.monitorId
              : undefined,
          showVwapOverlay:
            typeof rawAct.showVwapOverlay === 'boolean' ? rawAct.showVwapOverlay : undefined,
          showBollingerBands:
            typeof rawAct.showBollingerBands === 'boolean' ? rawAct.showBollingerBands : undefined,
          showEmaRibbon:
            typeof rawAct.showEmaRibbon === 'boolean' ? rawAct.showEmaRibbon : undefined,
          emaFastPeriod:
            typeof rawAct.emaFastPeriod === 'number' ? rawAct.emaFastPeriod : undefined,
          executionMode:
            rawAct.executionMode === 'FULLY_AUTONOMOUS' ||
            rawAct.executionMode === 'SUPERVISED_MANUAL_OVERRIDE'
              ? rawAct.executionMode
              : undefined,
          route:
            rawAct.route === '/' ||
            rawAct.route === '/signals' ||
            rawAct.route === '/portfolio' ||
            rawAct.route === '/backtesting' ||
            rawAct.route === '/settings' ||
            rawAct.route === '/signal-history'
              ? rawAct.route
              : undefined,
        },
      });
    }

    const fp = parsed.filePatch;
    const filePatchRequest =
      fp && fp.targetPath && fp.searchText && typeof fp.replaceText === 'string'
        ? {
            targetPath: String(fp.targetPath),
            searchText: String(fp.searchText),
            replaceText: String(fp.replaceText),
            rationale: String(fp.rationale || 'LLM-proposed local script update'),
          }
        : null;

    return {
      summary: String(parsed.summary || 'Staged Gemini orchestration plan — awaiting confirmation.'),
      reasoning: String(parsed.reasoning || 'Parsed via Unified API Gateway Gemini connector.'),
      uiActions,
      filePatchRequest,
    };
  }

  async createProposal(input: {
    readonly command: string;
    readonly inputSource: 'VOICE' | 'CLI_TEXT';
    readonly connectorId?: string;
    readonly explicitFilePatch?: {
      readonly targetPath: string;
      readonly searchText: string;
      readonly replaceText: string;
      readonly rationale?: string;
    };
  }): Promise<{ ok: boolean; statusCode: number; error?: string; proposal?: AgenticCliProposal; snapshot: AgenticCliGatewaySnapshot }> {
    if (!this.loopEnabled) {
      return {
        ok: false,
        statusCode: 409,
        error: 'Agentic CLI Loop is currently OFF. Enable the UI toggle first to parse commands.',
        snapshot: this.getSnapshot(),
      };
    }

    const command = String(input.command || '').trim();
    if (!command) {
      return {
        ok: false,
        statusCode: 400,
        error: 'Command transcript cannot be empty.',
        snapshot: this.getSnapshot(),
      };
    }

    const connectors = this.getConnectors();
    const chosenId = input.connectorId || this.activeConnectorId;
    const connector = connectors.find((c) => c.id === chosenId) ?? connectors[0];

    const configRead = this.readAllowlistedFile('src/config/agenticCliRuntimeConfig.ts');
    const configText = configRead.ok && configRead.content ? configRead.content : '';

    let summary = '';
    let reasoning = '';
    let uiActions: readonly UiModificationAction[] = [];
    let rawPatchRequest: {
      targetPath: string;
      searchText: string;
      replaceText: string;
      rationale: string;
    } | null = null;

    if (input.explicitFilePatch) {
      summary = `Staged direct local script edit on ${input.explicitFilePatch.targetPath} — awaiting manual confirmation.`;
      reasoning = 'Explicit local script editor patch submitted through Agentic CLI Loop.';
      rawPatchRequest = {
        targetPath: input.explicitFilePatch.targetPath,
        searchText: input.explicitFilePatch.searchText,
        replaceText: input.explicitFilePatch.replaceText,
        rationale: input.explicitFilePatch.rationale ?? 'Operator-requested local script patch.',
      };
    } else if (connector.provider === 'gemini') {
      try {
        const res = await this.runGeminiOrchestrator(connector.modelId, command, configText);
        summary = res.summary;
        reasoning = res.reasoning;
        uiActions = res.uiActions;
        rawPatchRequest = res.filePatchRequest;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Gemini gateway orchestration failed.';
        this.appendLog('ERROR', `Gateway (${connector.id}) error: ${msg}`);
        return {
          ok: false,
          statusCode: 502,
          error: msg,
          snapshot: this.getSnapshot(),
        };
      }
    } else if (connector.provider === 'openai-compatible' || connector.provider === 'anthropic') {
      if (connector.status !== 'READY') {
        const msg = `Connector '${connector.displayName}' requires ${connector.envVarName} on the server. Switch to Gemini 4 Hydrogen or Local Deterministic Router.`;
        this.appendLog('ERROR', msg);
        return {
          ok: false,
          statusCode: 503,
          error: msg,
          snapshot: this.getSnapshot(),
        };
      }
      const plan = orchestrateDeterministicCommand(command, configText);
      summary = plan.summary;
      reasoning = plan.reasoning;
      uiActions = plan.uiActions;
      rawPatchRequest = plan.filePatchRequest;
    } else {
      const plan = orchestrateDeterministicCommand(command, configText);
      summary = plan.summary;
      reasoning = plan.reasoning;
      uiActions = plan.uiActions;
      rawPatchRequest = plan.filePatchRequest;
    }

    let filePatch: FilePatchProposal | null = null;
    if (rawPatchRequest) {
      const targetRead = this.readAllowlistedFile(rawPatchRequest.targetPath);
      if (!targetRead.ok || typeof targetRead.content !== 'string' || !targetRead.sha256) {
        return {
          ok: false,
          statusCode: 400,
          error: targetRead.error ?? `Unable to read allowlisted target ${rawPatchRequest.targetPath}`,
          snapshot: this.getSnapshot(),
        };
      }
      const patched = applySingleSearchReplace(
        targetRead.content,
        rawPatchRequest.searchText,
        rawPatchRequest.replaceText
      );
      if (!patched.ok) {
        return {
          ok: false,
          statusCode: 400,
          error: patched.error ?? 'Failed to stage file patch.',
          snapshot: this.getSnapshot(),
        };
      }
      const diffRes = computeUnifiedDiff(
        targetRead.relativePath,
        targetRead.content,
        patched.updatedContent
      );
      filePatch = {
        targetPath: targetRead.relativePath,
        searchText: rawPatchRequest.searchText,
        replaceText: rawPatchRequest.replaceText,
        rationale: rawPatchRequest.rationale,
        unifiedDiff: diffRes.diff,
        expectedFileSha256: targetRead.sha256,
        linesAdded: diffRes.linesAdded,
        linesRemoved: diffRes.linesRemoved,
      };
    }

    const kind: ProposalKind =
      uiActions.length > 0 && filePatch
        ? 'COMPOSITE'
        : filePatch
        ? 'CODEBASE_EDIT'
        : 'UI_MODIFICATION';

    const proposal: AgenticCliProposal = {
      id: `prop_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`,
      confirmationToken: crypto.randomBytes(16).toString('hex'),
      status: 'PENDING_CONFIRMATION',
      kind,
      inputSource: input.inputSource,
      rawCommand: command,
      orchestratorConnectorId: connector.id,
      orchestratorModel: connector.modelId,
      summary,
      reasoning,
      uiActions,
      filePatch,
      createdAtIso: new Date().toISOString(),
      resolvedAtIso: null,
      appliedPostSha256: null,
      canRevertFile: false,
    };

    this.proposals.unshift(proposal);
    if (this.proposals.length > 40) this.proposals.length = 40;
    this.appendLog(
      'PROPOSAL',
      `[${input.inputSource}] Staged ${proposal.id} via ${connector.modelId}: ${proposal.summary}`,
      proposal.id
    );

    return {
      ok: true,
      statusCode: 201,
      proposal,
      snapshot: this.getSnapshot(),
    };
  }

  confirmProposal(input: {
    readonly proposalId: string;
    readonly confirmationToken: string;
    readonly approved: boolean;
  }): {
    ok: boolean;
    statusCode: number;
    error?: string;
    proposal?: AgenticCliProposal;
    snapshot: AgenticCliGatewaySnapshot;
  } {
    const idx = this.proposals.findIndex((p) => p.id === input.proposalId);
    if (idx === -1) {
      return {
        ok: false,
        statusCode: 404,
        error: `Proposal '${input.proposalId}' not found.`,
        snapshot: this.getSnapshot(),
      };
    }
    const existing = this.proposals[idx];
    if (existing.status !== 'PENDING_CONFIRMATION') {
      return {
        ok: false,
        statusCode: 409,
        error: `Proposal '${existing.id}' is already ${existing.status}.`,
        snapshot: this.getSnapshot(),
      };
    }
    if (!input.approved || !safeTokenEquals(existing.confirmationToken, input.confirmationToken)) {
      return {
        ok: false,
        statusCode: 403,
        error: 'Manual confirmation rejected: explicit approval and valid confirmation token are required.',
        snapshot: this.getSnapshot(),
      };
    }

    let appliedPostSha256: string | null = null;
    let canRevertFile = false;

    if (existing.filePatch) {
      const resolved = this.resolveSafeWorkspaceFile(existing.filePatch.targetPath);
      if (!resolved.ok) {
        return {
          ok: false,
          statusCode: 403,
          error: resolved.error ?? 'Target file path rejected.',
          snapshot: this.getSnapshot(),
        };
      }
      if (!fs.existsSync(resolved.absolutePath)) {
        return {
          ok: false,
          statusCode: 404,
          error: `Target file '${resolved.relativePath}' no longer exists.`,
          snapshot: this.getSnapshot(),
        };
      }
      const currentContent = fs.readFileSync(resolved.absolutePath, 'utf8');
      const currentSha = sha256Hex(currentContent);
      if (currentSha !== existing.filePatch.expectedFileSha256) {
        return {
          ok: false,
          statusCode: 409,
          error: `File '${resolved.relativePath}' changed since diff preview was staged (checksum mismatch). Re-propose to inspect latest diff.`,
          snapshot: this.getSnapshot(),
        };
      }
      const patched = applySingleSearchReplace(
        currentContent,
        existing.filePatch.searchText,
        existing.filePatch.replaceText
      );
      if (!patched.ok) {
        return {
          ok: false,
          statusCode: 400,
          error: patched.error ?? 'Failed to apply local script patch.',
          snapshot: this.getSnapshot(),
        };
      }

      // Save rollback snapshot before writing file
      this.rollbacks.set(existing.id, {
        proposalId: existing.id,
        targetPath: resolved.relativePath,
        previousContent: currentContent,
        previousSha256: currentSha,
      });

      fs.writeFileSync(resolved.absolutePath, patched.updatedContent, 'utf8');
      appliedPostSha256 = sha256Hex(patched.updatedContent);
      canRevertFile = true;
    }

    const updated: AgenticCliProposal = {
      ...existing,
      status: 'EXECUTED',
      resolvedAtIso: new Date().toISOString(),
      appliedPostSha256,
      canRevertFile,
    };
    this.proposals[idx] = updated;
    this.appendLog(
      'CONFIRMED',
      `Operator confirmed & executed ${updated.id}${
        updated.filePatch ? ` (patched ${updated.filePatch.targetPath}, sha256 ${appliedPostSha256?.slice(0, 10)})` : ''
      }.`,
      updated.id
    );

    return {
      ok: true,
      statusCode: 200,
      proposal: updated,
      snapshot: this.getSnapshot(),
    };
  }

  rejectProposal(proposalId: string): {
    ok: boolean;
    statusCode: number;
    error?: string;
    proposal?: AgenticCliProposal;
    snapshot: AgenticCliGatewaySnapshot;
  } {
    const idx = this.proposals.findIndex((p) => p.id === proposalId);
    if (idx === -1) {
      return {
        ok: false,
        statusCode: 404,
        error: `Proposal '${proposalId}' not found.`,
        snapshot: this.getSnapshot(),
      };
    }
    const existing = this.proposals[idx];
    if (existing.status !== 'PENDING_CONFIRMATION') {
      return {
        ok: false,
        statusCode: 409,
        error: `Proposal '${existing.id}' is already ${existing.status}.`,
        snapshot: this.getSnapshot(),
      };
    }
    const updated: AgenticCliProposal = {
      ...existing,
      status: 'REJECTED',
      resolvedAtIso: new Date().toISOString(),
    };
    this.proposals[idx] = updated;
    this.appendLog('REJECTED', `Operator rejected staged proposal ${updated.id}. Zero changes applied.`, updated.id);
    return { ok: true, statusCode: 200, proposal: updated, snapshot: this.getSnapshot() };
  }

  revertProposalFile(proposalId: string): {
    ok: boolean;
    statusCode: number;
    error?: string;
    proposal?: AgenticCliProposal;
    snapshot: AgenticCliGatewaySnapshot;
  } {
    const idx = this.proposals.findIndex((p) => p.id === proposalId);
    if (idx === -1) {
      return {
        ok: false,
        statusCode: 404,
        error: `Proposal '${proposalId}' not found.`,
        snapshot: this.getSnapshot(),
      };
    }
    const existing = this.proposals[idx];
    const rollback = this.rollbacks.get(existing.id);
    if (!rollback || existing.status !== 'EXECUTED') {
      return {
        ok: false,
        statusCode: 409,
        error: `No active rollback snapshot available for proposal '${existing.id}'.`,
        snapshot: this.getSnapshot(),
      };
    }
    const resolved = this.resolveSafeWorkspaceFile(rollback.targetPath);
    if (!resolved.ok) {
      return {
        ok: false,
        statusCode: 403,
        error: resolved.error ?? 'Target path rejected on revert.',
        snapshot: this.getSnapshot(),
      };
    }
    fs.writeFileSync(resolved.absolutePath, rollback.previousContent, 'utf8');
    this.rollbacks.delete(existing.id);

    const updated: AgenticCliProposal = {
      ...existing,
      status: 'REVERTED',
      resolvedAtIso: new Date().toISOString(),
      canRevertFile: false,
    };
    this.proposals[idx] = updated;
    this.appendLog(
      'REVERTED',
      `Reverted ${rollback.targetPath} back to pre-edit sha256 ${rollback.previousSha256.slice(0, 10)}.`,
      updated.id
    );
    return { ok: true, statusCode: 200, proposal: updated, snapshot: this.getSnapshot() };
  }
}
