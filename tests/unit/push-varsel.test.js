import { it, expect, vi, describe } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { base64UrlTilBytes, pushStotte, lesValgteEmner, VARSELTYPER } from '../../public/js/push-varsel.js';

const source = readFileSync(resolve(__dirname, '../../public/sw.js'), 'utf8');

function worker({ vinduer = [] } = {}) {
  const handlers = {};
  const showNotification = vi.fn(async () => {});
  const openWindow = vi.fn(async () => {});
  const context = vm.createContext({
    self: {
      addEventListener: (name, fn) => { handlers[name] = fn; },
      location: { origin: 'https://example.test' },
      registration: { showNotification },
      clients: { matchAll: vi.fn(async () => vinduer), openWindow, claim: vi.fn() },
    },
    caches: {}, Response, URL, fetch: vi.fn(),
  });
  vm.runInContext(source, context);
  return { handlers, showNotification, openWindow };
}

async function kjor(handler, event) {
  let p;
  handler({ ...event, waitUntil: (promise) => { p = promise; } });
  await p;
}

describe('service worker: push', () => {
  it('viser varselet med tittel, tekst og url fra meldingen', async () => {
    const { handlers, showNotification } = worker();
    const data = { title: 'Nytt', body: 'Kartet er raskt', url: '/changelog.html', tag: 'nyheter' };
    await kjor(handlers.push, { data: { json: () => data } });
    expect(showNotification).toHaveBeenCalledWith('Nytt', expect.objectContaining({
      body: 'Kartet er raskt', tag: 'nyheter', data: { url: '/changelog.html' },
    }));
  });

  it('viser likevel et varsel når innholdet ikke er JSON', async () => {
    // Et push uten synlig varsel straffes av nettleseren (iOS trekker abonnementet)
    const { handlers, showNotification } = worker();
    await kjor(handlers.push, { data: { json: () => { throw new Error('x'); }, text: () => 'ren tekst' } });
    expect(showNotification).toHaveBeenCalledWith('Enkel-AO', expect.objectContaining({ body: 'ren tekst' }));
  });
});

describe('service worker: trykk på varsel', () => {
  const varsel = (url) => ({ close: vi.fn(), data: { url } });

  it('åpner nytt vindu når appen ikke er åpen', async () => {
    const { handlers, openWindow } = worker();
    await kjor(handlers.notificationclick, { notification: varsel('/changelog.html') });
    expect(openWindow).toHaveBeenCalledWith('https://example.test/changelog.html');
  });

  it('fokuserer og navigerer et åpent vindu i stedet for å åpne et nytt', async () => {
    const vindu = { url: 'https://example.test/', focus: vi.fn(async () => {}), navigate: vi.fn(async () => {}) };
    const { handlers, openWindow } = worker({ vinduer: [vindu] });
    await kjor(handlers.notificationclick, { notification: varsel('/changelog.html') });
    expect(vindu.focus).toHaveBeenCalled();
    expect(vindu.navigate).toHaveBeenCalledWith('https://example.test/changelog.html');
    expect(openWindow).not.toHaveBeenCalled();
  });

  it('åpner aldri en fremmed adresse', async () => {
    const { handlers, openWindow } = worker();
    await kjor(handlers.notificationclick, { notification: varsel('https://evil.example/') });
    expect(openWindow).toHaveBeenCalledWith('https://example.test/');
  });
});

describe('push-varsel.js', () => {
  it('base64UrlTilBytes dekoder base64url uten padding', () => {
    expect([...base64UrlTilBytes('AQID_-8')]).toEqual([1, 2, 3, 255, 239]);
  });

  it('lesValgteEmner gir bare kjente varseltyper', () => {
    localStorage.setItem('pushEmner_v1', JSON.stringify(['nyheter', 'finnes-ikke']));
    expect(lesValgteEmner()).toEqual(['nyheter']);
    localStorage.setItem('pushEmner_v1', 'ødelagt');
    expect(lesValgteEmner()).toEqual([]);
    localStorage.removeItem('pushEmner_v1');
  });

  it('har nyheter som varseltype', () => {
    expect(VARSELTYPER.map((v) => v.id)).toContain('nyheter');
  });

  it('pushStotte sier nei, med grunn, når API-ene mangler', () => {
    const s = pushStotte();
    expect(s.stottet).toBe(false);
    expect(s.grunn).toBeTruthy();
  });
});
