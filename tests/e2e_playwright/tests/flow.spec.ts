import { test, expect } from '@playwright/test';

// Smoke E2E: Oppdater posisjon -> søk art -> angi antall -> legg til og verifiser i liste

test('@smoke brukerflyt', async ({ page, request }) => {
  const base = process.env.BASE_URL || 'http://localhost:3000';
  await page.goto(base);

  // Klikk Oppdater posisjon
  await page.locator('#loc-btn').click();

  // Vent kort for UI-oppdatering
  await page.waitForTimeout(800);

  // Skriv i artssøk (felt id må matche frontend)
  const speciesInput = page.locator('#species-search');
  await speciesInput.fill('Gråtrost');
  await page.waitForTimeout(600);

  // Velg første forslag
  await page.locator('.ao-item').first().click();

  // Angi antall
  await page.locator('#count').fill('1');

  // Klikk legg til-knapp
  await page.locator('#add-btn').click();

  // Sjekk at listen nederst har minst en rad
  const rows = await page.locator('#observations-list .observation-row').count();
  expect(rows).toBeGreaterThan(0);
});
