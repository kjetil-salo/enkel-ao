/**
 * Tilstandsmaskin for hvor mye av AO-lokalitetene kartet viser.
 *
 * Bakgrunn (tilbakemelding fra felt, 03.11.2026): på steder med svært mange
 * lokaliteter tett i tett (Lista) dekker markørpinnene kartet helt, og den
 * gamle to-tilstands «vis/skjul navn» hjalp ikke — den lukket bare tooltipene,
 * pinnene og polygonene ble stående. Uten å få se kartet under klarte ikke
 * brukeren å zoome inn og finne lokaliteten han skulle etterregistrere på.
 *
 * Derfor tre trinn på SAMME knapp, i stedet for en ny knapp ved siden av:
 * første trykk gjør nøyaktig det samme som før (skjuler navnene), så ingen
 * trenger å lære om, og andre trykk gir et helt rent kart å zoome i.
 *
 * Rene funksjoner uten DOM eller Leaflet, så de kan enhetstestes — selve
 * koblingen mot kartlagene ligger i map.js.
 */
import { tFor, DEFAULT_LANGUAGE } from './i18n.js?v=v1.60.20';

/** @typedef {'alt'|'kun-pins'|'ingen'} Visning */

export const VISNINGER = ['alt', 'kun-pins', 'ingen'];

/**
 * Neste trinn i sykelen Alt → Skjul navn → Skjul alt → Alt.
 * Ukjent verdi faller tilbake til 'alt' — en ødelagt localStorage-verdi skal
 * aldri kunne låse brukeren i en tilstand der kartet er tomt.
 * @param {Visning} visning
 * @returns {Visning}
 */
export function nesteVisning(visning) {
  const i = VISNINGER.indexOf(visning);
  if (i === -1) return 'alt';
  return VISNINGER[(i + 1) % VISNINGER.length];
}

/**
 * Knappeteksten beskriver hva NESTE trykk gjør, ikke tilstanden man står i.
 * @param {Visning} visning
 * @param {'nb'|'nn'} [lang] - map.js henter og gir gjeldende språk; uten det
 *   (bl.a. eksisterende tester) brukes bokmål - en ren funksjon skal ikke
 *   lese localStorage/globals selv for å avgjøre språk.
 * @returns {string}
 */
export function knappetekst(visning, lang = DEFAULT_LANGUAGE) {
  if (visning === 'alt') return tFor(lang, 'kart.visning.knapp.skjul_navn');
  if (visning === 'kun-pins') return tFor(lang, 'kart.visning.knapp.skjul_alt');
  return tFor(lang, 'kart.visning.knapp.vis_alt');
}

/**
 * Hjelpetekst (`title`) for knappen. Må følge teksten: i 'ingen' VISER neste
 * trykk alt, og en fast tittel ville lovet det motsatte ved hover på PC.
 * @param {Visning} visning
 * @param {'nb'|'nn'} [lang]
 * @returns {string}
 */
export function knappetittel(visning, lang = DEFAULT_LANGUAGE) {
  if (visning === 'alt') {
    return tFor(lang, 'kart.visning.tittel.skjul_navn');
  }
  if (visning === 'kun-pins') {
    return tFor(lang, 'kart.visning.tittel.skjul_alt');
  }
  return tFor(lang, 'kart.visning.tittel.vis_alt');
}

/** Skal de permanente navne-tooltipene være åpne? */
export function visNavn(visning) {
  return visning === 'alt';
}

/** Skal markører, polygoner og radiussirkler være tegnet i det hele tatt? */
export function visLokaliteter(visning) {
  return visning !== 'ingen';
}

/**
 * Les lagret preferanse. Bakoverkompatibel med den gamle to-tilstands-nøkkelen
 * (`'0'` = navn av), så ingen mister valget sitt ved oppgradering.
 * @param {string|null} lagret
 * @returns {Visning}
 */
export function lesLagretVisning(lagret) {
  return lagret === '0' ? 'kun-pins' : 'alt';
}

/**
 * Hva som skal lagres for en gitt visning, eller `null` for «ikke lagre».
 *
 * 'ingen' lagres bevisst ALDRI: den er et zoom-hjelpemiddel, ikke en
 * innstilling. Åpnet man kartet til et helt tomt kart neste gang, ville det
 * lest som at appen var i stuss — ikke som et valg man selv hadde tatt. Da
 * beholdes i stedet det forrige, lagrede trinnet.
 * @param {Visning} visning
 * @returns {string|null}
 */
export function tilLagretVerdi(visning) {
  if (visning === 'alt') return '1';
  if (visning === 'kun-pins') return '0';
  return null;
}
