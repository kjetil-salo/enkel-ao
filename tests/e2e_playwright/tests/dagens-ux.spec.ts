import { test, expect } from '../fixtures';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

test.beforeEach(async ({ page }) => {
  await page.goto(BASE_URL);
  await page.evaluate(() => {
    localStorage.removeItem('afterRegistrationMode');
    localStorage.removeItem('fugleobservasjoner_v1');
  });
  await page.reload();
});

test('viser den forenklede førsteskjermen i feltmodus', async ({ page }) => {
  await expect(page.getByRole('button', { name: /Modus: Felt/ })).toBeVisible();
  await expect(page.locator('#loc-map-btn-label')).toHaveText('Kart');
  await expect(page.locator('#radius-row')).toBeHidden();
  await expect(page.locator('#loc-sort-row')).toBeHidden();
  await expect(page.locator('#send-empty-hint')).toBeVisible();
  await expect(page.locator('#status-text')).toBeHidden();
});

test('modusbytte med tastatur holder mobilnavigasjonen innenfor skjermen', async ({ page }) => {
  const modeButton = page.getByRole('button', { name: /Modus: Felt/ });
  await modeButton.press('Space');

  await expect(page.getByRole('button', { name: /Modus: Etterregistrering/ })).toBeVisible();
  await expect(page.locator('#loc-map-btn-label')).toHaveText('Velg fra kart');
  await expect(page.locator('#loc-btn')).toBeHidden();
  await expect(page.locator('#datetime-fields')).toBeVisible();

  const layout = await page.evaluate(() => {
    const headerLinks = Array.from(document.querySelectorAll('header a'));
    return {
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      rightmostHeaderLink: Math.max(...headerLinks.map((link) => link.getBoundingClientRect().right)),
    };
  });

  expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth);
  expect(layout.rightmostHeaderLink).toBeLessThanOrEqual(layout.viewportWidth);
});
