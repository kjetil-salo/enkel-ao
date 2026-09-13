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
    expect(document.body.textContent).toContain('⚠️ Varsel ved sjeldne funn');
    expect(document.body.textContent).toContain('Krever nett og innlogging');
    expect(document.body.textContent).toContain('Se endringslogg');
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
    expect(document.body.textContent).toContain('⚠️ Varsel ved sjeldne funn');
    expect(hasReadNews(CURRENT_NEWS_SPLASH.id)).toBe(false);
  });
});
