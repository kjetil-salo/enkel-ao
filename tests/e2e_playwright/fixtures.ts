import { test as base, expect, type BrowserContext, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CURRENT_NEWS_SPLASH, STORAGE_KEY as NEWS_STORAGE_KEY } from '../../public/js/news-splash.js';

// Hent verdiene uten å laste nettlesermodulene (og deres versjonerte imports) i Node.
const hintSource = readFileSync(resolve(__dirname, '../../public/js/first-run-hint.js'), 'utf8');
const sgHintSource = readFileSync(resolve(__dirname, '../../public/js/species-group-hint.js'), 'utf8');
function hintConstant(source: string, name: string): string {
  const match = source.match(new RegExp(`export const ${name} = ['\"]([^'\"]+)['\"]`));
  if (!match) throw new Error(`Fant ikke ${name}`);
  return match[1];
}
const HINT_ID = hintConstant(hintSource, 'HINT_ID');
const HINT_STORAGE_KEY = hintConstant(hintSource, 'STORAGE_KEY');
const SG_HINT_ID = hintConstant(sgHintSource, 'HINT_ID');
const SG_HINT_STORAGE_KEY = hintConstant(sgHintSource, 'STORAGE_KEY');

/**
 * Delt test-fixture for hele E2E-suiten. Alle spec-filer bør importere
 * `test`/`expect` herfra i stedet for direkte fra '@playwright/test'.
 *
 * Auto-fixture: markerer nyhetsplashen («Nytt i Enkel-AO»), førstegangs-
 * hinten («Slik kommer du i gang») og artsgruppe-hinten som lest før hver test.
 * Alle tre er fullskjerms overlays som blokkerer klikk på resten av siden i
 * en frisk browser-kontekst. Henter id-ene direkte fra kildefilene i stedet
 * for å duplisere dem her, slik at fixturen automatisk følger med når en ny
 * nyhet/hint publiseres.
 */
export async function merkIntroLest(mal: BrowserContext | Page) {
  await mal.addInitScript(
    ({ newsKey, newsId, hintKey, hintId, sgHintKey, sgHintId }) => {
      try {
        window.localStorage.setItem(newsKey, newsId);
        window.localStorage.setItem(hintKey, hintId);
        window.localStorage.setItem(sgHintKey, sgHintId);
      } catch {
        // localStorage kan være utilgjengelig i noen testkontekster.
      }
    },
    {
      newsKey: NEWS_STORAGE_KEY,
      newsId: CURRENT_NEWS_SPLASH.id,
      hintKey: HINT_STORAGE_KEY,
      hintId: HINT_ID,
      sgHintKey: SG_HINT_STORAGE_KEY,
      sgHintId: SG_HINT_ID,
    },
  );
}

export const test = base.extend({
  page: async ({ page }, use) => {
    await merkIntroLest(page);
    await use(page);
  },
});

export { expect };
