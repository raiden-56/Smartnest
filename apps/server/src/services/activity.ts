import type { ActivityType, Severity } from '@smartnest/shared';
import { prisma } from '../db.js';
import { json, toActivityDto } from '../lib/dto.js';
import { pushRealtime } from './bus.js';

export interface ActivityInput {
  homeId: string;
  type: ActivityType;
  title: string;
  detail?: string | null;
  severity?: Severity;
  result?: 'success' | 'failure' | 'pending' | null;
  source: 'user' | 'automation' | 'scene' | 'integration' | 'system';
  actorUserId?: string | null;
  actorName?: string | null;
  device?: { id: string; name: string; roomId: string | null; category: string } | null;
  metadata?: Record<string, unknown>;
  isDemo?: boolean;
}

export async function recordActivity(input: ActivityInput) {
  const a = await prisma.activityEvent.create({
    data: {
      homeId: input.homeId,
      type: input.type,
      title: input.title,
      detail: input.detail ?? null,
      severity: input.severity ?? 'info',
      result: input.result ?? null,
      source: input.source,
      actorUserId: input.actorUserId ?? null,
      actorName: input.actorName ?? null,
      deviceId: input.device?.id ?? null,
      deviceName: input.device?.name ?? null,
      roomId: input.device?.roomId ?? null,
      category: input.device?.category ?? null,
      metadata: json(input.metadata ?? {}),
      isDemo: input.isDemo ?? false,
    },
  });
  pushRealtime({ type: 'activity.created', homeId: input.homeId, activity: toActivityDto(a) });
  return a;
}
