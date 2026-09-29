import { test as setup, expect } from '@playwright/test';

const ADMIN = { email: 'admin@demo.gr', password: 'Admin1234!' };
const RESIDENT = { email: 'maria@demo.gr', password: 'Password123!' };

/** Log in once per role; the HttpOnly refresh cookie is saved to storageState
 *  so downstream tests restore the session via /auth/refresh instead of
 *  re-logging-in (the API throttles auth to 10/min). */
setup('authenticate as admin', async ({ page }) => {
  await page.goto('/login');
  await page.fill('#email', ADMIN.email);
  await page.fill('#password', ADMIN.password);
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/\/admin$/);
  await page.context().storageState({
    path: require('path').join(__dirname, '../../../dist/.playwright/apps/web-e2e/states/admin.json'),
  });
});

setup('authenticate as resident', async ({ page }) => {
  await page.goto('/login');
  await page.fill('#email', RESIDENT.email);
  await page.fill('#password', RESIDENT.password);
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/\/balance$/);
  await page.context().storageState({
    path: require('path').join(__dirname, '../../../dist/.playwright/apps/web-e2e/states/resident.json'),
  });
});
