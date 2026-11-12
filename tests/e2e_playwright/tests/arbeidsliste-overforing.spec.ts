import type { BrowserContext, Page } from '@playwright/test';
import { expect, merkIntroLest, test } from '../fixtures';

const API = '/api/arbeidsliste-overforing';
const LOKAL = 'fugleobservasjoner_v1';
const INNHENTET = 'arbeidsliste_innhentet_v1';
const FOTO = 'data:image/jpeg;base64,/9j/wAALCAABAAEBAREA/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/9sAQwACAgICAgIDAgIDBQMDAwUGBQUFBQYIBgYGBgYICggICAgICAoKCgoKCgoKDAwMDAwMDg4ODg4PDw8PDw8PDw8P/90ABAAB/9oACAEBAAA/ACv/2Q==';
const FUNN = {
  species: { taxonName: 'Tjeld', taxonId: 100 }, count: 2, placeName: 'Testvika', placeId: '123',
  position: { lat: 60, lon: 5 }, visitId: 'testbesok', visitLocked: true,
  timestamp: '2026-01-01T12:00:00', privateComment: 'Privat testkommentar', photo: FOTO,
};

function mockOverforing() {
  const kopi = {
    id: 'a'.repeat(32), antall: 1, kilde: 'Mobil', lagretTs: Date.now() / 1000,
    utloperTs: Date.now() / 1000 + 604800, fraDato: '2026-01-01', tilDato: '2026-01-01',
  };
  let aktivKopi: { kopi: typeof kopi; liste: { schemaVersion: number; observations: unknown[] } } | null = null;
  let publiseringskall = 0;
  let fellesturskriving = 0;
  let lagringskall = 0;
  let ventPaLagring: Promise<void> | undefined;
  let ventPaInnhold: Promise<void> | undefined;

  async function koble(context: BrowserContext, bruker: string, obs: unknown[] = []) {
    await merkIntroLest(context);
    await context.addInitScript(({ bruker, obs, lokal }) => {
      if (localStorage.getItem('arbeidsliste-test-oppsett')) return;
      localStorage.setItem('arbeidsliste-test-oppsett', '1');
      localStorage.setItem('ao_username', bruker);
      localStorage.setItem('ao_password', 'mocket-passord');
      localStorage.setItem('ao_tokens', JSON.stringify({ loginToken: 'gammelt-token', authCookie: 'gammel-cookie' }));
      localStorage.setItem(lokal, JSON.stringify({ version: 1, observations: obs }));
    }, { bruker, obs, lokal: LOKAL });
    await context.route('**/api/**', async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      const token = request.headers()['authorization'];
      const eier = token === 'Bearer test-A' ? 'ao:1' : token === 'Bearer test-B' ? 'ao:2' : null;
      const json = (data: unknown, status = 200) => route.fulfill({ json: data, status });
      if (path === `${API}/status`) return json({ aktiv: true });
      if (path === `${API}/innlogging`) {
        const { username } = request.postDataJSON();
        return json({ sesjon: { eier: username === 'A' ? 'ao:1' : 'ao:2', alias: username,
          utloperTs: Date.now() / 1000 + 3600, token: `test-${username}` } });
      }
      if (path === `${API}/logg-ut`) return json({ ok: true });
      if (path === API && request.method() === 'POST') {
        const { liste, kilde } = request.postDataJSON();
        lagringskall += 1;
        if (ventPaLagring) await ventPaLagring;
        aktivKopi = { kopi: { ...kopi, antall: liste.observations.length, kilde }, liste };
        return json({ kopi: aktivKopi.kopi });
      }
      if (path === API) return json({ kopi: eier === 'ao:1' ? aktivKopi?.kopi ?? null : null });
      if (path === `${API}/innhold`) {
        if (ventPaInnhold) await ventPaInnhold;
        return eier === 'ao:1' && aktivKopi ? json(aktivKopi) : json({ error: 'Denne kopien er borte.' }, 404);
      }
      if (path === `${API}/slett`) {
        aktivKopi = null;
        return json({ ok: true });
      }
      if (path === '/api/ao-login') {
        const { username, arbeidslisteEier } = request.postDataJSON();
        if (arbeidslisteEier === 'ao:1' && username !== 'A') return json({ error: 'Logg inn på eierens konto.' }, 403);
        return json({ success: true, loginToken: 'engangstoken', authCookie: 'engangscookie', userId: '99' });
      }
      if (path === '/api/ao-import-stream') {
        publiseringskall += 1;
        return route.fulfill({ contentType: 'text/event-stream',
          body: 'data: {"phase":"done","success":true,"count":1,"refreshedAuthCookie":"fornyet-engangscookie"}\n\n' });
      }
      if (path === '/api/fellestur-sync') fellesturskriving += 1;
      if (path === '/api/ao-private-sites' || path === '/api/ao-sites') return json({ sites: [] });
      return json({});
    });
  }

  return {
    koble, publiseringskall: () => publiseringskall, fellesturskriving: () => fellesturskriving,
    lagringskall: () => lagringskall, kopi: () => aktivKopi,
    holdLagring: (promise: Promise<void>) => { ventPaLagring = promise; },
    seed: () => { aktivKopi = { kopi, liste: { schemaVersion: 1, observations: [FUNN] } }; },
    fjern: () => { aktivKopi = null; },
    holdInnhold: (promise: Promise<void>) => { ventPaInnhold = promise; },
  };
}

