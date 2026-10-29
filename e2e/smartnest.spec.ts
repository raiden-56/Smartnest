import { expect, test, type Page } from '@playwright/test';

/**
 * The complete SmartNest workflow (spec §26), against the mock Home Assistant:
 *  register → create home → create rooms → connect HA → discover → import + assign rooms →
 *  device detail → command → confirmed result → updated state → activity log →
 *  scene create + activate → automation create + enable → disconnect integration.
 */

const MOCK_HA_URL = 'http://127.0.0.1:8129';
const MOCK_HA_TOKEN = 'mock-long-lived-access-token-for-tests-0000';

test.describe.configure({ mode: 'serial' });

async function openDevice(page: Page, name: string) {
  await page.goto(`/devices?q=${encodeURIComponent(name)}`);
  await page.getByRole('link', { name, exact: true }).first().click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(name);
}

test('complete home setup, control, scenes, automations and disconnection', async ({ page }) => {
  const email = `e2e${Date.now()}@example.test`;

  // 1. Register
  await page.goto('/register');
  await page.getByLabel('Your name').fill('E2E Tester');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('correct-horse-42');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.waitForURL('**/onboarding**');

  // 2. Create a home
  await page.getByRole('button', { name: 'Get started' }).click();
  await page.getByLabel('Home name').fill('E2E Home');
  await page.getByRole('button', { name: 'Create home' }).click();

  // 4. Connect a supported integration (mock Home Assistant)
  await expect(page.getByRole('heading', { name: 'Connect your devices' })).toBeVisible();
  await page.getByText('Home Assistant', { exact: true }).first().click();
  await page.getByLabel('Home Assistant URL').fill(MOCK_HA_URL);
  await page.getByLabel('Long-lived access token').fill(MOCK_HA_TOKEN);
  await page.getByRole('button', { name: 'Connect Home Assistant' }).click();
  await expect(page.getByText(/Connected to/)).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Continue' }).click();

  // 3. Create rooms
  await expect(page.getByRole('heading', { name: 'Add your rooms' })).toBeVisible();
  await page.getByRole('button', { name: 'Add Living Room' }).click();
  await expect(page.getByLabel('Living Room added')).toBeVisible();
  await page.getByRole('button', { name: 'Add Garage' }).click();
  await expect(page.getByLabel('Garage added')).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();

  // 5–7. Discover, review, import and assign rooms (suggested HA areas map to our rooms)
  await expect(page.getByRole('heading', { name: 'Your first devices' })).toBeVisible();
  const review = page.getByRole('list', { name: 'Discovered devices' });
  await expect(review).toBeVisible();
  await expect(review.getByText('light.living_room')).toBeVisible();
  await expect(review.getByText('sensor.weather_summary')).toHaveCount(0); // unsupported entity is not offered
  const selectAll = page.getByRole('checkbox', { name: 'Select all shown devices' });
  if (!(await selectAll.isChecked())) await selectAll.check();
  await page.getByRole('button', { name: /^Import \d+ devices?$/ }).click();
  await expect(page.getByRole('list', { name: 'Import results' })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Go to my dashboard' }).click();
  await page.waitForURL((u) => u.pathname === '/');

  // 7. Assign a device to a room manually
  await openDevice(page, 'Coffee Maker');
  await page.getByLabel('Room', { exact: true }).click();
  await page.getByRole('option', { name: 'Garage' }).click();
  await expect(page.getByText('Room updated')).toBeVisible();

  // 8–11. Device detail, command, confirmed result, updated state
  await openDevice(page, 'Living Room Light');
  const power = page.getByRole('checkbox', { name: /Living Room Light power/ });
  await expect(power).not.toBeChecked();
  await power.click(); // the switch only flips once the device confirms — no optimistic state
  await expect(page.getByText('Turn on: Confirmed')).toBeVisible({ timeout: 15_000 });
  await expect(power).toBeChecked();

  // Unresponsive-in-HA style failure: an unavailable entity cannot be controlled
  await openDevice(page, 'Porch Bulb');
  await expect(page.getByText(/device is unavailable/i)).toBeVisible();

  // 12. Activity log shows the confirmed command
  await page.goto('/activity');
  await expect(page.getByText(/Turn on · Living Room Light/).first()).toBeVisible();

  // 13. Create and activate a scene
  await page.goto('/scenes/new');
  await page.getByLabel('Name').fill('E2E Evening');
  await page.getByRole('button', { name: 'Add action' }).click();
  await page.getByLabel('Device').first().fill('Coffee');
  await page.getByRole('option', { name: /Coffee Maker/ }).click();
  await page.getByRole('button', { name: 'Save scene' }).click();
  await page.waitForURL('**/scenes**');
  await page.getByRole('button', { name: 'Activate scene E2E Evening' }).click();
  await expect(page.getByText(/All 1 actions? confirmed/i)).toBeVisible({ timeout: 20_000 });
  await page.keyboard.press('Escape');

  // 14. Create and enable an automation
  await page.goto('/automations/new');
  await page.getByLabel('Name *').fill('E2E Morning coffee');
  await page.getByRole('button', { name: 'Add action' }).click();
  const device = page.getByLabel('Device').last();
  await device.fill('Coffee');
  await page.getByRole('option', { name: /Coffee Maker/ }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForURL(/\/automations\/[a-z0-9]+$/);
  await page.goto('/automations');
  await expect(page.getByRole('checkbox', { name: 'E2E Morning coffee enabled' })).toBeChecked();

  // 15. Disconnect the integration and verify graceful handling
  await page.goto('/integrations');
  await page.getByRole('link', { name: /Home Assistant/ }).first().click();
  await page.getByRole('button', { name: 'Disconnect' }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Disconnect' }).click();
  await expect(page.getByText(/Disconnected/).first()).toBeVisible();
  await openDevice(page, 'Living Room Light');
  await expect(page.getByText('Integration disconnected').first()).toBeVisible();
  await expect(page.getByText(/integration for this device is disconnected/i)).toBeVisible();
  await expect(page.getByRole('checkbox', { name: /Living Room Light power/ })).toBeDisabled();
});
