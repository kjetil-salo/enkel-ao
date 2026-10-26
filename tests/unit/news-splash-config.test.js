/**
 * Vakter mot feilene som faktisk har truffet prod når en nyhet publiseres.
 *
 * Alle sammen er stille: nyheten ser riktig ut i koden, testene er grønne, og
 * så oppdager du uken etter at ingen så den — eller at bildet manglet for alle
 * uten nett. Derfor står de her, ikke bare som punkter i en sjekkliste.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CURRENT_NEWS_SPLASH } from '../../public/js/news-splash.js';

const ROT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const les = (sti) => readFileSync(resolve(ROT, sti), 'utf8');

/**
 * Nyhets-id-er som har vært publisert før.
 *
 * Gjenbrukes en id, får ingen som har lukket den forrige nyheten se den nye —
 * og du oppdager det ikke selv, for din egen nettleser husker også at du har
 * lest den. Legg den gamle id-en hit når du publiserer en ny.
 */
const TIDLIGERE_IDER = [
  'oktober-2026-fellestur-og-brukeropplevelse-v1',
];

// AO-grensen er irrelevant her; dette er vår egen, satt for at bildet ikke skal
// koste brukerne unødig mobildata. Fila precaches til ALLE.
const MAKS_BILDE_KB = 250;

describe('nyhetssplash – id', () => {
  it('har en id', () => {
    expect(CURRENT_NEWS_SPLASH.id).toBeTruthy();
  });

  it('gjenbruker ikke en tidligere publisert id', () => {
    expect(TIDLIGERE_IDER).not.toContain(CURRENT_NEWS_SPLASH.id);
  });
});

describe('nyhetssplash – punktene', () => {
  const items = CURRENT_NEWS_SPLASH.items;

  it('har minst ett punkt', () => {
    expect(items.length).toBeGreaterThan(0);
  });

  it('har ikke flere punkter enn som vises', () => {
    // MAX_VISIBLE i news-splash.js kutter resten uten å si fra. Et punkt som
    // aldri vises er verre enn ingen: du tror du har fortalt noe.
    const maksVisible = Number(
      les('public/js/news-splash.js').match(/const MAX_VISIBLE = (\d+)/)[1]
    );
    expect(items.length).toBeLessThanOrEqual(maksVisible);
  });

  it('har tittel og brødtekst i hvert punkt', () => {
    for (const item of items) {
      expect(item.title?.trim()).toBeTruthy();
      expect(item.body?.trim()).toBeTruthy();
    }
  });

  it('har fullstendige lenker der lenke er satt', () => {
    for (const item of items.filter((i) => i.link)) {
      expect(item.link.href?.trim()).toBeTruthy();
      expect(item.link.text?.trim()).toBeTruthy();
    }
  });
});

describe('nyhetssplash – bilde', () => {
  const medBilde = CURRENT_NEWS_SPLASH.items.filter((i) => i.image);

  it('har alt-tekst på hvert bilde', () => {
    for (const item of medBilde) {
      expect(item.image.src?.trim()).toBeTruthy();
      expect(item.image.alt?.trim()).toBeTruthy();
    }
  });

  it('peker på en fil som finnes', () => {
    for (const item of medBilde) {
      expect(() => les(`public${item.image.src}`)).not.toThrow();
    }
  });

  it('er lagt i STATIC_ASSETS i sw.js', () => {
    // Uten dette mangler bildet for alle som åpner appen uten nett — og det
    // merkes ikke i utvikling, der nettet alltid er der.
    const sw = les('public/sw.js');
    for (const item of medBilde) {
      expect(sw).toContain(`'${item.image.src}'`);
    }
  });

  it('holder seg innenfor vektbudsjettet', () => {
    for (const item of medBilde) {
      const kb = les(`public${item.image.src}`).length / 1024;
      expect(kb).toBeLessThan(MAKS_BILDE_KB);
    }
  });
});

describe('nyhetssplash – cache-busting', () => {
  it('importeres med ?v= fra main.js', () => {
    // Stilark og bare imports har ingen versjon, så Cloudflare kan servere en
    // gammel kopi i opptil fire timer. Uten ?v= her finnes ikke en ny nyhet for
    // noen før cachen går ut. Traff prod i v1.55.2.
    const main = les('public/js/main.js');
    expect(main).toMatch(/from '\.\/news-splash\.js\?v=v[\d.]+'/);
  });

  it('bruker samme versjon i importen som i version.js', () => {
    const versjon = les('public/js/version.js').match(/VERSION = '(v[\d.]+)'/)[1];
    const importert = les('public/js/main.js')
      .match(/from '\.\/news-splash\.js\?v=(v[\d.]+)'/)[1];
    // Ikke en absolutt regel — en gammel ?v= er bare feil når modulen er endret.
    // Men å la dem følges ad er billig, og fjerner hele vurderingen.
    expect(importert).toBe(versjon);
  });
});
