import { Router } from 'express';
import { z } from 'zod';
import { CATEGORY_INFO, DEVICE_CATEGORIES, INTEGRATIONS, INTEGRATION_TYPES, homeAssistantConnectSchema, importDevicesSchema, type CatalogueDto } from '@smartnest/shared';
import { prisma } from '../db.js';
import { AppError, badRequest, notFound } from '../lib/errors.js';
import { assertSafeIntegrationUrl } from '../lib/netGuard.js';
import { integrations, isImplemented } from '../integrations/manager.js';
import { AdapterError } from '../integrations/types.js';
import { ctx, homeAccess } from '../middleware/auth.js';
import { ah, parse } from '../middleware/http.js';
import { audit } from '../services/audit.js';
import { automationEngine } from '../services/automationEngine.js';
import { pushRealtime } from '../services/bus.js';

/** Static catalogue: integration definitions and device categories (no auth-sensitive data). */
export const catalogueRouter = Router();
catalogueRouter.get('/integrations', (_req, res) => {
  res.json({ integrations: INTEGRATION_TYPES.map((t) => ({ ...INTEGRATIONS[t], implemented: isImplemented(t) })) });
});
catalogueRouter.get('/devices', (_req, res) => {
  const body: CatalogueDto = {
    categories: DEVICE_CATEGORIES.filter((c) => c !== 'other').map((c) => ({
      ...CATEGORY_INFO[c],
      supportedBy: INTEGRATION_TYPES.filter((t) => INTEGRATIONS[t].supportedCategories.includes(c)),
    })),
  };
  res.json(body);
});

export const integrationsRouter = Router({ mergeParams: true });

async function loadIntegration(homeId: string, id: string) {
  const i = await prisma.integration.findFirst({ where: { id, homeId } });
  if (!i) throw notFound('Integration');
  return i;
}

integrationsRouter.get(
  '/',
  homeAccess('integrations.view'),
  ah(async (req, res) => {
    const { home } = ctx(req);
    const list = await prisma.integration.findMany({ where: { homeId: home.id }, orderBy: { createdAt: 'asc' } });
    res.json({ integrations: await Promise.all(list.map(async (i) => (await integrations.getDto(i.id)).dto)) });
  }),
);

integrationsRouter.get(
  '/:integrationId',
  homeAccess('integrations.view'),
  ah(async (req, res) => {
    const { home } = ctx(req);
    const i = await loadIntegration(home.id, req.params.integrationId!);
    res.json({ integration: (await integrations.getDto(i.id)).dto, definition: INTEGRATIONS[i.type as keyof typeof INTEGRATIONS] });
  }),
);

/**
 * Connect Home Assistant. The URL is checked against SSRF rules, the token is
 * verified against HA before anything is stored, then encrypted at rest.
 */
integrationsRouter.post(
  '/home-assistant',
  homeAccess('integrations.manage'),
  ah(async (req, res) => {
    const { home, auth } = ctx(req);
    const input = parse(homeAssistantConnectSchema, req.body);
    await assertSafeIntegrationUrl(input.baseUrl);
    const integ = await integrations.connectHomeAssistant(home.id, input);
    await audit({ action: 'integration.connected', userId: auth.userId, homeId: home.id, targetType: 'integration', targetId: integ.id, metadata: { type: 'home_assistant', baseUrl: integ.baseUrl }, ipAddress: req.ip });
    res.status(201).json({ integration: (await integrations.getDto(integ.id)).dto, discovered: await integrations.listDiscovered(integ.id) });
  }),
);

integrationsRouter.post(
  '/demo',
  homeAccess('integrations.manage'),
  ah(async (req, res) => {
    const { home, auth } = ctx(req);
    const integ = await integrations.createDemo(home.id);
    await audit({ action: 'integration.connected', userId: auth.userId, homeId: home.id, targetType: 'integration', targetId: integ.id, metadata: { type: 'demo' } });
    res.status(201).json({ integration: (await integrations.getDto(integ.id)).dto });
  }),
);

/** Planned/"via Home Assistant" integrations have no adapter in this build — say so clearly. */
integrationsRouter.post(
  '/:type(mqtt|matter|onvif|zigbee_zwave|manufacturer)',
  homeAccess('integrations.manage'),
  (req, _res, next) => {
    const def = INTEGRATIONS[req.params.type as keyof typeof INTEGRATIONS];
    next(new AppError(501, 'not_implemented', `${def.name} is supported through Home Assistant in this build. Connect Home Assistant and configure ${def.name} there.`));
  },
);

