import { describe, it, expect, beforeEach, vi } from 'vitest';
import { normaliserProsjekt, lagretProsjekt, lagreProsjekt, initProjectPicker } from '../../public/js/project-picker.js';

const TOMT = { id: '4044', name: 'Tomtekryss Hylkjesvingen 49' };

describe('normaliserProsjekt', () => {
  it('godtar et rent tall-id og et navn', () => {
    expect(normaliserProsjekt({ id: 4044, name: ' Tomtekryss Hylkjesvingen 49 ' })).toEqual(TOMT);
  });
  it('avviser alt som ikke er en AO-ID', () => {
    expect(normaliserProsjekt({ id: '12&x=1', name: 'a' })).toBeNull();
    expect(normaliserProsjekt({ id: '12', name: '' })).toBeNull();
    expect(normaliserProsjekt(null)).toBeNull();
    expect(normaliserProsjekt('4044')).toBeNull();
  });
});

describe('prosjektet huskes til neste funn', () => {
  beforeEach(() => localStorage.clear());

  it('lagres og leses tilbake', () => {
    lagreProsjekt(TOMT);
    expect(lagretProsjekt()).toEqual(TOMT);
  });
  it('null fjerner det', () => {
    lagreProsjekt(TOMT);
    lagreProsjekt(null);
    expect(lagretProsjekt()).toBeNull();
  });
  it('tåler ødelagt lagring', () => {
    localStorage.setItem('aoProject_v1', '{ikke json');
    expect(lagretProsjekt()).toBeNull();
  });
  it('varsler andre deler av siden', () => {
    const lytter = vi.fn();
    document.addEventListener('obs:prosjekt-endret', lytter);
    lagreProsjekt(TOMT);
    expect(lytter.mock.calls[0][0].detail).toEqual(TOMT);
    document.removeEventListener('obs:prosjekt-endret', lytter);
  });
});

describe('initProjectPicker', () => {
  let els;
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '<input id="i"><button id="c" hidden></button><ul id="l" hidden></ul>';
    els = { input: document.getElementById('i'), list: document.getElementById('l'), clearBtn: document.getElementById('c') };
  });

  it('viser valgt prosjekt og ✕-knappen', () => {
    const p = initProjectPicker(els);
    p.setValue(TOMT);
    expect(els.input.value).toBe(TOMT.name);
    expect(els.clearBtn.hidden).toBe(false);
    expect(p.getValue()).toEqual(TOMT);
  });

  it('✕ fjerner prosjektet og melder fra', () => {
    const onChange = vi.fn();
    const p = initProjectPicker({ ...els, onChange });
    p.setValue(TOMT);
    els.clearBtn.click();
    expect(p.getValue()).toBeNull();
    expect(els.input.value).toBe('');
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('å skrive i feltet opphever valget til et nytt er valgt', () => {
    const onChange = vi.fn();
    const p = initProjectPicker({ ...els, onChange });
    p.setValue(TOMT);
    els.input.value = 'Tomtekryss X';
    els.input.dispatchEvent(new Event('input'));
    expect(p.getValue()).toBeNull();
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('viser treff fra serveren og velger ved trykk', async () => {
    localStorage.setItem('ao_tokens', JSON.stringify({ loginToken: 'L', authCookie: 'A' }));
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ projects: [{ ...TOMT, mine: true }] }) });
    const onChange = vi.fn();
    const p = initProjectPicker({ ...els, onChange });
    els.input.dispatchEvent(new Event('focus'));
    await vi.waitFor(() => expect(els.list.querySelector('.prosjekt-treff')).not.toBeNull());
    const treff = els.list.querySelector('.prosjekt-treff');
    expect(treff.textContent).toBe('👤 ' + TOMT.name);
    treff.click();
    expect(p.getValue()).toEqual(TOMT);
    expect(onChange).toHaveBeenCalledWith(TOMT);
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ loginToken: 'L', authCookie: 'A', search: '' });
  });

  it('uten AO-innlogging forteller den det i stedet for å søke', async () => {
    globalThis.fetch = vi.fn();
    initProjectPicker(els);
    els.input.dispatchEvent(new Event('focus'));
    await vi.waitFor(() => expect(els.list.textContent).toContain('Logg inn'));
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('initProjectPicker ved feilsvar', () => {
  it('503 (offline-modus) gir «fikk ikke kontakt», ikke «ingen prosjekter»', async () => {
    localStorage.clear();
    localStorage.setItem('ao_tokens', JSON.stringify({ loginToken: 'L', authCookie: 'A' }));
    document.body.innerHTML = '<input id="i"><button id="c" hidden></button><ul id="l" hidden></ul>';
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({ error: 'Offline' }) });
    initProjectPicker({ input: document.getElementById('i'), list: document.getElementById('l'), clearBtn: document.getElementById('c') });
    document.getElementById('i').dispatchEvent(new Event('focus'));
    await vi.waitFor(() => expect(document.getElementById('l').textContent).toContain('Fikk ikke kontakt'));
  });
});
