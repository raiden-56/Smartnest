/**
 * Demonstration seed data.
 *
 * Creates a clearly labelled demo account with a "Demo Home" populated by the
 * simulated demo integration (rooms, devices, scenes, automations, 30 days of
 * demo energy history). Every device and reading is flagged isDemo and shown
 * with a "Demo" label in the UI. Never run this against production.
 *
 *   npm run db:seed
 */
import { prisma } from '../src/db.js';
import { hashPassword } from '../src/lib/crypto.js';
import { integrations } from '../src/integrations/manager.js';
import { setupDemoHome } from '../src/services/demoSetup.js';

const EMAIL = process.env.SEED_DEMO_EMAIL ?? 'demo@smartnest.local';
const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'demo-password-123';

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to seed demo data in production.');
  let user = await prisma.user.findUnique({ where: { email: EMAIL } });
  if (!user) {
    user = await prisma.user.create({ data: { email: EMAIL, name: 'Demo User', passwordHash: await hashPassword(PASSWORD) } });
  }
  const existing = await prisma.homeMembership.findFirst({ where: { userId: user.id, home: { isDemo: true } } });
  if (existing) {
    console.log(`Demo home already exists for ${EMAIL}.`);
    return;
  }
  const home = await prisma.home.create({
    data: {
      name: 'Demo Home', timezone: 'Europe/London', isDemo: true, onboardingCompleted: true, latitude: 51.5074, longitude: -0.1278, currency: 'GBP', tariffPerKWh: 0.245,
      memberships: { create: { userId: user.id, role: 'owner' } },
    },
  });
  await setupDemoHome(home.id, user.id);
  console.log(`Seeded demonstration data.\n  Sign in with: ${EMAIL} / ${PASSWORD}\n  (All devices are simulated and labelled "Demo".)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await integrations.stopAll();
    await prisma.$disconnect();
  });
