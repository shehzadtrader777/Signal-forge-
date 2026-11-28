/**
 * Signal Forge — Public Animated AI Welcome Assistant Model
 *
 * Pure deterministic logic for:
 *  - Session-once welcome auto-presentation gate
 *  - Strict visitor-opt-in voice & microphone permission state (NEVER auto-activates)
 *  - 6 interactive public guidance shortcuts & transparent FAQ knowledge base
 *  - Natural text Q&A router (zero fabricated profit stats, user counts, or guaranteed returns)
 */

export const WELCOME_ASSISTANT_SESSION_KEY = 'sf_public_welcome_assistant_shown_v1';

export type WelcomeTopicId =
  | 'trade_verification'
  | 'trading_signals'
  | 'smart_charts'
  | 'registration'
  | 'login'
  | 'platform_features';

export interface WelcomeQuickTopic {
  id: WelcomeTopicId;
  label: string;
  question: string;
  answer: string;
  actionLabel: string;
  targetType: 'ANCHOR' | 'ROUTE';
  target: string;
}

export interface WelcomeAssistantResponse {
  matchedTopicId: WelcomeTopicId | 'general';
  answer: string;
  suggestedAction?: {
    label: string;
    targetType: 'ANCHOR' | 'ROUTE';
    target: string;
  };
}

export interface VoicePermissionState {
  microphoneOptIn: boolean;
  speechOutputOptIn: boolean;
  isListening: boolean;
}

export const INITIAL_VOICE_PERMISSION_STATE: Readonly<VoicePermissionState> = Object.freeze({
  microphoneOptIn: false,
  speechOutputOptIn: false,
  isListening: false,
});

export const WELCOME_GREETING_TEXT = 'Hello! Welcome to Signal Forge!';

export const WELCOME_QUICK_TOPICS: readonly WelcomeQuickTopic[] = [
  {
    id: 'trade_verification',
    label: 'Trade Verification',
    question: 'How do I verify a Trade ID?',
    answer:
      'Enter any published Signal Forge Trade ID (for example SF-2026-000103) inside Trade ID Verification. The platform loads actual historical candles, strategy evidence, entry/SL/TP levels, execution status, and clearly labels whether the record is Unexecuted Signal, Paper, Demo, or Exchange-Verified Live.',
    actionLabel: 'Go to Trade Verification',
    targetType: 'ANCHOR',
    target: '#trade-id-verification',
  },
  {
    id: 'trading_signals',
    label: 'Trading Signals',
    question: 'How are Trading Signals separated from executed trades?',
    answer:
      'Published analytical signals are strictly separated from executed positions. Unexecuted signals display theoretical R:R only and are never counted as realized profit. Executed records show verified fees, slippage, and Paper/Demo/Live environment tags.',
    actionLabel: 'Inspect Signals Feed',
    targetType: 'ROUTE',
    target: '/signals',
  },
  {
    id: 'smart_charts',
    label: 'Smart Charts',
    question: 'What tools are in the Smart Chart?',
    answer:
      'Our candlestick Smart Charts use verified OHLCV data with multi-timeframe switching, volume, EMA overlays, documented Support/Resistance, BOS/CHoCH market structure, breakout-retest zones, interactive trendline drawing, and Stage 1 / Stage 2 PNG snapshot export.',
    actionLabel: 'View Live Market Chart',
    targetType: 'ANCHOR',
    target: '#live-market-overview',
  },
  {
    id: 'registration',
    label: 'Registration',
    question: 'How do I register an account safely?',
    answer:
      'Create an account on the Sign In / Registration page. New accounts default to Paper/Testnet simulation mode so you can explore charts, risk limits, and strategies without risking real capital.',
    actionLabel: 'Open Registration',
    targetType: 'ROUTE',
    target: '/login',
  },
  {
    id: 'login',
    label: 'Login',
    question: 'How do I sign in to the Trading Workspace?',
    answer:
      'Use Sign In to access your private Dashboard, Portfolio, Exchange Controls, and Command Hub. Live real-money switching remains locked behind explicit authentication and Email OTP verification.',
    actionLabel: 'Go to Sign In',
    targetType: 'ROUTE',
    target: '/login',
  },
  {
    id: 'platform_features',
    label: 'Platform Features',
    question: 'What makes Signal Forge different?',
    answer:
      'Signal Forge combines real-time market ingestion, multi-agent risk vetting, canonical Trade ID auditing, Paper/Demo isolation, and backend-enforced Safe Maintenance controls that pause new live entries during updates while preserving protective stop-loss and take-profit orders.',
    actionLabel: 'Read Platform Overview',
    targetType: 'ROUTE',
    target: '/about',
  },
];

