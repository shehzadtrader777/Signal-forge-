import { create } from 'zustand';
import {
  applyCommandPreset,
  createDefaultCommandControlState,
  sanitizeCommandControlState,
  setDomainMasterOverride,
  setGlobalMasterOverride,
  setModuleGranularToggle,
  updateDockPreferences,
  type CommandControlHubState,
  type CommandDomainId,
  type CommandPresetId,
  type DockPreferences,
  type GlobalMasterOverride,
  type MasterOverrideMode,
} from '../lib/commandControlHub';

const STORAGE_KEY = 'signal_forge_command_control_hub_v1';
const BROADCAST_CHANNEL_NAME = 'signal_forge_command_control_sync_v1';
const TAB_ID = `sf_cch_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

interface CommandControlSyncEnvelope {
  originTabId: string;
  hub: CommandControlHubState;
}

let syncChannel: BroadcastChannel | null = null;

function getSyncChannel(): BroadcastChannel | null {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return null;
  if (!syncChannel) {
    syncChannel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
  }
  return syncChannel;
}

function loadInitialHubState(): CommandControlHubState {
  if (typeof window === 'undefined') {
    return createDefaultCommandControlState();
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return createDefaultCommandControlState();
    const parsed = JSON.parse(raw) as unknown;
    return sanitizeCommandControlState(parsed);
  } catch {
    return createDefaultCommandControlState();
  }
}

function persistAndBroadcast(hub: CommandControlHubState): void {
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(hub));
    } catch {
      // ignore storage quota errors
    }
  }
  try {
    const envelope: CommandControlSyncEnvelope = { originTabId: TAB_ID, hub };
    getSyncChannel()?.postMessage(envelope);
  } catch {
    // ignore channel closed errors
  }
}

export interface CommandControlStoreState {
  hub: CommandControlHubState;
  voiceOverlayOpen: boolean;
  setVoiceOverlayOpen: (open: boolean) => void;
  toggleVoiceOverlay: () => void;
  setGlobalOverride: (mode: GlobalMasterOverride) => CommandControlHubState;
  setDomainOverride: (domain: CommandDomainId, mode: MasterOverrideMode) => CommandControlHubState;
  setGranularToggle: (moduleId: string, enabled: boolean) => CommandControlHubState;
  applyPreset: (preset: CommandPresetId) => CommandControlHubState;
  updateDock: (patch: Partial<DockPreferences>) => CommandControlHubState;
  resetHubToDefaults: () => CommandControlHubState;
}

export const useCommandControlStore = create<CommandControlStoreState>((set, get) => ({
  hub: loadInitialHubState(),
  voiceOverlayOpen: false,

  setVoiceOverlayOpen: (open) => set({ voiceOverlayOpen: open }),

  toggleVoiceOverlay: () => set((s) => ({ voiceOverlayOpen: !s.voiceOverlayOpen })),

  setGlobalOverride: (mode) => {
    const next = setGlobalMasterOverride(get().hub, mode);
    persistAndBroadcast(next);
    set({ hub: next });
    return next;
  },

  setDomainOverride: (domain, mode) => {
    const next = setDomainMasterOverride(get().hub, domain, mode);
    persistAndBroadcast(next);
    set({ hub: next });
    return next;
  },

  setGranularToggle: (moduleId, enabled) => {
    const next = setModuleGranularToggle(get().hub, moduleId, enabled);
    persistAndBroadcast(next);
    set({ hub: next });
    return next;
  },

  applyPreset: (preset) => {
    const next = applyCommandPreset(get().hub, preset);
    persistAndBroadcast(next);
    set({ hub: next });
    return next;
  },

  updateDock: (patch) => {
    const next = updateDockPreferences(get().hub, patch);
    persistAndBroadcast(next);
    set({ hub: next });
    return next;
  },

  resetHubToDefaults: () => {
    const next = createDefaultCommandControlState();
    persistAndBroadcast(next);
    set({ hub: next });
    return next;
  },
}));

if (typeof window !== 'undefined') {
  const ch = getSyncChannel();
  if (ch) {
    ch.onmessage = (event: MessageEvent<CommandControlSyncEnvelope>) => {
      const msg = event.data;
      if (!msg || msg.originTabId === TAB_ID || !msg.hub) return;
      const current = useCommandControlStore.getState().hub;
      if (msg.hub.stateVersion <= current.stateVersion) return;
      useCommandControlStore.setState({
        hub: sanitizeCommandControlState(msg.hub),
      });
    };
  }
}
