import { test, expect } from '../fixtures';
import type { Page, Route } from '@playwright/test';

/**
 * Sjeldenhetsvarsel i observasjonsskjemaet (public/js/rarity.js).
 *
 * Dekker: uinnlogget = aldri fetch, Warning vises, Information alene vises
 * ikke (v1-terskel), boksen skjules umiddelbart ved art-/stedsendring,
 * memoisering (samme nøkkel = ingen ny fetch), race ved rask endring før
 * debounce, og at AO-/nettverksfeil er et stille no-op.
 */

const BASE = process.env.BASE_URL || 'http://localhost:3000';

const GRASPURV = {
  taxonId: 4126,
  taxonName: 'Gråspurv',
  scientificNameHtml: '<em>Passer domesticus</em>',
  speciesGroupId: 8,
  protectionLevelId: 1,
  leaf: true,
};

const BLAMEIS = {
  taxonId: 5968,
  taxonName: 'Blåmeis',
  scientificNameHtml: '<em>Cyanistes caeruleus</em>',
  speciesGroupId: 8,
  protectionLevelId: 1,
  leaf: true,
};

async function mockSpecies(page: Page) {
  await page.route('**/api/species*', async (route: Route) => {
    const url = new URL(route.request().url());
    const search = (url.searchParams.get('search') || '').toLowerCase();
    let items: any[] = [];
    if (search.includes('gråspurv') || search.includes('graspurv')) items = [GRASPURV];
    else if (search.includes('blåmeis') || search.includes('blameis')) items = [BLAMEIS];
    else items = [GRASPURV, BLAMEIS];
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(items) });
  });
}

// fetchAndCachePrivateSites() kjøres automatisk på DOMContentLoaded når
// ao_tokens.authCookie er satt — stubb den slik at innlogget-tester ikke
// gjør et uventet ekte kall mot AO.
async function mockPrivateSites(page: Page) {
  await page.route('**/api/ao-private-sites*', async (route: Route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sites: [] }) });
  });
}

async function setLoggedIn(page: Page) {
  await page.evaluate(() => {
    localStorage.setItem('ao_tokens', JSON.stringify({
      loginToken: 'tok-123', authCookie: 'cookie-abc', userId: '42',
    }));
  });
}

async function setPlace(page: Page, name: string, id: number) {
  await page.evaluate(({ name, id }) => {
    localStorage.setItem('selectedLocation', name);
    localStorage.setItem('selectedLocationId', String(id));
  }, { name, id });
}

async function velgArt(page: Page, sok: string) {
  await page.fill('#search', sok);
  const treff = page.locator('#results .result-item').first();
  await expect(treff).toBeVisible({ timeout: 5000 });
  await treff.click();
}

const rarityBox = (page: Page) => page.locator('#rarity-warning');

