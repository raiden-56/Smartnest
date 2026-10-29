import { execSync } from 'node:child_process';

/**
 * Apply migrations to the dedicated test database (non-destructive).
 * Tests never depend on an empty database: each one creates its own users and homes.
 */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? 'postgresql://smartnest:smartnest@localhost:5442/smartnest_test?schema=public';
  execSync('npx prisma migrate deploy', { env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe' });
}
