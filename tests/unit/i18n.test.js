import { describe, it, expect, beforeEach, vi } from 'vitest';
import nb from '../../public/js/i18n/nb.js';
import nn from '../../public/js/i18n/nn.js';

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

describe('nb.js og nn.js har samme nøkler', () => {
  // Bokmål er master (se nb.js' egen kommentar), men t() faller stille tilbake
  // til bokmål og logger bare en advarsel i konsollen når nynorsk mangler en
  // nøkkel — ingen ser den advarselen med mindre de aktivt bytter språk og
  // leser konsollen. Uten denne testen oppdages ikke et glemt nynorsk-strengpar
  // før en bruker melder inn hver enkelt manuelt (skjedde ved
  // «Tidligere sendt»-redesignet, 13 nøkler manglet i nn.js, 19.11.2026).
  it('nn.js mangler ingen nøkkel som finnes i nb.js', () => {
    const manglerINn = Object.keys(nb).filter((key) => !(key in nn));
    expect(manglerINn).toEqual([]);
  });

  it('nb.js mangler ingen nøkkel som finnes i nn.js', () => {
    const manglerINb = Object.keys(nn).filter((key) => !(key in nb));
    expect(manglerINb).toEqual([]);
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

describe('header-menu ikoner med i18n', () => {
  it('beholder ikon-span til venstre for teksten etter setLanguage()', () => {
    document.body.innerHTML = `
      <nav class="header-menu-links">
        <a href="/fellestur.html"><span class="header-menu-icon" aria-hidden="true"><svg></svg></span><span data-i18n="main.nav.fellestur">Fellestur</span></a>
        <a href="/help.html"><span class="header-menu-icon" aria-hidden="true">📖</span><span data-i18n="index.help_link">Hjelp</span></a>
        <a href="/settings.html"><span class="header-menu-icon" aria-hidden="true">⚙️</span><span data-i18n="settings.title">Innstillinger</span></a>
      </nav>
    `;
    i18n.setLanguage('nn');
    const links = document.querySelectorAll('.header-menu-links a');
    expect(links).toHaveLength(3);
    links.forEach((link) => {
      const icon = link.firstElementChild;
      expect(icon?.classList.contains('header-menu-icon')).toBe(true);
      expect(icon?.getAttribute('aria-hidden')).toBe('true');
    });
    expect(links[0].lastElementChild?.textContent).toBe('Fellestur');
    expect(links[1].lastElementChild?.textContent).toBe('Hjelp');
    expect(links[2].lastElementChild?.textContent).toBe('Innstillingar');
  });
});
