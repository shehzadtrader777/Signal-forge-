import { GoogleGenAI, Type } from '@google/genai';
import {
  enforceSignalRiskInvariants,
  type DebateRoundRecord,
  type KernelAgentProposal,
  type KernelAgentRole,
  type MarketDebateContext,
  type MultiAgentDebateResult,
  type SearchGroundingCitation,
  type SearchGroundingResult,
} from '../lib/multiAgentDebateEngine';
import { getSharedAiProviderVault } from '../lib/aiProviderVaultServer';

export class GeminiServiceError extends Error {
  readonly httpStatus: number;
  readonly code: string;

  constructor(message: string, httpStatus = 502, code = 'GEMINI_UPSTREAM_ERROR') {
    super(message);
    this.name = 'GeminiServiceError';
    this.httpStatus = httpStatus;
    this.code = code;
  }
}

const DEFAULT_REASONING_MODEL = 'gemini-3.1-pro-preview';
const DEFAULT_GROUNDING_MODEL = 'gemini-4-hydrogen';

function resolveReasoningModel(): string {
  const configured = (process.env.GEMINI_MODEL_REASONING || '').trim();
  return configured || DEFAULT_REASONING_MODEL;
}

function resolveGroundingModel(): string {
  return DEFAULT_GROUNDING_MODEL;
}

let cachedClient: GoogleGenAI | null = null;
let cachedApiKey = '';

function getGeminiClient(): GoogleGenAI {
  const apiKey = getSharedAiProviderVault().resolveEffectiveGeminiKey().apiKey;
  if (!apiKey) {
    cachedClient = null;
    cachedApiKey = '';
    throw new GeminiServiceError(
      'Gemini API Key is not configured. Save a valid Gemini API key in Settings > Command Hub to invoke live multi-agent debate or Search grounding.',
      503,
      'GEMINI_API_KEY_UNCONFIGURED'
    );
  }
  if (!cachedClient || cachedApiKey !== apiKey) {
    cachedClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
    cachedApiKey = apiKey;
  }
  return cachedClient;
}

export function getGeminiConfigurationHealth(): 'healthy' | 'unconfigured' {
  return getSharedAiProviderVault().hasEffectiveGeminiKey() ? 'healthy' : 'unconfigured';
}

function mapGeminiError(err: unknown): GeminiServiceError {
  if (err instanceof GeminiServiceError) return err;
  const rawMsg = err instanceof Error ? err.message : String(err);
  if (rawMsg.includes('403') || rawMsg.includes('PERMISSION_DENIED') || rawMsg.includes('API_KEY_INVALID')) {
    return new GeminiServiceError(
      'Gemini API rejected credentials (403/400). Verify GEMINI_API_KEY in Settings > Secrets.',
      403,
      'GEMINI_AUTH_ERROR'
    );
  }
  if (rawMsg.includes('429') || rawMsg.includes('RESOURCE_EXHAUSTED')) {
    return new GeminiServiceError(
      'Gemini API quota limit reached (429 RESOURCE_EXHAUSTED). Retry shortly or select a billing-enabled key in Settings > Secrets.',
      429,
      'GEMINI_QUOTA_EXCEEDED'
    );
  }
  return new GeminiServiceError(`Gemini upstream request failed: ${rawMsg.slice(0, 220)}`, 502, 'GEMINI_UPSTREAM_ERROR');
}

