import { test, expect, Page } from '@playwright/test';

const BASE = process.env.BASE_URL || 'http://localhost:3000';

function toLocalTimeStr(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function toLocalDateStr(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function toLocalTimestampStr(date: Date): string {
  const s = String(date.getSeconds()).padStart(2, '0');
  return `${toLocalDateStr(date)}T${toLocalTimeStr(date)}:${s}`;
}

async function injectObs(page: Page, now: Date) {
  const obs = {
    species: { taxonName: 'Blåmeis', taxonId: 58482, taxonGroupId: 8 },
    count: 1,
    placeName: 'Teststed',
    placeId: null,
    position: null,
    activity: 'Stasjonær',
    timestamp: toLocalTimestampStr(now),
    age: '',
    gender: '',
    coObservers: [],
  };
  await page.evaluate((o) => {
    localStorage.setItem('fugleobservasjoner_v1', JSON.stringify({ observations: [o] }));
  }, obs);
}

async function openClockModal(page: Page) {
  const clockBtn = page.locator('button[title="Sett klokkeslett for alle observasjoner på dette stedet"]');
  await expect(clockBtn).toBeVisible({ timeout: 3000 });
  await clockBtn.click();
  await expect(page.locator('#time-modal-fra')).toBeVisible({ timeout: 2000 });
}

test.describe('Tidsvalidering — 🕐-modal', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE);
    await page.evaluate(() => localStorage.clear());
    const now = new Date();
    await injectObs(page, now);
    await page.reload();
  });

  test('blokkerer fremtidig fra-tid og viser toast', async ({ page }) => {
    const future = new Date(Date.now() + 5 * 60_000);
    await openClockModal(page);

    await page.fill('#time-modal-fra', toLocalTimeStr(future));
    await page.click('#time-modal-apply');

    const toast = page.locator('#registered-toast');
    await expect(toast).toBeVisible({ timeout: 3000 });
    await expect(toast).toContainText('frem i tid');
    // Modalen skal fortsatt være åpen
    await expect(page.locator('#time-modal-fra')).toBeVisible();
  });

  test('fra-input får rød kant ved fremtidig tid', async ({ page }) => {
    const future = new Date(Date.now() + 5 * 60_000);
    await openClockModal(page);

    await page.fill('#time-modal-fra', toLocalTimeStr(future));
    await page.click('#time-modal-apply');

    const borderColor = await page.locator('#time-modal-fra').evaluate(
      (el: any) => el.style.borderColor
    );
    expect(borderColor).toBe('rgb(239, 68, 68)');
  });

  test('rød kant forsvinner når bruker endrer fra-tid', async ({ page }) => {
    const future = new Date(Date.now() + 5 * 60_000);
    const past = new Date(Date.now() - 30 * 60_000);
    await openClockModal(page);

    await page.fill('#time-modal-fra', toLocalTimeStr(future));
    await page.click('#time-modal-apply');
    // Rød kant settes
    await page.fill('#time-modal-fra', toLocalTimeStr(past));
    // Input-hendelse skal nullstille kanten
    const borderColor = await page.locator('#time-modal-fra').evaluate(
      (el: any) => el.style.borderColor
    );
    expect(borderColor).toBe('');
  });

  test('blokkerer fremtidig til-tid (gyldig fra-tid)', async ({ page }) => {
    const past = new Date(Date.now() - 30 * 60_000);
    const future = new Date(Date.now() + 5 * 60_000);
    await openClockModal(page);

    await page.fill('#time-modal-fra', toLocalTimeStr(past));
    await page.fill('#time-modal-til', toLocalTimeStr(future));
    await page.click('#time-modal-apply');

    const toast = page.locator('#registered-toast');
    await expect(toast).toBeVisible({ timeout: 3000 });
    await expect(toast).toContainText('Til-tid');
    await expect(toast).toContainText('frem i tid');
  });

  test('godtar fortids fra- og til-tid og lukker modal', async ({ page }) => {
    const fraTime = new Date(Date.now() - 60 * 60_000);
    const tilTime = new Date(Date.now() - 10 * 60_000);
    await openClockModal(page);

    await page.fill('#time-modal-fra', toLocalTimeStr(fraTime));
    await page.fill('#time-modal-til', toLocalTimeStr(tilTime));
    await page.click('#time-modal-apply');

    // Modalen skal lukkes ved gyldig input
    await expect(page.locator('#time-modal')).not.toBeVisible({ timeout: 2000 });
  });
});

test.describe('Tidsvalidering — etterregistreringsmodus', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE);
    await page.evaluate(() => {
      localStorage.clear();
      localStorage.setItem('afterRegistrationMode', '1');
    });
    await page.reload();
    // Fyll inn sted
    await page.fill('#place', 'Teststed');
    // Søk opp og velg art
    await page.fill('#search', 'meis');
    const firstResult = page.locator('#results .result-item').first();
    await expect(firstResult).toBeVisible({ timeout: 5000 });
    await firstResult.click();
    // Sett antall
    await page.fill('#count', '2');
  });

  test('blokkerer fremtidig fra-tid og viser toast', async ({ page }) => {
    const today = toLocalDateStr(new Date());
    const future = new Date(Date.now() + 5 * 60_000);
    await page.fill('#obs-date', today);
    await page.fill('#obs-time', toLocalTimeStr(future));

    // Klikk aktivitetspill for å committe
    const pill = page.locator('.activity-pill').first();
    await expect(pill).toBeVisible({ timeout: 2000 });
    await pill.click();

    const toast = page.locator('#registered-toast');
    await expect(toast).toBeVisible({ timeout: 3000 });
    await expect(toast).toContainText('frem i tid');
  });

  test('blokkerer fremtidig til-tid (gyldig fra-tid)', async ({ page }) => {
    const today = toLocalDateStr(new Date());
    const past = new Date(Date.now() - 30 * 60_000);
    const future = new Date(Date.now() + 5 * 60_000);
    await page.fill('#obs-date', today);
    await page.fill('#obs-time', toLocalTimeStr(past));
    await page.fill('#obs-time-to', toLocalTimeStr(future));

    const pill = page.locator('.activity-pill').first();
    await expect(pill).toBeVisible({ timeout: 2000 });
    await pill.click();

    const toast = page.locator('#registered-toast');
    await expect(toast).toBeVisible({ timeout: 3000 });
    await expect(toast).toContainText('frem i tid');
  });

  test('godtar fortids fra-tid og registrerer obs', async ({ page }) => {
    const today = toLocalDateStr(new Date());
    const past = new Date(Date.now() - 30 * 60_000);
    await page.fill('#obs-date', today);
    await page.fill('#obs-time', toLocalTimeStr(past));

    const pill = page.locator('.activity-pill').first();
    await expect(pill).toBeVisible({ timeout: 2000 });
    await pill.click();

    // Toast skal vise artsnavnet, ikke feilmelding
    const toast = page.locator('#registered-toast');
    await expect(toast).toBeVisible({ timeout: 3000 });
    await expect(toast).not.toContainText('frem i tid');
  });
});
