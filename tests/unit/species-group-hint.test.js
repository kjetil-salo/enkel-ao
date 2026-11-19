import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  HINT_ID,
  STORAGE_KEY,
  hasSeenSpeciesGroupHint,
  initSpeciesGroupHint,
  markSpeciesGroupHintSeen,
  shouldShowSpeciesGroupHint,
} from '../../public/js/species-group-hint.js';

const store = {};

function byggHeaderDOM() {
  document.body.innerHTML = `
    <div class="card">
      <header class="app-header">
        <div class="header-actions">
          <button type="button" class="species-group-toggle" id="species-group-trigger" aria-pressed="false">
            <span id="species-group-icon" aria-hidden="true">🦉</span>
          </button>
        </div>
      </header>
    </div>
  `;
  const trigger = document.getElementById('species-group-trigger');
  trigger.getBoundingClientRect = () => ({
    left: 280,
    top: 12,
    right: 324,
    bottom: 56,
    width: 44,
    height: 44,
  });
  return { trigger };
}

beforeEach(() => {
  document.body.innerHTML = '';
  document.body.className = '';
  document.cookie = 'enkelAoSpeciesGroupHintRead=; Max-Age=0; Path=/';
  Object.keys(store).forEach((key) => delete store[key]);
  vi.stubGlobal('localStorage', {
    getItem: vi.fn((key) => store[key] ?? null),
    setItem: vi.fn((key, value) => { store[key] = String(value); }),
    clear: vi.fn(() => {
      Object.keys(store).forEach((key) => delete store[key]);
    }),
  });
  vi.stubGlobal('scrollTo', vi.fn());
  Object.defineProperty(window, 'innerWidth', { value: 375, configurable: true });
});

describe('species-group-hint (spotlight-onboarding for pattedyr)', () => {
  it('lyser opp artsgruppe-ikonet over mørk bakgrunn på bokmål og peker pilen mot knappen', () => {
    const { trigger } = byggHeaderDOM();

    initSpeciesGroupHint();

    expect(document.body.classList.contains('species-group-hint-active')).toBe(true);
    expect(document.querySelector('.species-group-hint-dim')).toBeTruthy();
    expect(trigger.classList.contains('species-group-spot')).toBe(true);

    const bubble = document.querySelector('.species-group-hint-bubble');
    expect(bubble).toBeTruthy();
    expect(bubble.querySelector('.species-group-hint-body')?.textContent).toBe(
      'Nå er det mulig å rapportere pattedyr i tillegg til fugl.',
    );
    expect(bubble.querySelector('.species-group-hint-button')?.textContent).toBe('Prøv selv!');
    expect(bubble.style.top).toBe('68px');
    expect(bubble.style.getPropertyValue('--species-hint-arrow-left')).toBeTruthy();
  });

  it('viser kortfattet melding og Prøv sjølv!-knapp på nynorsk når språk er nn', () => {
    store['app_language_v1'] = 'nn';
    byggHeaderDOM();

    initSpeciesGroupHint();

    const bubble = document.querySelector('.species-group-hint-bubble');
    expect(bubble.querySelector('.species-group-hint-body')?.textContent).toBe(
      'No er det mogleg å rapportera pattedyr i tillegg til fugl.',
    );
    expect(bubble.querySelector('.species-group-hint-button')?.textContent).toBe('Prøv sjølv!');
  });

  it('bytter artsgruppe via knappen, lagrer lest-status og rydder opp når brukeren trykker Prøv selv!', () => {
    const { trigger } = byggHeaderDOM();
    const onToggle = vi.fn();
    trigger.addEventListener('click', onToggle);

    initSpeciesGroupHint();
    document.querySelector('.species-group-hint-button').click();

    expect(hasSeenSpeciesGroupHint()).toBe(true);
    expect(shouldShowSpeciesGroupHint()).toBe(false);
    expect(store[STORAGE_KEY]).toBe(HINT_ID);
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(trigger.classList.contains('species-group-spot')).toBe(false);
    expect(document.querySelector('.species-group-hint-dim')).toBeFalsy();
    expect(document.querySelector('.species-group-hint-bubble')).toBeFalsy();
    expect(document.body.classList.contains('species-group-hint-active')).toBe(false);
  });

  it('lukker spotlighten og lagrer lest-status når brukeren trykker direkte på artsgruppe-ikonet', () => {
    const { trigger } = byggHeaderDOM();
    const onToggle = vi.fn();
    trigger.addEventListener('click', onToggle);

    initSpeciesGroupHint();
    trigger.click();

    expect(hasSeenSpeciesGroupHint()).toBe(true);
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.species-group-hint-dim')).toBeFalsy();
    expect(trigger.classList.contains('species-group-spot')).toBe(false);
  });

  it('lukkes uten å bytte artsgruppe ved trykk på mørk bakgrunn eller Escape', () => {
    const { trigger } = byggHeaderDOM();
    const onToggle = vi.fn();
    trigger.addEventListener('click', onToggle);

    initSpeciesGroupHint();
    document.querySelector('.species-group-hint-dim').click();

    expect(hasSeenSpeciesGroupHint()).toBe(true);
    expect(onToggle).not.toHaveBeenCalled();
    expect(document.querySelector('.species-group-hint-dim')).toBeFalsy();

    document.cookie = 'enkelAoSpeciesGroupHintRead=; Max-Age=0; Path=/';
    delete store[STORAGE_KEY];
    initSpeciesGroupHint();
    expect(document.querySelector('.species-group-hint-dim')).toBeTruthy();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(hasSeenSpeciesGroupHint()).toBe(true);
    expect(onToggle).not.toHaveBeenCalled();
    expect(document.querySelector('.species-group-hint-dim')).toBeFalsy();
  });

  it('vises ikke igjen når den allerede er sett', () => {
    markSpeciesGroupHintSeen();
    byggHeaderDOM();

    initSpeciesGroupHint();

    expect(document.querySelector('.species-group-hint-dim')).toBeFalsy();
    expect(document.querySelector('.species-group-hint-bubble')).toBeFalsy();
  });

  it('venter med å vises mens nyhetssplash eller annen coachmark er åpen, og vises rett etterpå', async () => {
    byggHeaderDOM();
    const splash = document.createElement('div');
    splash.className = 'news-splash';
    document.body.appendChild(splash);

    initSpeciesGroupHint();
    expect(document.querySelector('.species-group-hint-dim')).toBeFalsy();

    splash.remove();
    await new Promise((r) => setTimeout(r, 0));

    expect(document.querySelector('.species-group-hint-dim')).toBeTruthy();
    expect(document.querySelector('.species-group-hint-bubble')).toBeTruthy();
  });
});