export function shouldAutoShowWelcomeAssistant(storage: Pick<Storage, 'getItem'> | null): boolean {
  if (!storage) return true;
  try {
    return storage.getItem(WELCOME_ASSISTANT_SESSION_KEY) !== '1';
  } catch {
    return true;
  }
}

export function markWelcomeAssistantShown(storage: Pick<Storage, 'setItem'> | null): void {
  if (!storage) return;
  try {
    storage.setItem(WELCOME_ASSISTANT_SESSION_KEY, '1');
  } catch {
    // ignore private browsing quota errors
  }
}

export function requestVoiceMicrophoneToggle(
  current: VoicePermissionState,
  explicitUserClick: boolean
): VoicePermissionState {
  if (!explicitUserClick) {
    return { ...current, isListening: false };
  }
  if (current.isListening) {
    return { ...current, isListening: false };
  }
  return {
    microphoneOptIn: true,
    speechOutputOptIn: current.speechOutputOptIn,
    isListening: true,
  };
}

export function answerWelcomeAssistantQuery(rawQuery: string): WelcomeAssistantResponse {
  const q = rawQuery.trim().toLowerCase();
  if (!q) {
    return {
      matchedTopicId: 'general',
      answer:
        'Ask me about Trade ID Verification, Trading Signals, Smart Charts, Registration, Login, or Signal Forge safety controls.',
    };
  }

  if (q.includes('sf-') || q.includes('verify') || q.includes('trade id') || q.includes('audit')) {
    const t = WELCOME_QUICK_TOPICS.find((item) => item.id === 'trade_verification')!;
    return {
      matchedTopicId: t.id,
      answer: t.answer,
      suggestedAction: { label: t.actionLabel, targetType: t.targetType, target: t.target },
    };
  }

  if (q.includes('chart') || q.includes('candle') || q.includes('trendline') || q.includes('support') || q.includes('breakout')) {
    const t = WELCOME_QUICK_TOPICS.find((item) => item.id === 'smart_charts')!;
    return {
      matchedTopicId: t.id,
      answer: t.answer,
      suggestedAction: { label: t.actionLabel, targetType: t.targetType, target: t.target },
    };
  }

  if (q.includes('signal') || q.includes('pnl') || q.includes('paper') || q.includes('demo') || q.includes('live')) {
    const t = WELCOME_QUICK_TOPICS.find((item) => item.id === 'trading_signals')!;
    return {
      matchedTopicId: t.id,
      answer: t.answer,
      suggestedAction: { label: t.actionLabel, targetType: t.targetType, target: t.target },
    };
  }

  if (q.includes('register') || q.includes('sign up') || q.includes('create account')) {
    const t = WELCOME_QUICK_TOPICS.find((item) => item.id === 'registration')!;
    return {
      matchedTopicId: t.id,
      answer: t.answer,
      suggestedAction: { label: t.actionLabel, targetType: t.targetType, target: t.target },
    };
  }

  if (q.includes('login') || q.includes('sign in') || q.includes('dashboard') || q.includes('account')) {
    const t = WELCOME_QUICK_TOPICS.find((item) => item.id === 'login')!;
    return {
      matchedTopicId: t.id,
      answer: t.answer,
      suggestedAction: { label: t.actionLabel, targetType: t.targetType, target: t.target },
    };
  }

  if (q.includes('feature') || q.includes('risk') || q.includes('maintenance') || q.includes('safe') || q.includes('how')) {
    const t = WELCOME_QUICK_TOPICS.find((item) => item.id === 'platform_features')!;
    return {
      matchedTopicId: t.id,
      answer: t.answer,
      suggestedAction: { label: t.actionLabel, targetType: t.targetType, target: t.target },
    };
  }

  return {
    matchedTopicId: 'general',
    answer:
      'Signal Forge provides verified market charts, independent Trade ID auditing, Paper/Demo isolation, and risk-gated execution workflows (no guaranteed profits). Choose a topic below to jump directly to that section.',
  };
}
