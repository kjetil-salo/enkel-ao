import { test, expect } from '@playwright/test';

/**
 * Layout-tester for mobil (iPhone og Samsung Galaxy).
 *
 * Injiserer observasjoner via localStorage og verifiserer at:
 * - tabellen ikke overflower horisontalt
 * - edit/slett-knapper er synlige uten sideveis scroll
 * - skriftstørrelse er innenfor forventet intervall
 *
 * Disse testene beskytter mot regresjoner der kolonnebredder eller
 * knappestørrelser gjør at siste kolonne havner utenfor viewport.
 */

const MOCK_OBS = {
  version: 1,
  observations: [
    {
      species: { taxonId: 1, taxonName: 'granmeis' },
      count: 1,
      placeName: 'Sele, myrområde',
      activity: 'Sang/spill i hekketid og passende hekkebiotop',
      timestamp: new Date().toISOString(),
    },
    {
      species: { taxonId: 2, taxonName: 'hvitryggspett' },
      count: 1,
      placeName: 'Sele, myrområde',
      activity: 'Næringssøkende',
      timestamp: new Date().toISOString(),
    },
    {
      species: { taxonId: 3, taxonName: 'svarttrost' },
      count: 2,
      placeName: 'Sele, myrområde',
      activity: 'Sang/spill i hekketid og passende hekkebiotop',
      timestamp: new Date().toISOString(),
    },
  ],
};

test.beforeEach(async ({ page }) => {
  const base = process.env.BASE_URL || 'http://localhost:3000';
  await page.goto(base);
  await page.evaluate((obs) => {
    localStorage.setItem('fugleobservasjoner_v1', JSON.stringify(obs));
  }, MOCK_OBS);
  await page.reload();
  // Vent til tabellen er rendret
  await page.waitForSelector('.obs-table');
});

test('obs-tabell overflower ikke horisontalt', async ({ page }) => {
  const overflow = await page.evaluate(() => {
    const table = document.querySelector('.obs-table') as HTMLElement;
    const container = document.querySelector('.obs-list') as HTMLElement;
    if (!table || !container) return { tableWidth: 0, containerWidth: 0, overflows: false };
    return {
      tableWidth: table.scrollWidth,
      containerWidth: container.clientWidth,
      overflows: table.scrollWidth > container.clientWidth + 2, // 2px toleranse
    };
  });
  expect(overflow.overflows, `Tabell (${overflow.tableWidth}px) overflower container (${overflow.containerWidth}px)`).toBe(false);
});

test('edit- og slett-knapper er synlige innenfor viewport', async ({ page }) => {
  const viewportWidth = page.viewportSize()!.width;

  const editBtn = page.locator('.edit-obs-btn').first();
  const deleteBtn = page.locator('.delete-obs-btn').first();

  await expect(editBtn).toBeVisible();
  await expect(deleteBtn).toBeVisible();

  const editBox = await editBtn.boundingBox();
  const deleteBox = await deleteBtn.boundingBox();

  expect(editBox).not.toBeNull();
  expect(deleteBox).not.toBeNull();

  // Knappene skal ikke stikke utenfor høyre viewport-kant
  expect(editBox!.x + editBox!.width, 'edit-knapp stikker utenfor viewport').toBeLessThanOrEqual(viewportWidth + 1);
  expect(deleteBox!.x + deleteBox!.width, 'slett-knapp stikker utenfor viewport').toBeLessThanOrEqual(viewportWidth + 1);
});

test('artsnavn har rimelig skriftstørrelse (maks 16px)', async ({ page }) => {
  const fontSize = await page.evaluate(() => {
    const td = document.querySelector('.obs-table td:first-child') as HTMLElement;
    if (!td) return 0;
    return parseFloat(window.getComputedStyle(td).fontSize);
  });
  // Forventet: ~12-14px. Over 16px indikerer at Samsung system-font skalerer opp
  expect(fontSize, `Skrift i art-kolonne er ${fontSize}px — for stor`).toBeLessThanOrEqual(16);
});
