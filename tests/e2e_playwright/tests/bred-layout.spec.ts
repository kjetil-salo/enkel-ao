import { test, expect } from '@playwright/test';
import { CURRENT_NEWS_SPLASH, STORAGE_KEY } from '../../../public/js/news-splash.js';

for (const modus of ['Felt', 'Etterregistrering']) {
  test(`bred visning i ${modus} viser publisering ved siden av en lang liste`, async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.route('**/api/**', route => route.fulfill({ json: {} }));
    await page.addInitScript(({ newsKey, newsId, etterregistrering }) => {
      localStorage.setItem(newsKey, newsId);
      localStorage.setItem('enkelAoHintRead', 'start-with-location-v1');
      localStorage.setItem('afterRegistrationMode', etterregistrering ? '1' : '0');
      localStorage.setItem('ao_username', 'Testbruker');
      localStorage.setItem('ao_password', 'lokal-testverdi');
      localStorage.setItem('selectedLocation', 'Herdla');
      localStorage.setItem('selectedLocationId', '1');
      const observations = Array.from({ length: 24 }, (_, index) => ({
        species: { taxonId: index + 1, taxonName: `Testart ${index + 1}` },
        count: 1,
        placeName: 'Herdla',
        activity: 'Næringssøkende',
        timestamp: new Date(2026, 9, 1, 9, index).toISOString(),
      }));
      localStorage.setItem('fugleobservasjoner_v1', JSON.stringify({ version: 1, observations }));
    }, { newsKey: STORAGE_KEY, newsId: CURRENT_NEWS_SPLASH.id, etterregistrering: modus === 'Etterregistrering' });

    await page.goto('/');
    await expect(page.locator('#obs-list-count')).toHaveText(/24/);
    const publiser = page.locator('#ao-direct-btn');
    await expect(publiser).toBeEnabled();
    await expect(publiser).toBeInViewport({ ratio: 1 });
    await expect(page.locator('.tablet-input-column .section-handlinger')).toHaveCount(1);
    await expect(page.locator('.tablet-list-column #clear-btn')).toHaveCount(1);
    if (modus === 'Etterregistrering') {
      await expect(page.locator('#datetime-fields')).toBeVisible();
    }
  });
}

test('sendeseksjonen beholder avkrysning og fokus når visningen bytter kolonne', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/**', route => route.fulfill({ json: {} }));
  await page.addInitScript(({ newsKey, newsId }) => {
    localStorage.setItem(newsKey, newsId);
    localStorage.setItem('enkelAoHintRead', 'start-with-location-v1');
    localStorage.setItem('ao_username', 'Testbruker');
    localStorage.setItem('ao_password', 'lokal-testverdi');
  }, { newsKey: STORAGE_KEY, newsId: CURRENT_NEWS_SPLASH.id });

  await page.goto('/');
  const underLista = page.locator('.tablet-list-column .section-liste + .section-handlinger');
  await expect(underLista).toHaveCount(1);

  await page.setViewportSize({ width: 1024, height: 768 });
  await expect(underLista).toHaveCount(0);
  const tomAutomatisk = page.locator('.tablet-input-column #ao-direct-auto-clear');
  await tomAutomatisk.check();
  await tomAutomatisk.focus();

  await page.setViewportSize({ width: 1024, height: 1366 });
  const etterRotasjon = underLista.locator('#ao-direct-auto-clear');
  await expect(etterRotasjon).toBeChecked();
  await expect(etterRotasjon).toBeFocused();

  await page.setViewportSize({ width: 999, height: 768 });
  await expect(underLista).toHaveCount(1);
  await page.setViewportSize({ width: 1000, height: 768 });
  await expect(tomAutomatisk).toBeChecked();
});
