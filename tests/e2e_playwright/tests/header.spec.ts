import { test, expect } from '@playwright/test';
import { CURRENT_NEWS_SPLASH, STORAGE_KEY } from '../../../public/js/news-splash.js';

test.use({ serviceWorkers: 'block' });

// Den delte fixturen importerer storage.js med en versjonert nettleserimport
// som Playwrights Node-loader ikke løser. Hold headertestene uavhengige av den.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(({ newsKey, newsId }) => {
    localStorage.setItem(newsKey, newsId);
    localStorage.setItem('enkelAoHintRead', 'start-with-location-v1');
  }, { newsKey: STORAGE_KEY, newsId: CURRENT_NEWS_SPLASH.id });
  await page.route('**/api/**', route => route.fulfill({ json: {} }));
});

for (const width of [320, 360, 390, 430, 599]) {
  test(`headeren holder én rad på ${width}px i begge moduser og innloggingstilstander`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/');
    for (const after of [false, true]) {
      for (const online of [false, true]) {
        await page.evaluate(({ after, online }) => {
          localStorage.setItem('afterRegistrationMode', after ? '1' : '0');
          if (online) {
            localStorage.setItem('ao_username', 'KS');
            localStorage.setItem('ao_password', 'testpassord');
          } else {
            localStorage.removeItem('ao_username');
            localStorage.removeItem('ao_password');
          }
        }, { after, online });
        await page.reload();
        await expect(page.locator('#ao-status-dot')).toHaveText(online ? 'KS' : /^Logg inn$/i);
        await expect(page.locator('#mode-pill')).toHaveAccessibleName(
          after ? /Modus: Etterregistrering/ : /Modus: Felt/,
        );

        const boxes = await page.locator('.app-header').evaluate(header => {
          const rect = header.getBoundingClientRect();
          const controls = ['#mode-pill', '#offline-mode-toggle', '#ao-status-dot', '.header-menu summary'].map(selector => {
            const box = header.querySelector(selector)!.getBoundingClientRect();
            return { x: box.x, y: box.y, width: box.width, height: box.height, right: box.right };
          });
          return { height: rect.height, y: rect.y, controls };
        });
        expect(boxes.height).toBe(44);
        for (const box of boxes.controls) {
          expect(box.y).toBe(boxes.y);
          expect(box.height).toBeGreaterThanOrEqual(44);
          expect(box.width).toBeGreaterThanOrEqual(44);
          expect(box.x).toBeGreaterThanOrEqual(0);
          expect(box.right).toBeLessThanOrEqual(width);
        }
        for (let i = 0; i < boxes.controls.length - 1; i++) {
          expect(boxes.controls[i].right).toBeLessThanOrEqual(boxes.controls[i + 1].x);
        }
      }
    }
  });
}

test('mobilmenyen ligger over skjemaet og kan lukkes med Escape og trykk utenfor', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto('/');
  const menu = page.locator('#header-menu');
  const trigger = menu.locator('summary');
  const location = page.locator('.section-lokasjon');
  const before = await location.boundingBox();

  await trigger.press('Enter');
  const help = menu.getByRole('link', { name: 'Hjelp', exact: true });
  await expect(help).toBeVisible();
  await expect(menu.getByRole('link', { name: 'Fellestur', exact: true })).toHaveAttribute('href', '/fellestur.html');
  await expect(menu.getByRole('link', { name: 'Innstillinger', exact: true })).toHaveAttribute('href', '/settings.html');
  expect((await location.boundingBox())!.y).toBe(before!.y);
  // Et faktisk treff i panelet, ikke bare et synlig element bak skjemaet.
  await help.click({ trial: true });
  await page.keyboard.press('Escape');
  await expect(help).toBeHidden();
  await expect(trigger).toBeFocused();

  await trigger.click();
  await page.locator('#place').click();
  await expect(help).toBeHidden();
  await expect(page.locator('#place')).toBeFocused();

  await trigger.click();
  await help.click();
  await expect(page).toHaveURL(/\/help.html$/);
});

test('modusbyttet beholder full tilgjengelig tekst på mobil', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto('/');
  const mode = page.locator('#mode-pill');
  await mode.press('Space');
  await expect(mode).toHaveAccessibleName(/Modus: Etterregistrering/);
  await expect(page.locator('.mode-pill-short')).toBeVisible();
  await expect(page.locator('#mode-pill-text')).toBeHidden();
  await expect(page.locator('#datetime-fields')).toBeVisible();
  await mode.press('Space');
  await expect(mode).toHaveAccessibleName(/Modus: Felt/);
  await expect(page.locator('.mode-pill-short')).toBeHidden();
  await expect(page.locator('#datetime-fields')).toBeHidden();
});

