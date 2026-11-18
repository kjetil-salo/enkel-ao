import { test, expect } from '../fixtures';
import type { Page } from '@playwright/test';
import { resolve } from 'node:path';

const funn = [
  { sightingId: 1, taxonName: 'Stokkand', quantity: '12', date: '2026-11-18', time: '10:42',
    activity: 'Næringssøk', siteId: 10, siteName: 'Mosvatnet', isReporter: true, canRemoveSelf: false,
    hasImage: false, reporter: 'meg', triggeredRules: '', url: 'https://www.artsobservasjoner.no/Sighting/1' },
  { sightingId: 2, taxonName: 'Toppand', quantity: '2', date: '2026-11-18', time: '10:45',
    activity: 'Rastende', siteId: 10, siteName: 'Mosvatnet', isReporter: false, canRemoveSelf: true,
    hasImage: false, reporter: 'tursekretæren', triggeredRules: 'Kontroller antallet', url: 'https://www.artsobservasjoner.no/Sighting/2' },
  { sightingId: 3, taxonName: 'Gråhegre', quantity: '1', date: '2026-11-18', time: '11:00',
    activity: 'Rastende', siteId: 20, siteName: 'Mosvatnet', isReporter: false, canRemoveSelf: false,
    hasImage: true, reporter: '', triggeredRules: '', url: 'https://www.artsobservasjoner.no/Sighting/3' },
];

async function aapne(page: Page, rader = funn, ekstra = {}) {
  let hentinger = 0;
  await page.addInitScript(() => {
    localStorage.setItem('ao_tokens', JSON.stringify({ loginToken: 'TEST', authCookie: 'TEST' }));
  });
  // Ingen av testene skal kontakte AO, heller ikke køkontrollen ved sidelast.
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/ao-my-sightings') {
      hentinger++;
      await route.fulfill({ json: { sightings: rader, total: rader.length, ...ekstra } });
    } else {
      await route.fulfill({ json: { count: 0 } });
    }
  });
  await page.goto('/sendt.html');
  await expect(page.locator('.sted-gruppe')).toHaveCount(new Set(rader.map(f => f.siteId)).size);
  return () => hentinger;
}

test('folder steder og bevarer valgene ved filter og oppdatering uten å slå sammen like navn', async ({ page }) => {
  const antallHentinger = await aapne(page);
  const steder = page.locator('.sted-gruppe');
  await expect(steder.nth(0)).toHaveAttribute('open', '');
  await expect(steder.nth(1)).not.toHaveAttribute('open', '');
  await expect(steder.nth(0).locator('.sted-tall')).toContainText('2 uten bilde');
  await expect(steder.nth(0).locator('.sted-tall')).toContainText('1 med merknad');
  await page.getByRole('button', { name: 'Skjul alle', exact: true }).click();
  await expect(page.locator('.sted-gruppe[open]')).toHaveCount(0);
  await page.getByLabel('Bare uten bilde').check();
  await expect(steder).toHaveCount(1);
  await expect(page.locator('.sted-gruppe[open]')).toHaveCount(0);
  expect(antallHentinger()).toBe(1);
  await page.getByLabel('Bare uten bilde').uncheck();
  await page.getByRole('button', { name: 'Vis alle', exact: true }).click();
  await expect(page.locator('.sted-gruppe[open]')).toHaveCount(2);
  await page.getByRole('button', { name: 'Oppdater' }).click();
  await expect(page.locator('.sted-gruppe[open]')).toHaveCount(2);
  expect(antallHentinger()).toBe(2);
  await expect(page.locator('.lokal-logg')).not.toHaveAttribute('open', '');
  await page.locator('.lokal-overskrift').click();
  await expect(page.locator('#liste')).toContainText('Ingen kvitteringer');
});

