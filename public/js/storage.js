/**
 * Storage-modul for localStorage-håndtering
 */
import { hentAktivFellestur } from './fellestur-client.js';
import { lastSpeil, lagreSpeilOgSynk, hentTurMedobservatorer } from './fellestur-sync.js';
import { translateDedicatedSubspeciesToNynorsk } from './species-matcher.js?v=v1.60.30';
import { aktivInnhentetListe, lagreEndringerIInnhentetListe, lesInnhentetListe } from './arbeidsliste-lokal.js';
import { getLanguage, setLanguage, isNynorsk, getDictionary } from './i18n.js?v=v1.60.30';

export { isNynorsk };

const STORAGE_KEY = 'fugleobservasjoner_v1';
const MEDOBS_KEY = 'medobs_list_v1';
const AO_SIZE_KEY = 'ao_search_radius_v1';
const ACTIVITY_PILLS_KEY = 'activityPills_v1';
const SENT_KEY = 'sent_observations_v1';
const LOCATION_SORT_KEY = 'location_sort_mode_v1';
const AO_DIRECT_AUTO_CLEAR_KEY = 'ao_direct_auto_clear_v1';
export const LAST_KNOWN_POSITION_KEY = 'ao_last_known_position_v1';

/**
 * Teknisk beskrivelse av siste feilede saveObservations()-kall (f.eks.
 * "QuotaExceededError: ..."). Rent diagnostisk — vises i feilmeldingen i
 * edit.html slik at en feilmelding ikke feilaktig peker på full lagrings-
 * plass når den egentlige årsaken er noe annet (f.eks. et felt som ikke lar
 * seg JSON-serialisere).
 */
export let lastSaveError = null;

// Sendt-loggen husker hva som faktisk ble sendt, slik at arbeidslista trygt kan
// tømmes etterpå. Holdes bevisst kort — den er en kvittering, ikke et arkiv.
export const SENT_MAX_DAYS = 7;
export const SENT_MAX_OBS = 200;

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Last medobservatører fra localStorage.
 * Aktive medobservatører nullstilles automatisk neste dag.
 * @returns {Array} - Liste med medobservatører
 */
export function loadMedobs() {
  try {
    const raw = JSON.parse(window.localStorage.getItem(MEDOBS_KEY) || 'null');
    if (!raw) return [];

    // Gammelt format: array av strings
    if (Array.isArray(raw) && raw.length && typeof raw[0] === 'string') {
      return raw.slice(0, 10).map((n) => ({ name: n, active: false }));
    }

    // Nytt format: { date: 'YYYY-MM-DD', list: [...] }
    if (raw && typeof raw === 'object' && !Array.isArray(raw) && raw.list) {
      const list = Array.isArray(raw.list) ? raw.list : [];
      if (raw.date !== todayStr()) {
        // Ny dag — deaktiver alle
        return list.map((it) => ({ ...it, active: false }));
      }
      return list;
    }

    // Gammelt format: direkte array av objekter
    if (Array.isArray(raw)) {
      return raw.map((it) => ({ ...it, active: false }));
    }

    return [];
  } catch (e) {
    console.warn('Kunne ikke laste medobservatører', e);
    return [];
  }
}

/**
 * Lagre medobservatører til localStorage med dagens dato.
 * @param {Array} list - Liste med medobservatører
 */
export function saveMedobs(list) {
  try {
    window.localStorage.setItem(MEDOBS_KEY, JSON.stringify({ date: todayStr(), list }));
  } catch (e) {
    console.warn('Kunne ikke lagre medobservatører', e);
  }
}

/**
 * Hent standard medobservatører for nye observasjoner
 * @returns {Array<string>} - Array med 10 medobservatør-navn (tomme strenger hvis ingen)
 */
export function defaultCoObservers() {
  const l = loadMedobs();
  // Alias (unikt hos AO) sendes med når det finnes, ellers bare navnet — se
  // ao-observer-autocomplete.js for hvor aliaset kommer fra.
  const active = (l || [])
    .filter((it) => it && it.name && it.active)
    .map((it) => (it.alias ? { name: it.name, alias: it.alias } : it.name));

  // Aktiv fellestur: gruppa krediteres automatisk på hver nye observasjon,
  // uten at man må huke dem av som medobs hver gang. Lokale aktive medobs
  // (huket av manuelt) går foran, innenfor samme 10-plasser-tak.
  if (hentAktivFellestur()) {
    const turMedobs = hentTurMedobservatorer();
    const activeNames = active.map((it) => (it && typeof it === 'object' ? it.name : it));
    (turMedobs || []).forEach((navn) => {
      if (navn && !activeNames.includes(navn)) { active.push(navn); activeNames.push(navn); }
    });
  }

  const res = Array(10).fill('');
  for (let i = 0; i < Math.min(10, active.length); i++) {
    res[i] = active[i];
  }
  return res;
}

