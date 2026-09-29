import { test, expect } from '../fixtures';

/**
 * Skrevet under QA av "zoom-nivå-begrenset lasting av AO-lokaliteter" (fase 1:
 * computeEffectiveFetchRadiusMeters + race-fiksen i handleMapMoveEnd).
 * computeEffectiveFetchRadiusMeters er ikke eksportert fra map.js (og filen
 * kan ikke importeres direkte i vitest uten Leaflet-mocking pga.
 * side-effekter ved modul-last, se toppen av map.js) — verifiseres derfor
 * her, svart-boks, via ekte tastatur-styrt panorering/zoom i en ekte
 * nettleser. Kjøres kun mot chromium (geometri-/timing-testen er ikke
 * mobil-spesifikk, og unødvendig repetisjon mot flere viewports/browsere
 * ville bare gjort testen tregere og mer flaky).
 */

const BASE = process.env.BASE_URL || 'http://localhost:3000';

test.describe('Kart: viewport-avhengig hente-radius ved panorering/zoom', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'Kun chromium nødvendig for denne geometri-testen');

  test('ren zoom uten panorering trigger refetch, med gulv og tak på radius', async ({ page }) => {
    const requests: { lat: number; lon: number; size: number }[] = [];

    await page.route('**/api/ao-sites*', async (route) => {
      const url = new URL(route.request().url());
      requests.push({
        lat: parseFloat(url.searchParams.get('lat') || 'NaN'),
        lon: parseFloat(url.searchParams.get('lon') || 'NaN'),
        size: parseFloat(url.searchParams.get('size') || 'NaN'),
      });
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sites: [] }) });
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

    // Fokuser kartet slik at Leaflets innebygde tastatur-navigasjon (påslått
    // som standard) tar imot +/-. Deterministisk og skriptbart i motsetning
    // til museklikk/drag, uten behov for noen test-hook inn i map.js.
    await page.locator('#map').click({ position: { x: 100, y: 400 } });

    // Zoom kraftig INN (samme senter, ingen panorering) — skal alene trigge
    // en ny henting (zoomChanged-fiksen) og gi en radius NEDE ved gulvet
    // (sizeMeters=500), siden et sterkt innzoomet kartutsnitt dekker et
    // mindre areal enn den valgte søkeradiusen.
    for (let i = 0; i < 7; i++) {
      await page.keyboard.press('+');
      await page.waitForTimeout(350);
    }
    await page.waitForTimeout(900); // debounce (600ms) + slingringsmonn

    expect(requests.length, 'Ren zoom inn trigget ingen refetch i det hele tatt').toBeGreaterThan(0);
    const afterZoomIn = requests[requests.length - 1];
    expect(afterZoomIn.size, `Forventet radius nær gulvet (500m) ved sterk innzooming, fikk ${afterZoomIn.size}`).toBeLessThanOrEqual(520);
    expect(afterZoomIn.size).toBeGreaterThanOrEqual(500);

    // Zoom kraftig UT (fortsatt samme senter) — skal gi en radius klippet til
    // taket (3000m), ALDRI mer, uansett hvor langt man zoomer ut.
    const beforeZoomOut = requests.length;
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('-');
      await page.waitForTimeout(350);
    }
    await page.waitForTimeout(900);

    expect(requests.length, 'Ren zoom ut trigget ingen refetch').toBeGreaterThan(beforeZoomOut);
    const afterZoomOut = requests[requests.length - 1];
    expect(afterZoomOut.size, `Radius skal aldri overstige taket på 3000m, fikk ${afterZoomOut.size}`).toBeLessThanOrEqual(3000);
    expect(afterZoomOut.size).toBeGreaterThan(afterZoomIn.size);
  });

  test('rask panorering A→B (A forsinket) skal ende med Bs data, ikke As utdaterte svar', async ({ page }) => {
    let callCount = 0;

    await page.route('**/api/ao-sites*', async (route) => {
      callCount++;
      if (callCount === 1) {
        // Simulerer et tregt AO-kall for det FØRSTE panorerings-målet (A).
        await new Promise((r) => setTimeout(r, 1500));
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            sites: [{ id: 'SITE_A', name: 'Sted A (utdatert)', lat: 60.4, lon: 5.33, isPrivate: false }],
          }),
        });
      } else {
        // Andre og senere kall (B) svarer raskt.
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            sites: [{ id: 'SITE_B', name: 'Sted B (gjeldende)', lat: 60.41, lon: 5.34, isPrivate: false }],
          }),
        });
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

    // Panorer til A: nok tastetrykk til å klart passere minRefetchDistance,
    // la debouncen (600ms) slå til slik at fetch for A faktisk starter (og
    // henger, se route-handleren over).
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(150);
    }
    await page.waitForTimeout(750);

    // Panorer videre til B FØR As forsinkede svar (1500ms) er kommet tilbake.
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(150);
    }
    await page.waitForTimeout(750);

    // Vent til As forsinkede svar uansett har rukket å komme tilbake.
    await page.waitForTimeout(1200);

    expect(callCount, 'Forventet minst to separate AO-kall (A og B)').toBeGreaterThanOrEqual(2);

    const siteALabel = page.locator('.site-label', { hasText: 'Sted A (utdatert)' });
    const siteBLabel = page.locator('.site-label', { hasText: 'Sted B (gjeldende)' });

    await expect(siteBLabel, 'Bs lokalitet skal være tegnet').toHaveCount(1);
    await expect(siteALabel, 'As utdaterte lokalitet skal IKKE være synlig etter at B er hentet').toHaveCount(0);
  });

  test('AO-feil ved panorering krasjer ikke og tillater et nytt forsøk på samme sted', async ({ page }) => {
    const pageErrors: Error[] = [];
    page.on('pageerror', (err) => pageErrors.push(err));

    let shouldFail = true;
    const calls: string[] = [];
    await page.route('**/api/ao-sites*', async (route) => {
      const url = new URL(route.request().url());
      calls.push(`${url.searchParams.get('lat')},${url.searchParams.get('lon')}`);
      if (shouldFail) {
        // Simulerer at AO er utilgjengelig midt i en panorering.
        await route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
      } else {
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

    // Panorer til et sted mens AO svarer 500.
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(150);
    }
    await page.waitForTimeout(900);

    expect(calls.length, 'Forventet at det feilede kallet faktisk ble forsøkt').toBeGreaterThanOrEqual(1);
    expect(pageErrors, `AO-feil under panorering skal håndteres i try/catch, ikke krasje siden: ${pageErrors.map((e) => e.message).join('; ')}`).toHaveLength(0);

    // La AO "komme tilbake" og panorer TILBAKE til nøyaktig samme sted som
    // nettopp feilet. Reverteringen av lastFetchedCenter ved feil skal gjøre
    // at dette stedet fortsatt er "friskt" nok til å trigge et nytt forsøk,
    // i stedet for at det er stille blokkert for godt av den optimistiske
    // oppdateringen som skjedde før det feilede kallet.
    shouldFail = false;
    const callsBeforeReturn = calls.length;
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press('ArrowLeft');
      await page.waitForTimeout(150);
    }
    await page.waitForTimeout(900);
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(150);
    }
    await page.waitForTimeout(900);

    expect(calls.length, 'Et nytt forsøk på det tidligere feilede stedet skal faktisk skje').toBeGreaterThan(callsBeforeReturn);
  });
});
