import { test, expect } from '../fixtures';
import type { Page } from '@playwright/test';

/**
 * Dublett-vern ved publisering.
 *
 * Lista tømmes ikke automatisk etter sending. Svarer brukeren nei på «tøm lista?»
 * og registrerer nye funn senere, ville et nytt trykk sendt de gamle på nytt — og
 * de blir liggende dobbelt i AO. Advarselen skal være stille når alt er nytt.
 */

const BASE = process.env.BASE_URL || 'http://localhost:3000';

function obs(taxonName: string, sentTs?: string) {
  return {
    species: { taxonName, taxonId: 58482, taxonGroupId: 8 },
    count: 2,
    placeName: 'Teststed',
    placeId: null,
    position: null,
    activity: 'Stasjonær',
    timestamp: '2026-07-26T15:00:00',
    age: '',
    gender: '',
    coObservers: [],
    ...(sentTs ? { sentTs } : {}),
  };
}

async function seed(page: Page, observations: object[]) {
  await page.evaluate((o) => {
    localStorage.setItem('fugleobservasjoner_v1', JSON.stringify({ version: 1, observations: o }));
    // Direktesending krever lagret innlogging for at knappen skal gjøre noe
    localStorage.setItem('ao_username', 'testbruker');
    localStorage.setItem('ao_password', 'testpassord');
  }, observations);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(400);

  // Nyhets-splashen legger seg over knappene
  const splash = page.locator('.news-splash-button');
  if (await splash.count()) {
    await splash.click();
    await page.waitForTimeout(200);
  }
}

