import { test as base, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CURRENT_NEWS_SPLASH, STORAGE_KEY as NEWS_STORAGE_KEY } from '../../public/js/news-splash.js';

// Hent verdiene uten å laste nettlesermodulene (og deres versjonerte imports) i Node.
const hintSource = readFileSync(resolve(__dirname, '../../public/js/first-run-hint.js'), 'utf8');
function hintConstant(name: string): string {
  const match = hintSource.match(new RegExp(`export const ${name} = ['\"]([^'\"]+)['\"]`));
  if (!match) throw new Error(`Fant ikke ${name} i first-run-hint.js`);
  return match[1];
}
const HINT_ID = hintConstant('HINT_ID');
const HINT_STORAGE_KEY = hintConstant('STORAGE_KEY');

/**
 * Delt test-fixture for hele E2E-suiten. Alle spec-filer bør importere
 * `test`/`expect` herfra i stedet for direkte fra '@playwright/test'.
 *
 * Auto-fixture: markerer nyhetsplashen («Nytt i Enkel-AO») og førstegangs-
 * hinten («Slik kommer du i gang») som lest før hver test. Begge er
 * fullskjerms modal-overlays som vises på første side-last i en frisk
 * browser-kontekst, og blokkerer klikk på resten av siden i enhver test som
 * ikke selv håndterer dem. Henter id-ene direkte fra kildefilene i stedet
 * for å duplisere dem her, slik at fixturen automatisk følger med når en ny
 * nyhet/hint publiseres.
 */
export const test = base.extend({
  page: async ({ page }, use) => {
    await page.addInitScript(
      ({ newsKey, newsId, hintKey, hintId }) => {
        try {
          window.localStorage.setItem(newsKey, newsId);
          window.localStorage.setItem(hintKey, hintId);
        } catch (e) {
          // localStorage kan være utilgjengelig i noen test-kontekster — ufarlig å hoppe over.
        }
      },
      { newsKey: NEWS_STORAGE_KEY, newsId: CURRENT_NEWS_SPLASH.id, hintKey: HINT_STORAGE_KEY, hintId: HINT_ID },
    );
    await use(page);
  },
});

export { expect };
