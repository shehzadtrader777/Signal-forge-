/**
 * Strict Type Definitions, Multi-Design Theme Tokens, Widget Layout Contracts,
 * and 120Hz Compositor-Only Spring Physics for the Signal Forge UI System.
 */

export type DesignSystemVariant =
  | 'CYBER_AI'
  | 'INSTITUTIONAL_SLATE'
  | 'HIGH_CONTRAST_TERMINAL';

export type WidgetDensity = 'COMPACT' | 'STANDARD';

export type WidgetElevation = 'FLAT' | 'SURFACE';

export type WidgetStatusTone = 'NOMINAL' | 'WARNING' | 'CRITICAL' | 'INFO';

export type WidgetGridSpan = 4 | 6 | 8 | 12;

export interface WidgetMetadataSegment {
  readonly id: string;
  readonly label: string;
  readonly value?: string;
  readonly tone?: WidgetStatusTone;
}

export interface WidgetMetricItem {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly subtext?: string;
  readonly tone?: WidgetStatusTone;
}

export interface WidgetLayoutContract {
  readonly widgetId: string;
  readonly ariaLabel: string;
  readonly colSpanDesktop: WidgetGridSpan;
  readonly minHeightPx?: number;
  readonly elevation: WidgetElevation;
  readonly density?: WidgetDensity;
  readonly gpuContain: boolean;
  readonly showStreamRail?: boolean;
}

export interface Motion120HzSpringConfig {
  readonly type: 'spring';
  readonly stiffness: number;
  readonly damping: number;
  readonly mass: number;
}

export interface MotionCompositorTransition {
  readonly duration: number;
  readonly ease: readonly [number, number, number, number];
}

export interface DesignSystemVariantSpec {
  readonly id: DesignSystemVariant;
  readonly label: string;
  readonly shortLabel: string;
  readonly description: string;
  readonly surfaceClass: string;
  readonly insetClass: string;
  readonly dividerClass: string;
  readonly accentTextClass: string;
  readonly activeTabBgClass: string;
  readonly activeTabTextClass: string;
  readonly primaryButtonClass: string;
  readonly secondaryButtonClass: string;
}

/**
 * Calibrated 120Hz spring physics (8.33ms frame budget).
 * Only compositor-accelerated properties (transform, opacity) should use these tokens.
 */
export const MOTION_120HZ_SPRINGS: Readonly<{
  readonly snappy: Motion120HzSpringConfig;
  readonly sharedElement: Motion120HzSpringConfig;
  readonly drawer: Motion120HzSpringConfig;
  readonly displaySlide: Motion120HzSpringConfig;
  readonly compositorFast: MotionCompositorTransition;
}> = {
  snappy: {
    type: 'spring',
    stiffness: 480,
    damping: 36,
    mass: 0.65,
  },
  sharedElement: {
    type: 'spring',
    stiffness: 420,
    damping: 34,
    mass: 0.72,
  },
  drawer: {
    type: 'spring',
    stiffness: 440,
    damping: 38,
    mass: 0.7,
  },
  displaySlide: {
    type: 'spring',
    stiffness: 430,
    damping: 36,
    mass: 0.68,
  },
  compositorFast: {
    duration: 0.16,
    ease: [0.16, 1, 0.3, 1],
  },
};

export const DESIGN_SYSTEM_VARIANTS: Readonly<Record<DesignSystemVariant, DesignSystemVariantSpec>> = {
  CYBER_AI: {
    id: 'CYBER_AI',
    label: 'Cyber-AI Precision',
    shortLabel: 'Cyber-AI',
    description: 'Deep navy obsidian canvas with crisp cyan data rails and subtle AI telemetry cadence.',
    surfaceClass: 'forge-surface rounded-xl border',
    insetClass: 'rounded-lg border border-slate-800/90 bg-[#060c1b]/95',
    dividerClass: 'border-slate-800/90',
    accentTextClass: 'text-cyan-300',
    activeTabBgClass: 'bg-cyan-500/20 border border-cyan-400/45',
    activeTabTextClass: 'text-cyan-100',
    primaryButtonClass:
      'bg-[#3b82f6] text-white hover:bg-blue-500 border border-blue-400/30',
    secondaryButtonClass:
      'border border-cyan-500/35 bg-cyan-500/10 text-cyan-200 hover:bg-cyan-500/20',
  },
  INSTITUTIONAL_SLATE: {
    id: 'INSTITUTIONAL_SLATE',
    label: 'Institutional Desk',
    shortLabel: 'Institutional',
    description: 'Restrained graphite-slate surfaces with muted hairline grids for long-duration quant desks.',
    surfaceClass: 'forge-surface rounded-xl border',
    insetClass: 'rounded-lg border border-slate-700/75 bg-slate-900/90',
    dividerClass: 'border-slate-800',
    accentTextClass: 'text-blue-300',
    activeTabBgClass: 'bg-blue-500/20 border border-blue-400/45',
    activeTabTextClass: 'text-white',
    primaryButtonClass:
      'bg-blue-600 text-white hover:bg-blue-500 border border-blue-400/30',
    secondaryButtonClass:
      'border border-slate-700 bg-slate-800/80 text-slate-100 hover:border-slate-500',
  },
  HIGH_CONTRAST_TERMINAL: {
    id: 'HIGH_CONTRAST_TERMINAL',
    label: 'High-Contrast Terminal',
    shortLabel: 'Terminal',
    description: 'Maximum-legibility obsidian surfaces with crisp high-contrast emerald and amber signaling.',
    surfaceClass: 'forge-surface rounded-lg border',
    insetClass: 'rounded-md border border-slate-700 bg-black/90',
    dividerClass: 'border-slate-700/90',
    accentTextClass: 'text-emerald-300',
    activeTabBgClass: 'bg-emerald-500/20 border border-emerald-400/60',
    activeTabTextClass: 'text-emerald-100',
    primaryButtonClass:
      'bg-emerald-500 text-slate-950 hover:bg-emerald-400 border border-emerald-300/40 font-bold',
    secondaryButtonClass:
      'border border-emerald-500/45 bg-emerald-950/50 text-emerald-200 hover:bg-emerald-900/60',
  },
};

export const ORDERED_DESIGN_VARIANTS: readonly DesignSystemVariant[] = [
  'CYBER_AI',
  'INSTITUTIONAL_SLATE',
  'HIGH_CONTRAST_TERMINAL',
];

export function resolveStatusToneClasses(tone: WidgetStatusTone | undefined): string {
  switch (tone) {
    case 'NOMINAL':
      return 'text-emerald-400';
    case 'WARNING':
      return 'text-amber-300';
    case 'CRITICAL':
      return 'text-rose-400';
    case 'INFO':
      return 'text-cyan-300';
    default:
      return 'text-slate-200';
  }
}

export function resolveDensityPaddingClass(density: WidgetDensity): string {
  return density === 'COMPACT' ? 'px-4 py-3' : 'px-5 py-4';
}