async function runKernelAgent(
  ai: GoogleGenAI,
  model: string,
  role: KernelAgentRole,
  label: string,
  directive: string,
  ctx: MarketDebateContext
): Promise<KernelAgentProposal> {
  const started = Date.now();
  const response = await ai.models.generateContent({
    model,
    contents: [
      `Role: ${label} (${directive}).`,
      `Market Snapshot: ${JSON.stringify(ctx)}`,
      'Return a concise institutional evaluation in strict JSON.',
    ].join('\n'),
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          bias: { type: Type.STRING, description: 'BUY, SELL, or NEUTRAL' },
          confidence: { type: Type.NUMBER, description: 'Confidence 1 to 99' },
          summary: { type: Type.STRING, description: 'Concise 1-2 sentence institutional rationale' },
          keyLevels: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: 'Up to 3 concise key price or risk levels',
          },
        },
        required: ['bias', 'confidence', 'summary', 'keyLevels'],
      },
    },
  });

  const parsed = JSON.parse((response.text ?? '{}').trim()) as {
    bias?: string;
    confidence?: number;
    summary?: string;
    keyLevels?: string[];
  };

  const biasRaw = String(parsed.bias || 'NEUTRAL').toUpperCase();
  const bias: 'BUY' | 'SELL' | 'NEUTRAL' =
    biasRaw === 'BUY' ? 'BUY' : biasRaw === 'SELL' ? 'SELL' : 'NEUTRAL';

  return {
    role,
    label,
    bias,
    confidence: Math.min(99, Math.max(1, Math.round(Number(parsed.confidence) || 65))),
    summary: String(parsed.summary || 'Analysis completed.').slice(0, 360),
    keyLevels: Array.isArray(parsed.keyLevels)
      ? parsed.keyLevels.slice(0, 3).map((x) => String(x).slice(0, 60))
      : [],
    latencyMs: Math.max(1, Date.now() - started),
  };
}

/**
 * Multi-Agent Debate Consensus Pipeline:
 * 1. StrategyAgent, IndicatorAgent, and BacktestAgent run concurrently via Promise.all.
 * 2. 2-Round DebateEngine critiques and synthesizes cross-agent disagreements.
 * 3. Coordinator emits strict structured JSON validated by Signal Forge's Risk Kernel (<= 2% SL, >= 1:5 R:R).
 */