/**
 * Lagre observasjoner til localStorage
 * @param {Array} observations - Liste med observasjoner
 * @returns {boolean} true hvis lagringen faktisk lyktes. En full localStorage
 *   (f.eks. store bilder på iOS Safari, som har lavere kvote) kaster ved
 *   setItem — det skjedde tidligere helt stille, og et nettopp lagt til
 *   bilde kunne forsvinne uten at brukeren fikk vite det.
 */
export function saveObservations(observations) {
  const innhentet = aktivInnhentetListe();
  if (!innhentet && hentAktivFellestur()) return lagreSpeilOgSynk(observations);

  if (!window.localStorage) return false;

  try {
    if (innhentet) {
      lagreEndringerIInnhentetListe(observations);
    } else {
      const payload = { version: 1, observations };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    }
    lastSaveError = null;
    return true;
  } catch (e) {
    lastSaveError = `${e.name || 'Feil'}: ${e.message || e}`;
    console.warn('Kunne ikke lagre til localStorage', e);
    return false;
  }
}

export function lesPrivatArbeidsliste() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw === null) return [];
  try {
    const payload = JSON.parse(raw);
    if (Array.isArray(payload?.observations)) return payload.observations;
  } catch {
    // Behold uleselig innhold i lagringen.
  }
  throw new Error('Den lokale lista kan ikke leses. Lokale data er beholdt.');
}

export function lesArbeidslisteForOverforing() {
  if (aktivInnhentetListe()) {
    const liste = lesInnhentetListe();
    if (!liste) throw new Error('Finner ikke den lokalt lagrede kopien.');
    return liste.observations;
  }
  return lesPrivatArbeidsliste();
}

/**
 * Last observasjoner fra localStorage
 * @returns {Array} - Liste med observasjoner
 */
export function loadObservations() {
  if (!aktivInnhentetListe() && hentAktivFellestur()) return lastSpeil();

  if (!window.localStorage) return [];

  try {
    return lesArbeidslisteForOverforing();
  } catch (e) {
    console.warn('Kunne ikke lese fra localStorage', e);
    return [];
  }
}

/**
 * Fjern for gamle og for mange poster fra sendt-loggen.
 * Nyeste sending først i lista.
 * @param {Array} batches - Sendinger, nyeste først
 * @returns {Array} - Beskåret liste
 */
function pruneSentBatches(batches) {
  const grense = Date.now() - SENT_MAX_DAYS * 86400000;
  const ferske = batches.filter((b) => {
    const t = Date.parse(b && b.ts);
    return !isNaN(t) && t >= grense;
  });

  // Behold nyeste sendinger til vi når obs-taket
  const beholdt = [];
  let antall = 0;
  for (const b of ferske) {
    const n = Array.isArray(b.obs) ? b.obs.length : 0;
    if (beholdt.length && antall + n > SENT_MAX_OBS) break;
    beholdt.push(b);
    antall += n;
  }
  return beholdt;
}

/**
 * Legg en fullført sending til i sendt-loggen.
 * Kalles ved vellykket publisering — før arbeidslista eventuelt tømmes.
 * @param {Array} observations - Observasjonene som ble sendt
 */
export function appendSentBatch(observations) {
  if (!window.localStorage || !Array.isArray(observations) || !observations.length) return;

  try {
    const batches = loadSentBatches();
    batches.unshift({
      ts: new Date().toISOString(),
      obs: JSON.parse(JSON.stringify(observations)),
    });
    window.localStorage.setItem(SENT_KEY, JSON.stringify({
      version: 1,
      batches: pruneSentBatches(batches),
    }));
  } catch (e) {
    // Full localStorage skal aldri velte appen — sendingen er allerede fullført
    console.warn('Kunne ikke lagre sendt-logg', e);
  }
}

/**
 * Hent sendt-loggen, nyeste sending først. Gamle poster filtreres bort.
 * @returns {Array<{ts: string, obs: Array}>}
 */
