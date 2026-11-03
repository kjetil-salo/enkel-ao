import { test, expect } from '../fixtures';

/**
 * Tre-trinns visningsknapp på kartet: Alt → Skjul navn → Skjul alt → Alt.
 *
 * Skrevet etter en feltmelding (03.11.2026): på steder med svært mange
 * lokaliteter tett i tett var kartet helt dekket av markørpinner, og den gamle
 * to-tilstands-knappen hjalp ikke — den lukket bare navne-tooltipene, pinnene og
 * polygonene ble stående. Brukeren klarte derfor ikke å zoome inn for å finne
 * lokaliteten han skulle etterregistrere på.
 *
 * Tilstandsmaskinen er enhetstestet i tests/unit/kart-visning.test.js. Det den
 * IKKE kan dekke, og som denne testen finnes for, er koblingen mot Leaflet:
 * at lagene faktisk forsvinner fra DOM-en, at de kommer tilbake igjen, og at
 * navnene ikke dukker opp uoppfordret når lagene legges tilbake på kartet
 * (Leaflet åpner en permanent tooltip på nytt av seg selv ved `add`).
 */

const BASE = process.env.BASE_URL || 'http://localhost:3000';

// To lokaliteter nær brukerposisjonen, én med polygon og én med radius-sirkel,
// så alle tre lagtypene knappen skal skjule er representert.
const SITES = [
  {
    id: '101',
    name: 'Testlokalitet polygon',
    lat: 60.3935,
    lon: 5.3235,
    raw: {
      isPolygon: true,
      polygonCoordinates: [
        [5.3230, 60.3930],
        [5.3240, 60.3930],
        [5.3240, 60.3940],
        [5.3230, 60.3940],
      ],
    },
  },
  {
    id: '102',
    name: 'Testlokalitet radius',
    lat: 60.3925,
    lon: 5.3215,
    raw: { accuracy: 120 },
  },
];

async function settOppKart(page, { lagretVisning }: { lagretVisning?: string } = {}) {
  await page.addInitScript(
    ([sites, lagret]) => {
      localStorage.setItem(
        'mapData',
        JSON.stringify({
          userPosition: { lat: 60.393, lon: 5.323, accuracy: 20 },
          sites,
          sizeMeters: 1000,
        }),
      );
      if (lagret !== null) localStorage.setItem('mapShowLabels_v1', lagret as string);
    },
    [SITES, lagretVisning ?? null],
  );
}

/** Antall markørpinner for lokaliteter som faktisk står på kartet. */
function pinner(page) {
  return page.locator('.leaflet-marker-pane img.leaflet-marker-icon');
}

/** Permanente navne-tooltips som faktisk står på kartet. */
function navn(page) {
  return page.locator('.leaflet-tooltip.site-label');
}

/** Polygoner og radius-sirkler (SVG-stier i overlay-panet). */
function flater(page) {
  return page.locator('.leaflet-overlay-pane path');
}

