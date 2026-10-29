import type { Integration } from '@prisma/client';
import type { DiscoveredDeviceDto, IntegrationType } from '@smartnest/shared';
import { prisma } from '../db.js';
import { decryptSecret, encryptSecret } from '../lib/crypto.js';
import { deviceInclude, json, toDeviceDto, toIntegrationDto } from '../lib/dto.js';
import { AppError, badRequest, notFound } from '../lib/errors.js';
import { logger } from '../logger.js';
import { recordActivity } from '../services/activity.js';
import { bus, pushRealtime } from '../services/bus.js';
import { ingestDeviceUpdate, markIntegrationDevicesUnknown } from '../services/deviceState.js';
import { notifyHome } from '../services/notifications.js';
import { DemoAdapter } from './demo/DemoAdapter.js';
import { HomeAssistantAdapter } from './homeassistant/HomeAssistantAdapter.js';
import { AdapterError, type AdapterContext, type AdapterDevice, type AdapterFactoryInput, type IntegrationAdapter, type IntegrationStatus } from './types.js';

type Factory = (input: AdapterFactoryInput) => IntegrationAdapter;

/** Adapter registry — add new integration types here. */
const FACTORIES: Partial<Record<IntegrationType, Factory>> = {
  demo: (i) => new DemoAdapter(i),
  home_assistant: (i) => new HomeAssistantAdapter(i),
};

export function isImplemented(type: IntegrationType): boolean {
  return !!FACTORIES[type];
}

const MAX_RETRY_MS = 5 * 60_000;

class IntegrationManager {
  private adapters = new Map<string, IntegrationAdapter>();
  private retryTimers = new Map<string, NodeJS.Timeout>();
  private retryAttempts = new Map<string, number>();
  private lastStatus = new Map<string, IntegrationStatus>();
  /** Overrides used by tests (e.g. faster demo simulation) */
  demoConfig: Record<string, unknown> = {};

  /** Start every integration that isn't explicitly disconnected. */
  async startAll(): Promise<void> {
    const integrations = await prisma.integration.findMany({ where: { NOT: { status: 'disconnected' } } });
    await Promise.all(integrations.map((i) => this.start(i).catch(() => undefined)));
  }

  async stopAll(): Promise<void> {
    for (const t of this.retryTimers.values()) clearTimeout(t);
    this.retryTimers.clear();
    await Promise.all([...this.adapters.values()].map((a) => a.disconnect().catch(() => undefined)));
    this.adapters.clear();
  }

  get(integrationId: string): IntegrationAdapter {
    const a = this.adapters.get(integrationId);
    if (!a) throw new AdapterError('integration_disconnected', 'This integration is not connected.');
    return a;
  }

  tryGet(integrationId: string): IntegrationAdapter | undefined {
    return this.adapters.get(integrationId);
  }

  private makeContext(integration: Pick<Integration, 'id' | 'homeId' | 'type' | 'name'>): AdapterContext {
    return {
      integrationId: integration.id,
      homeId: integration.homeId,
      logger: logger.child({ integration: integration.id, type: integration.type }),
      onDeviceUpdate: (u) => void ingestDeviceUpdate(integration.id, u),
      onStatusChange: (status, message) => void this.setStatus(integration.id, status, message ?? null),
      onIntegrationEvent: (eventType, data) => bus.emit('integration.event', { homeId: integration.homeId, integrationId: integration.id, eventType, data }),
      loadImportedDevices: async () =>
        (await prisma.device.findMany({ where: { integrationId: integration.id }, select: { externalId: true, state: true, connectivity: true } })).map((d) => ({
          externalId: d.externalId,
          state: d.state as never,
          connectivity: d.connectivity as never,
        })),
    };
  }

  private build(integration: Integration, secretOverride?: string | null): IntegrationAdapter {
    const factory = FACTORIES[integration.type as IntegrationType];
    if (!factory) throw new AdapterError('unsupported_capability', `The ${integration.type} integration is not available in this build.`);
    return factory({
      integrationId: integration.id,
      homeId: integration.homeId,
      baseUrl: integration.baseUrl,
      config: { ...(integration.config as Record<string, unknown>), ...(integration.type === 'demo' ? this.demoConfig : {}) },
      secret: secretOverride ?? null,
      context: this.makeContext(integration),
    });
  }

