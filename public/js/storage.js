/**
 * Storage-modul for localStorage-håndtering
 */
import { hentAktivFellestur } from './fellestur-client.js';
import { lastSpeil, lagreSpeilOgSynk, hentTurMedobservatorer } from './fellestur-sync.js';
import { translateDedicatedSubspeciesToNynorsk } from './species-matcher.js?v=v1.60.15';
import { aktivInnhentetListe, lagreEndringerIInnhentetListe, lesInnhentetListe } from './arbeidsliste-lokal.js';

const STORAGE_KEY = 'fugleobservasjoner_v1';
const MEDOBS_KEY = 'medobs_list_v1';
const AO_SIZE_KEY = 'ao_search_radius_v1';
const ACTIVITY_PILLS_KEY = 'activityPills_v1';
const SENT_KEY = 'sent_observations_v1';
const LOCATION_SORT_KEY = 'location_sort_mode_v1';
const AO_DIRECT_AUTO_CLEAR_KEY = 'ao_direct_auto_clear_v1';
const NYNORSK_ARTSNAVN_KEY = 'nynorsk_artsnavn_v1';
const LANGUAGE_KEY = 'app_language_v1';
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
 * Lagre valgt språk ('nb' eller 'nn') og synkroniser med nynorsk_artsnavn_v1.
 * @param {'nb'|'nn'|boolean} lang
 */
export function saveLanguage(lang) {
  if (!window.localStorage) return;
  const isNn = lang === 'nn' || lang === true || lang === '1';

  try {
    window.localStorage.setItem(LANGUAGE_KEY, isNn ? 'nn' : 'nb');
    window.localStorage.setItem(NYNORSK_ARTSNAVN_KEY, isNn ? '1' : '0');
    if (typeof document !== 'undefined' && document.documentElement) {
      document.documentElement.lang = isNn ? 'nn' : 'nb';
    }
  } catch (e) {
    console.warn('Kunne ikke lagre språk-valg', e);
  }
}

/**
 * Last valgt språk ('nb' eller 'nn'). Default 'nb'.
 * Bakoverkompatibel med eksisterende nynorsk_artsnavn_v1-nøkkel.
 * @returns {'nb'|'nn'}
 */
export function loadLanguage() {
  if (!window.localStorage) return 'nb';

  try {
    const lang = window.localStorage.getItem(LANGUAGE_KEY);
    if (lang === 'nn' || lang === 'nb') return lang;

    const ny = window.localStorage.getItem(NYNORSK_ARTSNAVN_KEY);
    if (ny === '1' || ny === 'true') return 'nn';
    if (ny === '0' || ny === 'false') return 'nb';
    return 'nb';
  } catch (e) {
    return 'nb';
  }
}

/**
 * Sjekk om nynorsk ('nn') er aktivt språk.
 * @returns {boolean}
 */
export function isNynorsk() {
  return loadLanguage() === 'nn';
}

/**
 * Lagre om nynorske artsnavn skal brukes som visningsnavn i artssøket (kun
 * offline-lista, se docs/ for kildeanalyse). Rent visuelt - endrer ALDRI
 * hvilket navn som faktisk lagres/sendes til AO ved publisering (det er
 * alltid bokmål, jf. observations.js sin CSV-eksport og speciesDisplayName()
 * under, som holder disse to bevisst atskilt).
 * @param {boolean} value
 */
