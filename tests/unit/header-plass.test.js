import { describe, it, expect, vi } from 'vitest';
import { finnTrinn, passer, tilpassHeader, TRINN } from '../../public/js/header-plass.js';

describe('finnTrinn', () => {
  it('velger det minst inngripende trinnet som passer', () => {
    // Passer alt med en gang: appnavn og nettverksord skal beholdes.
    expect(finnTrinn(() => true)).toBe(0);
  });

  it('trapper ned ett steg av gangen', () => {
    // Først når vi er nede i «EAO» er det plass.
    expect(finnTrinn((t) => t >= 1)).toBe(1);
    expect(finnTrinn((t) => t >= 2)).toBe(2);
  });

  it('gir mest komprimerte trinn når ingenting passer', () => {
    // En skjerm så smal at selv siste trinn renner over: vi har ikke noe
    // bedre å tilby enn det mest komprimerte.
    expect(finnTrinn(() => false)).toBe(TRINN[TRINN.length - 1]);
  });

  it('ofrer appnavnet før nettverksordet', () => {
    // Kjernen i prioriteringen: trinn 1 og 2 rører bare appnavnet, og det er
    // først i trinn 3 at Online/Hybrid/Offline mister ordet sitt.
    const prøvde = [];
    finnTrinn((t) => { prøvde.push(t); return t === 3; });
    expect(prøvde).toEqual([0, 1, 2, 3]);
  });
});

describe('passer', () => {
  it('godtar en piksels avrunding', () => {
    // Delpiksler ved zoom/DPR skal ikke utløse unødig komprimering.
    expect(passer({ scrollWidth: 321, clientWidth: 320 })).toBe(true);
    expect(passer({ scrollWidth: 322, clientWidth: 320 })).toBe(false);
  });

  it('er sann når innholdet er smalere enn boksen', () => {
    expect(passer({ scrollWidth: 200, clientWidth: 320 })).toBe(true);
  });
});

describe('tilpassHeader', () => {
  it('skriver det valgte trinnet til data-komprimering', () => {
    const header = { dataset: {} };
    const trinn = tilpassHeader(header, () => header.dataset.komprimering === '2');
    expect(trinn).toBe(2);
    expect(header.dataset.komprimering).toBe('2');
  });

  it('lar headeren stå på trinn 0 når alt får plass', () => {
    const header = { dataset: {} };
    expect(tilpassHeader(header, () => true)).toBe(0);
    expect(header.dataset.komprimering).toBe('0');
  });

  it('tåler at headeren ikke finnes', () => {
    // Siden deles av flere maler; en manglende header skal ikke felle skriptet.
    expect(tilpassHeader(null)).toBeNull();
  });

  it('etterlater aldri headeren på et trinn den ikke endte på', () => {
    // Målingen setter trinn underveis for å prøve dem. Den siste skrivingen
    // må være det valgte trinnet, ikke det siste som ble prøvd.
    const header = { dataset: {} };
    tilpassHeader(header, () => header.dataset.komprimering === '1');
    expect(header.dataset.komprimering).toBe('1');
  });
});
