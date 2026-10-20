import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CURRENT_NEWS_SPLASH,
  hasReadNews,
  initNewsSplash,
  markNewsRead,
} from '../../public/js/news-splash.js';

const store = {};
const originalNewsSplash = {
  enabled: CURRENT_NEWS_SPLASH.enabled,
  id: CURRENT_NEWS_SPLASH.id,
  items: CURRENT_NEWS_SPLASH.items,
};

beforeEach(() => {
  document.body.innerHTML = '';
  document.cookie = 'enkelAoNewsRead=; Max-Age=0; Path=/';
  CURRENT_NEWS_SPLASH.enabled = originalNewsSplash.enabled;
  CURRENT_NEWS_SPLASH.id = originalNewsSplash.id;
  CURRENT_NEWS_SPLASH.items = originalNewsSplash.items;
  Object.keys(store).forEach((key) => delete store[key]);
  vi.stubGlobal('localStorage', {
    getItem: vi.fn((key) => store[key] ?? null),
    setItem: vi.fn((key, value) => { store[key] = String(value); }),
    clear: vi.fn(() => {
      Object.keys(store).forEach((key) => delete store[key]);
    }),
  });
});

describe('news-splash', () => {
  it('viser nyheter når ingenting er lest, også uten observasjoner', () => {
    initNewsSplash();

    expect(document.querySelector('.news-splash')).toBeTruthy();
    expect(document.body.textContent).toContain('Nytt i Enkel-AO');
    expect(document.body.textContent).toContain('Se endringslogg');

    // Les forventningen ut av konfigen i stedet for å gjenta nyhetsteksten
    // her. Testen hardkodet tidligere punktene fra én bestemt nyhet, og falt
    // derfor hver gang en ny nyhet ble publisert — uten at noe faktisk var
    // galt. Det den skal verne om er at ALLE aktive punkter havner i DOM-en.
    CURRENT_NEWS_SPLASH.items.forEach((item) => {
      expect(document.body.textContent).toContain(item.title);
      expect(document.body.textContent).toContain(item.body);
    });
  });

  it('rendrer valgfri lenke på et punkt som har den', () => {
    CURRENT_NEWS_SPLASH.items = [
      { title: 'Med lenke', body: 'Tekst', link: { href: 'mailto:a@b.no', text: 'a@b.no' } },
      { title: 'Uten lenke', body: 'Tekst' },
    ];

    initNewsSplash();

    const lenker = document.querySelectorAll('.news-splash-item-link');
    expect(lenker).toHaveLength(1);
    expect(lenker[0].getAttribute('href')).toBe('mailto:a@b.no');
    expect(lenker[0].textContent).toBe('a@b.no');
  });

  it('hopper over ufullstendig lenke uten å kaste', () => {
    CURRENT_NEWS_SPLASH.items = [
      { title: 'Mangler text', body: 'Tekst', link: { href: 'mailto:a@b.no' } },
      { title: 'Mangler href', body: 'Tekst', link: { text: 'a@b.no' } },
    ];

    initNewsSplash();

    expect(document.querySelector('.news-splash')).toBeTruthy();
    expect(document.querySelectorAll('.news-splash-item-link')).toHaveLength(0);
  });

  it('skjuler nyheter etter at nyeste er lest', () => {
    markNewsRead();
    initNewsSplash();

    expect(hasReadNews()).toBe(true);
    expect(document.querySelector('.news-splash')).toBeFalsy();
  });

  it('viser ikke splash når nyheten er manuelt skrudd av', () => {
    CURRENT_NEWS_SPLASH.enabled = false;

    initNewsSplash();

    expect(document.querySelector('.news-splash')).toBeFalsy();
  });

  it('lagrer lest-status når brukeren trykker skjønner', () => {
    initNewsSplash();

    document.querySelector('.news-splash-button').click();

    expect(hasReadNews()).toBe(true);
    expect(document.querySelector('.news-splash')).toBeFalsy();
  });

  it('viser aktiv nyhet selv om en gammel nyhets-id er lest', () => {
    markNewsRead('visit-locks-v1');
    initNewsSplash();

    expect(document.querySelector('.news-splash')).toBeTruthy();
    expect(document.body.textContent).toContain(CURRENT_NEWS_SPLASH.items[0].title);
    expect(hasReadNews(CURRENT_NEWS_SPLASH.id)).toBe(false);
  });
});
