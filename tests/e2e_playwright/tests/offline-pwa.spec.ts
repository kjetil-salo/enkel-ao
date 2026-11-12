import { test, expect } from '../fixtures';

// Kjør mot mock-serveren med OFFLINE_MOCK=1. Innsending må aldri gå til ekte AO.
const BASE = process.env.BASE_URL || 'http://localhost:3333';
test.use({ serviceWorkers: 'allow' });
test.skip(process.env.OFFLINE_MOCK !== '1', 'Krever lokal mock-server og OFFLINE_MOCK=1');

test.beforeEach(async ({ page }) => {
  await page.goto(BASE);
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
});

test('kartet fullfører oppstart med GPS-posisjon og kan velge et offline-område', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', err => errors.push(err.message));
  await page.evaluate(() => localStorage.setItem('mapData', JSON.stringify({
    userPosition: { lat: 60, lon: 5, accuracy: 20 }, sites: [], sizeMeters: 500,
  })));
  await page.goto(`${BASE}/map.html`);
  await page.locator('#toggle-offline-area-btn').click();
  await expect(page.locator('#offline-check-download-btn')).toBeVisible();
  expect(errors).toEqual([]);
});

test('ny side og kart starter uten nett etter installasjon, og lokaliteter overlever sidebytte', async ({ page, context }) => {
  test.setTimeout(60000);
  await page.evaluate(async () => {
    const offline = await import('/js/offline-db.js');
    await offline.saveOfflineAreaLocations({ north: 60.02, south: 59.98, west: 4.98, east: 5.02 }, [
      { id: 123, name: 'Lagret teststed', lat: 60, lon: 5 },
    ]);
    localStorage.setItem('mapData', JSON.stringify({ userPosition: { lat: 60, lon: 5, isFallback: true }, sites: [] }));
    offline.setNetworkMode('offline');
    await offline.syncNetworkModeToServiceWorker('offline');
  });
  await context.setOffline(true);
  const fresh = await context.newPage();
  const errors: string[] = [];
  fresh.on('pageerror', err => errors.push(err.message));
  await fresh.goto(BASE);
  await expect(fresh.locator('#offline-mode-toggle-text')).toContainText('Offline');
  await fresh.locator('#header-menu summary').click();
  await fresh.getByRole('button', { name: 'Hent liste fra en annen enhet' }).click();
  await expect(fresh.locator('#arbeidsliste-status')).toContainText('Overføring krever nett');
  await fresh.getByRole('button', { name: 'Lukk', exact: true }).click();
  await fresh.fill('#place', 'Lagret teststed');
  await fresh.fill('#search', 'kjøttmeis');
  await expect(fresh.locator('#results .result-item').first()).toBeVisible();
  await fresh.locator('#results .result-item').first().click();
  await fresh.fill('#count', '2');
  await fresh.locator('#activity-submit').click();
  expect(await fresh.evaluate(() => JSON.parse(localStorage.getItem('fugleobservasjoner_v1') || '{}').observations.length)).toBe(1);
  await fresh.goto(`${BASE}/map.html`);
  await expect(fresh.locator('#map.leaflet-container')).toBeVisible();
  expect(await fresh.evaluate(async () => (await (await import('/js/offline-db.js')).getAllOfflineLocations()).map((s: any) => s.id))).toContain(123);
  expect(errors).toEqual([]);
});

test('avbryt bruker ikke nett, og tillat sender gjennom ekte worker med offline beholdt', async ({ page, context, browserName }) => {
  await page.evaluate(async () => {
    const offline = await import('/js/offline-db.js');
    localStorage.setItem('ao_username', 'mockbruker');
    localStorage.setItem('ao_password', 'mockpassord');
    offline.setNetworkMode('offline');
    await offline.syncNetworkModeToServiceWorker('offline');
  });
  const sends: string[] = [];
  if (browserName === 'chromium') {
    context.on('request', request => {
      if (request.serviceWorker() && /\/api\/ao-(login|import-stream)$/.test(request.url())) sends.push(request.url());
    });
  }
  const beginSend = () => page.evaluate(async () => {
    const { handleDirectSend } = await import('/js/export-operations.js');
    const observations = [{ species: { taxonName: 'Kjøttmeis' }, timestamp: '2026-01-01T10:00:00', count: 1, sentTs: undefined as string | undefined }];
    await handleDirectSend(observations, {
      aoDirectBtn: document.getElementById('ao-direct-btn'),
      aoDirectStatus: document.getElementById('ao-direct-status'),
      aoDirectAutoClear: document.getElementById('ao-direct-auto-clear'),
    }, { doRenderObservations() {}, saveState() {} });
    return observations[0].sentTs || null;
  });
  const cancelled = beginSend();
  await page.locator('#offline-send-avbryt').click();
  expect(await cancelled).toBeNull();
  expect(sends).toEqual([]);
  const approved = beginSend();
  await page.locator('#offline-send-tillat').click();
  expect(await approved).toBeTruthy();
  await expect(page.locator('#ao-direct-status')).toContainText('sendt til AO');
  if (browserName === 'chromium') expect(sends).toHaveLength(2);
  expect(await page.evaluate(() => localStorage.getItem('network_mode_v1'))).toBe('offline');
  expect(await page.evaluate(async () => (await fetch('/api/species?search=test')).status)).toBe(503);
});
