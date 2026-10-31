/**
 * Tester for regnestykkene i bilderedigeringen.
 *
 * Selve tegningen og dra-oppførselen krever et ekte lerret og testes manuelt;
 * her sikres det som kan gå stille galt: at et utsnitt aldri havner utenfor
 * bildet, at eksponeringen er fotografisk og ikke lineær, og at ingen
 * pikselverdi renner over.
 */

import { describe, it, expect } from 'vitest';
import {
  anvendEksponering,
  anvendJusteringer,
  eksponeringsfaktor,
  klemUtsnitt,
  skyggemaske,
  skyggestyrke,
  visningsmaal,
} from '../../public/js/bilde-editor.js';

describe('eksponeringsfaktor', () => {
  it('lar bildet være i ro på null', () => {
    expect(eksponeringsfaktor(0)).toBe(1);
  });

  it('er fotografisk: 100 trinn er ett blenderstrinn opp', () => {
    expect(eksponeringsfaktor(100)).toBe(2);
    expect(eksponeringsfaktor(-100)).toBe(0.5);
  });

  it('er symmetrisk rundt null', () => {
    expect(eksponeringsfaktor(50) * eksponeringsfaktor(-50)).toBeCloseTo(1, 10);
  });

  it('klemmer verdier utenfor skalaen i stedet for å brenne ut', () => {
    expect(eksponeringsfaktor(9999)).toBe(2);
    expect(eksponeringsfaktor(-9999)).toBe(0.5);
  });

  it('tåler søppel', () => {
    expect(eksponeringsfaktor(undefined)).toBe(1);
    expect(eksponeringsfaktor('abc')).toBe(1);
    expect(eksponeringsfaktor(null)).toBe(1);
  });
});

describe('klemUtsnitt', () => {
  it('holder utsnittet innenfor bildet', () => {
    const u = klemUtsnitt({ x: -50, y: -50, b: 5000, h: 5000 }, 1000, 800);
    expect(u).toEqual({ x: 0, y: 0, b: 1000, h: 800 });
  });

  it('skyver et utsnitt som stikker utenfor høyre/bunn tilbake inn', () => {
    const u = klemUtsnitt({ x: 900, y: 700, b: 300, h: 300 }, 1000, 800);
    expect(u.x + u.b).toBeLessThanOrEqual(1000);
    expect(u.y + u.h).toBeLessThanOrEqual(800);
  });

  it('hindrer at utsnittet blir uendelig lite', () => {
    const u = klemUtsnitt({ x: 10, y: 10, b: 0, h: -5 }, 1000, 800);
    expect(u.b).toBeGreaterThan(0);
    expect(u.h).toBeGreaterThan(0);
  });

  it('lar et helt bilde være et gyldig utsnitt', () => {
    expect(klemUtsnitt({ x: 0, y: 0, b: 1000, h: 800 }, 1000, 800))
      .toEqual({ x: 0, y: 0, b: 1000, h: 800 });
  });
});

describe('visningsmaal', () => {
  it('skalerer ned store bilder til maksbredden', () => {
    const v = visningsmaal(4000, 3000, 560);
    expect(Math.max(v.bredde, v.hoyde)).toBe(560);
    expect(v.bredde / v.hoyde).toBeCloseTo(4000 / 3000, 2);
  });

  it('forstørrer aldri små bilder', () => {
    const v = visningsmaal(200, 150, 560);
    expect(v).toEqual({ bredde: 200, hoyde: 150, skala: 1 });
  });

  it('gir aldri null i bredde eller høyde', () => {
    const v = visningsmaal(10000, 1, 560);
    expect(v.bredde).toBeGreaterThan(0);
    expect(v.hoyde).toBeGreaterThan(0);
  });
});

describe('anvendEksponering', () => {
  it('lar pikslene være i fred på null', () => {
    const d = Uint8ClampedArray.from([10, 20, 30, 255]);
    anvendEksponering(d, 0);
    expect([...d]).toEqual([10, 20, 30, 255]);
  });

  it('løfter alle fargekanaler, men ikke alfa', () => {
    const d = Uint8ClampedArray.from([10, 20, 30, 128]);
    anvendEksponering(d, 100);
    expect([...d.slice(0, 3)]).toEqual([20, 40, 60]);
    expect(d[3]).toBe(128);
  });

  it('brenner ikke ut over 255', () => {
    const d = Uint8ClampedArray.from([200, 250, 255, 255]);
    anvendEksponering(d, 100);
    expect([...d.slice(0, 3)]).toEqual([255, 255, 255]);
  });

  it('mørkner ved negativ eksponering', () => {
    const d = Uint8ClampedArray.from([100, 100, 100, 255]);
    anvendEksponering(d, -100);
    expect([...d.slice(0, 3)]).toEqual([50, 50, 50]);
  });

  it('behandler flere piksler', () => {
    const d = Uint8ClampedArray.from([10, 10, 10, 255, 20, 20, 20, 255]);
    anvendEksponering(d, 100);
    expect([...d]).toEqual([20, 20, 20, 255, 40, 40, 40, 255]);
  });
});