test('viser riktige handlinger for rapportør, medobservatør og ukjent rolle', async ({ page }) => {
  await aapne(page);
  await page.locator('#funn-1 .funn-meny > summary').click();
  await expect(page.locator('#funn-1 [data-endre]')).toBeVisible();
  await expect(page.locator('#funn-1 [data-fjern-meg]')).toHaveCount(0);
  await page.locator('h1').click();
  await expect(page.locator('#funn-1 .funn-meny')).not.toHaveAttribute('open', '');
  await page.locator('#funn-2 .funn-meny > summary').click();
  await expect(page.locator('#funn-1 .funn-meny')).not.toHaveAttribute('open', '');
  await expect(page.locator('#funn-2 [data-endre]')).toHaveCount(0);
  await expect(page.locator('#funn-2 [data-fjern-meg]')).toBeVisible();
  await expect(page.locator('#funn-2 .advarsel')).toContainText('Kontroller antallet');
  await page.getByRole('button', { name: 'Vis alle', exact: true }).click();
  await page.locator('#funn-3 .funn-meny > summary').click();
  await expect(page.locator('#funn-3 [data-fjern-meg]')).toHaveCount(0);
  await expect(page.locator('#funn-3 [data-bilde]')).toBeVisible();
  await page.locator('#funn-3 [data-bilde]').click();
  await expect(page.locator('#bilde-modal')).toBeVisible();
  await expect(page.locator('#bm-funn')).toContainText('Gråhegre');
});

test('støtter tastatur for folding og meny med Escape', async ({ page }) => {
  await aapne(page);
  const overskrift = page.locator('.sted-overskrift').first();
  await overskrift.focus();
  await overskrift.press('Enter');
  await expect(page.locator('.sted-gruppe').first()).not.toHaveAttribute('open', '');
  await overskrift.press('Space');
  await expect(page.locator('.sted-gruppe').first()).toHaveAttribute('open', '');
  const meny = page.locator('#funn-2 .funn-meny > summary');
  await meny.focus();
  await meny.press('Enter');
  await expect(page.locator('#funn-2 [data-fjern-meg]')).toBeVisible();
  await meny.press('Escape');
  await expect(page.locator('#funn-2 .funn-meny')).not.toHaveAttribute('open', '');
  await expect(meny).toBeFocused();
});

test('avbrutt bekreftelse sender ingen forespørsel om fjerning', async ({ page }) => {
  let kall = 0;
  await aapne(page);
  await page.route('**/api/ao-remove-me', async route => {
    kall++;
    await route.fulfill({ json: { ok: true, verified: true } });
  });
  page.once('dialog', async dialog => {
    expect(dialog.message()).toContain('Toppand, Mosvatnet, 18. november');
    await dialog.dismiss();
  });
  await page.locator('#funn-2 .funn-meny > summary').click();
  await page.locator('#funn-2 [data-fjern-meg]').click();
  await expect(page.locator('#funn-2')).toBeVisible();
  expect(kall).toBe(0);
});

test('fjerner raden bare etter bekreftet svar og oppdaterer antall og fokus', async ({ page }) => {
  await aapne(page);
  let fullfoer!: () => void;
  const vent = new Promise<void>(resolve => { fullfoer = resolve; });
  let kall = 0;
  await page.route('**/api/ao-remove-me', async route => {
    kall++;
    expect(route.request().postDataJSON()).toEqual({ sightingId: 2, loginToken: 'TEST', authCookie: 'TEST' });
    await vent;
    await route.fulfill({ json: { ok: true, verified: true } });
  });
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#funn-2 .funn-meny > summary').click();
  await page.locator('#funn-2 [data-fjern-meg]').click();
  await expect(page.locator('#funn-2 .rad-status')).toContainText('Fjerner deg');
  await page.locator('#funn-2 .funn-meny > summary').click();
  await expect(page.locator('#funn-2 [data-fjern-meg]')).toBeDisabled();
  fullfoer();
  await expect(page.locator('#funn-2')).toHaveCount(0);
  await expect(page.locator('.sammendrag')).toContainText('2 funn');
  await expect(page.locator('.sted-tall').first()).toContainText('1 uten bilde');
  await expect(page.locator('#ao-status')).toContainText('fjernet som observatør på Toppand');
  await expect(page.locator('.sted-overskrift').first()).toBeFocused();
  expect(kall).toBe(1);
});

