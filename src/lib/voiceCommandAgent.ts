export type VoiceListeningMode = 'STANDBY' | 'PUSH_TO_TALK' | 'ALWAYS_LISTENING';

export type VoiceCommandIntent =
  | 'STOP'
  | 'RESUME'
  | 'EMERGENCY_LIQUIDATE'
  | 'RUN_TICK'
  | 'RUN_AUDIT'
  | 'STATUS'
  | 'NAVIGATE'
  | 'UNKNOWN';

export interface ParsedVoiceCommand {
  intent: VoiceCommandIntent;
  routeTarget?: '/' | '/signals' | '/signal-history' | '/backtesting' | '/watchlist' | '/alerts';
  transcript: string;
  normalized: string;
  confidence: number; // 0..1
  summary: string;
  timestamp: string;
}

export interface VoiceAgentLogEntry {
  id: string;
  transcript: string;
  intent: VoiceCommandIntent;
  summary: string;
  mode: VoiceListeningMode;
  timestamp: string;
}

export interface VoiceAgentState {
  mode: VoiceListeningMode;
  listening: boolean;
  supportedInBrowser: boolean;
  lastTranscript: string;
  lastIntent: VoiceCommandIntent | null;
  lastActionSummary: string;
  history: VoiceAgentLogEntry[];
}

export const VOICE_AGENT_STORAGE_KEY = 'sf_voice_agent_mode_v1';

export const DEFAULT_VOICE_AGENT_STATE: VoiceAgentState = {
  mode: 'STANDBY',
  listening: false,
  supportedInBrowser: false,
  lastTranscript: '',
  lastIntent: null,
  lastActionSummary: 'Voice Command Agent ready (Push-to-Talk or Always-Listening emergency Stop guard).',
  history: [],
};

/**
 * Deterministically classifies voice or text transcripts into executable Coordinator commands.
 * Emergency 'STOP' and 'EMERGENCY_LIQUIDATE' take strict priority over other tokens so
 * background always-listening mode reacts immediately.
 */
export function parseVoiceCommandTranscript(
  rawTranscript: string,
  confidence = 0.94
): ParsedVoiceCommand {
  const transcript = String(rawTranscript || '').trim();
  const normalized = transcript
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const timestamp = new Date().toISOString();

  if (!normalized) {
    return {
      intent: 'UNKNOWN',
      transcript,
      normalized,
      confidence: 0,
      summary: 'No speech recognized.',
      timestamp,
    };
  }

  // Priority 1: Emergency Flash Crash Stablecoin Liquidation
  if (
    /\b(emergency liquidate|liquidate all|liquidate positions|convert to stablecoin|stablecoin shield|dump protection)\b/.test(
      normalized
    ) ||
    (normalized.includes('liquidate') && !normalized.includes('status'))
  ) {
    return {
      intent: 'EMERGENCY_LIQUIDATE',
      transcript,
      normalized,
      confidence,
      summary: 'Executing Autonomous Emergency Liquidation into USDT/USDC stablecoins.',
      timestamp,
    };
  }

  // Priority 2: Immediate Emergency System Stop / Kill Switch
  if (
    normalized === 'stop' ||
    /\b(emergency stop|stop system|stop app|halt system|halt trading|kill switch|pause all|freeze system|abort)\b/.test(
      normalized
    ) ||
    /\bstop\b/.test(normalized)
  ) {
    return {
      intent: 'STOP',
      transcript,
      normalized,
      confidence,
      summary: "EMERGENCY STOP triggered — 'App Live' Master Control switched OFF to safeguard API quota & halt execution.",
      timestamp,
    };
  }

  // Priority 3: Resume App Live Operations
  if (
    /\b(resume|start system|go live|app live on|restart stream|unpause|enable app)\b/.test(
      normalized
    )
  ) {
    return {
      intent: 'RESUME',
      transcript,
      normalized,
      confidence,
      summary: "'App Live' Master Control resumed — WebSocket feeds, signal dispatch & Coordinator active.",
      timestamp,
    };
  }

  // Priority 4: Autonomous Coordinator Execution & Audits
  if (/\b(run tick|execute cycle|autonomous cycle|coordinator tick|run cycle)\b/.test(normalized)) {
    return {
      intent: 'RUN_TICK',
      transcript,
      normalized,
      confidence,
      summary: 'Triggered manual Autonomous Coordinator cycle across live WebSocket feeds.',
      timestamp,
    };
  }

  if (/\b(run audit|sentinel audit|scan panic|check news|depth audit)\b/.test(normalized)) {
    return {
      intent: 'RUN_AUDIT',
      transcript,
      normalized,
      confidence,
      summary: 'Running Sentinel & Multi-Exchange L2 Order Book Depth audit.',
      timestamp,
    };
  }

  if (/\b(status|health|report|quota|positions)\b/.test(normalized)) {
    return {
      intent: 'STATUS',
      transcript,
      normalized,
      confidence,
      summary: 'Fetched live Coordinator, App Live quota, and open position status.',
      timestamp,
    };
  }

  // Priority 5: Route Navigation
  if (/\b(backtest|backtesting|simulation)\b/.test(normalized)) {
    return {
      intent: 'NAVIGATE',
      routeTarget: '/backtesting',
      transcript,
      normalized,
      confidence,
      summary: 'Navigated to 30/60/90-Day Comparative Backtesting.',
      timestamp,
    };
  }
  if (/\b(history|signal history|audit trail)\b/.test(normalized)) {
    return {
      intent: 'NAVIGATE',
      routeTarget: '/signal-history',
      transcript,
      normalized,
      confidence,
      summary: 'Navigated to Signal History & Attribution.',
      timestamp,
    };
  }
  if (/\b(signals|setups|scanner)\b/.test(normalized)) {
    return {
      intent: 'NAVIGATE',
      routeTarget: '/signals',
      transcript,
      normalized,
      confidence,
      summary: 'Navigated to Unified Signals & Execution Hub.',
      timestamp,
    };
  }
  if (/\b(dashboard|home|main)\b/.test(normalized)) {
    return {
      intent: 'NAVIGATE',
      routeTarget: '/',
      transcript,
      normalized,
      confidence,
      summary: 'Navigated to Master Coordinator Dashboard.',
      timestamp,
    };
  }

  return {
    intent: 'UNKNOWN',
    transcript,
    normalized,
    confidence,
    summary: `Unrecognized voice command: "${transcript}". Say "Stop", "Resume", "Emergency Liquidate", "Run Tick", or "Open Signals".`,
    timestamp,
  };
}
