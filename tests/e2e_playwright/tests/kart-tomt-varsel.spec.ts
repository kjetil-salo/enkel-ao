import { test, expect } from '@playwright/test';

// I offline-modus settes manglende kartfliser til en gjennomsiktig 1x1-PNG.
// Resultatet er et helt tomt kart med lokalitetspinner oppa - og uten en
// forklaring leser det som at kartet er odelagt, ikke som at omradet aldri ble
// lastet ned (feltmelding 05.11.2026). Varselet teller fliser framfor a gjette
// pa modus: hybrid uten dekning ender i samme tomme kart.
test.use({ serviceWorkers: 'block' });

test('offline uten nedlastet omrade forklarer hvorfor kartet er tomt', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('network_mode_v1', 'offline'));
  await page.goto('/map.html');
  const varsel = page.locator('#tomt-kart-varsel');
  await expect(varsel).toBeVisible({ timeout: 15000 });
  await expect(varsel).toContainText(/Offline-modus/);
  await expect(varsel).toContainText(/ikke lastet ned/);
  // Veien ut skal vaere ett trykk unna naar man staar i offline med vilje.
  await expect(varsel.locator('#tomt-kart-varsel-online-btn')).toBeVisible();

  // Lukket varsel skal ikke dukke opp igjen ved neste flispulje.
  await varsel.locator('#tomt-kart-varsel-lukk-btn').click();
  await expect(varsel).toBeHidden();
});

test('hybrid uten dekning peker pa dekning, ikke pa offline-modus', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('network_mode_v1', 'hybrid'));
  await page.route('**/*.png', route => route.abort());
  await page.goto('/map.html');
  const varsel = page.locator('#tomt-kart-varsel');
  await expect(varsel).toBeVisible({ timeout: 15000 });
  await expect(varsel).toContainText(/ingen dekning/);
  // Man ER online her; a tilby «Bytt til Online» ville vaert meningslost.
  await expect(varsel.locator('#tomt-kart-varsel-online-btn')).toBeHidden();
});

test('et kart som faktisk viser fliser gir ingen varsel', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('network_mode_v1', 'online'));
  await page.goto('/map.html');
  await expect(page.locator('.leaflet-tile-loaded').first()).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(1500);
  await expect(page.locator('#tomt-kart-varsel')).toBeHidden();
});