async function velgFraMeny(page: Page, id: string) {
  await page.locator('#header-menu summary').click();
  await page.locator(`#header-menu #${id}`).click();
  await expect(page.locator('#header-menu')).not.toHaveAttribute('open', '');
}

async function hent(page: Page) {
  await velgFraMeny(page, 'arbeidsliste-hent');
  await page.locator('#arbeidsliste-logg-inn').click();
}

test('lagrer hele lista på mobil og henter den inn på Mac med samme konto', async ({ browser, baseURL }) => {
  const api = mockOverforing();
  const mobil = await browser.newContext({ baseURL, serviceWorkers: 'block', hasTouch: true, viewport: { width: 390, height: 844 } });
  const mac = await browser.newContext({ baseURL, serviceWorkers: 'block' });
  const annen = await browser.newContext({ baseURL, serviceWorkers: 'block' });
  try {
    await api.koble(mobil, 'A', [FUNN]);
    await api.koble(mac, 'A');
    await api.koble(annen, 'B');
    const felt = await mobil.newPage();
    felt.on('dialog', (dialog) => dialog.accept());
    await felt.goto('/');
    await velgFraMeny(felt, 'arbeidsliste-overfor');
    await felt.locator('#arbeidsliste-logg-inn').click();
    await expect(felt.locator('#arbeidsliste-konto')).toContainText('AO-konto: A');
    await felt.locator('#arbeidsliste-lagre').click();
    await expect(felt.locator('#arbeidsliste-status')).toContainText('Lagret for henting');

    const annenSide = await annen.newPage();
    await annenSide.goto('/');
    await hent(annenSide);
    await expect(annenSide.locator('#arbeidsliste-info')).toContainText('Ingen lagret kopi');

    const hjemme = await mac.newPage();
    await hjemme.goto('/');
    await hent(hjemme);
    await expect(hjemme.locator('#arbeidsliste-rader')).toContainText('Privat testkommentar');
    await expect(hjemme.getByRole('img', { name: 'Bilde av Tjeld' })).toBeVisible();
    await hjemme.locator('#arbeidsliste-ta-inn').click();
    await expect(hjemme.locator('#obs-list')).toContainText('Tjeld');
    const lagret = await hjemme.evaluate((key) => JSON.parse(localStorage.getItem(key)!), INNHENTET);
    expect(lagret.observations).toEqual([FUNN]);
    expect(lagret.eier).toBe('ao:1');
    expect(await felt.evaluate((key) => JSON.parse(localStorage.getItem(key)!).observations, LOKAL)).toEqual([FUNN]);
    expect(api.publiseringskall()).toBe(0);

    // En eldre fane kan fortsatt skrive til den vanlige lista. Kopien har egen nøkkel.
    const eldre = await mac.newPage();
    await eldre.goto('/');
    await eldre.evaluate((key) => localStorage.setItem(key, JSON.stringify({ version: 1, observations: [{ species: { taxonName: 'Hegre' }, count: 1 }] })), LOKAL);
    await expect(hjemme.locator('#obs-list')).toContainText('Tjeld');
    await eldre.close();
    await hjemme.reload();
    await velgFraMeny(hjemme, 'arbeidsliste-lokal');
    await expect(hjemme.locator('#obs-list')).toContainText('Tjeld');

    const bekreftelser: string[] = [];
    hjemme.on('dialog', (dialog) => {
      bekreftelser.push(dialog.message());
      return dialog.message().includes('Sjekk hos AO') ? dialog.accept() : dialog.dismiss();
    });
    await hjemme.evaluate(() => localStorage.setItem('ao_username', 'B'));
    await hjemme.locator('#ao-direct-btn').click();
    await expect(hjemme.locator('#ao-direct-status')).toContainText('eierens konto');
    expect(api.publiseringskall()).toBe(0);

    await hjemme.evaluate(() => localStorage.setItem('ao_username', 'A'));
    await hjemme.locator('#ao-direct-btn').click();
    await expect(hjemme.locator('#ao-direct-status')).toContainText('sendt til AO');
    expect(api.publiseringskall()).toBe(1);
    expect(bekreftelser.some((tekst) => tekst.includes('Lista ble kopiert'))).toBe(true);
    expect(await hjemme.evaluate(() => JSON.parse(localStorage.getItem('ao_tokens')!).authCookie)).toBe('gammel-cookie');
  } finally {
    await Promise.all([mobil.close(), mac.close(), annen.close()]);
  }
});

