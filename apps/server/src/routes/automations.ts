import { Router } from 'express';
import { z } from 'zod';
import { automationInputSchema, type AutomationInput } from '@smartnest/shared';
import { prisma } from '../db.js';
import { AppError, badRequest, notFound } from '../lib/errors.js';
import { integrations } from '../integrations/manager.js';
import { ctx, homeAccess } from '../middleware/auth.js';
import { ah, parse } from '../middleware/http.js';
import { audit } from '../services/audit.js';
import { automationEngine } from '../services/automationEngine.js';
import { automationInclude, saveAutomation, toAutomationDto, toExecutionDto, validateAutomationForHome } from '../services/automations.js';

export const automationsRouter = Router({ mergeParams: true });

async function load(homeId: string, id: string) {
  const a = await prisma.automation.findFirst({ where: { id, homeId }, include: automationInclude });
  if (!a) throw notFound('Automation');
  return a;
}

function assertSmartNestOwned(a: { executor: string }) {
  if (a.executor !== 'smartnest') throw new AppError(409, 'externally_managed', 'This automation runs in Home Assistant. Edit it there; SmartNest can only enable, disable or trigger it.');
}

automationsRouter.get(
  '/',
  homeAccess('automations.view'),
  ah(async (req, res) => {
    const { home } = ctx(req);
    const list = await prisma.automation.findMany({ where: { homeId: home.id }, include: automationInclude, orderBy: [{ executor: 'desc' }, { name: 'asc' }] });
    res.json({ automations: list.map(toAutomationDto) });
  }),
);

automationsRouter.get(
  '/export',
  homeAccess('automations.view'),
  ah(async (req, res) => {
    const { home } = ctx(req);
    const list = await prisma.automation.findMany({ where: { homeId: home.id, executor: 'smartnest' }, include: automationInclude });
    const items: AutomationInput[] = list.map((a) => {
      const d = toAutomationDto(a);
      return { name: d.name, description: d.description, enabled: false, isDraft: d.isDraft, triggers: d.triggers, conditions: d.conditions, conditionOperator: d.conditionOperator, actions: d.actions, cooldownSeconds: d.cooldownSeconds, allowSensitiveActions: d.allowSensitiveActions };
    });
    res.setHeader('Content-Disposition', 'attachment; filename="smartnest-automations.json"');
    res.json({ format: 'smartnest.automations.v1', exportedAt: new Date().toISOString(), automations: items });
  }),
);

/** Imported automations are always saved disabled so they cannot run before review. */
automationsRouter.post(
  '/import',
  homeAccess('automations.manage'),
  ah(async (req, res) => {
    const { home, auth } = ctx(req);
    const body = parse(z.object({ format: z.literal('smartnest.automations.v1'), automations: z.array(z.unknown()).min(1).max(100) }), req.body);
    const results: { name: string; ok: boolean; id?: string; errors?: string[] }[] = [];
    for (const raw of body.automations) {
      const parsed = automationInputSchema.safeParse(raw);
      if (!parsed.success) {
        results.push({ name: (raw as { name?: string })?.name ?? 'Unnamed', ok: false, errors: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) });
        continue;
      }
      const input = { ...parsed.data, enabled: false };
      const issues = (await validateAutomationForHome(home.id, input)).filter((i) => i.severity === 'error');
      const saved = await saveAutomation(home.id, { ...input, isDraft: issues.length > 0 }, auth.userId);
      results.push({ name: input.name, ok: issues.length === 0, id: saved.id, errors: issues.map((i) => i.message) });
    }
    automationEngine.invalidate(home.id);
    res.status(201).json({ results });
  }),
);

automationsRouter.post(
  '/validate',
  homeAccess('automations.manage'),
  ah(async (req, res) => {
    const { home } = ctx(req);
    const parsed = automationInputSchema.safeParse(req.body?.automation);
    if (!parsed.success) return res.json({ valid: false, issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message, severity: 'error' })) });
    const issues = await validateAutomationForHome(home.id, parsed.data, req.body?.id);
    res.json({ valid: !issues.some((i) => i.severity === 'error'), issues });
  }),
);

automationsRouter.get(
  '/:automationId',
  homeAccess('automations.view'),
  ah(async (req, res) => {
    const a = await load(ctx(req).home.id, req.params.automationId!);
    res.json({ automation: toAutomationDto(a) });
  }),
);

automationsRouter.post(
  '/',
  homeAccess('automations.manage'),
  ah(async (req, res) => {
    const { home, auth } = ctx(req);
    const input = parse(automationInputSchema, req.body);
    const issues = await validateAutomationForHome(home.id, input);
    // Drafts may be saved with issues; enabled automations must be valid.
    if (!input.isDraft && issues.some((i) => i.severity === 'error')) throw new AppError(400, 'invalid_automation', issues.find((i) => i.severity === 'error')!.message, { issues });
    const a = await saveAutomation(home.id, input, auth.userId);
    automationEngine.invalidate(home.id);
    await audit({ action: 'automation.created', userId: auth.userId, homeId: home.id, targetType: 'automation', targetId: a.id, metadata: { sensitive: input.allowSensitiveActions } });
    res.status(201).json({ automation: toAutomationDto(a), issues });
  }),
);

