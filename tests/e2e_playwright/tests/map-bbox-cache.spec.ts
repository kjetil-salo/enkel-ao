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
const STARTLOKALITET = { id: 1, name: 'Lokalitet ved oppstart', lat: 60.393, lon: 5.323 };

test.describe('Kart: bbox-cache og tomt-svar-håndtering ved panorering', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'Kun chromium nødvendig for denne nettverks-testen');

  for (const modus of ['online', 'hybrid']) {
    test(`gjenbesøk i ${modus} viser lagrede offentlige og egne lokaliteter før AO svarer`, async ({ page }) => {
      const offentlig = { ...STARTLOKALITET, name: 'Offentlig lokalitet', lon: 5.319 };
      const egen = { id: 2, name: 'Egen lokalitet', lat: 60.395, lon: 5.327 };
      const privat = { id: 3, name: 'Annens private lokalitet', lat: 60.398, lon: 5.323, isPrivate: true };
      let slippSvar!: () => void;
      const ventPåSvar = new Promise<void>((resolve) => { slippSvar = resolve; });
      let kall = 0;

      await page.route('**/api/ao-sites?*', async (route) => {
        if (++kall > 1) await ventPåSvar;
        await route.fulfill({ json: { sites: [offentlig, privat] } });
      });
      await page.route('https://*.tile.openstreetmap.org/**', (route) => route.abort());
      await page.addInitScript(({ modus, egen }) => {
        localStorage.setItem('network_mode_v1', modus);
        localStorage.setItem('showPrivateSitesOnMap', '1');
        localStorage.setItem('ao_username', 'testbruker');
        localStorage.setItem('ao_tokens', JSON.stringify({ loginToken: 'test', authCookie: 'test' }));
        localStorage.setItem('ao_private_sites', JSON.stringify({ ts: Date.now(), sites: [egen] }));
        if (!localStorage.getItem('mapData')) {
          localStorage.setItem('mapData', JSON.stringify({ userPosition: { lat: 60.393, lon: 5.323 }, sites: [] }));
        }
      }, { modus, egen });

      const navnelapp = (name: string) => page.locator('.site-label', { hasText: name });
      await page.goto(`${BASE}/map.html`, { waitUntil: 'domcontentloaded' });
      await expect(navnelapp(privat.name)).toBeVisible();
      expect(kall).toBe(1);

      // Litt lenger unna enn bbox-cachens 300 m-grense, i samme område.
      await page.evaluate(() => {
        localStorage.setItem('mapData', JSON.stringify({ userPosition: { lat: 60.397, lon: 5.323 }, sites: [] }));
      });
      try {
        await page.reload({ waitUntil: 'domcontentloaded' });
        await expect(navnelapp(offentlig.name)).toBeVisible();
        await expect(navnelapp(egen.name)).toBeVisible();
        await expect.poll(() => kall).toBe(2);
        await expect(navnelapp(privat.name)).toHaveCount(0);
      } finally {
        slippSvar();
      }

      await expect(navnelapp(privat.name)).toBeVisible();
      // Leaflet lar forrige navnelapp tones ut før den fjernes fra DOM-en.
      await expect(navnelapp(egen.name)).toHaveCount(1);
      await expect(navnelapp(egen.name)).toBeVisible();
    });
  }

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

    await page.addInitScript((startlokalitet) => {
      localStorage.setItem(
        'mapData',
        JSON.stringify({
          userPosition: { lat: 60.393, lon: 5.323, accuracy: 20 },
          sites: [startlokalitet],
          sizeMeters: 500,
        }),
      );
    }, STARTLOKALITET);

    await page.goto(`${BASE}/map.html`);
    await expect(page.locator('.leaflet-container')).toBeVisible();
    await page.locator('#map').click({ position: { x: 100, y: 400 } });
    // GPS åpner nå på nivå 15. Bruk samme skala (13) som geometriprøvene opprinnelig hadde.
    await page.waitForTimeout(350);
    for (let i = 0; i < 2; i++) {
      await page.keyboard.press('-');
      await page.waitForTimeout(350);
    }

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

    await page.addInitScript((startlokalitet) => {
      localStorage.setItem(
        'mapData',
        JSON.stringify({
          userPosition: { lat: 60.393, lon: 5.323, accuracy: 20 },
          sites: [startlokalitet],
          sizeMeters: 500,
        }),
      );
    }, STARTLOKALITET);

    await page.goto(`${BASE}/map.html`);
    await expect(page.locator('.leaflet-container')).toBeVisible();
    await page.locator('#map').click({ position: { x: 100, y: 400 } });
    // GPS åpner nå på nivå 15. Bruk samme skala (13) som geometriprøvene opprinnelig hadde.
    await page.waitForTimeout(350);
    for (let i = 0; i < 2; i++) {
      await page.keyboard.press('-');
      await page.waitForTimeout(350);
    }

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
    await expect(page.locator('#map-sites-status')).toBeEmpty();
    await expect(
      originalLabel,
      'Et tomt (degradert) AO-svar skal IKKE tømme kartet for allerede synlige, gyldige lokaliteter',
    ).toHaveCount(1);
  });
});