integrationsRouter.post(
  '/:integrationId/discover',
  homeAccess('integrations.manage'),
  ah(async (req, res) => {
    const { home } = ctx(req);
    const i = await loadIntegration(home.id, req.params.integrationId!);
    try {
      res.json({ discovered: await integrations.discover(i.id) });
    } catch (e) {
      if (e instanceof AdapterError) throw new AppError(e.code === 'integration_disconnected' ? 409 : 502, e.code, e.message);
      throw e;
    }
  }),
);

integrationsRouter.get(
  '/:integrationId/discovered',
  homeAccess('integrations.view'),
  ah(async (req, res) => {
    const { home } = ctx(req);
    const i = await loadIntegration(home.id, req.params.integrationId!);
    res.json({ discovered: await integrations.listDiscovered(i.id) });
  }),
);

integrationsRouter.post(
  '/:integrationId/import',
  homeAccess('integrations.manage'),
  ah(async (req, res) => {
    const { home, auth } = ctx(req);
    const i = await loadIntegration(home.id, req.params.integrationId!);
    const input = parse(importDevicesSchema, req.body);
    const results = await integrations.importDevices(i.id, input.devices);
    await audit({ action: 'devices.imported', userId: auth.userId, homeId: home.id, targetType: 'integration', targetId: i.id, metadata: { count: results.filter((r) => r.status === 'imported').length } });
    res.status(201).json({ results });
  }),
);

integrationsRouter.post(
  '/:integrationId/health',
  homeAccess('integrations.view'),
  ah(async (req, res) => {
    const { home } = ctx(req);
    const i = await loadIntegration(home.id, req.params.integrationId!);
    const adapter = integrations.tryGet(i.id);
    if (!adapter) return res.json({ ok: false, message: i.statusMessage ?? 'Not connected.' });
    res.json(await adapter.healthCheck());
  }),
);

/** Reconnect, optionally with a new Home Assistant token (after expiry/revocation). */
integrationsRouter.post(
  '/:integrationId/reconnect',
  homeAccess('integrations.manage'),
  ah(async (req, res) => {
    const { home, auth } = ctx(req);
    const i = await loadIntegration(home.id, req.params.integrationId!);
    const body = parse(z.object({ accessToken: z.string().trim().min(20).max(1000).optional(), baseUrl: z.string().url().max(300).optional() }), req.body ?? {});
    if (body.accessToken) {
      if (i.type !== 'home_assistant') throw badRequest('This integration does not use an access token.');
      const baseUrl = body.baseUrl ?? i.baseUrl!;
      await assertSafeIntegrationUrl(baseUrl);
      await integrations.connectHomeAssistant(home.id, { name: i.name, baseUrl, accessToken: body.accessToken }, i.id);
      await audit({ action: 'integration.credentials_rotated', userId: auth.userId, homeId: home.id, targetType: 'integration', targetId: i.id, ipAddress: req.ip });
    } else {
      await integrations.reconnect(i.id);
    }
    res.json({ integration: (await integrations.getDto(i.id)).dto });
  }),
);

/** Disconnect: stop syncing and delete stored credentials. Devices are kept (shown as disconnected). */
integrationsRouter.post(
  '/:integrationId/disconnect',
  homeAccess('integrations.manage'),
  ah(async (req, res) => {
    const { home, auth } = ctx(req);
    const i = await loadIntegration(home.id, req.params.integrationId!);
    await integrations.disconnect(i.id);
    automationEngine.invalidate(home.id);
    await audit({ action: 'integration.disconnected', userId: auth.userId, homeId: home.id, targetType: 'integration', targetId: i.id, ipAddress: req.ip });
    res.json({ integration: (await integrations.getDto(i.id)).dto });
  }),
);

/** Remove the integration together with its devices from SmartNest. */
integrationsRouter.delete(
  '/:integrationId',
  homeAccess('integrations.manage'),
  ah(async (req, res) => {
    const { home, auth } = ctx(req);
    const i = await loadIntegration(home.id, req.params.integrationId!);
    const deviceCount = await prisma.device.count({ where: { integrationId: i.id } });
    await integrations.remove(i.id);
    automationEngine.invalidate(home.id);
    await audit({ action: 'integration.removed', userId: auth.userId, homeId: home.id, targetType: 'integration', targetId: i.id, metadata: { name: i.name, deviceCount }, ipAddress: req.ip });
    pushRealtime({ type: 'home.changed', homeId: home.id });
    res.status(204).end();
  }),
);

integrationsRouter.post(
  '/:integrationId/sync-automations',
  homeAccess('integrations.manage'),
  ah(async (req, res) => {
    const { home } = ctx(req);
    const i = await loadIntegration(home.id, req.params.integrationId!);
    try {
      res.json({ count: await integrations.syncExternalAutomations(i.id) });
    } catch (e) {
      throw new AppError(502, (e as AdapterError).code ?? 'integration_error', (e as Error).message);
    }
  }),
);