test.describe('Kartets visningsknapp', () => {
  test('sykler Alt → Skjul navn → Skjul alt → Alt', async ({ page }) => {
    const pageErrors: Error[] = [];
    page.on('pageerror', (err) => pageErrors.push(err));

    await settOppKart(page);
    await page.goto(`${BASE}/map.html`);

    const knapp = page.locator('#toggle-labels-btn');

    // Trinn 1: alt synlig
    await expect(knapp).toHaveText(/Skjul navn/);
    await expect(pinner(page)).toHaveCount(2);
    await expect(navn(page).first()).toBeVisible();
    const antallFlater = await flater(page).count();
    expect(antallFlater).toBeGreaterThan(0);

    // Trinn 2: navnene borte, pinnene og flatene står
    await knapp.click();
    await expect(knapp).toHaveText(/Skjul alt/);
    await expect(navn(page)).toHaveCount(0);
    await expect(pinner(page)).toHaveCount(2);
    expect(await flater(page).count()).toBe(antallFlater);

    // Trinn 3: alt borte — dette er trinnet som gjør det mulig å zoome inn
    await knapp.click();
    await expect(knapp).toHaveText(/Vis alt/);
    await expect(pinner(page)).toHaveCount(0);
    await expect(navn(page)).toHaveCount(0);
    await expect(flater(page)).toHaveCount(0);

    // Trinn 4: tilbake til utgangspunktet, navnene inkludert
    await knapp.click();
    await expect(knapp).toHaveText(/Skjul navn/);
    await expect(pinner(page)).toHaveCount(2);
    await expect(navn(page).first()).toBeVisible();
    expect(await flater(page).count()).toBe(antallFlater);

    expect(
      pageErrors,
      `Uventede JS-feil under visningssykelen: ${pageErrors.map((e) => e.message).join('; ')}`,
    ).toHaveLength(0);
  });

  test('navnene dukker ikke opp igjen når lagene legges tilbake i navn-av-tilstand', async ({
    page,
  }) => {
    // Leaflet åpner en permanent tooltip på nytt av seg selv når laget legges til
    // kartet. Starter man med navn AV, går til «skjul alt» og tilbake, må
    // navnene fortsatt være av — ellers slår de på uoppfordret.
    await settOppKart(page, { lagretVisning: '0' });
    await page.goto(`${BASE}/map.html`);

    const knapp = page.locator('#toggle-labels-btn');
    await expect(knapp).toHaveText(/Skjul alt/);
    await expect(navn(page)).toHaveCount(0);

    await knapp.click(); // → skjul alt
    await expect(pinner(page)).toHaveCount(0);

    await knapp.click(); // → alt tilbake (inkl. navn, siden sykelen går til 'alt')
    await expect(knapp).toHaveText(/Skjul navn/);
    await expect(pinner(page)).toHaveCount(2);

    // Ett trykk til tar navnene av igjen, og de skal da holde seg av
    await knapp.click();
    await expect(navn(page)).toHaveCount(0);
    await knapp.click(); // skjul alt
    await knapp.click(); // alt — her er navn forventet PÅ igjen
    await expect(navn(page).first()).toBeVisible();
  });

  test('«skjul alt» huskes ikke — kartet åpner aldri tomt', async ({ page }) => {
    await settOppKart(page);
    await page.goto(`${BASE}/map.html`);

    const knapp = page.locator('#toggle-labels-btn');
    await knapp.click(); // skjul navn (lagres som '0')
    await knapp.click(); // skjul alt (skal IKKE lagres)
    await expect(pinner(page)).toHaveCount(0);

    const lagret = await page.evaluate(() => localStorage.getItem('mapShowLabels_v1'));
    expect(lagret).toBe('0');

    await page.reload();
    await expect(page.locator('#toggle-labels-btn')).toHaveText(/Skjul alt/);
    await expect(pinner(page)).toHaveCount(2);
  });

  test('info-boksen merkes «(skjult)» mens lokalitetene er skjult', async ({ page }) => {
    await settOppKart(page);
    await page.goto(`${BASE}/map.html`);

    const infoBox = page.locator('#info-box');
    await expect(infoBox).toBeVisible();
    await expect(page.locator('#site-count')).toHaveText('2');
    await expect(page.locator('#site-hidden-note')).toHaveText('');

    const knapp = page.locator('#toggle-labels-btn');
    await knapp.click();
    await knapp.click();
    // Antallet står, men det skal være tydelig HVORFOR kartet er tomt
    await expect(page.locator('#site-count')).toHaveText('2');
    await expect(page.locator('#site-hidden-note')).toHaveText(/skjult/);
  });

  test('panorering mens alt er skjult smetter ikke lokaliteter inn igjen', async ({ page }) => {
    // Den virkelig risikable stien: panorer-oppdateringen tegner nye lag inn i
    // siteLayerGroup mens gruppa IKKE er på kartet. De skal da heller ikke
    // havne på kartet — og ingenting skal kaste underveis (polygoner får
    // f.eks. `bringToFront()` på et lag uten renderer).
    const pageErrors: Error[] = [];
    page.on('pageerror', (err) => pageErrors.push(err));

    let kall = 0;
    await page.route('**/api/ao-sites*', async (route) => {
      kall++;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          sites: [
            {
              id: `PAN_${kall}`,
              name: `Panorert sted ${kall}`,
              lat: 60.42,
              lon: 5.35,
              isPrivate: false,
              raw: { accuracy: 90 },
            },
          ],
        }),
      });
    });

    // Tomt utgangspunkt, som i map-bbox-cache.spec.ts: med lokaliteter i
    // mapData kjører fitBounds ved første last og zoomer så tett inn at fire
    // piltrykk ikke flytter kartet forbi MIN_REFETCH_DISTANCE_M (750 m).
    await page.addInitScript(() => {
      localStorage.setItem(
        'mapData',
        JSON.stringify({
          userPosition: { lat: 60.393, lon: 5.323, accuracy: 20 },
          sites: [],
          sizeMeters: 1000,
        }),
      );
    });
    await page.goto(`${BASE}/map.html`);

    const knapp = page.locator('#toggle-labels-btn');
    await knapp.click(); // skjul navn
    await knapp.click(); // skjul alt
    await expect(pinner(page)).toHaveCount(0);

    // Panorer — henter nye lokaliteter for det nye senteret
    await page.locator('#map').click({ position: { x: 100, y: 400 } });
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(150);
    }
    await page.waitForTimeout(1200);

    expect(kall, 'Panorering skal fortsatt hente lokaliteter, bare ikke tegne dem').toBeGreaterThan(0);
    await expect(pinner(page)).toHaveCount(0);
    await expect(flater(page)).toHaveCount(0);

    // Ett trykk henter dem fram igjen — inkludert det som ble hentet mens de var skjult
    await knapp.click();
    await expect(knapp).toHaveText(/Skjul navn/);
    expect(await pinner(page).count()).toBeGreaterThan(0);

    expect(
      pageErrors,
      `Uventede JS-feil ved panorering i skjult tilstand: ${pageErrors.map((e) => e.message).join('; ')}`,
    ).toHaveLength(0);
  });

  test('polygonet ligger fortsatt over radius-sirkelen etter en tur innom «skjul alt»', async ({
    page,
  }) => {
    // Regresjonsvern for feltrapporten 01.10.2026: der en punktlokalitets
    // radius-sirkel dekker en polygonlokalitet, må polygonet ligge øverst —
    // ellers fanger sirkelen klikket og brukeren finner ikke noe sted å trykke
    // for å velge polygonet. `renderSites()` ordner det med bringToFront(), men
    // `map.removeLayer(siteLayerGroup)` river SVG-elementene ut av DOM-en, og
    // `addTo(map)` legger dem tilbake i gruppas innsettingsrekkefølge — altså
    // nøyaktig den rekkefølgen bringToFront() fins for å overstyre. Rekkefølgen
    // må derfor gjenopprettes hver gang gruppa legges tilbake.
    //
    // I SVG er senere element øverst og fanger klikket, så DOM-rekkefølgen ER
    // mekanismen: polygonet skal komme ETTER sirkelen.
    const sitesOverlapp = [
      {
        id: '201',
        name: 'Polygonlokalitet',
        lat: 60.393,
        lon: 5.323,
        raw: {
          isPolygon: true,
          polygonCoordinates: [
            [5.3225, 60.3925],
            [5.3235, 60.3925],
            [5.3235, 60.3935],
            [5.3225, 60.3935],
          ],
        },
      },
      // Tegnes ETTER polygonet, så sirkelen havner øverst uten bringToFront()
      { id: '202', name: 'Punktlokalitet med sirkel', lat: 60.393, lon: 5.323, raw: { accuracy: 400 } },
    ];

    // Radius-sirkelen er stiplet ('5 5'), polygonet er ikke — det skiller dem.
    const lagRekkefølge = () =>
      page.evaluate(() => {
        const paths = [...document.querySelectorAll('.leaflet-overlay-pane path')];
        // Nettleserne er ikke enige om separatoren ('5 5' vs '5,5'), så begge
        // strippes bort før sammenligningen.
        const erSirkel = (el: Element) =>
          (el.getAttribute('stroke-dasharray') || '').replace(/[\s,]/g, '') === '55';
        return {
          polygon: paths.findIndex((el) => !el.getAttribute('stroke-dasharray')),
          sirkel: paths.findIndex(erSirkel),
        };
      });

    await page.addInitScript((sites) => {
      localStorage.setItem(
        'mapData',
        JSON.stringify({
          userPosition: { lat: 60.393, lon: 5.323, accuracy: 20 },
          sites,
          sizeMeters: 1000,
        }),
      );
    }, sitesOverlapp);
    await page.goto(`${BASE}/map.html`);

    const før = await lagRekkefølge();
    expect(før.polygon, 'fant ikke polygonet').toBeGreaterThanOrEqual(0);
    expect(før.sirkel, 'fant ikke radius-sirkelen').toBeGreaterThanOrEqual(0);
    expect(før.polygon, 'polygonet skal ligge over sirkelen ved første last').toBeGreaterThan(
      før.sirkel,
    );

    const knapp = page.locator('#toggle-labels-btn');
    await knapp.click(); // skjul navn
    await knapp.click(); // skjul alt
    await expect(flater(page)).toHaveCount(0);
    await knapp.click(); // vis alt

    const etter = await lagRekkefølge();
    expect(
      etter.polygon,
      'polygonet skal FORTSATT ligge over sirkelen etter skjul/vis — ellers fanger sirkelen klikket',
    ).toBeGreaterThan(etter.sirkel);
  });

  test('knappens title motsier ikke teksten i skjult tilstand', async ({ page }) => {
    // På PC er title det man får ved hover. Med en fast title ville den i
    // «skjul alt»-tilstanden lovet det stikk motsatte av hva trykket gjør.
    await settOppKart(page);
    await page.goto(`${BASE}/map.html`);

    const knapp = page.locator('#toggle-labels-btn');
    await knapp.click();
    await knapp.click();
    await expect(knapp).toHaveText(/Vis alt/);
    await expect(knapp).toHaveAttribute('title', /[Vv]is/);
    const title = await knapp.getAttribute('title');
    expect(title, 'title skal ikke love å skjule når trykket viser').not.toMatch(/[Ss]kjul/);
  });
});