export function loadSentBatches() {
  if (!window.localStorage) return [];

  try {
    const raw = window.localStorage.getItem(SENT_KEY);
    if (!raw) return [];

    const payload = JSON.parse(raw);
    if (!payload || !Array.isArray(payload.batches)) return [];

    return pruneSentBatches(payload.batches.filter((b) => b && Array.isArray(b.obs)));
  } catch (e) {
    console.warn('Kunne ikke lese sendt-logg', e);
    return [];
  }
}

/**
 * Lagre søkeradius til localStorage
 * @param {number} radius - Radius i meter
 */
export function saveAoSearchRadius(radius) {
  if (!window.localStorage) return;

  try {
    window.localStorage.setItem(AO_SIZE_KEY, String(radius));
  } catch (e) {
    console.warn('Kunne ikke lagre søkeradius', e);
  }
}

/**
 * Last søkeradius fra localStorage
 * @returns {number} - Radius i meter (default 1000)
 */
export function loadAoSearchRadius() {
  if (!window.localStorage) return 1000;

  try {
    const raw = window.localStorage.getItem(AO_SIZE_KEY);
    if (!raw) return 1000;

    const radius = parseFloat(raw);
    if (isNaN(radius) || radius < 500 || radius > 3000) return 1000;

    return radius;
  } catch (e) {
    console.warn('Kunne ikke lese søkeradius', e);
    return 1000;
  }
}

/**
 * Lagre valgt sorteringsmodus for lokasjonsforslag
 * @param {string} mode - 'standard' eller 'avstand'
 */
export function saveLocationSortMode(mode) {
  if (!window.localStorage) return;

  try {
    window.localStorage.setItem(LOCATION_SORT_KEY, mode);
  } catch (e) {
    console.warn('Kunne ikke lagre sorteringsmodus', e);
  }
}

/**
 * Last valgt sorteringsmodus for lokasjonsforslag
 * @returns {string} - 'standard' eller 'avstand' (default 'standard')
 */
export function loadLocationSortMode() {
  if (!window.localStorage) return 'standard';

  try {
    const raw = window.localStorage.getItem(LOCATION_SORT_KEY);
    return raw === 'avstand' ? 'avstand' : 'standard';
  } catch (e) {
    return 'standard';
  }
}

/**
 * Lagre om lista skal tømmes automatisk (uten spørsmål) ved vellykket
 * direktepublisering til AO.
 * @param {boolean} value
 */
export function saveAoDirectAutoClear(value) {
  if (!window.localStorage) return;

  try {
    window.localStorage.setItem(AO_DIRECT_AUTO_CLEAR_KEY, value ? '1' : '0');
  } catch (e) {
    console.warn('Kunne ikke lagre auto-tøm-valg', e);
  }
}

/**
 * Last om lista skal tømmes automatisk ved vellykket direktepublisering.
 * Default av — brukeren må aktivt slå det på.
 * @returns {boolean}
 */
export function loadAoDirectAutoClear() {
  if (!window.localStorage) return false;

  try {
    return window.localStorage.getItem(AO_DIRECT_AUTO_CLEAR_KEY) === '1';
  } catch (e) {
    return false;
  }
}

/**
 * Lagre om «ca»-avkrysningsboksen (legger «Estimert antal» i kommentarfeltet)
 * skal vises i hovedskjemaet. Av som standard, bak samme type innstillingsbryter
 * som «ukjent antall» — holder skjemaet enkelt for de fleste brukerne.
 * @param {boolean} value
 */
export function saveAllowEstimatedCount(value) {
  if (!window.localStorage) return;

  try {
    window.localStorage.setItem('allow_estimated_count_v1', value ? '1' : '0');
  } catch (e) {
    console.warn('Kunne ikke lagre estimert-antall-valg', e);
  }
}

/**
 * Last om «ca»-avkrysningsboksen skal vises i hovedskjemaet.
 * @returns {boolean}
 */
export function loadAllowEstimatedCount() {
  if (!window.localStorage) return false;

  try {
    return window.localStorage.getItem('allow_estimated_count_v1') === '1';
  } catch (e) {
    return false;
  }
}

/**
 * Lagre om antall-feltet kan stå tomt ved registrering (sticky «ukjent
 * antall»-avkrysning i hovedskjemaet). Av som standard — moderatorer har
 * historisk klaget på antallsløse funn, se docs/ukjent-antall-og-uoppgitt-aktivitet.md.
 * @param {boolean} value
 */
