import { configureStore, createSlice, nanoid, type PayloadAction } from '@reduxjs/toolkit';
import { useDispatch, useSelector, type TypedUseSelectorHook } from 'react-redux';
import type { CommandDto, DeviceDto, SceneExecutionDto } from '@smartnest/shared';
import { api } from '../api/api';

const HOME_KEY = 'smartnest.currentHome';
const SIDEBAR_KEY = 'smartnest.sidebarCollapsed';
const safeGet = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const safeSet = (k: string, v: string | null) => {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    /* storage unavailable */
  }
};

// ─── UI ─────────────────────────────────────────────────────────────────

export type RealtimeStatus = 'connecting' | 'live' | 'reconnecting' | 'offline';

interface UiState {
  currentHomeId: string | null;
  sidebarCollapsed: boolean;
  realtime: RealtimeStatus;
  searchOpen: boolean;
  /** Guided product tour and the feature guide dialog */
  tourOpen: boolean;
  guideOpen: boolean;
}

const uiSlice = createSlice({
  name: 'ui',
  initialState: { currentHomeId: safeGet(HOME_KEY), sidebarCollapsed: safeGet(SIDEBAR_KEY) === '1', realtime: 'connecting', searchOpen: false, tourOpen: false, guideOpen: false } as UiState,
  reducers: {
    setCurrentHome(s, a: PayloadAction<string | null>) {
      s.currentHomeId = a.payload;
      safeSet(HOME_KEY, a.payload);
    },
    toggleSidebar(s) {
      s.sidebarCollapsed = !s.sidebarCollapsed;
      safeSet(SIDEBAR_KEY, s.sidebarCollapsed ? '1' : '0');
    },
    setRealtime(s, a: PayloadAction<RealtimeStatus>) {
      s.realtime = a.payload;
    },
    setSearchOpen(s, a: PayloadAction<boolean>) {
      s.searchOpen = a.payload;
    },
    setTourOpen(s, a: PayloadAction<boolean>) {
      s.tourOpen = a.payload;
    },
    setGuideOpen(s, a: PayloadAction<boolean>) {
      s.guideOpen = a.payload;
    },
  },
});

// ─── Live state pushed by the server ────────────────────────────────────

interface LiveState {
  devices: Record<string, DeviceDto>;
  removedDevices: Record<string, true>;
  commands: Record<string, CommandDto>;
  latestCommandByDevice: Record<string, string>;
  sceneExecutions: Record<string, SceneExecutionDto>;
  cameraViewers: Record<string, number>;
}

const liveSlice = createSlice({
  name: 'live',
  initialState: { devices: {}, removedDevices: {}, commands: {}, latestCommandByDevice: {}, sceneExecutions: {}, cameraViewers: {} } as LiveState,
  reducers: {
    deviceUpdated(s, a: PayloadAction<DeviceDto>) {
      s.devices[a.payload.id] = a.payload;
      delete s.removedDevices[a.payload.id];
    },
    deviceRemoved(s, a: PayloadAction<string>) {
      delete s.devices[a.payload];
      s.removedDevices[a.payload] = true;
    },
    commandUpdated(s, a: PayloadAction<CommandDto>) {
      s.commands[a.payload.id] = a.payload;
      s.latestCommandByDevice[a.payload.deviceId] = a.payload.id;
    },
    sceneExecutionUpdated(s, a: PayloadAction<SceneExecutionDto>) {
      s.sceneExecutions[a.payload.id] = a.payload;
    },
    cameraViewers(s, a: PayloadAction<{ deviceId: string; count: number }>) {
      s.cameraViewers[a.payload.deviceId] = a.payload.count;
    },
    resetLive() {
      return { devices: {}, removedDevices: {}, commands: {}, latestCommandByDevice: {}, sceneExecutions: {}, cameraViewers: {} };
    },
  },
  extraReducers: (builder) => {
    // Fresh query results also refresh the live cache, so the newest data always wins.
    builder.addMatcher(api.endpoints.devices.matchFulfilled, (s, a) => {
      for (const d of a.payload.items) s.devices[d.id] = d;
    });
    builder.addMatcher(api.endpoints.device.matchFulfilled, (s, a) => {
      s.devices[a.payload.device.id] = a.payload.device;
    });
    builder.addMatcher(api.endpoints.sendCommand.matchFulfilled, (s, a) => {
      const c = a.payload.command;
      if (!s.commands[c.id]) s.commands[c.id] = c;
      s.latestCommandByDevice[c.deviceId] = c.id;
    });
  },
});

// ─── Toasts & screen-reader announcements ───────────────────────────────

export interface Toast {
  id: string;
  message: string;
  severity: 'success' | 'info' | 'warning' | 'error';
  action?: { label: string; href: string };
}

const feedbackSlice = createSlice({
  name: 'feedback',
  initialState: { toasts: [] as Toast[], announcement: '' },
  reducers: {
    pushToast: {
      reducer(s, a: PayloadAction<Toast>) {
        s.toasts = [...s.toasts.slice(-3), a.payload];
      },
      prepare(t: Omit<Toast, 'id'>) {
        return { payload: { ...t, id: nanoid() } };
      },
    },
    dismissToast(s, a: PayloadAction<string>) {
      s.toasts = s.toasts.filter((t) => t.id !== a.payload);
    },
    announce(s, a: PayloadAction<string>) {
      // A trailing zero-width space forces repeated identical messages to be re-read
      s.announcement = s.announcement === a.payload ? `${a.payload}​` : a.payload;
    },
  },
});

export const { setCurrentHome, toggleSidebar, setRealtime, setSearchOpen, setTourOpen, setGuideOpen } = uiSlice.actions;
export const { deviceUpdated, deviceRemoved, commandUpdated, sceneExecutionUpdated, cameraViewers, resetLive } = liveSlice.actions;
export const { pushToast, dismissToast, announce } = feedbackSlice.actions;

export const store = configureStore({
  reducer: {
    [api.reducerPath]: api.reducer,
    ui: uiSlice.reducer,
    live: liveSlice.reducer,
    feedback: feedbackSlice.reducer,
  },
  middleware: (gdm) => gdm().concat(api.middleware),
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
export const useAppDispatch: () => AppDispatch = useDispatch;
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector;

/** The freshest known version of a device: live (WebSocket) data if present, else what the caller fetched. */
export function useLiveDevice(device: DeviceDto): DeviceDto;
export function useLiveDevice(device: DeviceDto | undefined): DeviceDto | undefined;
export function useLiveDevice(device: DeviceDto | undefined): DeviceDto | undefined {
  return useAppSelector((s) => (device ? (s.live.devices[device.id] ?? device) : undefined));
}

export function useLiveDevices(devices: DeviceDto[] | undefined): DeviceDto[] {
  const live = useAppSelector((s) => s.live.devices);
  const removed = useAppSelector((s) => s.live.removedDevices);
  return (devices ?? []).filter((d) => !removed[d.id]).map((d) => live[d.id] ?? d);
}