  private async loadSecret(integrationId: string): Promise<string | null> {
    const cred = await prisma.integrationCredentialReference.findUnique({ where: { integrationId } });
    if (!cred) return null;
    try {
      return decryptSecret(cred.ciphertext);
    } catch {
      // Key changed (e.g. dev ephemeral key) — the user must re-enter the credential.
      return null;
    }
  }

  async start(integration: Integration): Promise<void> {
    await this.stop(integration.id);
    const secret = await this.loadSecret(integration.id);
    let adapter: IntegrationAdapter;
    try {
      adapter = this.build(integration, secret);
    } catch (e) {
      const err = e as AdapterError;
      await this.setStatus(integration.id, err.code === 'integration_auth_failed' ? 'auth_failed' : 'error', err.message);
      throw e;
    }
    this.adapters.set(integration.id, adapter);
    try {
      await adapter.connect();
      this.retryAttempts.delete(integration.id);
      if (integration.type === 'home_assistant') void this.syncExternalAutomations(integration.id).catch(() => undefined);
    } catch (e) {
      const err = e instanceof AdapterError ? e : new AdapterError('integration_error', (e as Error).message, true);
      await adapter.disconnect().catch(() => undefined);
      this.adapters.delete(integration.id);
      await this.setStatus(integration.id, err.code === 'integration_auth_failed' ? 'auth_failed' : 'error', err.message);
      if (err.retryable) this.scheduleRetry(integration.id);
      throw err;
    }
  }

  private scheduleRetry(integrationId: string): void {
    if (this.retryTimers.has(integrationId)) return;
    const attempt = (this.retryAttempts.get(integrationId) ?? 0) + 1;
    this.retryAttempts.set(integrationId, attempt);
    const delay = Math.min(MAX_RETRY_MS, 5000 * 2 ** (attempt - 1));
    const t = setTimeout(async () => {
      this.retryTimers.delete(integrationId);
      const integ = await prisma.integration.findUnique({ where: { id: integrationId } });
      if (!integ || integ.status === 'disconnected' || integ.status === 'auth_failed') return;
      await this.start(integ).catch(() => undefined);
    }, delay);
    t.unref?.();
    this.retryTimers.set(integrationId, t);
  }

  async stop(integrationId: string): Promise<void> {
    const t = this.retryTimers.get(integrationId);
    if (t) clearTimeout(t);
    this.retryTimers.delete(integrationId);
    const a = this.adapters.get(integrationId);
    this.adapters.delete(integrationId);
    if (a) await a.disconnect().catch(() => undefined);
  }

  async setStatus(integrationId: string, status: IntegrationStatus, message: string | null): Promise<void> {
    const prev = this.lastStatus.get(integrationId);
    this.lastStatus.set(integrationId, status);
    const integ = await prisma.integration
      .update({
        where: { id: integrationId },
        data: { status, statusMessage: message, ...(status === 'connected' ? { lastConnectedAt: new Date(), lastSyncAt: new Date() } : {}) },
      })
      .catch(() => null);
    if (!integ) return;
    await this.pushIntegration(integrationId);
    if (prev === status) return;

    if (status !== 'connected' && status !== 'connecting') await markIntegrationDevicesUnknown(integrationId);
    if (prev === 'connected' && status === 'connecting') await markIntegrationDevicesUnknown(integrationId);

    if (status === 'connected' && prev && prev !== 'connected') {
      await recordActivity({ homeId: integ.homeId, type: 'integration.connected', title: `${integ.name} connected`, severity: 'success', source: 'integration', isDemo: integ.isDemo });
    }
    if (status === 'error' || status === 'auth_failed') {
      await recordActivity({ homeId: integ.homeId, type: 'integration.error', title: `${integ.name}: ${status === 'auth_failed' ? 'authentication failed' : 'connection problem'}`, detail: message, severity: 'warning', result: 'failure', source: 'integration', isDemo: integ.isDemo });
      await notifyHome({
        homeId: integ.homeId,
        category: 'integrationFailures',
        title: `${integ.name} needs attention`,
        body: message ?? 'The integration reported an error.',
        severity: 'warning',
        link: `/integrations/${integ.id}`,
      });
    }
  }

  async pushIntegration(integrationId: string): Promise<void> {
    const dto = await this.getDto(integrationId).catch(() => null);
    if (dto) pushRealtime({ type: 'integration.updated', homeId: dto.homeId, integration: dto.dto });
  }

