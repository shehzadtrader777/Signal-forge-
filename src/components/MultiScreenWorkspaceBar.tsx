import { memo, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import {
  Activity,
  Cpu,
  Eye,
  EyeOff,
  Grid,
  Layers,
  Monitor,
  Palette,
  RotateCcw,
  SlidersHorizontal,
} from 'lucide-react';
import {
  WORKSPACE_PANEL_CATALOG,
  useWorkspaceStore,
  type MonitorId,
  type WorkspacePresetId,
} from '../store/useWorkspaceStore';
import {
  DESIGN_SYSTEM_VARIANTS,
  MOTION_120HZ_SPRINGS,
  ORDERED_DESIGN_VARIANTS,
  type DesignSystemVariant,
} from '../lib/designSystem';
import type { BackendExecutionPipelineSnapshot } from '../lib/executionPipeline';
import {
  ForgeAnimatedDrawer,
  ForgeInteractiveButton,
  ForgeSegmentedControl,
  type SegmentedOption,
} from './ui/ForgeDesignSystem';

interface MultiScreenWorkspaceBarProps {
  pipelineSnapshot: BackendExecutionPipelineSnapshot | null;
}

const MONITOR_OPTIONS: readonly SegmentedOption<MonitorId>[] = [
  { value: 'DISPLAY_1', label: 'Display 1 · Command', testId: 'monitor-tab-DISPLAY_1' },
  { value: 'DISPLAY_2', label: 'Display 2 · Execution', testId: 'monitor-tab-DISPLAY_2' },
  { value: 'DISPLAY_3', label: 'Display 3 · Intelligence', testId: 'monitor-tab-DISPLAY_3' },
];

// Keep motion prop identities stable across high-frequency market rerenders.
const PRESET_BTN_TAP = { scale: 0.96 } as const;
const PANEL_BTN_TAP = { scale: 0.97 } as const;

const BATCH_OPTIONS: Array<{ ms: 8 | 16 | 50 | 100; label: string }> = [
  { ms: 8, label: '120Hz (8ms)' },
  { ms: 16, label: '60Hz (16ms)' },
  { ms: 50, label: '20Hz (50ms)' },
  { ms: 100, label: '10Hz (100ms)' },
];

export const MultiScreenWorkspaceBar = memo(function MultiScreenWorkspaceBar({
  pipelineSnapshot,
}: MultiScreenWorkspaceBarProps) {
  const activeMonitorId = useWorkspaceStore((s) => s.activeMonitorId);
  const activeMonitor = useWorkspaceStore((s) => s.monitors[s.activeMonitorId]);
  const cyber = useWorkspaceStore((s) => s.cyber);
  const stateVersion = useWorkspaceStore((s) => s.stateVersion);
  const syncedPeersCount = useWorkspaceStore((s) => s.syncedPeersCount);
  const setActiveMonitor = useWorkspaceStore((s) => s.setActiveMonitor);
  const togglePanelVisibility = useWorkspaceStore((s) => s.togglePanelVisibility);
  const applyPreset = useWorkspaceStore((s) => s.applyPreset);
  const updateCyberSettings = useWorkspaceStore((s) => s.updateCyberSettings);
  const resetMonitors = useWorkspaceStore((s) => s.resetMonitors);

  const [drawerOpen, setDrawerOpen] = useState(false);

  const designVariantOptions: readonly SegmentedOption<DesignSystemVariant>[] = useMemo(
    () =>
      ORDERED_DESIGN_VARIANTS.map((variantId) => ({
        value: variantId,
        label: DESIGN_SYSTEM_VARIANTS[variantId].shortLabel,
        testId: `design-variant-${variantId}`,
      })),
    []
  );

  const visibleCount = Object.values(activeMonitor.panels).filter(Boolean).length;
  const totalCount = WORKSPACE_PANEL_CATALOG.length;
  const pulse = pipelineSnapshot?.aiActivityPulse;

  return (
    <section
      aria-label="Multi-Screen Workspace & Multi-Design Control Deck"
      data-testid="multiscreen-workspace-bar"
      className="cyber-surface forge-widget-contain rounded-xl border overflow-hidden"
    >
      {/* Top Pulse-Synchronized Stream Rail */}
      {cyber.pulseSyncStreams && (
        <div
          aria-hidden="true"
          className="cyber-stream-rail h-[2px] w-full bg-slate-900"
        />
      )}

      <div className="px-4 py-3 sm:px-5 space-y-2.5">
        {/* Tier 1: Multi-Screen Display Switcher & Primary Panel Matrix Trigger */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5 min-w-0">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-cyan-300 shrink-0">
              <Monitor className="h-4 w-4 text-cyan-400" aria-hidden="true" />
              <span>Multi-Screen</span>
            </div>

            <ForgeSegmentedControl
              ariaLabel="Monitor Display Profiles"
              layoutGroupId="active-monitor-tab-bg"
              options={MONITOR_OPTIONS}
              value={activeMonitorId}
              onChange={setActiveMonitor}
            />

            <span className="font-mono text-[11px] text-slate-400 tabular-nums whitespace-nowrap">
              {visibleCount}/{totalCount} modules · v{stateVersion} · {syncedPeersCount} display
              {syncedPeersCount > 1 ? 's' : ''}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {cyber.aiActivityIndicators && (
              <div className="inline-flex items-center gap-2 rounded-lg border border-cyan-500/25 bg-[#050914] px-3 py-1.5 text-[11px] font-mono tabular-nums text-slate-300">
                <Cpu className="h-3.5 w-3.5 text-cyan-400 cyber-ai-wave shrink-0" aria-hidden="true" />
                <span>
                  Backend AI {pulse?.activeModels ?? 5} models ·{' '}
                  {pulse ? `${pulse.avgPipelineLatencyMs}ms` : '1.4ms'} · Epoch{' '}
                  {pipelineSnapshot?.pipelineEpoch ?? 0}
                </span>
              </div>
            )}

            <ForgeInteractiveButton
              label={drawerOpen ? 'Hide Panels' : 'Customize Panels'}
              icon={<SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />}
              intent="primary"
              ariaExpanded={drawerOpen}
              testId="toggle-multiscreen-matrix-btn"
              onClick={() => setDrawerOpen((prev) => !prev)}
            />
          </div>
        </div>

        {/* Tier 2: Multi-Design Theme Variants, Density & 120Hz Compositor Controls */}
        <div className="flex flex-wrap items-center justify-between gap-2.5 border-t border-slate-800/75 pt-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center gap-1.5 text-xs text-slate-400">
              <Palette className="h-3.5 w-3.5 text-cyan-400" aria-hidden="true" />
              <span className="hidden sm:inline font-medium">Design Set</span>
            </div>
            <ForgeSegmentedControl
              ariaLabel="Multi-Design Theme Variant"
              layoutGroupId="active-design-variant-bg"
              options={designVariantOptions}
              value={cyber.designVariant}
              onChange={(nextVariant) => updateCyberSettings({ designVariant: nextVariant })}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <ForgeInteractiveButton
              label={cyber.density === 'COMPACT' ? 'Compact' : 'Standard'}
              intent="ghost"
              ariaPressed={cyber.density === 'COMPACT'}
              testId="toggle-widget-density-btn"
              onClick={() =>
                updateCyberSettings({
                  density: cyber.density === 'COMPACT' ? 'STANDARD' : 'COMPACT',
                })
              }
            />

            <ForgeInteractiveButton
              label="Neon Grid"
              icon={<Grid className="h-3.5 w-3.5" aria-hidden="true" />}
              intent={cyber.neonGridOverlay ? 'secondary' : 'ghost'}
              ariaPressed={cyber.neonGridOverlay}
              onClick={() => updateCyberSettings({ neonGridOverlay: !cyber.neonGridOverlay })}
            />

            <ForgeInteractiveButton
              label="Pulse Sync"
              icon={<Activity className="h-3.5 w-3.5" aria-hidden="true" />}
              intent={cyber.pulseSyncStreams ? 'secondary' : 'ghost'}
              ariaPressed={cyber.pulseSyncStreams}
              onClick={() => updateCyberSettings({ pulseSyncStreams: !cyber.pulseSyncStreams })}
            />

            <select
              aria-label="WebSocket batch frame cadence"
              value={cyber.wsBatchIntervalMs}
              onChange={(e) =>
                updateCyberSettings({
                  wsBatchIntervalMs: Number(e.target.value) as 8 | 16 | 50 | 100,
                })
              }
              className="rounded-lg border border-slate-700 bg-[#050914] px-2.5 py-2 text-xs font-mono text-cyan-200 focus:border-cyan-400 focus:outline-none cursor-pointer"
            >
              {BATCH_OPTIONS.map((opt) => (
                <option key={opt.ms} value={opt.ms}>
                  Batch {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Compositor-Only (transform + opacity) Independent Per-Monitor Panel Matrix */}
      <ForgeAnimatedDrawer
        open={drawerOpen}
        drawerKey="multiscreen-matrix-drawer"
        testId="multiscreen-panel-matrix"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs text-slate-300">
            <Layers className="h-3.5 w-3.5 text-cyan-400" aria-hidden="true" />
            <span>
              Independent Visibility for <strong className="text-white">{activeMonitor.name}</strong>{' '}
              — {activeMonitor.role}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {(
              [
                { id: 'FULL_COMMAND', label: 'All Panels' },
                { id: 'EXECUTION_120HZ', label: '120Hz Execution' },
                { id: 'SIGNALS_AND_PREPUMP', label: 'Signals & Pre-Pump' },
                { id: 'TELEMETRY_OPS', label: 'Telemetry Ops' },
              ] as Array<{ id: WorkspacePresetId; label: string }>
            ).map((preset) => (
              <motion.button
                key={preset.id}
                whileTap={PRESET_BTN_TAP}
                transition={MOTION_120HZ_SPRINGS.snappy}
                type="button"
                onClick={() => applyPreset(preset.id)}
                className="rounded-md border border-slate-700 bg-[#0b1224] px-2.5 py-1 text-[11px] font-medium text-slate-200 hover:border-cyan-400 hover:text-cyan-200 transition-colors cursor-pointer whitespace-nowrap"
              >
                {preset.label}
              </motion.button>
            ))}
            <motion.button
              whileTap={PRESET_BTN_TAP}
              transition={MOTION_120HZ_SPRINGS.snappy}
              type="button"
              onClick={() => resetMonitors()}
              className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-[#0b1224] px-2.5 py-1 text-[11px] font-medium text-slate-400 hover:text-white transition-colors cursor-pointer whitespace-nowrap"
            >
              <RotateCcw className="h-3 w-3" aria-hidden="true" />
              <span>Reset</span>
            </motion.button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {WORKSPACE_PANEL_CATALOG.map((panel) => {
            const visible = activeMonitor.panels[panel.key];
            return (
              <motion.button
                key={panel.key}
                whileTap={PANEL_BTN_TAP}
                transition={MOTION_120HZ_SPRINGS.snappy}
                type="button"
                onClick={() => togglePanelVisibility(panel.key)}
                aria-pressed={visible}
                className={`flex items-center justify-between gap-2 rounded-lg border px-2.5 py-2 text-left text-xs transition-colors cursor-pointer ${
                  visible
                    ? 'border-cyan-500/40 bg-cyan-500/10 text-white'
                    : 'border-slate-800 bg-[#0b1224] text-slate-500 hover:text-slate-300'
                }`}
              >
                <span className="truncate font-medium">{panel.label}</span>
                {visible ? (
                  <Eye className="h-3.5 w-3.5 text-cyan-400 shrink-0" aria-hidden="true" />
                ) : (
                  <EyeOff className="h-3.5 w-3.5 text-slate-600 shrink-0" aria-hidden="true" />
                )}
              </motion.button>
            );
          })}
        </div>
      </ForgeAnimatedDrawer>
    </section>
  );
});

