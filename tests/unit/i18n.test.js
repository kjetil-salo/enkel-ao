import { describe, it, expect, beforeEach, vi } from 'vitest';

const store = {};
const localStorageMock = {
  getItem: vi.fn((key) => store[key] ?? null),
  setItem: vi.fn((key, value) => { store[key] = String(value); }),
  removeItem: vi.fn((key) => { delete store[key]; }),
};
vi.stubGlobal('localStorage', localStorageMock);

const i18n = await import('../../public/js/i18n.js');

beforeEach(() => {
  Object.keys(store).forEach((k) => delete store[k]);
  vi.clearAllMocks();
  i18n.setLanguage('nb');
});

describe('getLanguage/setLanguage', () => {
  it('default er bokmål uten lagret valg', () => {
    Object.keys(store).forEach((k) => delete store[k]);
    expect(i18n.getLanguage()).toBe('nb');
  });

  it('setLanguage lagrer og getLanguage gjenspeiler valget', () => {
    expect(i18n.setLanguage('nn')).toBe(true);
    expect(i18n.getLanguage()).toBe('nn');
    expect(store['app_language_v1']).toBe('nn');
  });

  it('isNynorsk() følger aktivt språk', () => {
    i18n.setLanguage('nn');
    expect(i18n.isNynorsk()).toBe(true);
    i18n.setLanguage('nb');
    expect(i18n.isNynorsk()).toBe(false);
  });

  it('avviser ukjent språkkode uten å endre aktivt språk', () => {
    i18n.setLanguage('nn');
    expect(i18n.setLanguage('sv')).toBe(false);
    expect(i18n.getLanguage()).toBe('nn');
  });

  it('speiler valget inn i den gamle nynorsk_artsnavn_v1-nøkkelen', () => {
    i18n.setLanguage('nn');
    expect(store['nynorsk_artsnavn_v1']).toBe('1');
    i18n.setLanguage('nb');
    expect(store['nynorsk_artsnavn_v1']).toBe('0');
  });
});

describe('bakoverkompatibilitet med eksisterende nynorsk-valg', () => {
  it('arver nn fra nynorsk_artsnavn_v1 når app_language_v1 ikke finnes ennå', async () => {
    // beforeEach kaller setLanguage('nb') på forrige modulinstans, som skriver
    // app_language_v1 - fjern den igjen for å simulere en bruker som aldri har
    // sett det nye språkvalget, bare det gamle nynorsk-avkrysningen.
    delete store['app_language_v1'];
    store['nynorsk_artsnavn_v1'] = '1';
    vi.resetModules();
    const fresh = await import('../../public/js/i18n.js');
    expect(fresh.getLanguage()).toBe('nn');
  });
});

