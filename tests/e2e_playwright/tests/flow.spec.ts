import { test, expect } from '@playwright/test';

// Smoke E2E: Verifiser at siden laster og hovedelementene vises

test('@smoke side laster', async ({ page }) => {
  const base = process.env.BASE_URL || 'http://localhost:3000';
  await page.goto(base);

  // Verifiser at siden har lastet med tittel
  await expect(page).toHaveTitle(/Fugleobservasjoner/);

  // Verifiser at viktige elementer er synlige
  await expect(page.locator('#loc-btn')).toBeVisible();
  await expect(page.locator('#search')).toBeVisible();
  await expect(page.locator('#count')).toBeVisible();
});
