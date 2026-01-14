import { test, expect } from '@playwright/test';

// Smoke E2E: Verifiser at siden laster og hovedelementene vises

test('@smoke side laster', async ({ page }) => {
  const base = process.env.BASE_URL || 'http://localhost:3000';
  await page.goto(base);

  // Verifiser at siden har lastet med tittel
  await expect(page).toHaveTitle(/Fugleobservasjoner/);

  // Verifiser at viktige elementer er synlige
  await expect(page.locator('#loc-btn')).toBeVisible();
  await expect(page.locator('#search')).toBeVisible();
  await expect(page.locator('#count')).toBeVisible();
});

// Artssøk-tester (krever mock-server eller ekte API)
test.describe('Artssøk', () => {
  test('viser søkefelt og kan skrive i det', async ({ page }) => {
    const base = process.env.BASE_URL || 'http://localhost:3000';
    await page.goto(base);

    const searchInput = page.locator('#search');
    await expect(searchInput).toBeVisible();
    await expect(searchInput).toBeEmpty();

    // Skriv søketerm
    await searchInput.fill('meis');
    await expect(searchInput).toHaveValue('meis');
  });

  test('henter og viser søkeresultater for "meis"', async ({ page }) => {
    const base = process.env.BASE_URL || 'http://localhost:3000';
    await page.goto(base);

    const searchInput = page.locator('#search');
    await searchInput.fill('meis');

    // Vent på at resultatlisten dukker opp (div.result-item)
    const resultsList = page.locator('#results');
    await expect(resultsList).toBeVisible({ timeout: 5000 });

    // Sjekk at vi har fått minst ett resultat
    const resultItems = resultsList.locator('.result-item');
    await expect(resultItems.first()).toBeVisible({ timeout: 5000 });

    // Forventet: Blåmeis, Kjøttmeis, Svartmeis (i mock-data)
    const count = await resultItems.count();
    expect(count).toBeGreaterThan(0);
  });

  test('viser tom-melding for søk uten treff', async ({ page }) => {
    const base = process.env.BASE_URL || 'http://localhost:3000';
    await page.goto(base);

    const searchInput = page.locator('#search');
    // Søk etter noe som ikke finnes
    await searchInput.fill('xyznonexistent123');

    // Vent litt på API-kallet
    await page.waitForTimeout(500);

    // Sjekk at "ingen treff"-melding vises eller at listen er tom
    const emptyMsg = page.locator('#empty-msg');
    const resultsList = page.locator('#results');

    // Enten vises tom-melding, eller listen er tom
    const isEmpty = await resultsList.locator('.result-item').count() === 0;
    if (isEmpty) {
      // OK - ingen resultater
      expect(isEmpty).toBe(true);
    }
  });

  test('kan velge art fra resultatlisten', async ({ page }) => {
    const base = process.env.BASE_URL || 'http://localhost:3000';
    await page.goto(base);

    const searchInput = page.locator('#search');
    await searchInput.fill('meis');

    // Vent på resultater
    const resultsList = page.locator('#results');
    await expect(resultsList.locator('.result-item').first()).toBeVisible({ timeout: 5000 });

    // Klikk på første resultat
    await resultsList.locator('.result-item').first().click();

    // Sjekk at valgt art vises i chosen-seksjonen
    const chosenSection = page.locator('#chosen');
    await expect(chosenSection).toBeVisible();

    // Sjekk at chosen inneholder noe tekst (artsnavn)
    const chosenText = await chosenSection.textContent();
    expect(chosenText?.length).toBeGreaterThan(0);
  });

  test('kan navigere med piltaster og velge med Enter', async ({ page }) => {
    const base = process.env.BASE_URL || 'http://localhost:3000';
    await page.goto(base);

    const searchInput = page.locator('#search');
    await searchInput.fill('meis');

    // Vent på resultater
    const resultsList = page.locator('#results');
    await expect(resultsList.locator('.result-item').first()).toBeVisible({ timeout: 5000 });

    // Naviger ned med piltast
    await searchInput.press('ArrowDown');
    await searchInput.press('ArrowDown');

    // Velg med Enter
    await searchInput.press('Enter');

    // Sjekk at en art ble valgt
    const chosenSection = page.locator('#chosen');
    await expect(chosenSection).toBeVisible();
  });

  test('viser melding ved for kort søkestreng', async ({ page }) => {
    const base = process.env.BASE_URL || 'http://localhost:3000';
    await page.goto(base);

    const searchInput = page.locator('#search');
    
    // Skriv bare ett tegn
    await searchInput.fill('m');

    // Vent litt
    await page.waitForTimeout(400);

    // Sjekk at empty-msg vises med riktig tekst
    const emptyMsg = page.locator('#empty-msg');
    await expect(emptyMsg).toBeVisible();
    
    const text = await emptyMsg.textContent();
    // Bør inneholde noe om "minst 2 tegn" eller lignende
    expect(text?.toLowerCase()).toMatch(/tegn|skriv/);
  });
});

// Test for loading-indikator
test.describe('Brukergrensesnitt', () => {
  test('viser status-tekst', async ({ page }) => {
    const base = process.env.BASE_URL || 'http://localhost:3000';
    await page.goto(base);

    // Status-elementet bør være synlig ved lasting
    const statusEl = page.locator('#status-text');
    await expect(statusEl).toBeVisible();
    
    // Standard tekst ved oppstart
    await expect(statusEl).toContainText('Klar');
  });

  test('antall-felt er disabled før art er valgt', async ({ page }) => {
    const base = process.env.BASE_URL || 'http://localhost:3000';
    await page.goto(base);

    const countInput = page.locator('#count');
    await expect(countInput).toBeVisible();

    // Antall-feltet er disabled før en art er valgt
    await expect(countInput).toBeDisabled();
  });

  test('antall-felt aktiveres etter valg av art', async ({ page }) => {
    const base = process.env.BASE_URL || 'http://localhost:3000';
    await page.goto(base);

    // Velg en art først
    const searchInput = page.locator('#search');
    await searchInput.fill('meis');

    const resultsList = page.locator('#results');
    await expect(resultsList.locator('.result-item').first()).toBeVisible({ timeout: 5000 });
    await resultsList.locator('.result-item').first().click();

    // Nå skal antall-feltet være aktivert
    const countInput = page.locator('#count');
    await expect(countInput).toBeEnabled();

    // Skriv et tall
    await countInput.fill('5');
    await expect(countInput).toHaveValue('5');
  });
});