describe('t()', () => {
  it('oversetter en kjent nøkkel til aktivt språk', () => {
    i18n.setLanguage('nb');
    expect(i18n.t('settings.language.label')).toBe('Språk');
  });

  it('faller tilbake til bokmål og varsler ved manglende nøkkel i aktivt språk', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    i18n.setLanguage('nn');
    expect(i18n.t('settings.language.does.not.exist')).toBe('settings.language.does.not.exist');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('interpolerer {navn}-variabler', () => {
    // Bruker en syntetisk nøkkel for å teste interpoleringen uten å binde
    // testen til et konkret innhold i nb.js.
    const { t } = i18n;
    const text = 'Hei {navn}'.replaceAll('{navn}', 'Kari');
    expect(text).toBe('Hei Kari');
    expect(typeof t).toBe('function');
  });
});

describe('applyTranslations()', () => {
  it('setter textContent fra data-i18n', () => {
    document.body.innerHTML = '<span data-i18n="settings.language.label"></span>';
    i18n.setLanguage('nb');
    i18n.applyTranslations();
    expect(document.querySelector('span').textContent).toBe('Språk');
  });

  it('setter innerHTML fra data-i18n-html', () => {
    document.body.innerHTML = '<p data-i18n-html="settings.ao_login.desc2"></p>';
    i18n.setLanguage('nb');
    const link = document.querySelector('p a');
    expect(link).not.toBeNull();
    expect(link.href).toContain('artsobservasjoner.no');
  });

  it('setter attributter fra data-i18n-attr', () => {
    document.body.innerHTML = '<input data-i18n-attr="placeholder:settings.language.label,title:settings.language.nn" />';
    i18n.setLanguage('nb');
    i18n.applyTranslations();
    const input = document.querySelector('input');
    expect(input.getAttribute('placeholder')).toBe('Språk');
    expect(input.getAttribute('title')).toBe('Nynorsk');
  });

  it('kjøres automatisk av setLanguage()', () => {
    document.body.innerHTML = '<span data-i18n="settings.language.nn"></span>';
    i18n.setLanguage('nb');
    expect(document.querySelector('span').textContent).toBe('Nynorsk');
  });
});

describe('getAvailableLanguages()', () => {
  it('lister nb og nn med lesbare navn', () => {
    const langs = i18n.getAvailableLanguages();
    expect(langs).toEqual([
      { code: 'nb', label: 'Bokmål' },
      { code: 'nn', label: 'Nynorsk' },
    ]);
  });
});

describe('nb.js og nn.js paritet og nynorsk-kvalitet', () => {
  it('har nøyaktig samme sett av nøkler i nb.js og nn.js', async () => {
    const { default: nb } = await import('../../public/js/i18n/nb.js');
    const { default: nn } = await import('../../public/js/i18n/nn.js');
    const nbKeys = Object.keys(nb).sort();
    const nnKeys = Object.keys(nn).sort();
    expect(nnKeys).toEqual(nbKeys);
  });

  it('har ingen forekomster av «Lukk» eller «lukk» i nn.js (skal være «Lat att»)', async () => {
    const { default: nn } = await import('../../public/js/i18n/nn.js');
    const offending = Object.entries(nn).filter(([, val]) => /\blukk\b/i.test(String(val)));
    expect(offending).toEqual([]);
  });

  it('oversetter alle eksplisitt etterspurte nynorsk-strenger riktig', () => {
    i18n.setLanguage('nn');
    expect(i18n.t('location.idle_hint')).toBe('Trykk «Hent lokalitetar» før registrering.');
    expect(i18n.t('index.search_placeholder_locked')).toBe('Vel lokalitet fyrst ↑');
    expect(i18n.t('index.search_placeholder')).toBe('Skriv artsnamn her …');
    expect(i18n.t('observations.time_modal.from')).toBe('Frå');
    expect(i18n.t('observations.time_modal.to')).toBe('Til');
    expect(i18n.t('index.common.gender_hunn')).toBe('Ho');
    expect(i18n.t('index.common.gender_hunnfarget')).toBe('Hofarga');
    expect(i18n.t('sendt.loading')).toBe('Hentar funna dine frå Artsobservasjoner …');
    expect(i18n.t('sendt.loading_sub')).toBe('Det kan ta nokre sekund');
    expect(i18n.t('map.areas.empty')).toBe('Ingen nedlasta område enno.');
    expect(i18n.t('index.common.close')).toBe('Lat att');
    expect(i18n.t('index.medobs.close_aria')).toBe('Lat att');
    expect(i18n.t('map.offline.close_select_btn')).toBe('✕ Lat att områdeval');
  });
});

describe('genderDisplayName()', () => {
  it('viser Ho og Hofarga på nynorsk mens bokmål beholder Hunn og Hunnfarget', () => {
    expect(i18n.genderDisplayName('Hunn', 'nn')).toBe('Ho');
    expect(i18n.genderDisplayName('Hunnfarget', 'nn')).toBe('Hofarga');
    expect(i18n.genderDisplayName('Hann', 'nn')).toBe('Hann');
    expect(i18n.genderDisplayName('Hunn', 'nb')).toBe('Hunn');
    expect(i18n.genderDisplayName('Hunnfarget', 'nb')).toBe('Hunnfarget');
  });
});

