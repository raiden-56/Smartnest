import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient({
  log: [{ level: 'error', emit: 'stdout' }],
});

export type Tx = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;
