import { EventEmitter } from 'node:events';
import type { ConnectivityState, DeviceState, RealtimeEvent } from '@smartnest/shared';

export interface DeviceChangedEvent {
  homeId: string;
  deviceId: string;
  integrationId: string;
  prevState: DeviceState;
  state: DeviceState;
  prevConnectivity: ConnectivityState;
  connectivity: ConnectivityState;
  changedKeys: string[];
}

interface BusEvents {
  'device.changed': [DeviceChangedEvent];
  'integration.event': [{ homeId: string; integrationId: string; eventType: string; data: Record<string, unknown> }];
  /** Push to browsers. `userId` restricts delivery to one user's connections. */
  realtime: [RealtimeEvent, { userId?: string } | undefined];
}

class TypedBus extends EventEmitter<BusEvents> {}

/** In-process event bus connecting integrations, services, automations and the WebSocket hub. */
export const bus = new TypedBus();
bus.setMaxListeners(50);

export function pushRealtime(event: RealtimeEvent, opts?: { userId?: string }): void {
  bus.emit('realtime', event, opts);
}