describe('skyggestyrke', () => {
  it('gjør ingenting på null', () => {
    expect(skyggestyrke(0)).toBe(0);
  });

  it('vokser med trinnet', () => {
    expect(skyggestyrke(100)).toBeGreaterThan(skyggestyrke(50));
    expect(skyggestyrke(50)).toBeGreaterThan(0);
  });

  it('kan ikke dra bildet nedover — det er eksponeringens jobb', () => {
    expect(skyggestyrke(-50)).toBe(0);
  });

  it('klemmer og tåler søppel', () => {
    expect(skyggestyrke(9999)).toBe(skyggestyrke(100));
    expect(skyggestyrke('abc')).toBe(0);
    expect(skyggestyrke(undefined)).toBe(0);
  });
});

describe('skyggemaske', () => {
  it('treffer de mørkeste partiene fullt ut', () => {
    expect(skyggemaske(0)).toBe(1);
  });

  it('slipper høylysene nesten helt i fred', () => {
    // Hele poenget: himmelen bak fuglen skal ikke brenne ut av at fuglen lysnes.
    expect(skyggemaske(0.8)).toBeLessThan(0.01);
    expect(skyggemaske(1)).toBe(0);
  });

  it('avtar monotont oppover tonene', () => {
    const verdier = [0, 0.2, 0.4, 0.6, 0.8, 1].map(skyggemaske);
    for (let i = 1; i < verdier.length; i++) {
      expect(verdier[i]).toBeLessThan(verdier[i - 1]);
    }
  });

  it('tåler verdier utenfor 0..1', () => {
    expect(skyggemaske(-5)).toBe(1);
    expect(skyggemaske(5)).toBe(0);
    expect(skyggemaske('abc')).toBe(1);
  });
});

describe('anvendJusteringer – skyggeløft', () => {
  it('lar pikslene være i fred når begge sliderne står på null', () => {
    const d = Uint8ClampedArray.from([10, 20, 30, 255]);
    anvendJusteringer(d, { eksponering: 0, skygger: 0 });
    expect([...d]).toEqual([10, 20, 30, 255]);
  });

  it('løfter en mørk piksel merkbart', () => {
    const d = Uint8ClampedArray.from([30, 30, 30, 255]);
    anvendJusteringer(d, { skygger: 100 });
    expect(d[0]).toBeGreaterThan(50);
  });

  it('rører så godt som ikke en lys piksel', () => {
    const d = Uint8ClampedArray.from([230, 230, 230, 255]);
    anvendJusteringer(d, { skygger: 100 });
    expect(d[0]).toBeLessThanOrEqual(232);
  });

  it('løfter de mørke mer enn de lyse i samme bilde', () => {
    const d = Uint8ClampedArray.from([40, 40, 40, 255, 200, 200, 200, 255]);
    anvendJusteringer(d, { skygger: 100 });
    expect(d[0] / 40).toBeGreaterThan(d[4] / 200);
  });

  it('holder fargebalansen — ingen fargestikk i skyggene', () => {
    const d = Uint8ClampedArray.from([20, 40, 60, 255]);
    anvendJusteringer(d, { skygger: 80 });
    // Samme faktor på alle tre kanaler betyr at forholdet står urørt.
    expect(d[1] / d[0]).toBeCloseTo(2, 1);
    expect(d[2] / d[0]).toBeCloseTo(3, 1);
  });

  it('beholder svartpunktet i stedet for å gråvaske bildet', () => {
    const d = Uint8ClampedArray.from([0, 0, 0, 255]);
    anvendJusteringer(d, { skygger: 100 });
    expect([...d.slice(0, 3)]).toEqual([0, 0, 0]);
  });

  it('brenner ikke ut over 255, uansett kombinasjon', () => {
    const d = Uint8ClampedArray.from([250, 250, 250, 255]);
    anvendJusteringer(d, { eksponering: 100, skygger: 100 });
    expect([...d.slice(0, 3)]).toEqual([255, 255, 255]);
  });

  it('rører ikke alfa', () => {
    const d = Uint8ClampedArray.from([30, 30, 30, 128]);
    anvendJusteringer(d, { eksponering: 50, skygger: 100 });
    expect(d[3]).toBe(128);
  });

  it('anvender eksponering FØR skyggeløftet', () => {
    // Rekkefølgen er synlig: etter -100 er pikselen mørkere, og masken gir den
    // da et STØRRE løft enn den ville fått uten eksponeringen først.
    const mork = Uint8ClampedArray.from([80, 80, 80, 255]);
    anvendJusteringer(mork, { eksponering: -100, skygger: 100 });
    const baresky = Uint8ClampedArray.from([40, 40, 40, 255]);
    anvendJusteringer(baresky, { skygger: 100 });
    expect(mork[0]).toBe(baresky[0]);
  });

  it('er bakoverkompatibel: anvendEksponering gjør bare eksponering', () => {
    const a = Uint8ClampedArray.from([30, 30, 30, 255]);
    const b = Uint8ClampedArray.from([30, 30, 30, 255]);
    anvendEksponering(a, 50);
    anvendJusteringer(b, { eksponering: 50, skygger: 0 });
    expect([...a]).toEqual([...b]);
  });

  it('tåler et tomt opsjonsobjekt', () => {
    const d = Uint8ClampedArray.from([10, 20, 30, 255]);
    anvendJusteringer(d);
    expect([...d]).toEqual([10, 20, 30, 255]);
  });
});