  async getDto(integrationId: string) {
    const integ = await prisma.integration.findUniqueOrThrow({ where: { id: integrationId } });
    const [devices, discovered, imported] = await Promise.all([
      prisma.device.count({ where: { integrationId } }),
      prisma.discoveredEntity.findMany({ where: { integrationId }, select: { externalId: true } }),
      prisma.device.findMany({ where: { integrationId }, select: { externalId: true } }),
    ]);
    const importedSet = new Set(imported.map((d) => d.externalId));
    return { homeId: integ.homeId, dto: toIntegrationDto(integ, { devices, discoveredNotImported: discovered.filter((d) => !importedSet.has(d.externalId)).length }) };
  }

  // ─── Setup flows ────────────────────────────────────────────────────────

  /**
   * Verify a Home Assistant connection with a temporary adapter before
   * persisting anything — a failed connection is never saved as "connected".
   */
  async connectHomeAssistant(homeId: string, input: { name: string; baseUrl: string; accessToken: string }, existingId?: string): Promise<Integration> {
    const baseUrl = input.baseUrl.replace(/\/+$/, '');
    const probeIntegration = { id: existingId ?? 'probe', homeId, type: 'home_assistant', name: input.name };
    const probe = new HomeAssistantAdapter({
      integrationId: probeIntegration.id,
      homeId,
      baseUrl,
      config: {},
      secret: input.accessToken,
      context: { ...this.makeContext(probeIntegration), onDeviceUpdate: () => undefined, onStatusChange: () => undefined },
    });
    let discovered: AdapterDevice[];
    try {
      await probe.connect();
      discovered = await probe.discover();
    } catch (e) {
      const err = e as AdapterError;
      throw new AppError(err.code === 'integration_auth_failed' ? 401 : 502, err.code ?? 'integration_error', err.message || 'Could not connect to Home Assistant.');
    } finally {
      await probe.disconnect();
    }

    const integration = existingId
      ? await prisma.integration.update({ where: { id: existingId }, data: { name: input.name, baseUrl, status: 'connecting', statusMessage: null, disconnectedAt: null } })
      : await prisma.integration.create({ data: { homeId, type: 'home_assistant', name: input.name, baseUrl, status: 'connecting' } });
    await prisma.integrationCredentialReference.upsert({
      where: { integrationId: integration.id },
      create: { integrationId: integration.id, kind: 'long_lived_token', ciphertext: encryptSecret(input.accessToken) },
      update: { ciphertext: encryptSecret(input.accessToken), rotatedAt: new Date() },
    });
    await this.saveDiscovery(integration.id, discovered);
    await this.start(integration).catch(() => undefined);
    return prisma.integration.findUniqueOrThrow({ where: { id: integration.id } });
  }

  async createDemo(homeId: string): Promise<Integration> {
    const existing = await prisma.integration.findFirst({ where: { homeId, type: 'demo' } });
    if (existing) {
      if (existing.status === 'disconnected') await prisma.integration.update({ where: { id: existing.id }, data: { status: 'connecting', disconnectedAt: null } });
      await this.start({ ...existing, status: 'connecting' }).catch(() => undefined);
      return existing;
    }
    const integ = await prisma.integration.create({ data: { homeId, type: 'demo', name: 'Demonstration home', isDemo: true, status: 'connecting' } });
    await this.start(integ);
    return integ;
  }

  async discover(integrationId: string): Promise<DiscoveredDeviceDto[]> {
    const adapter = this.get(integrationId);
    const devices = await adapter.discover();
    await this.saveDiscovery(integrationId, devices);
    await prisma.integration.update({ where: { id: integrationId }, data: { lastSyncAt: new Date() } });
    await this.pushIntegration(integrationId);
    return this.listDiscovered(integrationId);
  }

  private async saveDiscovery(integrationId: string, devices: AdapterDevice[]): Promise<void> {
    await prisma.$transaction([
      prisma.discoveredEntity.deleteMany({ where: { integrationId, externalId: { notIn: devices.map((d) => d.externalId) } } }),
      ...devices.map((d) =>
        prisma.discoveredEntity.upsert({
          where: { integrationId_externalId: { integrationId, externalId: d.externalId } },
          create: {
            integrationId, externalId: d.externalId, name: d.name, category: d.category, deviceType: d.deviceType, manufacturer: d.manufacturer, model: d.model,
            capabilities: json(d.capabilities), connectivity: d.connectivity, suggestedRoom: d.suggestedRoom,
          },
          update: {
            name: d.name, category: d.category, deviceType: d.deviceType, manufacturer: d.manufacturer, model: d.model,
            capabilities: json(d.capabilities), connectivity: d.connectivity, suggestedRoom: d.suggestedRoom, discoveredAt: new Date(),
          },
        }),
      ),
    ]);
  }