export async function runMultiAgentDebateDecision(
  ctx: MarketDebateContext,
  rounds = 2
): Promise<MultiAgentDebateResult> {
  const ai = getGeminiClient();
  const model = resolveReasoningModel();
  const totalStarted = Date.now();
  const safeRounds = Math.min(3, Math.max(1, Math.floor(rounds)));

  try {
    const proposals = await Promise.all([
      runKernelAgent(
        ai,
        model,
        'STRATEGY_GENERATOR',
        'StrategyAgent',
        'SMC liquidity sweeps, order blocks, breakout, and mean-reversion setups',
        ctx
      ),
      runKernelAgent(
        ai,
        model,
        'INDICATOR_ANALYST',
        'IndicatorAgent',
        'RSI divergence, EMA ribbon trend alignment, MACD momentum, and volume expansion',
        ctx
      ),
      runKernelAgent(
        ai,
        model,
        'BACKTEST_VALIDATOR',
        'BacktestAgent',
        'historical expectancy, drawdown resilience, and regime win-rate validation',
        ctx
      ),
    ]);

    const debateRounds: DebateRoundRecord[] = [];
    let runningTranscript = JSON.stringify(proposals);

    for (let r = 1; r <= safeRounds; r += 1) {
      const roundStart = Date.now();
      const roundResp = await ai.models.generateContent({
        model,
        contents: [
          `Signal Forge DebateEngine Round ${r} of ${safeRounds}.`,
          `Market Context: ${JSON.stringify(ctx)}`,
          `Prior Proposals & Debate History: ${runningTranscript}`,
          'Critique contradictions, eliminate false positives, and synthesize refined directional consensus in strict JSON.',
        ].join('\n'),
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              critique: { type: Type.STRING, description: 'Concise round synthesis & risk critique' },
              consensusBias: { type: Type.STRING, description: 'BUY, SELL, or NEUTRAL' },
              agreementScore: { type: Type.NUMBER, description: 'Cross-agent agreement score 0-100' },
            },
            required: ['critique', 'consensusBias', 'agreementScore'],
          },
        },
      });

      const parsedRound = JSON.parse((roundResp.text ?? '{}').trim()) as {
        critique?: string;
        consensusBias?: string;
        agreementScore?: number;
      };
      const cbRaw = String(parsedRound.consensusBias || 'NEUTRAL').toUpperCase();
      const consensusBias: 'BUY' | 'SELL' | 'NEUTRAL' =
        cbRaw === 'BUY' ? 'BUY' : cbRaw === 'SELL' ? 'SELL' : 'NEUTRAL';

      const record: DebateRoundRecord = {
        round: r,
        critique: String(parsedRound.critique || 'Consensus refined.').slice(0, 420),
        consensusBias,
        agreementScore: Math.min(100, Math.max(0, Math.round(Number(parsedRound.agreementScore) || 75))),
        latencyMs: Math.max(1, Date.now() - roundStart),
      };
      debateRounds.push(record);
      runningTranscript = JSON.stringify({ proposals, debateRounds });
    }

    const coordResp = await ai.models.generateContent({
      model,
      contents: [
        'You are the Signal Forge Coordinator.',
        `Market: ${JSON.stringify(ctx)}`,
        `Kernel Proposals: ${JSON.stringify(proposals)}`,
        `Debate Consensus: ${JSON.stringify(debateRounds)}`,
        'Return the final trade signal in strict JSON with stop loss <= 2.0% from entry and take profit >= 1:5 Risk-to-Reward.',
      ].join('\n'),
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            symbol: { type: Type.STRING },
            direction: { type: Type.STRING, description: 'BUY or SELL' },
            entry: { type: Type.NUMBER },
            tp: { type: Type.NUMBER },
            sl: { type: Type.NUMBER },
            confidence: { type: Type.NUMBER },
            leverage: { type: Type.NUMBER },
            rationale: { type: Type.STRING },
          },
          required: ['symbol', 'direction', 'entry', 'tp', 'sl', 'confidence', 'leverage', 'rationale'],
        },
      },
    });

    const parsedDecision = JSON.parse((coordResp.text ?? '{}').trim()) as {
      symbol?: string;
      direction?: string;
      entry?: number;
      tp?: number;
      sl?: number;
      confidence?: number;
      leverage?: number;
      rationale?: string;
    };

    const decision = enforceSignalRiskInvariants({
      symbol: parsedDecision.symbol || ctx.symbol,
      direction: String(parsedDecision.direction || 'BUY').toUpperCase() === 'SELL' ? 'SELL' : 'BUY',
      entry: Number(parsedDecision.entry) || ctx.livePrice,
      tp: Number(parsedDecision.tp) || ctx.livePrice * 1.075,
      sl: Number(parsedDecision.sl) || ctx.livePrice * 0.985,
      confidence: Number(parsedDecision.confidence) || 78,
      leverage: Number(parsedDecision.leverage) || 3,
      rationale: parsedDecision.rationale,
    });

    return {
      modelUsed: model,
      generatedAtIso: new Date().toISOString(),
      totalLatencyMs: Math.max(1, Date.now() - totalStarted),
      context: ctx,
      proposals,
      debateRounds,
      decision,
    };
  } catch (err) {
    throw mapGeminiError(err);
  }
}

/**
 * Google Search Grounding service for real-time market/macro knowledge refresh.
 * Extracts verified groundingChunks web citations for UI display.
 */
export async function runGroundedMarketSearch(queryText: string): Promise<SearchGroundingResult> {
  const cleanQuery = queryText.trim().slice(0, 400);
  if (!cleanQuery) {
    throw new GeminiServiceError('Search query cannot be empty.', 400, 'INVALID_QUERY');
  }

  const ai = getGeminiClient();
  const model = resolveGroundingModel();
  const started = Date.now();

  try {
    const response = await ai.models.generateContent({
      model,
      contents: `Provide a concise, factual crypto market briefing for Signal Forge traders answering: ${cleanQuery}`,
      config: {
        tools: [{ googleSearch: {} }],
      },
    });

    const rawChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
    const seen = new Set<string>();
    const citations: SearchGroundingCitation[] = [];

    for (const chunk of rawChunks) {
      const uri = chunk.web?.uri;
      if (!uri || seen.has(uri)) continue;
      seen.add(uri);
      citations.push({
        title: (chunk.web?.title || uri).slice(0, 120),
        uri,
      });
    }

    return {
      query: cleanQuery,
      modelUsed: model,
      answer: (response.text ?? 'No grounded summary returned.').trim(),
      citations: citations.slice(0, 8),
      generatedAtIso: new Date().toISOString(),
      latencyMs: Math.max(1, Date.now() - started),
    };
  } catch (err) {
    throw mapGeminiError(err);
  }
}