test('filterbytte under fjerning låser ikke den nye knappen etter avvist svar', async ({ page }) => {
  await aapne(page);
  let fullfoer!: () => void;
  const vent = new Promise<void>(resolve => { fullfoer = resolve; });
  await page.route('**/api/ao-remove-me', async route => {
    await vent;
    await route.fulfill({ json: { ok: false, error: 'Kunne ikke kontrollere funnet. Ingen endring er sendt.' } });
  });
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#funn-2 .funn-meny > summary').click();
  await page.locator('#funn-2 [data-fjern-meg]').click();
  await expect(page.locator('#funn-2 .rad-status')).toContainText('Fjerner deg');
  await page.getByLabel('Bare uten bilde').check();
  await page.locator('#funn-2 .funn-meny > summary').click();
  await expect(page.locator('#funn-2 [data-fjern-meg]')).toBeDisabled();
  fullfoer();
  await expect(page.locator('#funn-2 .rad-status')).toContainText('Ingen endring er sendt');
  await expect(page.locator('#funn-2 [data-fjern-meg]')).toBeEnabled();
});

test('eldre hentesvar gjeninnfører ikke et bekreftet fjernet funn', async ({ page }) => {
  await aapne(page);
  let fullfoerFjerning!: () => void;
  const ventFjerning = new Promise<void>(resolve => { fullfoerFjerning = resolve; });
  await page.route('**/api/ao-remove-me', async route => {
    await ventFjerning;
    await route.fulfill({ json: { ok: true, verified: true } });
  });
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#funn-2 .funn-meny > summary').click();
  await page.locator('#funn-2 [data-fjern-meg]').click();
  let fullfoerHenting!: () => void;
  const ventHenting = new Promise<void>(resolve => { fullfoerHenting = resolve; });
  await page.route('**/api/ao-my-sightings', async route => {
    await ventHenting;
    await route.fulfill({ json: { sightings: funn, total: 3 } });
  });
  await page.getByRole('button', { name: 'Oppdater' }).click();
  await expect(page.locator('#ao-liste .laster')).toBeVisible();
  fullfoerFjerning();
  await expect(page.locator('#ao-status')).toContainText('fjernet som observatør');
  fullfoerHenting();
  await expect(page.locator('#ao-oppdater')).toBeEnabled();
  await expect(page.locator('#funn-2')).toHaveCount(0);
  await expect(page.locator('.sammendrag')).toContainText('2 funn');
});

for (const utfall of ['usikkert', 'nettverksfeil', 'ubekreftet suksess']) {
  test(`beholder funnet ved ${utfall} og gjentar ikke toggle`, async ({ page }) => {
    await aapne(page);
    let kall = 0;
    await page.route('**/api/ao-remove-me', async route => {
      kall++;
      if (utfall === 'nettverksfeil') await route.abort();
      else await route.fulfill({ json: utfall === 'usikkert'
        ? { ok: false, uncertain: true, error: 'Kunne ikke bekrefte fjerningen.' }
        : { ok: true } });
    });
    page.once('dialog', dialog => dialog.accept());
    await page.locator('#funn-2 .funn-meny > summary').click();
    await page.locator('#funn-2 [data-fjern-meg]').click();
    await expect(page.locator('#funn-2 .rad-status.feil')).not.toBeEmpty();
    await expect(page.locator('#funn-2')).toBeVisible();
    await expect(page.locator('.sammendrag')).toContainText('3 funn');
    expect(kall).toBe(1);
  });
}

test('bevarer avkortingsvarsel når bildefilteret gir tom liste', async ({ page }) => {
  await aapne(page, funn.map(f => ({ ...f, hasImage: true })), { truncated: true, total: 100 });
  await page.getByLabel('Bare uten bilde').check();
  await expect(page.locator('#ao-liste')).toContainText('Viser 3 av 100 funn');
  await expect(page.locator('#ao-liste')).toContainText('Alle funnene i dette tidsrommet har bilde');
});