export function saveAllowUnknownCount(value) {
  if (!window.localStorage) return;

  try {
    window.localStorage.setItem('allow_unknown_count_v1', value ? '1' : '0');
  } catch (e) {
    console.warn('Kunne ikke lagre ukjent-antall-valg', e);
  }
}

/**
 * Last om antall-feltet kan stå tomt ved registrering.
 * @returns {boolean}
 */
export function loadAllowUnknownCount() {
  if (!window.localStorage) return false;

  try {
    return window.localStorage.getItem('allow_unknown_count_v1') === '1';
  } catch (e) {
    return false;
  }
}

/**
 * Lagre valgt appspråk ('nb'/'nn'). Tynn re-eksport av i18n.js sin
 * setLanguage() - all språklagring skjer der nå, se
 * docs/i18n-arkitektur-analyse.md. Beholdt her under samme navn som
 * speciesDisplayName()/activityDisplayName() allerede importeres fra, og
 * fordi eksisterende kallsteder (species-search.js) fortsatt bruker den
 * boolske varianten for det smale art-spesifikke valget.
 * @param {'nb'|'nn'|boolean} lang
 */
export function saveLanguage(lang) {
  setLanguage(lang === true || lang === '1' ? 'nn' : lang === false || lang === '0' ? 'nb' : lang);
}

/**
 * Last valgt appspråk ('nb'/'nn'). Tynn re-eksport av i18n.js sin
 * getLanguage().
 * @returns {'nb'|'nn'}
 */
export function loadLanguage() {
  return getLanguage();
}

/**
 * Lagre om nynorske artsnavn skal brukes som visningsnavn i artssøket (kun
 * offline-lista, se docs/ for kildeanalyse). Rent visuelt - endrer ALDRI
 * hvilket navn som faktisk lagres/sendes til AO ved publisering (det er
 * alltid bokmål, jf. observations.js sin CSV-eksport og speciesDisplayName()
 * under, som holder disse to bevisst atskilt).
 *
 * Delegerer til samme språkvalg som resten av appen (setLanguage()) - et
 * eget, atskilt flagg for "nynorske artsnavn" ga tidligere en app som kunne
 * stå i bokmål med nynorske artsnavn, en kombinasjon ingen UI-tekst noensinne
 * tilbød å velge og som derfor bare var en kilde til forvirring.
 * @param {boolean} value
 */
export function saveNynorskArtsnavn(value) {
  setLanguage(value ? 'nn' : 'nb');
}

/**
 * Last om nynorske artsnavn skal brukes som visningsnavn i artssøket. Default av.
 * @returns {boolean}
 */
export function loadNynorskArtsnavn() {
  return isNynorsk();
}

/**
 * Navnet som skal VISES til brukeren for en art - nynorsk hvis innstillingen
 * er på og arten har et (fra offline-lista), ellers bokmål. Brukes overalt
 * arten vises i grensesnittet (søkeresultater, ③-lista, registrerings-toast).
 *
 * Helt bevisst ALDRI brukt for selve lagringen/publiseringen: `species.taxonName`
 * er og skal forbli det eneste feltet som sendes til AO (se observations.js
 * sin CSV-eksport, som leser taxonName direkte - ikke denne funksjonen).
 * Uten dette skillet ville registrering av f.eks. "fiskemåse" (nynorsk) blitt
 * sendt til AO som teksten "fiskemåse", som AO mest sannsynlig ikke kjenner
 * igjen (AO matcher navn på tekst, se kråke/svartkråke-unntaket i
 * observations.js).
 * @param {{taxonName?: string, nynorsk?: string}} species
 * @returns {string}
 */
export function speciesDisplayName(species, userLanguage = undefined) {
  if (!species) return '';
  let useNynorsk;
  if (userLanguage !== undefined && userLanguage !== null && userLanguage !== '') {
    if (typeof userLanguage === 'boolean') {
      useNynorsk = userLanguage;
    } else {
      const norm = String(userLanguage).trim().toLowerCase();
      useNynorsk = norm === 'nn' || norm === 'nno' || norm === 'nynorsk';
    }
  } else {
    useNynorsk = loadNynorskArtsnavn();
  }

  if (useNynorsk) {
    const nno = species.nameNno || species.nynorsk;
    if (nno) return nno;
    const nob = species.taxonName || species.nameNob || species.norwegian || '';
    if (nob) {
      const trans = translateDedicatedSubspeciesToNynorsk(nob);
      if (trans && trans.toLowerCase() !== nob.toLowerCase()) {
        return trans;
      }
    }
  }
  return species.taxonName || species.nameNob || species.norwegian || '';
}

