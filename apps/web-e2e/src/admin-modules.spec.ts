import { test, expect } from '@playwright/test';

/**
 * Runs with the admin storageState from the setup project, so each test
 * restores the session via /auth/refresh (no login round-trips).
 */
const MODULE_PAGES: Array<{ path: string; heading: string }> = [
  { path: '/admin/maintenance', heading: 'Πρόγραμμα προληπτικής συντήρησης' },
  { path: '/admin/reserve', heading: 'Αποθεματικό' },
  { path: '/admin/treasury', heading: 'Ταμείο' },
  { path: '/admin/supplier-invoices', heading: 'Τιμολόγια προμηθευτών' },
  { path: '/admin/legal', heading: 'Νομικές ενέργειες' },
  { path: '/admin/occupancy', heading: 'Ένοικοι & Δικαιώματα Ψήφου' },
];

test.describe('admin feature modules', () => {
  for (const { path, heading } of MODULE_PAGES) {
    test(`${path} renders`, async ({ page }) => {
      await page.goto(path);
      await expect(
        page.getByRole('heading', { name: heading }),
      ).toBeVisible();
    });
  }

  test('sidebar navigation links to the new modules', async ({ page }) => {
    await page.goto('/admin');
    await expect(
      page.getByRole('link', { name: 'Συντήρηση' }),
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Τιμολόγια προμηθευτών' }),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: 'Αποθεματικό' })).toBeVisible();
  });
});
