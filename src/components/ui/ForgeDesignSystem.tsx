import { Fragment, memo, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  DESIGN_SYSTEM_VARIANTS,
  MOTION_120HZ_SPRINGS,
  resolveDensityPaddingClass,
  resolveStatusToneClasses,
  type DesignSystemVariant,
  type WidgetDensity,
  type WidgetLayoutContract,
  type WidgetMetadataSegment,
  type WidgetMetricItem,
} from '../../lib/designSystem';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';

interface ForgeWidgetFrameProps {
  readonly layout: WidgetLayoutContract;
  readonly title: string;
  readonly icon?: ReactNode;
  readonly metadata?: readonly WidgetMetadataSegment[];
  readonly actions?: ReactNode;
  readonly children: ReactNode;
  readonly testId?: string;
  readonly className?: string;
  readonly variantOverride?: DesignSystemVariant;
  readonly densityOverride?: WidgetDensity;
}

/**
 * Strict, GPU-contained multi-design widget shell with 120Hz compositor-only motion
 * and zero-pill typographic metadata headers.
 */
export const ForgeWidgetFrame = memo(function ForgeWidgetFrame({
  layout,
  title,
  icon,
  metadata,
  actions,
  children,
  testId,
  className = '',
  variantOverride,
  densityOverride,
}: ForgeWidgetFrameProps) {
  const storeVariant = useWorkspaceStore((s) => s.cyber.designVariant);
  const storeDensity = useWorkspaceStore((s) => s.cyber.density);
  const pulseSyncStreams = useWorkspaceStore((s) => s.cyber.pulseSyncStreams);

  const variant = variantOverride ?? storeVariant;
  const density = densityOverride ?? layout.density ?? storeDensity;
  const spec = DESIGN_SYSTEM_VARIANTS[variant];
  const padClass = resolveDensityPaddingClass(density);

  return (
    <motion.section
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={MOTION_120HZ_SPRINGS.compositorFast}
      aria-label={layout.ariaLabel}
      data-testid={testId ?? `widget-${layout.widgetId}`}
      data-design-variant={variant}
      data-widget-density={density}
      className={`${spec.surfaceClass} overflow-hidden ${
        layout.gpuContain ? 'forge-widget-contain' : ''
      } ${className}`}
    >
      {layout.showStreamRail && pulseSyncStreams && (
        <div aria-hidden="true" className="cyber-stream-rail h-[2px] w-full bg-slate-900" />
      )}

      <div
        className={`flex flex-col gap-3 border-b ${spec.dividerClass} ${padClass} lg:flex-row lg:items-center lg:justify-between`}
      >
        <div className="min-w-0">
          {metadata && metadata.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
              {metadata.map((seg, idx) => (
                <Fragment key={seg.id}>
                  {idx > 0 && <span aria-hidden="true">·</span>}
                  <span
                    className={`font-mono tabular-nums ${
                      idx === 0 && !seg.tone
                        ? `${spec.accentTextClass} font-medium font-sans`
                        : resolveStatusToneClasses(seg.tone)
                    }`}
                  >
                    {seg.label}
                    {seg.value ? ` ${seg.value}` : ''}
                  </span>
                </Fragment>
              ))}
            </div>
          )}

          <h2 className="mt-1 font-display text-lg font-bold text-white tracking-tight flex items-center gap-2 text-balance">
            {icon}
            <span className="truncate">{title}</span>
          </h2>
        </div>

        {actions && <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>}
      </div>

      <div className={padClass}>{children}</div>
    </motion.section>
  );
});

export interface SegmentedOption<T extends string> {
  readonly value: T;
  readonly label: string;
  readonly testId?: string;
}

interface ForgeSegmentedControlProps<T extends string> {
  readonly ariaLabel: string;
  readonly layoutGroupId: string;
  readonly options: readonly SegmentedOption<T>[];
  readonly value: T;
  readonly onChange: (nextValue: T) => void;
  readonly variantOverride?: DesignSystemVariant;
}

/**
 * Strictly typed interactive segmented control with 120Hz shared-layout spring indicator.
 */
function ForgeSegmentedControlInner<T extends string>({
  ariaLabel,
  layoutGroupId,
  options,
  value,
  onChange,
  variantOverride,
}: ForgeSegmentedControlProps<T>) {
  const storeVariant = useWorkspaceStore((s) => s.cyber.designVariant);
  const spec = DESIGN_SYSTEM_VARIANTS[variantOverride ?? storeVariant];

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="inline-flex items-center gap-1 rounded-lg border border-slate-800 bg-[#050914] p-1 overflow-x-auto max-w-full"
    >
      {options.map((opt) => {
        const selected = opt.value === value;
        return (
          <motion.button
            key={opt.value}
            whileTap={{ scale: 0.97 }}
            type="button"
            role="tab"
            aria-selected={selected}
            data-testid={opt.testId}
            onClick={() => onChange(opt.value)}
            className={`relative px-3 py-1.5 rounded-md text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-cyan-400 ${
              selected ? spec.activeTabTextClass : 'text-slate-400 hover:text-white'
            }`}
          >
            {selected && (
              <motion.span
                layoutId={layoutGroupId}
                transition={MOTION_120HZ_SPRINGS.snappy}
                className={`absolute inset-0 rounded-md ${spec.activeTabBgClass}`}
                aria-hidden="true"
              />
            )}
            <span className="relative z-10">{opt.label}</span>
          </motion.button>
        );
      })}
    </div>
  );
}

