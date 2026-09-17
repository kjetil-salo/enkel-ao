import { test, expect } from '../fixtures';
import { VERSION } from '../../../public/js/version.js';

/**
 * Kartsidens skript må lastes med en versjonert URL (?v=...), akkurat som
 * main.js på hovedsiden.
 *
 * Skrevet etter en reell hendelse: v1.53.6 fikset en ekte bug i map.js, men
 * brukeren fortsatte å se den gamle, ødelagte oppførselen etter deploy.
 * Årsaken var ikke koden — Cloudflare overstyrer JS-filers Cache-Control til
 * max-age=14400 (4 timer), og map.html lastet `/js/map.js` uten noen
 * versjons-query. En vanlig sideoppdatering endrer da ikke URL-en, så både
 * Cloudflares edge-cache og nettleserens egen HTTP-cache kan fortsette å
 * servere en utdatert fil i opptil 4 timer — helt uavhengig av hva som
 * faktisk er deployet på serveren. index.html unngår dette ved å laste
 * main.js som `/js/main.js?v=<VERSION>`; map.html manglet det samme
 * mønsteret. Denne testen fanger regresjonen ved neste versjonsbump: hvis
 * noen glemmer å oppdatere querystringen i map.html, feiler testen.
 */

const BASE = process.env.BASE_URL || 'http://localhost:3000';

test.describe('Kartsidens skript er versjonert (cache-brytning)', () => {
  test('map.js lastes med ?v=<gjeldende VERSION>', async ({ page }) => {
    // Uten mapData i localStorage kaster map.js tidlig og skriver over hele
    // <body> (inkl. selve script-taggen som lastet den) med en feilmelding —
    // da finnes det ingenting å sjekke src på lenger. Sett gyldig mapData
    // først, som i den ekte appen (location.js før navigering til /map.html).
    await page.addInitScript(() => {
      localStorage.setItem(
        'mapData',
        JSON.stringify({ userPosition: { lat: 60.393, lon: 5.323, accuracy: 20 }, sites: [] }),
      );
    });

    await page.goto(`${BASE}/map.html`);

    const src = await page.evaluate(() => {
      const script = [...document.scripts].find((s) => s.src.includes('/js/map.js'));
      return script ? script.getAttribute('src') : null;
    });

    expect(src, 'Fant ingen <script src="/js/map.js"> på kartsiden').not.toBeNull();
    expect(src).toContain(`?v=${VERSION}`);
  });
});