automationsRouter.put(
  '/:automationId',
  homeAccess('automations.manage'),
  ah(async (req, res) => {
    const { home, auth } = ctx(req);
    const existing = await load(home.id, req.params.automationId!);
    assertSmartNestOwned(existing);
    const input = parse(automationInputSchema, req.body);
    const issues = await validateAutomationForHome(home.id, input, existing.id);
    if (!input.isDraft && issues.some((i) => i.severity === 'error')) throw new AppError(400, 'invalid_automation', issues.find((i) => i.severity === 'error')!.message, { issues });
    const a = await saveAutomation(home.id, input, auth.userId, existing.id);
    automationEngine.invalidate(home.id);
    res.json({ automation: toAutomationDto(a), issues });
  }),
);

automationsRouter.post(
  '/:automationId/enabled',
  homeAccess('automations.manage'),
  ah(async (req, res) => {
    const { home, auth } = ctx(req);
    const { enabled } = parse(z.object({ enabled: z.boolean() }), req.body);
    const a = await load(home.id, req.params.automationId!);
    if (a.executor === 'home_assistant') {
      const adapter = integrations.tryGet(a.integrationId!);
      if (!adapter?.setAutomationEnabled) throw new AppError(409, 'integration_disconnected', 'Home Assistant is not connected.');
      await adapter.setAutomationEnabled(a.externalId!, enabled);
      await integrations.syncExternalAutomations(a.integrationId!);
    } else {
      if (enabled) {
        if (a.isDraft) throw badRequest('Finish and save this draft before enabling it.');
        const dto = toAutomationDto(a);
        const issues = await validateAutomationForHome(home.id, { ...dto, enabled: true }, a.id);
        const err = issues.find((i) => i.severity === 'error');
        if (err) throw new AppError(400, 'invalid_automation', err.message, { issues });
      }
      await prisma.automation.update({ where: { id: a.id }, data: { enabled } });
      automationEngine.invalidate(home.id);
    }
    await audit({ action: enabled ? 'automation.enabled' : 'automation.disabled', userId: auth.userId, homeId: home.id, targetType: 'automation', targetId: a.id });
    res.json({ automation: toAutomationDto(await load(home.id, a.id)) });
  }),
);

automationsRouter.post(
  '/:automationId/run',
  homeAccess('automations.manage'),
  ah(async (req, res) => {
    const { home, auth } = ctx(req);
    const a = await load(home.id, req.params.automationId!);
    if (a.executor === 'home_assistant') {
      const adapter = integrations.tryGet(a.integrationId!);
      if (!adapter?.triggerAutomation) throw new AppError(409, 'integration_disconnected', 'Home Assistant is not connected.');
      await adapter.triggerAutomation(a.externalId!);
      return res.status(202).json({ execution: null, message: 'Triggered in Home Assistant. Results appear in Home Assistant\'s trace view.' });
    }
    if (a.isDraft) throw badRequest('Drafts cannot be run. Use "Test" to simulate instead.');
    const execution = await automationEngine.run(a.id, `Run manually by ${auth.name}`, 0, { manual: true, actorUserId: auth.userId });
    if (!execution) throw new AppError(409, 'not_run', 'The automation is already running or its rate limit has been reached.');
    res.json({ execution });
  }),
);

/** Evaluate conditions and list the actions that would run, without executing anything. */
automationsRouter.post(
  '/:automationId/simulate',
  homeAccess('automations.manage'),
  ah(async (req, res) => {
    const { home } = ctx(req);
    const a = await load(home.id, req.params.automationId!);
    assertSmartNestOwned(a);
    const execution = await automationEngine.run(a.id, 'Test', 0, { simulate: true });
    res.json({ execution });
  }),
);

automationsRouter.post(
  '/:automationId/duplicate',
  homeAccess('automations.manage'),
  ah(async (req, res) => {
    const { home, auth } = ctx(req);
    const a = await load(home.id, req.params.automationId!);
    assertSmartNestOwned(a);
    const d = toAutomationDto(a);
    const copy = await saveAutomation(home.id, { name: `${d.name} (copy)`.slice(0, 80), description: d.description, enabled: false, isDraft: d.isDraft, triggers: d.triggers, conditions: d.conditions, conditionOperator: d.conditionOperator, actions: d.actions, cooldownSeconds: d.cooldownSeconds, allowSensitiveActions: d.allowSensitiveActions }, auth.userId);
    res.status(201).json({ automation: toAutomationDto(copy) });
  }),
);

automationsRouter.delete(
  '/:automationId',
  homeAccess('automations.manage'),
  ah(async (req, res) => {
    const { home, auth } = ctx(req);
    const a = await load(home.id, req.params.automationId!);
    assertSmartNestOwned(a);
    await prisma.automation.delete({ where: { id: a.id } });
    automationEngine.invalidate(home.id);
    await audit({ action: 'automation.deleted', userId: auth.userId, homeId: home.id, targetType: 'automation', targetId: a.id });
    res.status(204).end();
  }),
);

automationsRouter.get(
  '/:automationId/executions',
  homeAccess('automations.view'),
  ah(async (req, res) => {
    const { home } = ctx(req);
    const a = await load(home.id, req.params.automationId!);
    const ex = await prisma.automationExecution.findMany({ where: { automationId: a.id }, orderBy: { startedAt: 'desc' }, take: 30 });
    res.json({ executions: ex.map(toExecutionDto) });
  }),
);
