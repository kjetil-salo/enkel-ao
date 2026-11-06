/**
 * Trinnvis komprimering av toppraden når den ikke får plass.
 *
 * CSS kan ikke svare på «får dette plass?». Container queries måler
 * containerens bredde, ikke hva innholdet trenger, så et rent CSS-breakpoint
 * må gjette på en bredde og gjetter nødvendigvis feil for noen: på en 430 px
 * skjerm med god plass ble både appnavnet og nettverksordet skjult helt
 * unødvendig (feltmelding 05.11.2026). Derfor måler vi faktisk overflyt og
 * trapper ned først så mye som trengs.
 *
 * Rekkefølgen er en prioritering, ikke en tilfeldighet: nettverksmodusen
 * (Online/Hybrid/Offline) er driftsinformasjon man må kunne lese i felt, mens
 * appnavnet bare er identitet — og logoen bærer den alene. Derfor ofres
 * appnavnet i to steg FØR nettverksordet røres.
 */

/** Trinnene, fra mest generøse til mest komprimerte. */
export const TRINN = [
  0, // Alt: logo + «Enkel-AO» + modus + nettverksord + konto + meny
  1, // «EAO» i stedet for «Enkel-AO»
  2, // Uten appnavn (logoen står)
  3, // I tillegg uten nettverksord — bare symbolet
];

/**
 * Finner det laveste trinnet som får innholdet til å passe.
 *
 * Ren funksjon: `prøv(trinn)` skal anvende trinnet og svare om det passer.
 * Returnerer siste trinn hvis ingen passer — da er skjermen rett og slett for
 * smal, og mest komprimert er det beste vi har.
 */
export function finnTrinn(prøv, trinn = TRINN) {
  for (const t of trinn) {
    if (prøv(t)) return t;
  }
  return trinn[trinn.length - 1];
}

/**
 * Passer innholdet i elementet?
 *
 * `scrollWidth > clientWidth` er det ærlige målet, men bare når barna ikke får
 * lov å krympe seg til å «passe». Toleransen på 1 px dekker at nettlesere
 * runder av delpiksler ulikt ved zoom og på skjermer med brøkdels-DPR.
 */
export function passer(el) {
  return el.scrollWidth <= el.clientWidth + 1;
}

/**
 * Måler headeren og setter `data-komprimering` til det laveste trinnet som
 * holder raden innenfor viewporten.
 *
 * Trinnet leses av CSS. Vi skriver aldri tekst i DOM-en her: appnavnet og
 * nettverksordet eies av annen kode (og av skjermleseren), og en JS som
 * overskrev teksten ville kollidert med dem ved neste modusbytte.
 */
export function tilpassHeader(header, erPasser = passer) {
  if (!header) return null;
  const trinn = finnTrinn((t) => {
    header.dataset.komprimering = String(t);
    return erPasser(header);
  });
  header.dataset.komprimering = String(trinn);
  return trinn;
}