/**
 * Eldre aliaser som ikke ligger som egne activity.*-nøkler i i18n, men som
 * fortsatt kan finnes i lagrede observasjoner eller eldre hurtigknapper.
 */
const ACTIVITY_ALIASES = {
  'Stationær': 'activity.23',
  'Overflyvende': 'activity.24',
};

const ACTIVITY_BOKMAL_OVERRIDES = {
  // Noen nynorsk-verdier er identiske med flere bokmål-nøkler (f.eks.
  // 'Stasjonær' for både 'Stasjonær' og 'Stationær') - sikre at identitet
  // slår alias, og at Ø/NØ/SØ-retningene mapper til hovedformen.
  'Stasjonær': 'Stasjonær',
  'Overflygande': 'Overflygende',
  'Trekkjande mot Ø': 'Trekkende mot Ø',
  'Trekkjande mot NØ': 'Trekkende mot NØ',
  'Trekkjande mot SØ': 'Trekkende mot SØ',
};

/**
 * Nynorsk-oversettelse av AO-aktivitetskodene fra i18n-ordbøkene (nb.js / nn.js).
 * Nøkkel er det kanoniske bokmål-navnet AO selv bruker, verdi er
 * nynorsk-visningsnavnet - samme retning som speciesDisplayName() over.
 */
export const ACTIVITY_NYNORSK_MAP = (() => {
  const nb = getDictionary('nb');
  const nn = getDictionary('nn');
  const map = {};
  // «Ikke oppgitt» deler nøkkel (index.common.not_specified) i i18n, men trengs
  // også her for at hurtigpillen og visningshjelperne skal slå den opp direkte.
  if (nb['index.common.not_specified'] && nn['index.common.not_specified'] !== undefined) {
    map[nb['index.common.not_specified']] = nn['index.common.not_specified'];
  }
  for (const key of Object.keys(nb)) {
    if (key.startsWith('activity.') && nn[key] !== undefined) {
      map[nb[key]] = nn[key];
    }
  }
  for (const [aliasNb, targetKey] of Object.entries(ACTIVITY_ALIASES)) {
    if (nn[targetKey] !== undefined) {
      map[aliasNb] = nn[targetKey];
    }
  }
  return map;
})();

const ACTIVITY_BOKMAL_MAP = (() => {
  const rev = {};
  for (const [nb, nn] of Object.entries(ACTIVITY_NYNORSK_MAP)) {
    if (!rev[nn]) rev[nn] = nb;
  }
  Object.assign(rev, ACTIVITY_BOKMAL_OVERRIDES);
  return rev;
})();

/**
 * Visningsnavn for en AO-aktivitetskode, etter aktivt språk (eller
 * `userLanguage` hvis gitt - samme mønster som speciesDisplayName()).
 * @param {string} label
 * @param {string} [userLanguage]
 * @returns {string}
 */
export function activityDisplayName(label, userLanguage) {
  if (!label) return '';
  const lang = userLanguage !== undefined ? userLanguage : getLanguage();
  if (lang === 'nn') {
    const trimmed = label.trim();
    return ACTIVITY_NYNORSK_MAP[label] || ACTIVITY_NYNORSK_MAP[trimmed] || label;
  }
  return activityBokmalName(label);
}

/**
 * Konverterer et eventuelt nynorsk aktivitetsnavn tilbake til det kanoniske
 * bokmål-navnet AO forventer. Brukes når en <option> sin viste tekst er
 * oversatt, men verdien som lagres/sendes må være AO-formen - se
 * activityDisplayName() over for motsatt retning.
 * @param {string} label
 * @returns {string}
 */
export function activityBokmalName(label) {
  if (!label) return '';
  const trimmed = label.trim();
  return ACTIVITY_BOKMAL_MAP[label] || ACTIVITY_BOKMAL_MAP[trimmed] || label;
}

const GENDER_I18N_KEYS = [
  'index.common.not_specified',
  'index.common.gender_hann',
  'index.common.gender_hunn',
  'index.common.gender_hunnfarget',
  'index.common.gender_i_par',
];