export const ForgeSegmentedControl = memo(
  ForgeSegmentedControlInner
) as typeof ForgeSegmentedControlInner;

interface ForgeMetricStripProps {
  readonly items: readonly WidgetMetricItem[];
  readonly columns?: 2 | 3 | 4;
}

/**
 * Single-elevation tabular metric strip separated by hairline borders (no nested card clutter).
 */
export const ForgeMetricStrip = memo(function ForgeMetricStrip({
  items,
  columns = 4,
}: ForgeMetricStripProps) {
  const gridCols =
    columns === 2
      ? 'grid-cols-1 sm:grid-cols-2'
      : columns === 3
      ? 'grid-cols-1 sm:grid-cols-3'
      : 'grid-cols-2 lg:grid-cols-4';

  return (
    <div
      className={`grid ${gridCols} divide-y sm:divide-y-0 sm:divide-x divide-slate-800/80 border border-slate-800/80 rounded-lg bg-[#050914]/70`}
    >
      {items.map((item) => (
        <div key={item.id} className="px-4 py-3 min-w-0">
          <div className="text-[11px] font-medium text-slate-400 truncate">{item.label}</div>
          <div
            className={`mt-1 font-mono text-base font-bold tabular-nums truncate ${resolveStatusToneClasses(
              item.tone
            )}`}
          >
            {item.value}
          </div>
          {item.subtext && (
            <div className="mt-0.5 font-mono text-[11px] text-slate-400 tabular-nums truncate">
              {item.subtext}
            </div>
          )}
        </div>
      ))}
    </div>
  );
});

interface ForgeInteractiveButtonProps {
  readonly label: string;
  readonly icon?: ReactNode;
  readonly intent?: 'primary' | 'secondary' | 'ghost' | 'danger';
  readonly onClick: () => void;
  readonly disabled?: boolean;
  readonly ariaPressed?: boolean;
  readonly ariaExpanded?: boolean;
  readonly testId?: string;
}

export const ForgeInteractiveButton = memo(function ForgeInteractiveButton({
  label,
  icon,
  intent = 'secondary',
  onClick,
  disabled = false,
  ariaPressed,
  ariaExpanded,
  testId,
}: ForgeInteractiveButtonProps) {
  const storeVariant = useWorkspaceStore((s) => s.cyber.designVariant);
  const spec = DESIGN_SYSTEM_VARIANTS[storeVariant];

  const intentClass =
    intent === 'primary'
      ? spec.primaryButtonClass
      : intent === 'danger'
      ? 'border border-rose-500/40 bg-rose-500/15 text-rose-200 hover:bg-rose-500/25'
      : intent === 'ghost'
      ? 'border border-slate-800 bg-[#050914] text-slate-300 hover:border-slate-600 hover:text-white'
      : spec.secondaryButtonClass;

  return (
    <motion.button
      whileTap={disabled ? undefined : { scale: 0.97 }}
      transition={MOTION_120HZ_SPRINGS.snappy}
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-pressed={ariaPressed}
      aria-expanded={ariaExpanded}
      data-testid={testId}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-cyan-400 ${intentClass}`}
    >
      {icon}
      <span>{label}</span>
    </motion.button>
  );
});

interface ForgeAnimatedDrawerProps {
  readonly open: boolean;
  readonly drawerKey: string;
  readonly testId?: string;
  readonly children: ReactNode;
}

/**
 * Compositor-only (opacity + transform) animated drawer panel — zero height layout thrashing at 120Hz.
 */
export const ForgeAnimatedDrawer = memo(function ForgeAnimatedDrawer({
  open,
  drawerKey,
  testId,
  children,
}: ForgeAnimatedDrawerProps) {
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          key={drawerKey}
          initial={{ opacity: 0, y: -8, scaleY: 0.96 }}
          animate={{ opacity: 1, y: 0, scaleY: 1 }}
          exit={{ opacity: 0, y: -6, scaleY: 0.97 }}
          transition={MOTION_120HZ_SPRINGS.drawer}
          style={{ transformOrigin: 'top center' }}
          data-testid={testId}
          className="border-t border-slate-800/90 bg-[#050914]/95 px-4 py-4 sm:px-5 space-y-4"
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
});
