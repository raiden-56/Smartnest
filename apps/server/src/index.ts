import { createServer } from 'node:http';
import { createApp } from './app.js';
import { config } from './config.js';
import { prisma } from './db.js';
import { integrations } from './integrations/manager.js';
import { startScheduler, stopScheduler } from './jobs/scheduler.js';
import { logger } from './logger.js';
import { RealtimeHub } from './realtime/hub.js';
import { automationEngine } from './services/automationEngine.js';

async function main() {
  await prisma.$connect();
  const app = createApp();
  const server = createServer(app);
  const hub = new RealtimeHub();
  hub.attach(server);
  automationEngine.start();

  server.listen(config.port, () => logger.info(`SmartNest API listening on http://localhost:${config.port}`));
  await integrations.startAll();
  startScheduler();

  const shutdown = async (signal: string) => {
    logger.info(`${signal} received, shutting down`);
    stopScheduler();
    hub.close();
    server.close();
    await integrations.stopAll();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((e) => {
  logger.fatal({ err: (e as Error).message }, 'Failed to start');
  process.exit(1);
});
