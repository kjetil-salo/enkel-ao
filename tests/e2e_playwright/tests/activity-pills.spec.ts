import { test, expect } from '@playwright/test';

const BASE_URL = 'http://localhost:3000';

test.describe('Konfigurerbare Aktivitetspills', () => {
  test.beforeEach(async ({ page }) => {
    // Tøm localStorage før hver test
    await page.goto(BASE_URL);
    await page.evaluate(() => {
      localStorage.clear();
    });
  });

  test('ny bruker får 4 default pills', async ({ page }) => {
    await page.goto(BASE_URL);

    // Vent på at pills rendres
    await page.waitForSelector('#activity-pills', { timeout: 3000 });

    const pills = await page.$$eval('.activity-pill', els =>
      els.map(el => el.textContent)
    );

    expect(pills.length).toBe(4);
    expect(pills[0]).toBe('Stasjonær');
    expect(pills[1]).toBe('Rastende');
    expect(pills[2]).toBe('Overflygende');
    expect(pills[3]).toBe('Næringssøkende');
  });

  test('migrerer fra gammelt activityPillCount=2', async ({ page }) => {
    await page.goto(BASE_URL);

    // Sett gammelt format i localStorage
    await page.evaluate(() => {
      localStorage.setItem('activityPillCount', '2');
    });

    // Reload for å trigge migrasjon
    await page.reload();
    await page.waitForSelector('#activity-pills', { timeout: 3000 });

    const pills = await page.$$eval('.activity-pill', els =>
      els.map(el => el.textContent)
    );

    expect(pills.length).toBe(2);
    expect(pills[0]).toBe('Stasjonær');
    expect(pills[1]).toBe('Rastende');
  });

  test('settings-siden viser pill-konfigurasjon', async ({ page }) => {
    await page.goto(`${BASE_URL}/settings.html`);

    // Vent på at settings laster
    await page.waitForSelector('#activity-pills-config', { timeout: 5000 });

    // Sjekk at add-knappen finnes
    const addBtn = await page.$('#add-activity-pill');
    expect(addBtn).not.toBeNull();

    // Sjekk at det finnes 4 default pills (dropdowns)
    const rows = await page.$$('.pill-config-row');
    expect(rows.length).toBe(4);
  });

  test('kan legge til ny pill i settings', async ({ page }) => {
    await page.goto(`${BASE_URL}/settings.html`);
    await page.waitForSelector('#activity-pills-config', { timeout: 5000 });

    // Klikk på "Legg til aktivitet"
    await page.click('#add-activity-pill');

    // Sjekk at det nå er 5 rader
    const rows = await page.$$('.pill-config-row');
    expect(rows.length).toBe(5);

    // Verifiser at endringen lagres i localStorage
    const saved = await page.evaluate(() => {
      const raw = localStorage.getItem('activityPills_v1');
      return raw ? JSON.parse(raw) : null;
    });

    expect(saved).not.toBeNull();
    expect(saved.pills.length).toBe(5);
  });

  test('kan fjerne pill i settings', async ({ page }) => {
    await page.goto(`${BASE_URL}/settings.html`);
    await page.waitForSelector('#activity-pills-config', { timeout: 5000 });

    // Klikk på første slett-knapp (🗑️)
    const deleteButtons = await page.$$('.pill-config-row button');
    if (deleteButtons.length > 0) {
      await deleteButtons[0].click();
    }

    // Sjekk at det nå er 3 rader
    const rows = await page.$$('.pill-config-row');
    expect(rows.length).toBe(3);

    // Verifiser lagring
    const saved = await page.evaluate(() => {
      const raw = localStorage.getItem('activityPills_v1');
      return raw ? JSON.parse(raw) : null;
    });

    expect(saved.pills.length).toBe(3);
  });

  test('maks 6 pills - knapp disables', async ({ page }) => {
    await page.goto(`${BASE_URL}/settings.html`);
    await page.waitForSelector('#activity-pills-config', { timeout: 5000 });

    // Legg til 2 pills (vi har 4 default, så totalt blir 6)
    await page.click('#add-activity-pill');
    await page.click('#add-activity-pill');

    // Sjekk at knappen nå er disabled
    const addBtn = await page.$('#add-activity-pill');
    const isDisabled = await addBtn?.isDisabled();
    expect(isDisabled).toBe(true);

    // Sjekk tekst
    const btnText = await addBtn?.textContent();
    expect(btnText).toContain('Maks 6 aktiviteter');
  });

  test('endringer i settings reflekteres på index.html', async ({ page }) => {
    await page.goto(`${BASE_URL}/settings.html`);
    await page.waitForSelector('#activity-pills-config', { timeout: 5000 });

    // Endre første dropdown til "Sang/spill"
    const firstSelect = await page.$('.pill-config-row select');
    if (firstSelect) {
      await firstSelect.selectOption({ label: 'Sang/spill' });
    }

    // Vent litt for at lagring skal skje
    await page.waitForTimeout(200);

    // Gå til index.html
    await page.goto(BASE_URL);
    await page.waitForSelector('#activity-pills', { timeout: 3000 });

    // Sjekk at første pill er "Sang/spill"
    const firstPill = await page.$eval('.activity-pill', el => el.textContent);
    expect(firstPill).toBe('Sang/spill');
  });

  test('0 pills - ingen pills vises', async ({ page }) => {
    await page.goto(`${BASE_URL}/settings.html`);
    await page.waitForSelector('#activity-pills-config', { timeout: 5000 });

    // Fjern alle pills
    const deleteButtons = await page.$$('.pill-config-row button');
    for (const btn of deleteButtons) {
      await btn.click();
      await page.waitForTimeout(100); // Vent litt mellom hver
    }

    // Gå til index.html
    await page.goto(BASE_URL);

    // Sjekk at container finnes men er tom
    const container = await page.$('#activity-pills');
    const pillCount = await page.$$eval('.activity-pill', els => els.length);

    expect(container).not.toBeNull();
    expect(pillCount).toBe(0);
  });
});
