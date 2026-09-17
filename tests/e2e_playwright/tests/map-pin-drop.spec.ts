import { test, expect } from '../fixtures';

/**
 * Ny lokasjon fra kartet (pin-drop): pluss-knapp → trykk på kartet → opprett-panel.
 *
 * Skrevet etter en reell regresjon: radius-sirkel-funksjonen (v1.53.5) la til et
 * kall på `dropMarker.bringToFront()`, en metode som ikke finnes på L.Marker
 * (kun på L.Path-lag som sirkler/polygoner). Det kastet en TypeError midt inne i
 * kart-klikk-handleren, rett etter at pin-en ble plassert — brukeren satt igjen
 * med en rød pin og «Trykk på kartet»-hintet fortsatt synlig, uten at
 * opprett-panelet noensinne dukket opp. Testen fanger klassen av feil (en
 * uncaught exception som stopper handleren midtveis), ikke bare dette ene
 * symptomet.
 */

const BASE = process.env.BASE_URL || 'http://localhost:3000';

test.describe('Opprett ny lokasjon fra kartet', () => {
  test.beforeEach(async ({ page }) => {
    // map.js krever mapData i localStorage (satt av location.js før navigering
    // til /map.html i den ekte appen) og AO-credentials for å vise FAB-knappen.
    await page.addInitScript(() => {
      localStorage.setItem(
        'mapData',
        JSON.stringify({ userPosition: { lat: 60.393, lon: 5.323, accuracy: 20 }, sites: [] }),
      );
      localStorage.setItem('ao_username', 'testbruker');
      localStorage.setItem('ao_password', 'testpassord');
    });
  });

  test('pluss-knapp + klikk på kartet åpner opprett-panelet uten JS-feil', async ({ page }) => {
    const pageErrors: Error[] = [];
    page.on('pageerror', (err) => pageErrors.push(err));

    await page.goto(`${BASE}/map.html`);
    await page.locator('#add-site-fab').click();
    await expect(page.locator('#pin-drop-hint')).toBeVisible();

    // Klikk et sted nede til venstre på kartflaten — unna hint-banneret øverst,
    // brukerposisjon-markøren midt i, og «Skjul navn»/pluss-knappene øverst til høyre.
    // Absolutte koordinater må holde seg innenfor det minste testviewportet (360px bredt).
    await page.locator('#map').click({ position: { x: 60, y: 400 } });

    await expect(page.locator('#create-site-panel')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('#new-site-name')).toBeVisible();
    await expect(page.locator('#pin-drop-hint')).toBeHidden();

    expect(pageErrors, `Uventede JS-feil under pin-drop: ${pageErrors.map((e) => e.message).join('; ')}`).toHaveLength(0);
  });
});
