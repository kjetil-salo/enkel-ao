import { test, expect } from '../fixtures';

/**
 * Lokalitetsnavn velges av AO-brukerne selv, og Leaflet setter popup og tooltip
 * som HTML. Uescapet kuttet et «"» i navnet onclick-attributtet på «Velg denne
 * lokaliteten» (knappen gjorde ingenting), og «<» ble tolket som HTML.
 */

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const NAVN = 'Tjern "Store" <b>fet</b> & O\'Hara';

test.describe('Lokalitetsnavn med spesialtegn på kartet', () => {
  test.beforeEach(async ({ page }) => {
    // Ingen ekte kall mot AO eller kartflis-tjenestene fra testen.
    await page.route('**/api/ao-sites**', (route) =>
      route.fulfill({ contentType: 'application/json', body: JSON.stringify({ sites: [] }) }),
    );
    await page.route(/tile|wmts|cache\.kartverket/, (route) => route.abort());
    await page.addInitScript((navn) => {
      localStorage.setItem(
        'mapData',
        JSON.stringify({
          userPosition: { lat: 60.393, lon: 5.323, accuracy: 20 },
          sites: [{ id: 4242, name: navn, lat: 60.394, lon: 5.324 }],
        }),
      );
    }, NAVN);
  });

  test('navnet vises som tekst i navnelappen', async ({ page }) => {
    await page.goto(`${BASE}/map.html`);
    const tooltip = page.locator('.leaflet-tooltip.site-label').first();
    await expect(tooltip).toContainText(NAVN);
    await expect(tooltip.locator('b')).toHaveCount(0);
  });

  test('«Velg denne lokaliteten» i popupen velger riktig lokalitet', async ({ page }) => {
    const pageErrors: Error[] = [];
    page.on('pageerror', (err) => pageErrors.push(err));

    await page.goto(`${BASE}/map.html`);
    // Med navnene synlige velger et trykk på markøren direkte; popupen med
    // knappen er veien når navnene er skjult.
    await page.locator('#toggle-labels-btn').click();
    await page.locator('.leaflet-marker-icon').last().click();

    const popup = page.locator('.leaflet-popup-content');
    await expect(popup.locator('strong')).toHaveText(NAVN);
    await expect(popup.locator('b')).toHaveCount(0);

    // Forsiden tar valget ut av localStorage når den laster; en tom side i stedet
    // lar testen lese nøyaktig det kartet lagret.
    await page.route(`${BASE}/`, (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html>' }));
    await Promise.all([
      page.waitForURL(`${BASE}/`),
      popup.getByRole('button', { name: 'Velg denne lokaliteten' }).click(),
    ]);
    expect(await page.evaluate(() => localStorage.getItem('selectedLocation'))).toBe(NAVN);
    expect(await page.evaluate(() => localStorage.getItem('selectedLocationId'))).toBe('4242');

    expect(pageErrors.map((e) => e.message)).toEqual([]);
  });
});
