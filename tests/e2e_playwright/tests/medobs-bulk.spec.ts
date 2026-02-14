import { test, expect } from '@playwright/test';

const BASE_URL = 'http://localhost:3000';

test.describe('Masseoppdatering av Medobservatører', () => {
  test.beforeEach(async ({ page }) => {
    // Naviger til siden og tøm localStorage
    await page.goto(BASE_URL);
    await page.evaluate(() => localStorage.clear());

    // Seed 3 observasjoner med ulike medobservatør-states
    await page.evaluate(() => {
      const observations = [
        {
          species: { taxonName: 'Gråspurv' },
          count: '1',
          timestamp: '2024-01-15T14:00:00Z',
          placeName: 'Oslo',
          coObservers: ['', '', '', '', '', '', '', '', '', '']
        },
        {
          species: { taxonName: 'Skjære' },
          count: '2',
          timestamp: '2024-01-15T14:30:00Z',
          placeName: 'Bergen',
          coObservers: ['Gammel Person', '', '', '', '', '', '', '', '', '']
        },
        {
          species: { taxonName: 'Svale' },
          count: '1',
          timestamp: '2024-01-15T15:00:00Z',
          placeName: 'Trondheim',
          coObservers: ['', '', '', '', '', '', '', '', '', '']
        }
      ];
      localStorage.setItem('fugleobservasjoner_v1', JSON.stringify({
        version: 1,
        observations
      }));
    });
  });

  test('kan legge til medobservatører på alle observasjoner', async ({ page }) => {
    await page.goto(`${BASE_URL}/medobs.html`);

    // Vent på at siden lastes
    await page.waitForSelector('.medobs-name', { timeout: 3000 });

    // Fyll inn medobservatører i tabell
    const nameInputs = await page.locator('.medobs-name').all();
    await nameInputs[0].fill('Per Hansen');
    await nameInputs[1].fill('Kari Nordmann');

    // Huk av for aktiv
    const checkboxes = await page.locator('.medobs-active').all();
    await checkboxes[0].check();
    await checkboxes[1].check();

    // Setup dialog handler for å akseptere bekreftelsesdialogen
    page.on('dialog', dialog => dialog.accept());

    // Klikk knapp
    const applyBtn = page.locator('#apply-to-all-btn');
    await expect(applyBtn).toBeVisible();
    await applyBtn.click();

    // Verifiser suksessmelding på knapp
    await expect(applyBtn).toHaveText(/Oppdatert 3 observasjon/);

    // Verifiser localStorage - alle obs skal ha de 2 medobservatørene
    const result = await page.evaluate(() => {
      const data = JSON.parse(localStorage.getItem('fugleobservasjoner_v1') || '{}');
      return data.observations.map((o: any) => o.coObservers.slice(0, 2));
    });

    expect(result[0]).toEqual(['Per Hansen', 'Kari Nordmann']);
    expect(result[1]).toEqual(['Per Hansen', 'Kari Nordmann']); // Overskriver "Gammel Person"
    expect(result[2]).toEqual(['Per Hansen', 'Kari Nordmann']);
  });

  test('viser bekreftelsesdialog med korrekt antall', async ({ page }) => {
    await page.goto(`${BASE_URL}/medobs.html`);
    await page.waitForSelector('.medobs-name', { timeout: 3000 });

    // Fyll inn medobservatører
    const nameInputs = await page.locator('.medobs-name').all();
    await nameInputs[0].fill('Per Hansen');
    await nameInputs[1].fill('Kari Nordmann');

    // Huk av for aktiv
    const checkboxes = await page.locator('.medobs-active').all();
    await checkboxes[0].check();
    await checkboxes[1].check();

    // Capture dialog message
    let dialogMessage = '';
    page.on('dialog', dialog => {
      dialogMessage = dialog.message();
      dialog.dismiss(); // Avbryt for å ikke endre data
    });

    // Klikk knapp
    const applyBtn = page.locator('#apply-to-all-btn');
    await applyBtn.click();

    // Vent på at dialog er trigget
    await page.waitForTimeout(500);

    // Verifiser dialog-innhold
    expect(dialogMessage).toContain('alle 3 observasjon');
    expect(dialogMessage).toContain('Per Hansen');
    expect(dialogMessage).toContain('Kari Nordmann');
  });

  test('undo-funksjon gjenoppretter original state', async ({ page }) => {
    await page.goto(`${BASE_URL}/medobs.html`);
    await page.waitForSelector('.medobs-name', { timeout: 3000 });

    // Fyll inn og aktiver medobservatører
    const nameInputs = await page.locator('.medobs-name').all();
    await nameInputs[0].fill('Per Hansen');
    await nameInputs[1].fill('Kari Nordmann');

    const checkboxes = await page.locator('.medobs-active').all();
    await checkboxes[0].check();
    await checkboxes[1].check();

    // Aksepter dialog
    page.on('dialog', dialog => dialog.accept());

    // Utfør masseoppdatering
    const applyBtn = page.locator('#apply-to-all-btn');
    await applyBtn.click();

    // Vent på at toast vises
    await page.waitForTimeout(500);

    // Klikk Undo i toast
    const undoBtn = page.locator('text=Angre');
    await expect(undoBtn).toBeVisible({ timeout: 2000 });
    await undoBtn.click();

    // Vent litt for at undo skal fullføres
    await page.waitForTimeout(300);

    // Verifiser at undo gjenopprettet original state
    const result = await page.evaluate(() => {
      const data = JSON.parse(localStorage.getItem('fugleobservasjoner_v1') || '{}');
      return [
        data.observations[0].coObservers[0], // Skal være tom
        data.observations[1].coObservers[0]  // Skal være "Gammel Person"
      ];
    });

    expect(result[0]).toBe('');
    expect(result[1]).toBe('Gammel Person');
  });

  test('ingen aktive medobservatører → viser alert', async ({ page }) => {
    await page.goto(`${BASE_URL}/medobs.html`);
    await page.waitForSelector('.medobs-name', { timeout: 3000 });

    // Fyll inn navn MEN ikke huk av for aktiv
    const nameInputs = await page.locator('.medobs-name').all();
    await nameInputs[0].fill('Per Hansen');

    // Setup dialog handler for å fange alert
    let alertMessage = '';
    page.on('dialog', dialog => {
      alertMessage = dialog.message();
      dialog.accept();
    });

    // Klikk knapp
    const applyBtn = page.locator('#apply-to-all-btn');
    await applyBtn.click();

    // Vent på at alert er trigget
    await page.waitForTimeout(500);

    // Verifiser alert-melding
    expect(alertMessage).toContain('Ingen aktive medobservatører');
  });

  test('ingen observasjoner → viser alert', async ({ page }) => {
    await page.goto(`${BASE_URL}/medobs.html`);
    await page.waitForSelector('.medobs-name', { timeout: 3000 });

    // Tøm observasjoner
    await page.evaluate(() => {
      localStorage.setItem('fugleobservasjoner_v1', JSON.stringify({
        version: 1,
        observations: []
      }));
    });

    // Fyll inn og aktiver medobservatører
    const nameInputs = await page.locator('.medobs-name').all();
    await nameInputs[0].fill('Per Hansen');

    const checkboxes = await page.locator('.medobs-active').all();
    await checkboxes[0].check();

    // Setup dialog handler
    let alertMessage = '';
    page.on('dialog', dialog => {
      alertMessage = dialog.message();
      dialog.accept();
    });

    // Klikk knapp
    const applyBtn = page.locator('#apply-to-all-btn');
    await applyBtn.click();

    // Vent på alert
    await page.waitForTimeout(500);

    // Verifiser alert
    expect(alertMessage).toContain('Ingen observasjoner');
  });

  test('avbryt bekreftelsesdialog → ingen endringer', async ({ page }) => {
    await page.goto(`${BASE_URL}/medobs.html`);
    await page.waitForSelector('.medobs-name', { timeout: 3000 });

    // Fyll inn medobservatører
    const nameInputs = await page.locator('.medobs-name').all();
    await nameInputs[0].fill('Per Hansen');

    const checkboxes = await page.locator('.medobs-active').all();
    await checkboxes[0].check();

    // Avbryt dialog
    page.on('dialog', dialog => dialog.dismiss());

    // Klikk knapp
    const applyBtn = page.locator('#apply-to-all-btn');
    await applyBtn.click();

    // Vent litt
    await page.waitForTimeout(500);

    // Verifiser at data IKKE er endret
    const result = await page.evaluate(() => {
      const data = JSON.parse(localStorage.getItem('fugleobservasjoner_v1') || '{}');
      return [
        data.observations[0].coObservers[0],
        data.observations[1].coObservers[0]
      ];
    });

    // Original state skal være bevart
    expect(result[0]).toBe('');
    expect(result[1]).toBe('Gammel Person');

    // Knappen skal ikke vise suksessmelding
    await expect(applyBtn).not.toHaveText(/Oppdatert/);
  });
});