test('bildeopplasting beholder raden med aktivt filter og oppdaterer stedets teller', async ({ page }) => {
  await aapne(page);
  await page.route('**/api/ao-upload-image', route => route.fulfill({
    json: { ok: true, verified: true, imageCount: 1 },
  }));
  await page.getByLabel('Bare uten bilde').check();
  await page.locator('#funn-2 > .funn-handling > [data-bilde]').click();
  await page.locator('#bm-fil-input').setInputFiles(resolve(__dirname, '../../../public/favicon.png'));
  await expect(page.locator('#bm-send')).toBeEnabled();
  await page.locator('#bm-send').click();
  await expect(page.locator('#bm-kvittering')).toBeVisible();
  await page.locator('#bm-avbryt').click();
  await expect(page.locator('#funn-2')).toBeVisible();
  await expect(page.locator('#funn-2 .har-bilde')).toBeVisible();
  await expect(page.locator('.sted-tall')).toContainText('1 uten bilde');
  // Legg-til-knappen blir stående i hovedraden (ikke flyttet inn i ⋯-menyen) —
  // bilde-indikator og legg-til er to atskilte, alltid synlige ikoner.
  await expect(page.locator('#funn-2 > .funn-handling > [data-bilde]')).toBeVisible();
  await page.locator('#funn-2 .funn-meny > summary').click();
  await expect(page.locator('#funn-2 [data-fjern-meg]')).toBeVisible();
});

test('endre fra menyen åpner eksisterende skjema og oppdaterer raden uten å endre folding', async ({ page }) => {
  await aapne(page);
  await page.route('**/api/ao-sighting-details', route => route.fulfill({
    json: { ok: true, funn: { quantity: '12', activity_navn: 'Stasjonær', taxon_id: 1, comment: 'Sett fra land' } },
  }));
  await page.route('**/api/ao-sighting-save', async route => {
    expect(route.request().postDataJSON().endringer).toEqual({ quantity: '13' });
    await route.fulfill({ json: { ok: true, bekreftet: true, ao: { Quantity: '13', ActivityName: 'Stasjonær' } } });
  });
  await page.locator('#funn-1 .funn-meny > summary').click();
  await page.locator('#funn-1 [data-endre]').click();
  await expect(page.locator('#em-kommentar')).toHaveValue('Sett fra land');
  await page.locator('#em-antall').fill('13');
  await page.locator('#em-lagre').click();
  await expect(page.locator('#em-kvittering')).toBeVisible();
  await page.locator('#em-avbryt').click();
  await expect(page.locator('#funn-1 .funn-art')).toContainText('13 Stokkand');
  await expect(page.locator('.sted-gruppe[open]')).toHaveCount(1);
});

test('320 px og lange navn gir ingen horisontal scrolling og beholder 44 px trykkflater', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await aapne(page, funn.map(f => ({ ...f,
    taxonName: 'Ubestemt dvergspett eller hvitryggspett',
    siteName: 'Langt lokalitetsnavn ved den ytterste bukta i Mosvatnet',
    reporter: 'Tursekretær med et langt observatørnavn',
  })));
  for (const tema of ['light', 'dark', 'clean']) {
    await page.evaluate(tema => {
      document.body.classList.toggle('theme-light', tema !== 'dark');
      document.body.classList.toggle('theme-clean', tema === 'clean');
    }, tema);
    await page.locator('#funn-2 .funn-meny > summary').click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    for (const selector of ['.sted-overskrift', '#funn-2 .funn-meny > summary', '#funn-2 [data-fjern-meg]', '#funn-1 > .funn-handling > [data-bilde]']) {
      const boks = await page.locator(selector).first().boundingBox();
      expect(boks!.height).toBeGreaterThanOrEqual(44);
    }
    await page.locator('#funn-2 .funn-meny > summary').click();
  }
});

function blandetGruppe() {
  return [funn[0], funn[1], { ...funn[0], sightingId: 4, taxonName: 'Gråmåke', hasImage: true },
    { ...funn[2], siteId: 10 }];
}

