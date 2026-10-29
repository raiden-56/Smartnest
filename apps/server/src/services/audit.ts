import { prisma } from '../db.js';
import { json } from '../lib/dto.js';
import { logger } from '../logger.js';

export interface AuditInput {
  action: string;
  userId?: string | null;
  homeId?: string | null;
  targetType?: string;
  targetId?: string;
  /** Must never contain secrets — callers pass identifiers and outcomes only. */
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
}

export async function audit(input: AuditInput): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        action: input.action,
        userId: input.userId ?? null,
        homeId: input.homeId ?? null,
        targetType: input.targetType ?? null,
        targetId: input.targetId ?? null,
        metadata: json(input.metadata ?? {}),
        ipAddress: input.ipAddress ?? null,
      },
    });
  } catch (e) {
    // Audit failures must be visible but should not break the user's action.
    logger.error({ err: (e as Error).message, action: input.action }, 'Failed to write audit log');
  }
}