const AGE_I18N_KEYS = [
  'index.common.not_specified',
  'index.common.stage_aarsunge',
  'index.common.stage_fjoraarsunge',
  'index.common.stage_voksen',
];

function buildTranslationMaps(keys) {
  const nb = getDictionary('nb');
  const nn = getDictionary('nn');
  const toNn = {};
  const toNb = {};
  for (const key of keys) {
    const labelNb = nb[key];
    const labelNn = nn[key];
    if (!labelNb || labelNn === undefined) continue;
    toNn[labelNb] = labelNn;
    if (!toNb[labelNn]) toNb[labelNn] = labelNb;
  }
  return { toNn, toNb };
}

const { toNn: GENDER_NYNORSK_MAP, toNb: GENDER_BOKMAL_MAP } = buildTranslationMaps(GENDER_I18N_KEYS);
const { toNn: AGE_NYNORSK_MAP, toNb: AGE_BOKMAL_MAP } = buildTranslationMaps(AGE_I18N_KEYS);

/**
 * Visningsnavn for AO-kjønnskode ('Hann', 'Hunn', 'Hunnfarget', 'I par').
 * Lagret/sendt verdi skal alltid være kanonisk bokmål.
 * @param {string} label
 * @param {string} [userLanguage]
 * @returns {string}
 */
export function genderDisplayName(label, userLanguage) {
  if (!label) return '';
  const lang = userLanguage !== undefined ? userLanguage : getLanguage();
  const trimmed = String(label).trim();
  if (lang === 'nn') {
    return GENDER_NYNORSK_MAP[label] || GENDER_NYNORSK_MAP[trimmed] || label;
  }
  return genderBokmalName(label);
}

/**
 * Konverterer et eventuelt nynorsk kjønnsnavn tilbake til kanonisk bokmål.
 * @param {string} label
 * @returns {string}
 */
export function genderBokmalName(label) {
  if (!label) return '';
  const trimmed = String(label).trim();
  return GENDER_BOKMAL_MAP[label] || GENDER_BOKMAL_MAP[trimmed] || label;
}

/**
 * Visningsnavn for AO-alders-/stadiumskode (f.eks. 'Voksen' -> 'Vaksen').
 * Fuglekoder som 'Adult', 'Egg', 'Pulli', '1K' osv. er like på begge målformer.
 * Lagret/sendt verdi skal alltid være kanonisk bokmål.
 * @param {string} label
 * @param {string} [userLanguage]
 * @returns {string}
 */
export function ageDisplayName(label, userLanguage) {
  if (!label) return '';
  const lang = userLanguage !== undefined ? userLanguage : getLanguage();
  const trimmed = String(label).trim();
  if (lang === 'nn') {
    return AGE_NYNORSK_MAP[label] || AGE_NYNORSK_MAP[trimmed] || label;
  }
  return ageBokmalName(label);
}

/**
 * Konverterer et eventuelt nynorsk alders-/stadiumsnavn tilbake til kanonisk bokmål.
 * @param {string} label
 * @returns {string}
 */
export function ageBokmalName(label) {
  if (!label) return '';
  const trimmed = String(label).trim();
  return AGE_BOKMAL_MAP[label] || AGE_BOKMAL_MAP[trimmed] || label;
}

function buildPrefixedTranslationMaps(prefix) {
  const nb = getDictionary('nb');
  const keys = ['index.common.not_specified'];
  for (const key of Object.keys(nb)) {
    if (key.startsWith(prefix)) keys.push(key);
  }
  return buildTranslationMaps(keys);
}

const { toNn: UNIT_NYNORSK_MAP, toNb: UNIT_BOKMAL_MAP } = buildPrefixedTranslationMaps('unit.');
const { toNn: DISCOVERY_METHOD_NYNORSK_MAP, toNb: DISCOVERY_METHOD_BOKMAL_MAP } = buildPrefixedTranslationMaps('discovery_method.');

/**
 * Visningsnavn for AO-enhet (pattedyr, f.eks. 'Individer' -> 'Individ').
 * Lagret/sendt verdi skal alltid være kanonisk bokmål.
 * @param {string} label
 * @param {string} [userLanguage]
 * @returns {string}
 */
export function unitDisplayName(label, userLanguage) {
  if (!label) return '';
  const lang = userLanguage !== undefined ? userLanguage : getLanguage();
  const trimmed = String(label).trim();
  if (lang === 'nn') {
    return UNIT_NYNORSK_MAP[label] || UNIT_NYNORSK_MAP[trimmed] || label;
  }
  return unitBokmalName(label);
}

