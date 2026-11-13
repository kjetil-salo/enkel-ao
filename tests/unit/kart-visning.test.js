/**
 * Tester for tre-trinns visningssykelen på kartet.
 *
 * Selve koblingen mot Leaflet-lagene krever et ekte kart og testes i felt;
 * her sikres det som kan gå stille galt: at sykelen kommer HELT RUNDT tilbake
 * til 'alt' (ellers kan brukeren bli sittende med et tomt kart han ikke får
 * slått på igjen), at knappeteksten lover det neste trykk faktisk gjør, og at
 * 'ingen' aldri havner i localStorage.
 */

import { describe, it, expect } from 'vitest';
import {
  VISNINGER,
  knappetekst,
  knappetittel,
  lesLagretVisning,
  nesteVisning,
  tilLagretVerdi,
  visLokaliteter,
  visNavn,
} from '../../public/js/kart-visning.js';

describe('nesteVisning', () => {
  it('går Alt → Skjul navn → Skjul alt → Alt', () => {
    expect(nesteVisning('alt')).toBe('kun-pins');
    expect(nesteVisning('kun-pins')).toBe('ingen');
    expect(nesteVisning('ingen')).toBe('alt');
  });

  it('kommer tilbake til utgangspunktet etter én runde', () => {
    let v = 'alt';
    for (let i = 0; i < VISNINGER.length; i++) v = nesteVisning(v);
    expect(v).toBe('alt');
  });

  it('faller tilbake til alt ved ukjent eller manglende verdi', () => {
    expect(nesteVisning('tull')).toBe('alt');
    expect(nesteVisning(undefined)).toBe('alt');
    expect(nesteVisning(null)).toBe('alt');
  });
});

describe('knappetekst', () => {
  it('beskriver hva neste trykk gjør', () => {
    expect(knappetekst('alt')).toContain('Skjul navn');
    expect(knappetekst('kun-pins')).toContain('Skjul alt');
    expect(knappetekst('ingen')).toContain('Vis alt');
  });

  it('har en tekst for hver tilstand', () => {
    const tekster = VISNINGER.map(knappetekst);
    expect(new Set(tekster).size).toBe(VISNINGER.length);
    tekster.forEach((t) => expect(t.length).toBeGreaterThan(0));
  });

  it('bruker nynorsk når lang er nn', () => {
    expect(knappetekst('alt', 'nn')).toContain('Skjul namn');
  });
});

describe('knappetittel', () => {
  it('lover det samme som knappeteksten i hver tilstand', () => {
    expect(knappetittel('alt')).toMatch(/[Ss]kjul navn/);
    expect(knappetittel('kun-pins')).toMatch(/[Ss]kjul alle/);
    // Det var denne som motsa seg selv med en fast tittel: her VISER neste trykk
    expect(knappetittel('ingen')).toMatch(/[Vv]is/);
    expect(knappetittel('ingen')).not.toMatch(/[Ss]kjul/);
  });

  it('har en egen tittel for hver tilstand', () => {
    const titler = VISNINGER.map(knappetittel);
    expect(new Set(titler).size).toBe(VISNINGER.length);
  });

  it('bruker nynorsk når lang er nn', () => {
    expect(knappetittel('alt', 'nn')).toBe('Skjul namna på lokalitetane');
  });
});

describe('visNavn / visLokaliteter', () => {
  it('viser navn kun i alt-tilstanden', () => {
    expect(visNavn('alt')).toBe(true);
    expect(visNavn('kun-pins')).toBe(false);
    expect(visNavn('ingen')).toBe(false);
  });

  it('tegner lokaliteter i alle tilstander unntatt ingen', () => {
    expect(visLokaliteter('alt')).toBe(true);
    expect(visLokaliteter('kun-pins')).toBe(true);
    expect(visLokaliteter('ingen')).toBe(false);
  });

  it('navn kan aldri være synlige uten at lokalitetene er tegnet', () => {
    VISNINGER.forEach((v) => {
      if (visNavn(v)) expect(visLokaliteter(v)).toBe(true);
    });
  });
});

describe('lagring', () => {
  it('leser den gamle to-tilstands-nøkkelen bakoverkompatibelt', () => {
    expect(lesLagretVisning('0')).toBe('kun-pins');
    expect(lesLagretVisning('1')).toBe('alt');
    expect(lesLagretVisning(null)).toBe('alt');
  });

  it('lagrer aldri ingen — kartet skal ikke åpne tomt neste gang', () => {
    expect(tilLagretVerdi('ingen')).toBeNull();
    expect(tilLagretVerdi('alt')).toBe('1');
    expect(tilLagretVerdi('kun-pins')).toBe('0');
  });

  it('er rundturssikker for de to lagrede tilstandene', () => {
    ['alt', 'kun-pins'].forEach((v) => {
      expect(lesLagretVisning(tilLagretVerdi(v))).toBe(v);
    });
  });
});
