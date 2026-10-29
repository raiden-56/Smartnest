import { expect, test } from '@playwright/test';

/** Mobile layout: demo mode, bottom navigation, no horizontal overflow. */
test('demo home works on a phone without horizontal overflow', async ({ page }) => {
  await page.goto('/register');
  await page.getByLabel('Your name').fill('Mobile Tester');
  await page.getByLabel('Email').fill(`m${Date.now()}@example.test`);
  await page.getByLabel('Password').fill('correct-horse-42');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByRole('button', { name: 'Get started' }).click();
  await page.getByText('Explore demo mode').click();
  await page.getByRole('button', { name: /demo/i }).last().click();
  await page.waitForURL((u) => u.pathname === '/', { timeout: 60_000 });
  // The guided tour opens on the first dashboard visit; Esc closes it
  await expect(page.getByRole('dialog', { name: 'Welcome to SmartNest' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Welcome to SmartNest' })).toHaveCount(0);

  const nav = page.getByRole('navigation', { name: 'Primary' });
  await expect(nav).toBeVisible();
  for (const path of ['/', '/devices', '/rooms', '/scenes', '/energy', '/activity', '/settings']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    // Only the content area scrolls, so check both the page and the <main> scroll container
    const overflow = await page.evaluate(() => {
      const main = document.querySelector('main')!;
      return Math.max(document.documentElement.scrollWidth - document.documentElement.clientWidth, main.scrollWidth - main.clientWidth);
    });
    expect(overflow, `${path} overflows horizontally`).toBeLessThanOrEqual(1);
    const pageScroll = await page.evaluate(() => document.documentElement.scrollHeight - document.documentElement.clientHeight);
    expect(pageScroll, `${path}: the window itself should not scroll`).toBeLessThanOrEqual(1);
  }
  await page.getByRole('button', { name: 'Open navigation menu' }).click();
  await expect(page.getByRole('link', { name: 'Integrations' })).toBeVisible();
});