/**
 * Konverterer et eventuelt nynorsk enhetsnavn tilbake til kanonisk bokmål.
 * @param {string} label
 * @returns {string}
 */
export function unitBokmalName(label) {
  if (!label) return '';
  const trimmed = String(label).trim();
  return UNIT_BOKMAL_MAP[label] || UNIT_BOKMAL_MAP[trimmed] || label;
}

/**
 * Visningsnavn for AO-metode (DiscoveryMethod, pattedyr, f.eks. 'Hørt' -> 'Høyrt').
 * Lagret/sendt verdi skal alltid være kanonisk bokmål.
 * @param {string} label
 * @param {string} [userLanguage]
 * @returns {string}
 */
export function discoveryMethodDisplayName(label, userLanguage) {
  if (!label) return '';
  const lang = userLanguage !== undefined ? userLanguage : getLanguage();
  const trimmed = String(label).trim();
  if (lang === 'nn') {
    return DISCOVERY_METHOD_NYNORSK_MAP[label] || DISCOVERY_METHOD_NYNORSK_MAP[trimmed] || label;
  }
  return discoveryMethodBokmalName(label);
}

/**
 * Konverterer et eventuelt nynorsk metodenavn tilbake til kanonisk bokmål.
 * @param {string} label
 * @returns {string}
 */
export function discoveryMethodBokmalName(label) {
  if (!label) return '';
  const trimmed = String(label).trim();
  return DISCOVERY_METHOD_BOKMAL_MAP[label] || DISCOVERY_METHOD_BOKMAL_MAP[trimmed] || label;
}

/**
 * Kuraterte forkortelses-forslag for standard-aktivitetene, nøklet på value.
 * Brukes av «Foreslå forkortelser»-knappen i innstillinger. Maks 5 tegn.
 */
export const ACTIVITY_SHORT_SUGGESTIONS = {
  '': 'Ingen',   // Ikke oppgitt
  '23': 'Stasj', // Stasjonær
  '22': 'Rast',  // Rastende
  '24': 'Overf', // Overflygende
  '25': 'Nær',   // Næringssøkende
  '32': 'Trekk', // Trekkende
  '52': 'Sang',  // Sang/spill
  '57': 'Svøm',  // Svømmende
  '86': 'Hvil',  // Hvilende
  '80': 'Drek',  // Drektig hunn
  '85': 'Unge',  // Hunn med unge(r)
  '27': 'Lyd'    // Lokkelyd, øvrige lyder
};

const ACTIVITY_PILLS_MAMMALS_KEY = 'activityPills_mammals_v1';

export const DEFAULT_MAMMAL_ACTIVITY_PILLS = [
  { label: 'Svømmende', value: '57' },
  { label: 'Hvilende', value: '86' },
  { label: 'Næringssøkende', value: '25' },
  { label: 'Drektig hunn', value: '80' },
  { label: 'Hunn med unge(r)', value: '85' },
  { label: 'Lokkelyd, øvrige lyder', value: '27' }
];

function activityPillsKey(speciesGroup = '8') {
  return String(speciesGroup || '8') === '11' ? ACTIVITY_PILLS_MAMMALS_KEY : ACTIVITY_PILLS_KEY;
}

/**
 * Lagre konfigurasjon av aktivitetspills
 * @param {Array<{label: string, value: string, short?: string}>} pills - Array av pill-objekter.
 *   `short` er valgfritt kortnavn (maks 5 tegn) som vises på hurtigknappen i stedet for fullt navn.
 * @param {string|number} [speciesGroup='8'] - Artsgruppe ('8' = fugl, '11' = pattedyr)
 */
export function saveActivityPills(pills, speciesGroup = '8') {
  try {
    const config = {
      version: 1,
      pills: pills.slice(0, 8).map(p => {
        const pill = { label: p.label, value: p.value };
        const short = (p.short || '').trim().slice(0, 5);
        if (short) pill.short = short; // tomt kortnavn utelates → vis fullt navn
        return pill;
      })
    };
    localStorage.setItem(activityPillsKey(speciesGroup), JSON.stringify(config));
  } catch (e) {
    console.warn('Kunne ikke lagre aktivitetspills', e);
  }
}