  async listDiscovered(integrationId: string): Promise<DiscoveredDeviceDto[]> {
    const [rows, imported] = await Promise.all([
      prisma.discoveredEntity.findMany({ where: { integrationId }, orderBy: { name: 'asc' } }),
      prisma.device.findMany({ where: { integrationId }, select: { id: true, externalId: true } }),
    ]);
    const map = new Map(imported.map((d) => [d.externalId, d.id]));
    return rows.map((r) => ({
      externalId: r.externalId,
      name: r.name,
      category: r.category as DiscoveredDeviceDto['category'],
      deviceType: r.deviceType,
      manufacturer: r.manufacturer,
      model: r.model,
      capabilities: r.capabilities as DiscoveredDeviceDto['capabilities'],
      connectivity: r.connectivity as DiscoveredDeviceDto['connectivity'],
      suggestedRoom: r.suggestedRoom,
      alreadyImported: map.has(r.externalId),
      importedDeviceId: map.get(r.externalId) ?? null,
    }));
  }

  /**
   * Import selected discovered entities as devices, then test each one by
   * reading its state back from the integration.
   */
  async importDevices(
    integrationId: string,
    selections: { externalId: string; name: string; roomId: string | null; category?: string }[],
    extraMetadata: (externalId: string) => Record<string, unknown> = () => ({}),
  ) {
    const integ = await prisma.integration.findUniqueOrThrow({ where: { id: integrationId } });
    const rooms = await prisma.room.findMany({ where: { homeId: integ.homeId }, select: { id: true } });
    const roomIds = new Set(rooms.map((r) => r.id));
    const results: { externalId: string; deviceId: string | null; status: 'imported' | 'already_imported' | 'not_found'; connectivity: string | null; tested: boolean; message: string | null }[] = [];
    const adapter = this.tryGet(integrationId);

    for (const sel of selections) {
      const disc = await prisma.discoveredEntity.findUnique({ where: { integrationId_externalId: { integrationId, externalId: sel.externalId } } });
      if (!disc) {
        results.push({ externalId: sel.externalId, deviceId: null, status: 'not_found', connectivity: null, tested: false, message: 'Not found in the latest discovery. Run discovery again.' });
        continue;
      }
      const existing = await prisma.device.findUnique({ where: { integrationId_externalId: { integrationId, externalId: sel.externalId } } });
      if (existing) {
        results.push({ externalId: sel.externalId, deviceId: existing.id, status: 'already_imported', connectivity: existing.connectivity, tested: false, message: null });
        continue;
      }
      if (sel.roomId && !roomIds.has(sel.roomId)) throw badRequest('One of the selected rooms does not belong to this home.');
      const caps = disc.capabilities as { type: string }[];
      let state = {};
      let connectivity = disc.connectivity;
      let tested = false;
      let message: string | null = null;
      if (adapter) {
        try {
          const read = await adapter.readState(sel.externalId);
          if (read) {
            state = read.state;
            connectivity = read.connectivity;
            tested = true;
          } else message = 'The integration no longer reports this device.';
        } catch (e) {
          message = (e as Error).message;
          connectivity = 'unknown';
        }
      } else {
        message = 'Integration is not connected; state will update when it reconnects.';
        connectivity = 'unknown';
      }
      const device = await prisma.device.create({
        data: {
          homeId: integ.homeId,
          integrationId,
          externalId: sel.externalId,
          name: sel.name,
          category: sel.category ?? disc.category,
          deviceType: disc.deviceType,
          manufacturer: disc.manufacturer,
          model: disc.model,
          roomId: sel.roomId,
          connectivity,
          state: json(state),
          stateUpdatedAt: tested ? new Date() : null,
          lastSeenAt: tested && connectivity === 'online' ? new Date() : null,
          metadata: json(extraMetadata(sel.externalId)),
          capabilities: { create: caps.map(({ type, ...config }) => ({ type, config: json(config) })) },
        },
        include: deviceInclude,
      });
      pushRealtime({ type: 'device.updated', homeId: integ.homeId, device: toDeviceDto(device) });
      results.push({ externalId: sel.externalId, deviceId: device.id, status: 'imported', connectivity, tested, message });
    }
    const importedCount = results.filter((r) => r.status === 'imported').length;
    if (importedCount) {
      await recordActivity({ homeId: integ.homeId, type: 'device.added', title: `${importedCount} device${importedCount === 1 ? '' : 's'} imported from ${integ.name}`, severity: 'success', source: 'user', isDemo: integ.isDemo });
    }
    await this.pushIntegration(integrationId);
    pushRealtime({ type: 'home.changed', homeId: integ.homeId });
    return results;
  }