test('stedets handlinger virker lukket og viser hele utvalget med bildefilter og avkorting', async ({ page }, testInfo) => {
  await aapne(page, blandetGruppe(), { truncated: true, total: 100 });
  await page.getByLabel('Bare uten bilde').check();
  await page.getByRole('button', { name: 'Skjul alle', exact: true }).click();
  await page.locator('[data-sted-handlinger]').click();
  await expect(page.locator('.sted-gruppe')).not.toHaveAttribute('open', '');
  await expect(page.locator('#gm-utvalg')).toContainText('4 funn: 2 egne og 1 du er med på');
  await expect(page.locator('#gm-utvalg')).toContainText('1 med ukjent rolle');
  await expect(page.locator('#gm-omfang')).toContainText('også dem bildefilteret skjuler');
  await expect(page.locator('#gm-omfang')).toContainText('AO-listen er avkortet');
  await expect(page.locator('#gm-utfor')).toHaveText('Sett aktivitet på 2 funn');
  await page.locator('#gm-handling').selectOption('slett');
  await expect(page.locator('#gm-aktivitet-felt')).not.toBeVisible();
  await expect(page.locator('#gm-tid-felt')).not.toBeVisible();
  await expect(page.locator('#gm-advarsel')).toContainText('Sletter 2 egne funn');
  if (testInfo.project.name === 'chromium') await page.screenshot({ path: '/tmp/enkel-ao-sted-handlinger.png' });
  await page.keyboard.press('Escape');
  await expect(page.locator('.gruppe-modal')).not.toBeVisible();
  await expect(page.locator('[data-sted-handlinger]')).toBeFocused();
});

test('aktivitet endres sekvensielt bare på egne funn og lar senere AO-oppdatering vinne', async ({ page }) => {
  const rader = blandetGruppe();
  await aapne(page, rader);
  const kall: number[] = [];
  await page.route('**/api/ao-sighting-save', async route => {
    const data = route.request().postDataJSON();
    kall.push(data.sightingId);
    expect(data.expectedGroup).toEqual({ date: '2026-11-18', siteId: 10 });
    expect(data.endringer).toEqual({ activity_id: '23', activity_navn: 'Stasjonær' });
    await route.fulfill({ json: { ok: true, bekreftet: true, ao: { ActivityName: 'Stasjonær' } } });
  });
  await page.locator('[data-sted-handlinger]').click();
  await page.locator('#gm-aktivitet').selectOption('23');
  await page.locator('#gm-utfor').click();
  await expect(page.locator('#gm-status')).toContainText('Ferdig. 2 av 2');
  expect(kall).toEqual([1, 4]);
  await page.locator('#gm-avbryt').click();
  await expect(page.locator('#funn-1 .funn-meta')).toContainText('Stasjonær');
  await expect(page.locator('#funn-2 .funn-meta')).toContainText('Rastende');
  await page.route('**/api/ao-my-sightings', route => route.fulfill({
    json: { sightings: rader.map(f => ({ ...f, activity: 'Overflygende' })) },
  }));
  await page.locator('#ao-oppdater').click();
  await expect(page.locator('#funn-1 .funn-meta')).toContainText('Overflygende');
});

test('tidsrom valideres og sendes bare på egne funn', async ({ page }) => {
  await aapne(page, blandetGruppe());
  const kall: number[] = [];
  await page.route('**/api/ao-sighting-save', async route => {
    const data = route.request().postDataJSON();
    kall.push(data.sightingId);
    expect(data.endringer).toEqual({ time_from: '09:00', time_to: '11:30' });
    await route.fulfill({ json: { ok: true, bekreftet: true } });
  });
  await page.locator('[data-sted-handlinger]').click();
  await page.locator('#gm-handling').selectOption('tid');
  await expect(page.locator('#gm-aktivitet-felt')).not.toBeVisible();
  await expect(page.locator('#gm-tid-felt')).toBeVisible();
  await page.locator('#gm-fra').fill('11:00');
  await page.locator('#gm-til').fill('09:00');
  await page.locator('#gm-utfor').click();
  await expect(page.locator('#gm-status')).toContainText('Til-tid må være lik eller etter');
  expect(kall).toHaveLength(0);
  await page.locator('#gm-fra').fill('09:00');
  await page.locator('#gm-til').fill('11:30');
  await page.locator('#gm-utfor').click();
  await expect(page.locator('#gm-status')).toContainText('Ferdig. 2 av 2');
  expect(kall).toEqual([1, 4]);
  await page.locator('#gm-avbryt').click();
  await expect(page.locator('#funn-1 .funn-meta')).toContainText('09:00-11:30');
});

