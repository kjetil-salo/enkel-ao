import { test, expect } from '../fixtures';

test('bekreftet AO3-innlogging lar brukeren publisere uten å åpne importen', async ({ page }) => {
  await page.route('**/api/ao-login', async route => {
    const data = route.request().postDataJSON();
    expect(data).toMatchObject({ username: 'test@example.org', password: 'testpass' });
    await route.fulfill(data.allowAo3 === true ? {
      json: {
        success: true, via: 'ao3',
        ...(data.includePrivateSites && { sites: [{ id: 18, name: 'Min lokalitet', lat: 60.393, lon: 5.323 }] }),
      },
    } : {
      status: 503,
      json: { code: 'ao2_unavailable_before_import' },
    });
  });
  await page.route('**/api/ao3-import', async route => {
    expect(route.request().postDataJSON().observations).toMatchObject([
      { species: { taxonId: 4372 }, placeId: 349566, count: 1 },
    ]);
    await route.fulfill({ json: { success: true, via: 'ao3', published: true, count: 1 } });
  });
  await page.route('**/api/log-export', route => route.fulfill({ json: { ok: true } }));
  await page.goto('/profil.html');
  // Simuler autofyll uten input-hendelse for å teste hva klikket leser.
  await page.evaluate(() => {
    localStorage.setItem('ao_tokens', JSON.stringify({ authCookie: 'gammel-ao2-sesjon' }));
    document.querySelector<HTMLInputElement>('#ao-username')!.value = 'test@example.org';
    document.querySelector<HTMLInputElement>('#ao-password')!.value = 'testpass';
  });
  await page.locator('#test-ao-login').click();
  await expect(page.locator('#ao-login-status')).toContainText('Innlogging bekreftet via AO3');
  expect(await page.evaluate(() => localStorage.getItem('ao_username'))).toBe('test@example.org');
  expect(await page.evaluate(() => localStorage.getItem('ao_tokens'))).toBeNull();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('ao_private_sites')!).sites[0].id)).toBe(18);

  await page.evaluate(() => {
    localStorage.setItem('fugleobservasjoner_v1', JSON.stringify({
      version: 1,
      observations: [{
        species: { taxonName: 'Kjøttmeis', taxonId: 4372, taxonGroupId: 8 },
        count: 1, placeName: 'Byparken', placeId: 349566,
        activity: 'Stasjonær', timestamp: '2026-07-26T15:00:00',
        age: '', gender: '', coObservers: [],
      }],
    }));
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Publiser til AO' }).click();
  await page.getByRole('button', { name: 'Publiser via AO3' }).click();
  await expect(page.locator('#ao-direct-status')).toContainText('1 observasjon sendt til AO3');
  expect(page.context().pages()).toHaveLength(1);
});

test('kart og stedsnavnsøk viser egne AO3-lokaliteter når AO2-innloggingen feiler', async ({ page }) => {
  await page.route('**/api/ao-login', route => route.fulfill({
    status: 401, json: { error: 'Innlogging avvist i AO2' },
  }));
  await page.route('**/api/ao-private-sites', async route => {
    expect(route.request().method()).toBe('POST');
    expect(route.request().postDataJSON().username).toBe('test@example.org');
    await route.fulfill({ json: {
      success: true, via: 'ao3',
      sites: [{ id: 18, name: 'Min testlokalitet', lat: 60.393, lon: 5.323, acc: 100 }],
    } });
  });
  await page.route('**/api/ao-sites?*', route => route.fulfill({ json: { sites: [] } }));
  await page.route('**/api/ao-autocomplete?*', route => route.fulfill({
    json: { results: [], not_logged_in: true },
  }));
  await page.addInitScript(() => {
    localStorage.setItem('ao_username', 'test@example.org');
    localStorage.setItem('ao_password', 'testpass');
    localStorage.setItem('mapData', JSON.stringify({
      userPosition: { lat: 60.393, lon: 5.323, accuracy: 20 },
      sites: [],
    }));
  });

  await page.goto('/map.html');
  await expect(page.locator('.mine-label', { hasText: 'Min testlokalitet' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('ao_tokens'))).toBeNull();

  await page.goto('/');
  await page.getByRole('button', { name: /Modus: Felt/ }).click();
  await page.locator('#place').fill('testlokalitet');
  await expect(page.locator('.autocomplete-dropdown')).toContainText('Min testlokalitet');
});

test('profilsiden ber aliasbrukeren bruke e-post når AO2 er nede', async ({ page }) => {
  await page.route('**/api/ao-login', route => route.fulfill({
    status: 503,
    json: { code: 'ao2_unavailable_before_import' },
  }));
  await page.goto('/profil.html');
  await page.locator('#ao-username').fill('testalias');
  await page.locator('#ao-password').fill('testpass');
  await page.locator('#test-ao-login').click();
  await expect(page.locator('#ao-login-status')).toContainText('Bruk e-postadressen til den samme');
});