/**
 * Last konfigurasjon av aktivitetspills
 * @param {string|number} [speciesGroup='8'] - Artsgruppe ('8' = fugl, '11' = pattedyr)
 * @returns {Array<{label: string, value: string, short?: string}>}
 */
export function loadActivityPills(speciesGroup = '8') {
  const erPattedyr = String(speciesGroup || '8') === '11';
  try {
    const raw = localStorage.getItem(activityPillsKey(speciesGroup));
    if (raw) {
      const config = JSON.parse(raw);
      if (config.version === 1 && Array.isArray(config.pills)) {
        return config.pills.slice(0, 8);
      }
    }
  } catch (e) {
    console.warn('Kunne ikke laste aktivitetspills', e);
  }

  if (erPattedyr) {
    return DEFAULT_MAMMAL_ACTIVITY_PILLS.map(p => ({ ...p }));
  }

  // Migrer fra gammelt system (kun fugl)
  return migrateFromOldPillCount();
}

/**
 * Migrer fra gammelt activityPillCount til nytt system
 * @returns {Array<{label: string, value: string}>}
 */
function migrateFromOldPillCount() {
  const oldCount = localStorage.getItem('activityPillCount');

  // Standard pills (matching observation-commit.js hardkoded array)
  const defaultPills = [
    { label: 'Stasjonær', value: '23' },
    { label: 'Rastende', value: '22' },
    { label: 'Overflygende', value: '24' },
    { label: 'Næringssøkende', value: '25' },
    { label: 'Trekkende', value: '32' },
    { label: 'Sang/spill', value: '52' }
  ];

  if (oldCount) {
    const count = parseInt(oldCount, 10);
    if (count >= 1 && count <= 6) {
      return defaultPills.slice(0, count);
    }
  }

  // Default for helt nye brukere: 4 første
  return defaultPills.slice(0, 4);
}

/**
 * Lagre siste kjente brukerposisjon til localStorage.
 * Lagrer kun gyldige posisjoner som ikke er merket som fallback.
 * @param {Object} pos - { lat, lon, accuracy }
 * @returns {boolean}
 */
export function saveLastKnownPosition(pos) {
  if (!pos || typeof pos !== 'object') return false;
  if (pos.isFallback) return false;
  const lat = Number(pos.lat);
  const lon = Number(pos.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;

  try {
    const payload = {
      lat,
      lon,
      accuracy: typeof pos.accuracy === 'number' && Number.isFinite(pos.accuracy) ? pos.accuracy : null,
      timestamp: Date.now(),
    };
    window.localStorage.setItem(LAST_KNOWN_POSITION_KEY, JSON.stringify(payload));
    return true;
  } catch (e) {
    console.warn('Kunne ikke lagre siste kjente posisjon til localStorage', e);
    return false;
  }
}

/**
 * Hent siste kjente brukerposisjon fra localStorage.
 * Returnerer null dersom ingen gyldig posisjon er lagret.
 * @returns {{lat: number, lon: number, accuracy: number|null, timestamp: number|null}|null}
 */
export function loadLastKnownPosition() {
  if (typeof window === 'undefined' || !window.localStorage) return null;

  try {
    const raw = window.localStorage.getItem(LAST_KNOWN_POSITION_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        const lat = Number(parsed.lat);
        const lon = Number(parsed.lon);
        if (Number.isFinite(lat) && Number.isFinite(lon)) {
          return {
            lat,
            lon,
            accuracy: typeof parsed.accuracy === 'number' && Number.isFinite(parsed.accuracy) ? parsed.accuracy : null,
            timestamp: parsed.timestamp || null,
          };
        }
      }
    }
  } catch (e) {
    console.warn('Kunne ikke lese siste kjente posisjon fra localStorage', e);
  }

  // Backup-sjekk fra mapData dersom nøkkelen ikke finnes ennå
  try {
    const rawMapData = window.localStorage.getItem('mapData');
    if (rawMapData) {
      const md = JSON.parse(rawMapData);
      if (md && md.userPosition && !md.userPosition.isFallback) {
        const lat = Number(md.userPosition.lat);
        const lon = Number(md.userPosition.lon);
        if (Number.isFinite(lat) && Number.isFinite(lon)) {
          return {
            lat,
            lon,
            accuracy: typeof md.userPosition.accuracy === 'number' ? md.userPosition.accuracy : null,
            timestamp: null,
          };
        }
      }
    }
  } catch (_) {}

  return null;
}