test('avmelding på stedet omfatter bare bekreftede medobservatørroller', async ({ page }) => {
  await aapne(page, blandetGruppe());
  const kall: number[] = [];
  await page.route('**/api/ao-remove-me', async route => {
    kall.push(route.request().postDataJSON().sightingId);
    await route.fulfill({ json: { ok: true, verified: true } });
  });
  await page.locator('[data-sted-handlinger]').click();
  await page.locator('#gm-handling').selectOption('fjern');
  page.once('dialog', async dialog => {
    expect(dialog.message()).toContain('Fjern meg fra 1 funn');
    expect(dialog.message()).toContain('Mosvatnet · 2026-11-18');
    await dialog.accept();
  });
  await page.locator('#gm-utfor').click();
  await expect(page.locator('#gm-status')).toContainText('Ferdig. 1 av 1');
  expect(kall).toEqual([2]);
  await page.locator('#gm-avbryt').click();
  await expect(page.locator('#funn-2')).toHaveCount(0);
  await expect(page.locator('#funn-1')).toBeVisible();
  await expect(page.locator('#funn-3')).toHaveCount(1);
});

test('sletting av stedet omfatter skjulte egne funn og bevarer andres', async ({ page }) => {
  await aapne(page, blandetGruppe());
  const kall: number[] = [];
  await page.route('**/api/ao-delete-sighting', async route => {
    kall.push(route.request().postDataJSON().sightingId);
    await route.fulfill({ json: { ok: true, verified: true } });
  });
  await page.getByLabel('Bare uten bilde').check();
  await page.locator('[data-sted-handlinger]').click();
  await page.locator('#gm-handling').selectOption('slett');
  page.once('dialog', dialog => dialog.dismiss());
  await page.locator('#gm-utfor').click();
  expect(kall).toHaveLength(0);
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#gm-utfor').click();
  await expect(page.locator('#gm-status')).toContainText('Ferdig. 2 av 2');
  expect(kall).toEqual([1, 4]);
  await page.locator('#gm-avbryt').click();
  await page.getByLabel('Bare uten bilde').uncheck();
  await expect(page.locator('#funn-1')).toHaveCount(0);
  await expect(page.locator('#funn-4')).toHaveCount(0);
  await expect(page.locator('#funn-2')).toBeVisible();
  await expect(page.locator('#funn-3')).toHaveCount(1);
});

test('delvis resultat stopper videre kall og modalen kan ikke lukkes under sending', async ({ page }) => {
  await aapne(page, [...blandetGruppe(), { ...funn[0], sightingId: 5, taxonName: 'Spurv' }]);
  let fullfoer!: () => void;
  const vent = new Promise<void>(resolve => { fullfoer = resolve; });
  const kall: number[] = [];
  await page.route('**/api/ao-sighting-save', async route => {
    kall.push(route.request().postDataJSON().sightingId);
    if (kall.length === 1) {
      await vent;
      await route.fulfill({ json: { ok: true, bekreftet: true, ao: { ActivityName: 'Stasjonær' } } });
    } else await route.fulfill({ json: { ok: true, bekreftet: null } });
  });
  await page.locator('[data-sted-handlinger]').click();
  await page.locator('#gm-aktivitet').selectOption('23');
  await page.locator('#gm-utfor').click();
  await expect(page.locator('#gm-avbryt')).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(page.locator('.gruppe-modal')).toBeVisible();
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.activeElement?.closest('dialog') !== null)).toBe(true);
  expect(kall).toEqual([1]);
  fullfoer();
  await expect(page.locator('#gm-status')).toContainText('Stoppet. 1 av 3');
  await expect(page.locator('#gm-utfor')).toBeDisabled();
  expect(kall).toEqual([1, 4]);
  await expect(page.locator('#gm-resultater li')).toHaveCount(2);
});

