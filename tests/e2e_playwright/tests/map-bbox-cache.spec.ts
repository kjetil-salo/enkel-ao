import { test, expect } from '../fixtures';

/**
 * Skrevet under QA av fase 2 ("zoom-nivå-begrenset lasting av AO-lokaliteter"):
 * fetchAoSitesCached() i api.js (7-dagers localStorage-cache for bbox-svar
 * brukt av map.js sin panorer-og-oppdater), og bugfiksen i handleMapMoveEnd()
 * som gjør at et TOMT AO-svar midt i panorering ikke lenger tømmer kartet for
 * allerede synlige, gyldige lokaliteter (se map.js, "bboxSites.length === 0").
 *
 * Kun chromium: dette er nettverks-/cache-atferd, ikke browser-spesifikk UI.
 */

const BASE = process.env.BASE_URL || 'http://localhost:3000';

test.describe('Kart: bbox-cache og tomt-svar-håndtering ved panorering', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'Kun chromium nødvendig for denne nettverks-testen');

  test('panorering til samme sted to ganger gir kun ETT nettverkskall til /api/ao-sites (cache-treff nr. 2)', async ({ page }) => {
    let callCount = 0;
    await page.route('**/api/ao-sites*', async (route) => {
      callCount++;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          sites: [{ id: `SITE_${callCount}`, name: `Sted ${callCount}`, lat: 60.4 + callCount * 0.01, lon: 5.33, isPrivate: false }],
        }),
      });
    });

    await page.addInitScript(() => {
      localStorage.setItem(
        'mapData',
        JSON.stringify({
          userPosition: { lat: 60.393, lon: 5.323, accuracy: 20 },
          sites: [], // tomt: unngår fitBounds ved første last, som ellers selv kunne trigget en moveend
          sizeMeters: 500,
        }),
      );
    });

    await page.goto(`${BASE}/map.html`);
    await expect(page.locator('.leaflet-container')).toBeVisible();
    await page.locator('#map').click({ position: { x: 100, y: 400 } });

    // Panorer til P1 — første kall, skal treffe nettverket og bli cachet.
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(150);
    }
    await page.waitForTimeout(900);
    expect(callCount, 'Panorering til P1 skal gi nøyaktig ett nettverkskall').toBe(1);

    // Panorer videre til P2 — et helt annet sted, skal IKKE cache-treffe P1.
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(150);
    }
    await page.waitForTimeout(900);
    expect(callCount, 'Panorering til et nytt sted (P2) skal gi et nytt nettverkskall').toBe(2);

    // Panorer TILBAKE til nøyaktig P1 (samme antall tastetrykk motsatt vei).
    // Cachen skal nå treffe — ingen tredje nettverkskall.
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press('ArrowLeft');
      await page.waitForTimeout(150);
    }
    await page.waitForTimeout(900);

    expect(callCount, 'Retur til et allerede besøkt sted (P1) skal gjenbruke bbox-cachen, ikke gi et nytt nettverkskall').toBe(2);

    // Og lokalitetene fra det cachede P1-svaret skal fortsatt vises på kartet.
    await expect(page.locator('.site-label', { hasText: 'Sted 1' })).toHaveCount(1);
  });

  test('et tomt AO-svar midt i panorering tømmer ikke allerede synlige lokaliteter', async ({ page }) => {
    let callCount = 0;
    await page.route('**/api/ao-sites*', async (route) => {
      callCount++;
      if (callCount === 1) {
        // Første kall: ekte treff, skal tegnes.
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            sites: [{ id: 'SITE_ORIGINAL', name: 'Opprinnelig lokalitet', lat: 60.4, lon: 5.33, isPrivate: false }],
          }),
        });
      } else {
        // Senere kall: AO degradert til et tomt (men gyldig, HTTP 200) svar —
        // umulig å skille fra et genuint tomt område (se CLAUDE.md "External
        // API Error Handling"). Skal IKKE tømme det som allerede vises.
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sites: [] }) });
      }
    });

    await page.addInitScript(() => {
      localStorage.setItem(
        'mapData',
        JSON.stringify({
          userPosition: { lat: 60.393, lon: 5.323, accuracy: 20 },
          sites: [],
          sizeMeters: 500,
        }),
      );
    });

    await page.goto(`${BASE}/map.html`);
    await expect(page.locator('.leaflet-container')).toBeVisible();
    await page.locator('#map').click({ position: { x: 100, y: 400 } });

    // Panorer til stedet med det ekte treffet.
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(150);
    }
    await page.waitForTimeout(900);

    const originalLabel = page.locator('.site-label', { hasText: 'Opprinnelig lokalitet' });
    await expect(originalLabel, 'Det opprinnelige treffet skal være tegnet på kartet').toHaveCount(1);
    expect(callCount).toBe(1);

    // Panorer videre — AO svarer nå (degradert) med en tom liste.
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(150);
    }
    await page.waitForTimeout(900);

    expect(callCount, 'Det tomme svaret skal faktisk ha blitt forsøkt hentet').toBeGreaterThanOrEqual(2);
    await expect(
      originalLabel,
      'Et tomt (degradert) AO-svar skal IKKE tømme kartet for allerede synlige, gyldige lokaliteter',
    ).toHaveCount(1);
  });
});
