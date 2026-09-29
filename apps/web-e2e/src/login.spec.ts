import { test, expect, type Page } from '@playwright/test';

const ADMIN = { email: 'admin@demo.gr', password: 'Admin1234!' };
const RESIDENT = { email: 'maria@demo.gr', password: 'Password123!' };

async function login(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.fill('#email', email);
  await page.fill('#password', password);
  await page.click('button[type="submit"]');
}

test.describe('authentication', () => {
  test('login page renders the demo credentials hint', async ({ page }) => {
    await page.goto('/login');
    await expect(
      page.getByRole('heading', { name: 'Σύνδεση', exact: true }),
    ).toBeVisible();
    await expect(page.getByText('admin@demo.gr / Admin1234!')).toBeVisible();
  });

  test('admin signs in and lands on the overview dashboard', async ({
    page,
  }) => {
    await login(page, ADMIN.email, ADMIN.password);
    await expect(page).toHaveURL(/\/admin$/);
    await expect(
      page.getByRole('heading', { name: 'Επισκόπηση' }),
    ).toBeVisible();
  });

  test('resident signs in and lands on their balance', async ({ page }) => {
    await login(page, RESIDENT.email, RESIDENT.password);
    await expect(page).toHaveURL(/\/balance$/);
    await expect(
      page.getByRole('heading', { name: 'Υπόλοιπό μου' }),
    ).toBeVisible();
  });

  test('wrong credentials show an inline error and stay on login', async ({
    page,
  }) => {
    await login(page, ADMIN.email, 'wrong-password');
    await expect(
      page.getByText('Λανθασμένα στοιχεία σύνδεσης. Δοκιμάστε ξανά.'),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });
});