  /** Stop the connection and delete stored credentials; device records are kept (connectivity unknown). */
  async disconnect(integrationId: string): Promise<void> {
    const integ = await prisma.integration.findUnique({ where: { id: integrationId } });
    if (!integ) throw notFound('Integration');
    await this.stop(integrationId);
    await prisma.integrationCredentialReference.deleteMany({ where: { integrationId } });
    await prisma.integration.update({ where: { id: integrationId }, data: { status: 'disconnected', statusMessage: 'Disconnected by a user', disconnectedAt: new Date() } });
    this.lastStatus.set(integrationId, 'disconnected');
    await prisma.automation.updateMany({ where: { integrationId }, data: { enabled: false } });
    await markIntegrationDevicesUnknown(integrationId);
    const refreshed = await prisma.device.findMany({ where: { integrationId }, include: deviceInclude });
    for (const d of refreshed) pushRealtime({ type: 'device.updated', homeId: d.homeId, device: toDeviceDto(d) });
    await recordActivity({ homeId: integ.homeId, type: 'integration.disconnected', title: `${integ.name} disconnected`, severity: 'warning', source: 'user', isDemo: integ.isDemo });
    await this.pushIntegration(integrationId);
  }

  async reconnect(integrationId: string): Promise<void> {
    const integ = await prisma.integration.findUnique({ where: { id: integrationId } });
    if (!integ) throw notFound('Integration');
    if (integ.type === 'home_assistant' && !(await prisma.integrationCredentialReference.findUnique({ where: { integrationId } }))) {
      throw new AppError(400, 'credentials_required', 'Enter a new access token to reconnect Home Assistant.');
    }
    await prisma.integration.update({ where: { id: integrationId }, data: { status: 'connecting', statusMessage: null, disconnectedAt: null } });
    this.retryAttempts.delete(integrationId);
    try {
      await this.start({ ...integ, status: 'connecting' });
    } catch (e) {
      throw new AppError(502, (e as AdapterError).code ?? 'integration_error', (e as Error).message);
    }
  }

  /** Remove the integration and every device, scene action and HA automation that came from it. */
  async remove(integrationId: string): Promise<void> {
    await this.stop(integrationId);
    this.lastStatus.delete(integrationId);
    const devices = await prisma.device.findMany({ where: { integrationId }, select: { id: true, homeId: true } });
    await prisma.integration.delete({ where: { id: integrationId } });
    for (const d of devices) pushRealtime({ type: 'device.removed', homeId: d.homeId, deviceId: d.id });
  }

  async syncExternalAutomations(integrationId: string): Promise<number> {
    const adapter = this.get(integrationId);
    if (!adapter.listAutomations) return 0;
    const integ = await prisma.integration.findUniqueOrThrow({ where: { id: integrationId } });
    const list = await adapter.listAutomations();
    for (const a of list) {
      await prisma.automation.upsert({
        where: { integrationId_externalId: { integrationId, externalId: a.externalId } },
        create: { homeId: integ.homeId, integrationId, externalId: a.externalId, name: a.name, enabled: a.enabled, executor: 'home_assistant', lastRunAt: a.lastTriggeredAt ? new Date(a.lastTriggeredAt) : null },
        update: { name: a.name, enabled: a.enabled, lastRunAt: a.lastTriggeredAt ? new Date(a.lastTriggeredAt) : null },
      });
    }
    await prisma.automation.deleteMany({ where: { integrationId, externalId: { notIn: list.map((a) => a.externalId) } } });
    return list.length;
  }
}

export const integrations = new IntegrationManager();
