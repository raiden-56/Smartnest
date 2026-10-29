import type { Readable } from 'node:stream';
import type {
  Capability,
  CommandErrorCode,
  ConnectivityState,
  DeviceCategory,
  DeviceCommand,
  DeviceState,
  IntegrationDto,
  IntegrationType,
  NetworkDto,
} from '@smartnest/shared';
import type { Logger } from 'pino';

export type IntegrationStatus = IntegrationDto['status'];

/** A device (entity) as reported by an integration, before or after import. */
export interface AdapterDevice {
  externalId: string;
  name: string;
  category: DeviceCategory;
  deviceType: string | null;
  manufacturer: string | null;
  model: string | null;
  capabilities: Capability[];
  state: DeviceState;
  connectivity: ConnectivityState;
  suggestedRoom: string | null;
}

export interface AdapterDeviceUpdate {
  externalId: string;
  /** Partial state; merged with the last known state. Omitted keys are left untouched. */
  state?: DeviceState;
  /** Keys that the integration explicitly reports as no longer known. */
  clearKeys?: (keyof DeviceState)[];
  connectivity?: ConnectivityState;
  /** When the integration observed the change (falls back to now) */
  observedAt?: Date;
  /** Adapter-specific de-duplication key (e.g. HA last_updated). Repeated keys are dropped. */
  dedupeKey?: string;
}

export interface AdapterContext {
  integrationId: string;
  homeId: string;
  logger: Logger;
  onDeviceUpdate(update: AdapterDeviceUpdate): void;
  onStatusChange(status: IntegrationStatus, message?: string | null): void;
  onIntegrationEvent(eventType: string, data: Record<string, unknown>): void;
  /** Lets an adapter (e.g. Demo) restore persisted state on start. */
  loadImportedDevices(): Promise<{ externalId: string; state: DeviceState; connectivity: ConnectivityState }[]>;
}

export interface CameraMedia {
  contentType: string;
  stream: Readable;
}

export interface ExternalAutomation {
  externalId: string;
  name: string;
  enabled: boolean;
  lastTriggeredAt: string | null;
}

export type NetworkSnapshot = Omit<NetworkDto, 'available' | 'sources'>;

/**
 * Contract every integration implements. Optional methods are feature-gated:
 * the API returns a clear "not supported by this integration" error when absent.
 */
export interface IntegrationAdapter {
  readonly type: IntegrationType;
  /** Establish connection, authenticate and subscribe to events. Throws AdapterError. */
  connect(): Promise<void>;
  /** Close connections and stop timers. Must be idempotent. */
  disconnect(): Promise<void>;
  healthCheck(): Promise<{ ok: boolean; message?: string }>;
  /** List devices the integration exposes (does not import them). */
  discover(): Promise<AdapterDevice[]>;
  /** Read back the current state of one device from the source of truth. */
  readState(externalId: string): Promise<{ state: DeviceState; connectivity: ConnectivityState } | null>;
  /**
   * Send a command. Resolves when the integration acknowledged it — which is NOT
   * proof the device reached the requested state; the command service confirms via read-back.
   */
  executeCommand(externalId: string, command: DeviceCommand, capabilities: Capability[]): Promise<void>;
  getCameraSnapshot?(externalId: string): Promise<CameraMedia>;
  openCameraStream?(externalId: string, signal: AbortSignal): Promise<CameraMedia>;
  getNetworkSnapshot?(): Promise<NetworkSnapshot | null>;
  listAutomations?(): Promise<ExternalAutomation[]>;
  setAutomationEnabled?(externalId: string, enabled: boolean): Promise<void>;
  triggerAutomation?(externalId: string): Promise<void>;
}

export class AdapterError extends Error {
  constructor(
    public readonly code: CommandErrorCode,
    message: string,
    public readonly retryable = false,
  ) {
    super(message);
  }
}

export interface AdapterFactoryInput {
  integrationId: string;
  homeId: string;
  baseUrl: string | null;
  config: Record<string, unknown>;
  /** Decrypted secret, only available in-process. Never logged or returned. */
  secret: string | null;
  context: AdapterContext;
}