test.describe('Sjeldenhetsvarsel', () => {
  test.beforeEach(async ({ page }) => {
    await mockSpecies(page);
    await mockPrivateSites(page);
    await page.goto(BASE);
    await page.evaluate(() => localStorage.clear());
  });

  test('uinnlogget: ingen fetch til /api/ao-rarity, boks vises aldri', async ({ page }) => {
    let rarityCalls = 0;
    await page.route('**/api/ao-rarity*', async (route: Route) => {
      rarityCalls++;
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ warning: { Header: 'Skal aldri vises', Body: 'x' } }),
      });
    });

    await setPlace(page, 'Tovo', 9001);
    await page.reload({ waitUntil: 'domcontentloaded' });

    await velgArt(page, 'gråspurv');
    await page.fill('#count', '1');

    // Vent vesentlig lenger enn debounce (400ms) for å gi et evt. fetch tid til å skje
    await page.waitForTimeout(800);

    expect(rarityCalls).toBe(0);
    await expect(rarityBox(page)).toBeHidden();
  });

  test('innlogget + Warning: boksen vises med riktig Header/Body', async ({ page }) => {
    await setLoggedIn(page);
    await setPlace(page, 'Tovo', 9001);
    await page.reload({ waitUntil: 'domcontentloaded' });

    let capturedUrl = '';
    let capturedHeaders: Record<string, string> = {};
    await page.route('**/api/ao-rarity*', async (route: Route) => {
      capturedUrl = route.request().url();
      capturedHeaders = route.request().headers();
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ warning: { Header: 'Sjelden art!', Body: 'Denne arten er sjelden sett her.' } }),
      });
    });

    await velgArt(page, 'gråspurv');
    await page.fill('#count', '1');

    await expect(rarityBox(page)).toBeVisible({ timeout: 2000 });
    await expect(page.locator('#rarity-warning-header')).toHaveText('Sjelden art!');
    await expect(page.locator('#rarity-warning-body')).toHaveText('Denne arten er sjelden sett her.');

    expect(capturedUrl).toContain('taxonId=4126');
    expect(capturedUrl).toContain('siteId=9001');
    expect(capturedHeaders['x-ao-login-token']).toBe('tok-123');
  });

  test('innlogget + kun Information (ingen Warning): boksen vises ikke', async ({ page }) => {
    await setLoggedIn(page);
    await setPlace(page, 'Tovo', 9001);
    await page.reload({ waitUntil: 'domcontentloaded' });

    let rarityCalls = 0;
    await page.route('**/api/ao-rarity*', async (route: Route) => {
      rarityCalls++;
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ information: { Header: 'FYI', Body: 'Bare til informasjon.' } }),
      });
    });

    await velgArt(page, 'gråspurv');
    await page.fill('#count', '1');

    // Gi fetchen tid til å fullføre
    await page.waitForTimeout(800);

    expect(rarityCalls).toBe(1);
    await expect(rarityBox(page)).toBeHidden();
  });

  test('boksen skjules umiddelbart når arten endres', async ({ page }) => {
    await setLoggedIn(page);
    await setPlace(page, 'Tovo', 9001);
    await page.reload({ waitUntil: 'domcontentloaded' });

    await page.route('**/api/ao-rarity*', async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ warning: { Header: 'Sjelden art!', Body: 'x' } }),
      });
    });

    await velgArt(page, 'gråspurv');
    await page.fill('#count', '1');
    await expect(rarityBox(page)).toBeVisible({ timeout: 2000 });

    // Begynn å skrive et nytt artssøk — boksen skal skjules med det samme,
    // lenge før en ny debounce/fetch kan ha kommet tilbake.
    await page.fill('#search', 'g');
    await expect(rarityBox(page)).toBeHidden({ timeout: 200 });
  });

  test('boksen skjules umiddelbart når lokasjonen fjernes', async ({ page }) => {
    await setLoggedIn(page);
    await setPlace(page, 'Tovo', 9001);
    await page.reload({ waitUntil: 'domcontentloaded' });

    await page.route('**/api/ao-rarity*', async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ warning: { Header: 'Sjelden art!', Body: 'x' } }),
      });
    });

    await velgArt(page, 'gråspurv');
    await page.fill('#count', '1');
    await expect(rarityBox(page)).toBeVisible({ timeout: 2000 });

    // Stedsfeltet er kollapset til en festet linje etter valg — «Bytt plass»
    // åpner det igjen (samme mønster som bytt-lokalitet.spec.ts).
    await page.locator('#loc-change-btn').click();
    await page.fill('#place', '');
    await expect(rarityBox(page)).toBeHidden({ timeout: 200 });
  });

  test('samme art+lokasjon+dato sjekkes ikke på nytt når kun Antall endres', async ({ page }) => {
    await setLoggedIn(page);
    await setPlace(page, 'Tovo', 9001);
    await page.reload({ waitUntil: 'domcontentloaded' });

    let rarityCalls = 0;
    await page.route('**/api/ao-rarity*', async (route: Route) => {
      rarityCalls++;
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ warning: { Header: 'Sjelden art!', Body: 'x' } }),
      });
    });

    await velgArt(page, 'gråspurv');
    await page.fill('#count', '1');
    await expect(rarityBox(page)).toBeVisible({ timeout: 2000 });
    expect(rarityCalls).toBe(1);

    // Endre bare antallet flere ganger
    await page.fill('#count', '2');
    await page.fill('#count', '3');
    await page.waitForTimeout(800);

    expect(rarityCalls).toBe(1);
    await expect(rarityBox(page)).toBeVisible();
  });

  test('race: raskt artsbytte før debounce fyrer viser aldri et utdatert svar', async ({ page }) => {
    await setLoggedIn(page);
    await setPlace(page, 'Tovo', 9001);
    await page.reload({ waitUntil: 'domcontentloaded' });

    await page.route('**/api/ao-rarity*', async (route: Route) => {
      const url = new URL(route.request().url());
      const taxonId = url.searchParams.get('taxonId');
      if (taxonId === String(GRASPURV.taxonId)) {
        // Simuler en treg respons for den FORLATTE arten
        await new Promise((r) => setTimeout(r, 900));
        await route.fulfill({
          status: 200, contentType: 'application/json',
          body: JSON.stringify({ warning: { Header: 'UTDATERT (gråspurv)', Body: 'skal aldri vises' } }),
        });
      } else {
        await route.fulfill({
          status: 200, contentType: 'application/json',
          body: JSON.stringify({ warning: { Header: 'GJELDENDE (blåmeis)', Body: 'ny art' } }),
        });
      }
    });

    // Velg gråspurv, og la debouncen faktisk fyre (>400ms) slik at fetchen
    // for gråspurv er underveis (og henger i 900ms) når vi bytter art.
    await velgArt(page, 'gråspurv');
    await page.fill('#count', '1');
    await page.waitForTimeout(500);

    // Bytt til blåmeis FØR gråspurv-fetchen har rukket å svare
    await velgArt(page, 'blåmeis');
    await page.fill('#count', '1');

    // Vent til begge har hatt god tid til å fullføre
    await page.waitForTimeout(1200);

    // Kun det gjeldende (blåmeis) skal vises — aldri det utdaterte svaret
    await expect(rarityBox(page)).toBeVisible({ timeout: 500 });
    await expect(page.locator('#rarity-warning-header')).toHaveText('GJELDENDE (blåmeis)');
  });

  test('AO-feil (500, ugyldig JSON, nettverksfeil) er et stille no-op', async ({ page }) => {
    await setLoggedIn(page);
    await setPlace(page, 'Tovo', 9001);
    await page.reload({ waitUntil: 'domcontentloaded' });

    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(String(err)));

    let call = 0;
    await page.route('**/api/ao-rarity*', async (route: Route) => {
      call++;
      if (call === 1) {
        await route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"boom"}' });
      } else if (call === 2) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: 'ikke-json{{{' });
      } else {
        await route.abort('failed');
      }
    });

    // 1) 500-feil
    await velgArt(page, 'gråspurv');
    await page.fill('#count', '1');
    await page.waitForTimeout(700);
    await expect(rarityBox(page)).toBeHidden();

    // 2) Ugyldig JSON — bytt art for å trigge nytt kall (ny nøkkel,
    // samme lokalitet). Manuell redigering av #place nullstiller alltid ID
    // (og dermed nøkkelen), så artsbytte er den riktige måten å trigge et
    // nytt kall på uten å miste siteId.
    await velgArt(page, 'blåmeis');
    await page.fill('#count', '1');
    await page.waitForTimeout(700);
    await expect(rarityBox(page)).toBeHidden();

    // 3) Nettverksfeil (abort) — bytt tilbake til gråspurv for enda et nytt kall
    await velgArt(page, 'gråspurv');
    await page.fill('#count', '1');
    await page.waitForTimeout(700);
    await expect(rarityBox(page)).toBeHidden();

    expect(call).toBe(3);
    expect(pageErrors).toEqual([]);

    // Appen skal fortsatt fungere normalt: kan registrere en observasjon
    const pill = page.locator('.activity-pill').first();
    await expect(pill).toBeVisible({ timeout: 2000 });
    await pill.click();
    await expect(page.locator('#registered-toast')).toBeVisible({ timeout: 3000 });
  });
});