test('enkeltfunn har blyant og AO-lenke, og sletting krever bekreftelse med sted og dato', async ({ page }) => {
  await aapne(page);
  await expect(page.locator('#funn-1 > .funn-handling > [data-endre]')).toBeVisible();
  await expect(page.locator('#funn-1 > .funn-handling > a')).toHaveText('AO ↗');
  await page.locator('#funn-1 .funn-meny > summary').click();
  await page.locator('#funn-1 [data-slett]').click();
  let kall = 0;
  await page.route('**/api/ao-delete-sighting', async route => {
    kall++;
    await route.fulfill({ json: { ok: true, verified: false } });
  });
  page.once('dialog', async dialog => {
    expect(dialog.message()).toContain('Mosvatnet · 2026-11-18');
    expect(dialog.message()).toContain('12 Stokkand');
    await dialog.accept();
  });
  await page.locator('#gm-utfor').click();
  await expect(page.locator('#gm-status')).toContainText('Stoppet. 0 av 1');
  expect(kall).toBe(1);
  await page.locator('#gm-avbryt').click();
  await expect(page.locator('#funn-1')).toBeVisible();
});

test('avbrutt enkeltsletting gir fokus til synlig menyknapp', async ({ page }) => {
  await aapne(page);
  const menyknapp = page.locator('#funn-1 .funn-meny > summary');
  for (const maate of ['Escape', 'Avbryt']) {
    await menyknapp.click();
    await page.locator('#funn-1 [data-slett]').click();
    if (maate === 'Escape') await page.keyboard.press('Escape');
    else await page.locator('#gm-avbryt').click();
    await expect(page.locator('.gruppe-modal')).not.toBeVisible();
    await expect(menyknapp).toBeFocused();
  }
});

test('manglende steds-ID gir ingen massehandling', async ({ page }) => {
  await aapne(page, [{ ...funn[0], siteId: 0 }]);
  await expect(page.locator('[data-sted-handlinger]')).toHaveCount(0);
  await expect(page.locator('#funn-1 [data-endre]')).toBeVisible();
});

test('medobservatører venter på AO-bekreftelse før massehandling tilbys', async ({ page }) => {
  await aapne(page, blandetGruppe());
  let kall = 0;
  await page.route('**/api/ao-coobserver-setup', async route => {
    kall++;
    // Liten forsinkelse slik at «skjult mens vi venter»-tilstanden faktisk
    // er mulig å observere i testen, i stedet for at svaret kommer før
    // assertionen under rekker å kjøre.
    await new Promise((r) => setTimeout(r, 50));
    await route.fulfill({ json: { ok: true, selfAlias: 'meg',
      coobservers: [{ alias: 'annen', name: 'En annen' }], observerFields: {} } });
  });
  await page.locator('[data-sted-handlinger]').click();
  await page.locator('#gm-handling').selectOption('medobs');
  await expect(page.locator('#gm-aktivitet-felt')).not.toBeVisible();
  // «Utfør» skal ikke bare virke deaktivert — den skal være helt borte til
  // AO har bekreftet medobservatørvalgene, slik at ingen kan trykke gjennom
  // en masseendring som aldri ble kontrollert.
  await expect(page.locator('#gm-utfor')).not.toBeVisible();
  await expect(page.locator('#gm-status')).toContainText('Kontrollerer');
  await expect(page.locator('#gm-utfor')).toBeVisible();
  expect(kall).toBe(1);
});

test('et eldre hentesvar overskriver ikke aktivitet som ble bekreftet mens hentingen pågikk', async ({ page }) => {
  await aapne(page, blandetGruppe());
  let fullfoer!: () => void;
  const vent = new Promise<void>(resolve => { fullfoer = resolve; });
  await page.route('**/api/ao-my-sightings', async route => {
    await vent;
    await route.fulfill({ json: { sightings: blandetGruppe() } });
  });
  await page.route('**/api/ao-sighting-save', route => route.fulfill({
    json: { ok: true, bekreftet: true, ao: { ActivityName: 'Stasjonær' } },
  }));
  await page.locator('[data-sted-handlinger]').click();
  // Simuler en bakgrunnsoppdatering som allerede er i luften mens modalen er åpen.
  await page.evaluate(() => document.getElementById('ao-oppdater')!.click());
  await page.locator('#gm-aktivitet').selectOption('23');
  await page.locator('#gm-utfor').click();
  await expect(page.locator('#gm-status')).toContainText('Ferdig. 2 av 2');
  fullfoer();
  await expect(page.locator('#ao-oppdater')).toBeEnabled();
  await page.locator('#gm-avbryt').click();
  await expect(page.locator('#funn-1 .funn-meta')).toContainText('Stasjonær');
});