test('menypanelet følger alle tre temaer', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  for (const theme of ['light', 'dark', 'clean']) {
    await page.evaluate(theme => localStorage.setItem('ao_theme', theme), theme);
    await page.reload();
    await page.locator('#header-menu summary').click();
    const panel = page.locator('.header-menu-links');
    await expect(panel).toBeVisible();
    const colors = await panel.evaluate(nav => {
      const style = getComputedStyle(nav);
      const link = getComputedStyle(nav.querySelector('a')!);
      return { background: style.backgroundColor, text: link.color };
    });
    expect(colors.background).not.toBe('rgba(0, 0, 0, 0)');
    expect(colors.text).not.toBe(colors.background);
  }
});

test('desktop beholder ikonlenkene og full modustekst', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 900 });
  await page.goto('/');
  await page.locator('#mode-pill').click();
  await expect(page.locator('#mode-pill-text')).toBeVisible();
  await expect(page.locator('#mode-pill-text')).toHaveText('Etterregistrering');
  await expect(page.locator('#header-menu')).toBeHidden();
  const actions = page.locator('.header-actions');
  await expect(actions.getByRole('link', { name: 'Hjelp', exact: true })).toBeVisible();
  await expect(actions.getByRole('link', { name: 'Innstillinger', exact: true })).toBeVisible();
  await expect(actions.getByRole('link', { name: /Fellestur –/ })).toBeVisible();
});

// Prioriteringen i trinn-systemet: nettverksmodusen (Online/Hybrid/Offline) er
// driftsinfo man må kunne lese i felt, appnavnet er bare identitet - og logoen
// bærer den alene. Appnavnet ofres derfor i to steg FØR ordet røres.
// Grensene er målt, ikke valgt: de følger av 44px-trykkflatene.
for (const [bredde, forventet] of [[430, 'Enkel-AO'], [390, 'Enkel-AO'], [375, 'EAO'], [360, 'EAO'], [320, 'ingen']] as const) {
  test(`${bredde}px viser appnavnet som «${forventet}» og beholder alltid nettverksordet`, async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('network_mode_v1', 'offline'));
    await page.setViewportSize({ width: bredde, height: 844 });
    await page.goto('/');
    const navn = page.locator('#app-title');

    if (forventet === 'Enkel-AO') {
      await expect(navn).toBeVisible();
      await expect(navn).toHaveText('Enkel-AO');
      await expect(navn).not.toHaveCSS('font-size', '0px');
    } else if (forventet === 'EAO') {
      // Kortformen tegnes med ::before, så elementet er synlig uten egen tekst.
      await expect(navn).toBeVisible();
      await expect(navn).toHaveCSS('font-size', '0px');
    } else {
      await expect(navn).toBeHidden();
    }

    // Uansett trinn: ordet Online/Hybrid/Offline skal stå så lenge det er mulig.
    const pill = page.locator('#offline-mode-toggle');
    await expect(pill).toContainText(/Offline/);
    await expect(pill).not.toHaveCSS('font-size', '0px');

    // Logoen er aldri forhandlingsbar.
    await expect(page.locator('.title img')).toBeVisible();
  });
}

test('nettverksordet ofres først når selv et navnløst navn ikke er nok', async ({ page }) => {
  // 280px er smalere enn noen telefon vi støtter og finnes her bare for å
  // bevise rekkefølgen: appnavnet må være borte før ordet i det hele tatt røres.
  await page.addInitScript(() => {
    localStorage.setItem('network_mode_v1', 'offline');
    localStorage.setItem('afterRegistrationMode', '1');
  });
  await page.setViewportSize({ width: 280, height: 844 });
  await page.goto('/');
  const trinn = Number(await page.locator('.app-header').getAttribute('data-komprimering'));
  expect(trinn).toBeGreaterThanOrEqual(2);
  await expect(page.locator('#app-title')).toBeHidden();
  await expect(page.locator('.title img')).toBeVisible();
});

test('headeren komprimerer aldri mer enn nødvendig', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('network_mode_v1', 'hybrid'));
  await page.setViewportSize({ width: 360, height: 844 });
  await page.goto('/');
  // Trinnet under det valgte skal faktisk renne over - ellers ga vi fra oss
  // tekst vi kunne ha beholdt.
  const resultat = await page.evaluate(() => {
    const h = document.querySelector('.app-header') as HTMLElement;
    const valgt = Number(h.dataset.komprimering);
    if (valgt === 0) return { valgt, rennerOver: null };
    h.dataset.komprimering = String(valgt - 1);
    const rennerOver = h.scrollWidth > h.clientWidth + 1;
    h.dataset.komprimering = String(valgt);
    return { valgt, rennerOver };
  });
  if (resultat.valgt > 0) expect(resultat.rennerOver).toBe(true);
});