test('forhåndsvisning bevarer en eksisterende arbeidsliste', async ({ context, page }) => {
  const api = mockOverforing();
  api.seed();
  const eksisterende = [{ species: { taxonName: 'Hegre' }, count: 1 }];
  await api.koble(context, 'A', eksisterende);
  await page.goto('/');
  await hent(page);
  await expect(page.locator('#arbeidsliste-rader')).toContainText('Tjeld');
  await page.locator('#arbeidsliste-ta-inn').click();
  await expect(page.locator('#arbeidsliste-status')).toContainText('Arbeidslista må være tom');
  await expect(page.locator('#obs-list')).toContainText('Hegre');
  expect(await page.evaluate((key) => localStorage.getItem(key), INNHENTET)).toBeNull();
});

test('avviser slettet kopi og stanser en gammel forhåndsvisning ved kontobytte', async ({ context, page }) => {
  const api = mockOverforing();
  api.seed();
  await api.koble(context, 'A');
  await page.goto('/');
  await hent(page);
  await expect(page.locator('#arbeidsliste-rader')).toContainText('Tjeld');
  api.fjern();
  await page.locator('#arbeidsliste-ta-inn').click();
  await expect(page.locator('#arbeidsliste-status')).toContainText('kopien er borte');
  await expect(page.locator('#arbeidsliste-rader')).toBeEmpty();

  api.seed();
  await page.getByRole('button', { name: 'Lukk', exact: true }).click();
  let fortsett!: () => void;
  api.holdInnhold(new Promise<void>((resolve) => { fortsett = resolve; }));
  await velgFraMeny(page, 'arbeidsliste-hent');
  const annenFane = await context.newPage();
  await annenFane.goto('/');
  await annenFane.evaluate(() => localStorage.setItem('ao_username', 'B'));
  fortsett();
  await expect(page.locator('#arbeidsliste-dialog')).not.toBeVisible();
  await expect(page.locator('#arbeidsliste-rader')).toBeEmpty();
});

test('privat kopi går ikke inn i en fellestur åpnet i en annen fane', async ({ context, page }) => {
  const api = mockOverforing();
  api.seed();
  await api.koble(context, 'A');
  await page.goto('/');
  await hent(page);
  await page.locator('#arbeidsliste-ta-inn').click();
  await expect(page.locator('#obs-list')).toContainText('Tjeld');
  const annenFane = await context.newPage();
  await annenFane.goto('/');
  await annenFane.evaluate(() => localStorage.setItem('aktivFellestur_v1', JSON.stringify({ kode: '12345' })));
  await page.locator('#obs-list button[title="+1"]').click();
  const antall = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).observations[0].count, INNHENTET);
  expect(antall).toBe(3);
  expect(api.fellesturskriving()).toBe(0);
});

test('bevarer forhåndsvisning og serverkopi når enheten mangler lagringsplass', async ({ context, page }) => {
  const api = mockOverforing();
  api.seed();
  await api.koble(context, 'A');
  await page.goto('/');
  await hent(page);
  await expect(page.locator('#arbeidsliste-rader')).toContainText('Tjeld');
  await page.evaluate((innhentet) => {
    const lagre = Storage.prototype.setItem;
    Storage.prototype.setItem = function (nokkel, verdi) {
      if (nokkel === innhentet) throw new DOMException('Testkvote', 'QuotaExceededError');
      return lagre.call(this, nokkel, verdi);
    };
  }, INNHENTET);
  await page.locator('#arbeidsliste-ta-inn').click();
  await expect(page.locator('#arbeidsliste-status')).toContainText('for lite lagringsplass');
  await expect(page.locator('#arbeidsliste-rader')).toContainText('Tjeld');
  expect(api.kopi()?.liste.observations).toEqual([FUNN]);
  expect(await page.evaluate((key) => localStorage.getItem(key), INNHENTET)).toBeNull();
});

test('lagrer øyeblikksbildet og varsler om nyere lokale endringer', async ({ context, page }) => {
  const api = mockOverforing();
  await api.koble(context, 'A', [FUNN]);
  page.on('dialog', (dialog) => dialog.accept());
  await page.goto('/');
  await velgFraMeny(page, 'arbeidsliste-overfor');
  await page.locator('#arbeidsliste-logg-inn').click();
  let fortsett!: () => void;
  api.holdLagring(new Promise<void>((resolve) => { fortsett = resolve; }));
  await page.locator('#arbeidsliste-lagre').click();
  await expect.poll(api.lagringskall).toBe(1);
  const annenFane = await context.newPage();
  await annenFane.goto('/');
  await annenFane.evaluate((key) => {
    const liste = JSON.parse(localStorage.getItem(key)!);
    liste.observations[0].count = 8;
    localStorage.setItem(key, JSON.stringify(liste));
  }, LOKAL);
  fortsett();
  await expect(page.locator('#arbeidsliste-status')).toContainText('Nyere lokale endringer');
  expect(api.kopi()?.liste.observations).toEqual([FUNN]);
});
