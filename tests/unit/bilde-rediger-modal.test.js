/**
 * Tester for «Beskjær og juster»-laget.
 *
 * Selve lerretet krever en ekte canvas og testes manuelt i nettleser — her
 * sikres vaktklausulene rundt det: at modulen ikke bygger DOM før den faktisk
 * trengs, og at et kall uten bilde svarer i stedet for å åpne et tomt lag.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { apneBildeRedigering } from '../../public/js/bilde-rediger-modal.js';

describe('apneBildeRedigering', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('svarer null uten å åpne noe når det ikke finnes et bilde', async () => {
    expect(await apneBildeRedigering(null)).toBeNull();
    expect(await apneBildeRedigering('')).toBeNull();
    expect(await apneBildeRedigering(undefined)).toBeNull();
  });

  it('bygger ikke DOM før den trengs', async () => {
    await apneBildeRedigering(null);
    expect(document.getElementById('bilde-rediger-lag')).toBeNull();
  });
});
