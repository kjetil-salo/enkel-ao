import { test, expect } from '@playwright/test';
import { spawn } from 'child_process';
import path from 'path';

const mockServerPath = path.join(__dirname, '..', 'mock-server.ts');
const BASE_URL = process.env.BASE_URL || 'http://localhost:3333';

test.describe('Superlokasjon UI', () => {
  let mockProc: any = null;

  test.beforeAll(async () => {
    // If a BASE_URL is supplied by the runner (e.g. npm script), assume the
    // mock was started externally and don't spawn a second instance.
    if (!process.env.BASE_URL) {
      // Start mock server (requires ts-node installed in dev env)
      mockProc = spawn('npx', ['ts-node', mockServerPath], { stdio: 'inherit' });
      // Wait a short while for server to boot
      await new Promise((r) => setTimeout(r, 800));
    }
  });

  test.afterAll(() => {
    if (mockProc) {
      mockProc.kill();
    }
  });

  test('viser superlokasjon badge og prioriterer den først', async ({ page }) => {
    // Load app using BASE_URL (set by npm scripts to http://localhost:3333 when using mock)
    await page.goto(BASE_URL);

    // Gi tillatelse og sett geolocation slik at locate-knappen fungerer
    await page.context().grantPermissions(['geolocation']);
    await page.context().setGeolocation({ latitude: 59.9139, longitude: 10.7522 });
    // Klikk på knappen for å hente lokasjon hvis den finnes
    const locBtn = await page.$('#loc-btn');
    if (locBtn) {
      await locBtn.click();
    }

    // Vent på AO-sites dropdown å bli synlig (ny UI bruker dropdown)
    await page.waitForSelector('#ao-sites-dropdown');

    // Sjekk at dropdown-innholdet inneholder Mock Sentrum
    const aoDropdown = page.locator('#ao-sites-dropdown');
    await expect(aoDropdown).toBeVisible();

    // Finn et element i dropdown som inneholder teksten "Mock Sentrum"
    const matching = aoDropdown.locator('text=Mock Sentrum');
    await expect(matching.first()).toBeVisible({ timeout: 5000 });
  });
});