test.describe('Dublett-vern ved publisering', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/ao-login', route => route.fulfill({
      json: { success: true, loginToken: 'mock-token', authCookie: 'mock-cookie', userId: '42' },
    }));
    await page.goto(BASE);
  });

  test('viser ✓-merke på observasjoner som allerede er sendt', async ({ page }) => {
    await seed(page, [obs('Blåmeis', '2026-07-26T18:30:00'), obs('Kjøttmeis')]);
    await expect(page.locator('.obs-sent-badge')).toHaveCount(1);
  });

  test('advarer når lista inneholder allerede sendte funn', async ({ page }) => {
    await seed(page, [
      obs('Blåmeis', '2026-07-26T18:30:00'),
      obs('Gråtrost', '2026-07-26T18:30:00'),
      obs('Kjøttmeis'),
    ]);

    await page.locator('#ao-direct-btn').click();
    await expect(page.locator('#dub-nye')).toBeVisible({ timeout: 3000 });

    const tekst = await page.locator('#dub-nye').locator('..').innerText();
    expect(tekst).toContain('2 av disse 3');
    expect(tekst).toContain('dobbelt');
  });

  test('avbryt lukker dialogen uten å sende', async ({ page }) => {
    await seed(page, [obs('Blåmeis', '2026-07-26T18:30:00'), obs('Kjøttmeis')]);

    await page.locator('#ao-direct-btn').click();
    await expect(page.locator('#dub-nye')).toBeVisible({ timeout: 3000 });
    await page.locator('#dub-avbryt').click();

    await expect(page.locator('#dub-nye')).toHaveCount(0);
    // Ingen sending startet → ingen fremdriftsvisning
    await expect(page.locator('.ao-progress-track')).toHaveCount(0);
  });

  test('er stille når ingenting er sendt fra før', async ({ page }) => {
    await seed(page, [obs('Kjøttmeis'), obs('Blåmeis')]);

    await page.locator('#ao-direct-btn').click();
    await page.waitForTimeout(600);
    await expect(page.locator('#dub-nye')).toHaveCount(0);
  });

  test('kopierer bare valgte funn og åpner AO3 med ett klikk når lista krever manuell kontroll', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: async (tekst: string) => { sessionStorage.setItem('test-ao3-kopi', tekst); } },
      });
    });
    await page.route('**/api/ao-import-stream', (route) => route.fulfill({
      contentType: 'text/event-stream',
      body: 'data: {"phase":"error","code":"ao2_unavailable_before_import"}\n\n',
    }));
    const importside = 'https://mobil.artsobservasjoner.no/contribute/import';
    await page.context().route(importside, route => route.fulfill({ body: 'AO3-import' }));
    await page.route('**/api/log-export', route => route.fulfill({ json: { ok: true } }));
    await page.route('**/api/ao3-import', route => route.fulfill({ json: { code: 'ao3_manual' } }));

    const nyttFunn = { ...obs('Kjøttmeis'), placeId: 123, privateComment: 'Første linje\nAndre linje', uncertain: true };
    await seed(page, [obs('Blåmeis', '2026-07-26T18:30:00'), nyttFunn]);
    await page.evaluate(() => localStorage.setItem('ao_username', 'test@example.org'));
    await page.locator('#ao-direct-btn').click();
    await page.locator('#dub-nye').click();

    const status = page.locator('#ao-direct-status');
    await status.getByRole('button', { name: 'Publiser via AO3' }).click();
    await expect(status).toContainText('krever manuell kontroll');
    await expect(status.locator('button, a')).toHaveCount(1);
    const loggkall = page.waitForRequest('**/api/log-export');
    const nyFane = page.context().waitForEvent('page');
    await status.getByRole('button', { name: 'Kopier og åpne AO3' }).click();
    await expect(await nyFane).toHaveURL(importside);
    await expect(status).toContainText('Kopiert.');
    expect((await loggkall).postDataJSON()).toEqual({ type: 'copy_ao3' });

    const tekst = await page.evaluate(() => sessionStorage.getItem('test-ao3-kopi'));
    const [overskrift, rad] = tekst!.split('\n');
    const kolonner = overskrift.split('\t');
    const felt = rad.split('\t');
    expect(tekst!.split('\n')).toHaveLength(2);
    expect(felt).toHaveLength(kolonner.length);
    expect(felt[kolonner.indexOf('Artsnavn')]).toBe('Kjøttmeis');
    expect(felt[kolonner.indexOf('Lokalitetsnavn')]).toBe('Teststed');
    expect(felt[kolonner.indexOf('Privat merknad (kun synlig for deg selv)')]).toBe('Første linje Andre linje');
    expect(felt[kolonner.indexOf('Usikker artsbestemming')]).toBe('X');
    await expect(page.locator('.obs-sent-badge')).toHaveCount(1);
  });

  test('tilbyr ingen ny sending når proxyen svarer 503 på importen uten kvittering', async ({ page }) => {
    await page.route('**/api/ao-import-stream', (route) => route.fulfill({ status: 503, body: 'Utilgjengelig' }));
    await seed(page, [obs('Kjøttmeis')]);
    await page.locator('#ao-direct-btn').click();

    const status = page.locator('#ao-direct-status');
    await expect(status).toContainText('Sendingen kunne ikke bekreftes. Listen er beholdt.');
    await expect(status.locator('button, a')).toHaveCount(0);
    await expect(page.locator('.obs-sent-badge')).toHaveCount(0);

    let innlogginger = 0;
    await page.route('**/api/ao-login', (route) => {
      innlogginger++;
      return route.fulfill({ status: 503, json: { code: 'ao2_unavailable_before_import' } });
    });
    await page.reload();
    await page.locator('#ao-direct-btn').click();
    const modal = page.locator('#uavklarte-send-confirm-modal');
    await expect(modal).toBeVisible();
    await expect(modal).toContainText('Har du sjekket både publiserte funn og funn til gjennomgang');
    await modal.locator('[data-confirm-action="cancel"]').click();
    expect(innlogginger).toBe(0);
  });

  test('ber om bekreftelse før direkte AO3-publisering ved bekreftet AO2-feil', async ({ page }) => {
    await page.route('**/api/ao-login', (route) => route.fulfill({
      status: 503, json: { code: 'ao2_unavailable_before_import' },
    }));
    let ao3Kall = 0;
    await page.route('**/api/ao3-import', (route) => {
      ao3Kall++;
      return route.fulfill({ json: { success: true, via: 'ao3', published: true, count: 1 } });
    });
    await page.route('**/api/log-export', route => route.fulfill({ json: { ok: true } }));
    await seed(page, [obs('Kjøttmeis')]);
    await page.evaluate(() => localStorage.setItem('ao_username', 'test@example.org'));
    await page.locator('#ao-direct-btn').click();
    const status = page.locator('#ao-direct-status');
    await expect(status).toContainText('AO2 er utilgjengelig');
    await expect(status.locator('button, a')).toHaveCount(1);
    expect(ao3Kall).toBe(0);
    const reservekall = page.waitForRequest('**/api/ao3-import');
    await status.getByRole('button', { name: 'Publiser via AO3' }).click();
    expect((await reservekall).postDataJSON().observations).toHaveLength(1);
    await expect(status).toContainText('1 observasjon sendt til AO3');
    await expect(page.locator('.obs-sent-badge')).toHaveCount(1);
  });

  test('viser AO-innstillinger ved AO2-feil for en bruker med alias', async ({ page }) => {
    await page.route('**/api/ao-login', route => route.fulfill({
      status: 503, json: { code: 'ao2_unavailable_before_import' },
    }));
    await seed(page, [obs('Kjøttmeis')]);
    await page.locator('#ao-direct-btn').click();
    const status = page.locator('#ao-direct-status');
    await expect(status).toContainText('e-postadressen til samme AO-konto');
    await expect(status.locator('button, a')).toHaveCount(1);
    await status.getByRole('link', { name: 'Gå til AO-innlogging' }).click();
    await expect(page).toHaveURL(/\/profil\.html#ao-username$/);
  });

  test('husker uavklart sending når siden lastes på nytt før kvitteringen', async ({ page }) => {
    let slippImport = () => {};
    const ventPåOmlasting = new Promise<void>((resolve) => { slippImport = resolve; });
    await page.route('**/api/ao-import-stream', async (route) => {
      await ventPåOmlasting;
      await route.abort().catch(() => {});
    });
    await seed(page, [obs('Kjøttmeis')]);
    const importkall = page.waitForRequest('**/api/ao-import-stream');
    await page.locator('#ao-direct-btn').click();
    await importkall;
    try {
      await page.reload({ waitUntil: 'domcontentloaded' });
    } finally {
      slippImport();
    }

    await page.locator('#ao-direct-btn').click();
    const modal = page.locator('#uavklarte-send-confirm-modal');
    await expect(modal).toBeVisible();
    await expect(modal).toContainText('Har du sjekket både publiserte funn og funn til gjennomgang');
    await modal.locator('[data-confirm-action="cancel"]').click();
    await expect(page.locator('.obs-sent-badge')).toHaveCount(0);
  });
});
