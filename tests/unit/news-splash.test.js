import { beforeEach, describe, expect, it, vi } from 'vitest';

import { hasReadNews, initNewsSplash, markNewsRead } from '../../public/js/news-splash.js';

const store = {};

beforeEach(() => {
  document.body.innerHTML = '';
  document.cookie = 'enkelAoNewsRead=; Max-Age=0; Path=/';
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
  it('viser nyhet når den ikke er lest', () => {
    initNewsSplash();

    expect(document.querySelector('.news-splash')).toBeTruthy();
    expect(document.body.textContent).toContain('Nytt i Enkel-AO');
    expect(document.body.textContent).toContain('Besøk på samme lokalitet');
  });

  it('skjuler nyhet etter at den er lest', () => {
    markNewsRead();
    initNewsSplash();

    expect(hasReadNews()).toBe(true);
    expect(document.querySelector('.news-splash')).toBeFalsy();
  });

  it('lagrer lest-status når brukeren trykker skjønner', () => {
    initNewsSplash();

    document.querySelector('.news-splash-button').click();

    expect(hasReadNews()).toBe(true);
    expect(document.querySelector('.news-splash')).toBeFalsy();
  });
});