export function saveNynorskArtsnavn(value) {
  saveLanguage(Boolean(value) ? 'nn' : 'nb');
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
 * Nynorsk-omsetjing av alle AO-aktivitetskodar.
 * Nøkkel er bokmål-namnet frå activities.json / AO, verdi er nynorsk visingsnamn.
 */
export const ACTIVITY_NYNORSK_MAP = {
  // Alle 61 aktivitetskodar frå public/data/activities.json
  'Stasjonær': 'Stasjonær',
  'Rastende': 'Rastande',
  'Overflygende': 'Overflygande',
  'Næringssøkende': 'Næringssøkjande',
  'Ved fôring': 'Ved fôring',
  'Trekkende': 'Trekkjande',
  'Sang/spill, ikke hekking': 'Song/spel, ikkje hekking',
  'Lokkelyd, øvrige lyder': 'Lokkelyd, andre lydar',
  'Revir, ikke hekking': 'Revir, ikkje hekking',
  'Trekkende mot N': 'Trekkjande mot N',
  'Trekkende mot NØ': 'Trekkjande mot NA',
  'Trekkende mot Ø': 'Trekkjande mot A',
  'Trekkende mot SØ': 'Trekkjande mot SA',
  'Trekkende mot S': 'Trekkjande mot S',
  'Trekkende mot SV': 'Trekkjande mot SV',
  'Trekkende mot V': 'Trekkjande mot V',
  'Trekkende mot NV': 'Trekkjande mot NV',
  'Permanent revir': 'Permanent revir',
  'Sang/spill i hekketid og passende hekkebiotop': 'Song/spel i hekketid og passande hekkebiotop',
  'Observasjon i hekketid, passende biotop': 'Observasjon i hekketid, passande biotop',
  'Par i passende hekkebiotop': 'Par i passande hekkebiotop',
  'Paring/kurtise på mulig hekkeplass': 'Paring/kurtise på mogleg hekkeplass',
  'Reirbygging': 'Reirbygging',
  'Reirbesøk?': 'Reirbesøk?',
  'Besøker bebodd reir': 'Besøkjer bebodd reir',
  'Reir i bruk': 'Reir i bruk',
  'Rugende': 'Rugande',
  'Rugeflekker': 'Rugeflekkar',
  'Reir med egg eller unger': 'Reir med egg eller ungar',
  'Reir, unger hørt': 'Reir, ungar høyrt',
  'Mat til unger': 'Mat til ungar',
  'Bar ekskrementpose': 'Bar ekskrementpose',
  'Unger utenfor reir, ikke utvokste': 'Ungar utanfor reir, ikkje utvaksne',
  'Eggeskall': 'Eggeskall',
  'Brukt reir': 'Brukt reir',
  'Engstelig adferd, indikasjon på hekking': 'Engsteleg åtferd, indikasjon på hekking',
  'Avledningsmanøver': 'Avleiingsmanøver',
  'Mislykket hekking': 'Mislykka hekking',
  'Ringmerket': 'Ringmerkt',
  'Individmerket (kontroll)': 'Individmerkt (kontroll)',
  'Trekkforsøk': 'Trekkforsøk',
  'Syk': 'Sjuk',
  'Død - kollisjon med kraftledning': 'Daud - kollisjon med kraftleidning',
  'Død - kollisjon med vindturbin': 'Daud - kollisjon med vindturbin',
  'Død - kollisjon med vindu': 'Daud - kollisjon med vindauge',
  'Død - kollisjon med fyr': 'Daud - kollisjon med fyr',
  'Død - kollisjon med fly': 'Daud - kollisjon med fly',
  'Død - kollisjon med gjerde': 'Daud - kollisjon med gjerde',
  'Drept av elektrokusjon (strømslag)': 'Drepen av elektrokusjon (straumslag)',
  'Drept av olje': 'Drepen av olje',
  'Trafikkdrept': 'Trafikkdrepen',
  'Garndød': 'Garndaud',
  'Skadet av fiskeredskap': 'Skadd av fiskereiskap',
  'Drept av predator': 'Drepen av predator',
  'Død av sykdom/sult': 'Daud av sjukdom/sult',
  'Skutt/avlivet': 'Skoten/avliva',
  'Død - ukjent dødsårsak': 'Daud - ukjend dødsårsak',
  'Ferske spor': 'Ferske spor',
  'Eldre spor': 'Eldre spor',
  'Fersk møkk': 'Fersk møkk',
  'Eldre møkk': 'Eldre møkk',
  // Eldre aliasar og hurtigknappar
  'Stationær': 'Stasjonær',
  'Overflyvende': 'Overflygande',
  'Syngende': 'Syngjande',
  'Spill/sang': 'Spel/song',
  'Sang/spill': 'Song/spel',
  'Reir med unger eller hørt unger': 'Reir med ungar eller høyrt ungar',
};

const ACTIVITY_BOKMAL_MAP = (() => {
  const rev = {};
  for (const [nb, nn] of Object.entries(ACTIVITY_NYNORSK_MAP)) {
    if (!rev[nn]) rev[nn] = nb;
  }
  rev['Stasjonær'] = 'Stasjonær';
  rev['Overflygande'] = 'Overflygende';
  rev['Trekkjande mot Ø'] = 'Trekkende mot Ø';
  rev['Trekkjande mot NØ'] = 'Trekkende mot NØ';
  rev['Trekkjande mot SØ'] = 'Trekkende mot SØ';
  return rev;
})();

/**
 * Returnerer visingsnamn for ein aktivitetskode basert på språkpreferanse (nb/nn).
 * @param {string} label
 * @param {string} [userLanguage]
 * @returns {string}
 */
export function activityDisplayName(label, userLanguage) {
  if (!label) return '';
  const useNynorsk = userLanguage !== undefined
    ? userLanguage === 'nn'
    : loadNynorskArtsnavn();
  if (useNynorsk) {
    if (ACTIVITY_NYNORSK_MAP[label]) return ACTIVITY_NYNORSK_MAP[label];
    const trimmed = label.trim();
    if (ACTIVITY_NYNORSK_MAP[trimmed]) return ACTIVITY_NYNORSK_MAP[trimmed];
    return label;
  }
  return activityBokmalName(label);
}

/**
 * Konverterer eit eventuelt nynorsk aktivitetsnamn tilbake til kanonisk bokmål AO-namn.
 * @param {string} label
 * @returns {string}
 */
export function activityBokmalName(label) {
  if (!label) return '';
  if (ACTIVITY_BOKMAL_MAP[label]) return ACTIVITY_BOKMAL_MAP[label];
  const trimmed = label.trim();
  if (ACTIVITY_BOKMAL_MAP[trimmed]) return ACTIVITY_BOKMAL_MAP[trimmed];
  return label;
}

/**
 * Kuraterte forkortelses-forslag for standard-aktivitetene, nøklet på value.
 * Brukes av «Foreslå forkortelser»-knappen i innstillinger. Maks 5 tegn.
 */
export const ACTIVITY_SHORT_SUGGESTIONS = {
  '23': 'Stasj', // Stasjonær
  '22': 'Rast',  // Rastende
  '24': 'Overf', // Overflygende
  '25': 'Nær',   // Næringssøkende
  '32': 'Trekk', // Trekkende
  '52': 'Sang'   // Sang/spill
};

/**
 * Lagre konfigurasjon av aktivitetspills
 * @param {Array<{label: string, value: string, short?: string}>} pills - Array av pill-objekter.
 *   `short` er valgfritt kortnavn (maks 5 tegn) som vises på hurtigknappen i stedet for fullt navn.
 */
export function saveActivityPills(pills) {
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
    localStorage.setItem(ACTIVITY_PILLS_KEY, JSON.stringify(config));
  } catch (e) {
    console.warn('Kunne ikke lagre aktivitetspills', e);
  }
}

/**
 * Last konfigurasjon av aktivitetspills
 * @returns {Array<{label: string, value: string, short?: string}>}
 */
export function loadActivityPills() {
  try {
    const raw = localStorage.getItem(ACTIVITY_PILLS_KEY);
    if (raw) {
      const config = JSON.parse(raw);
      if (config.version === 1 && Array.isArray(config.pills)) {
        return config.pills.slice(0, 8);
      }
    }
  } catch (e) {
    console.warn('Kunne ikke laste aktivitetspills', e);
  }

  // Migrer fra gammelt system
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

