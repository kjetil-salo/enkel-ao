/**
 * Kjerne-i18n for Enkel-AO. Erstatter den boolske isNynorsk()/
 * window.__isNynorsk()-modellen (se docs/i18n-arkitektur-analyse.md) med en
 * språkkode og en nøkkel→streng-oppslagstabell, slik at et tredje språk
 * (engelsk) er å legge til en ordbok og en linje i SUPPORTED_LANGUAGES -
 * ikke å skrive om hvert kallsted i appen.
 *
 * Ingen bygg-prosess kjører over frontend-koden (ren <script type="module">,
 * se CLAUDE.md), så ordbøkene er ES-moduler og ikke JSON - det sparer en
 * ekstra fetch og passer stilen resten av public/js/ allerede bruker.
 */
import nb from './i18n/nb.js';
import nn from './i18n/nn.js';

// Navnet er videreført fra Espens opprinnelige nynorsk-arbeid (samme nøkkel
// brukes av den tidlige, ikke-modul-baserte sjekken i theme.js før denne
// modulen er lastet - se der for hvorfor).
const LANGUAGE_KEY = 'app_language_v1';
// Bakoverkompatibel med den enda eldre, kun art-spesifikke
// nynorsk_artsnavn_v1-nøkkelen i storage.js - en bruker som allerede har
// valgt nynorsk skal ikke falle tilbake til bokmål bare fordi denne modulen
// ble innført etter at valget ble lagret.
const LEGACY_NYNORSK_KEY = 'nynorsk_artsnavn_v1';

const DICTIONARIES = { nb, nn };
export const DEFAULT_LANGUAGE = 'nb';
export const SUPPORTED_LANGUAGES = Object.keys(DICTIONARIES);

function normalizeLanguage(code) {
  if (typeof code !== 'string') return null;
  const norm = code.trim().toLowerCase();
  return SUPPORTED_LANGUAGES.includes(norm) ? norm : null;
}

function readStoredLanguage() {
  if (typeof window === 'undefined' || !window.localStorage) return null;

  try {
    const stored = normalizeLanguage(window.localStorage.getItem(LANGUAGE_KEY));
    if (stored) return stored;

    // Finnes ingen LANGUAGE_KEY ennå, men brukeren har tidligere slått på
    // nynorske artsnavn - behandle det som et nynorsk-valg også her.
    if (window.localStorage.getItem(LEGACY_NYNORSK_KEY) === '1') return 'nn';
  } catch (e) {
    // localStorage utilgjengelig (f.eks. privat nettlesing) - bruk default.
  }

  return null;
}

/**
 * Aktivt språk. Leser localStorage på hvert kall, uten mellomlagring i minnet
 * - samme "ingen cache" som resten av storage.js sine load*()-funksjoner.
 *
 * Bevisst valg, ikke en forglemt optimalisering: denne modulen importeres
 * under flere ulike `?v=`-suffikser fra forskjellige filer (se
 * "Versjonering" i CLAUDE.md), og ES-moduler med forskjellig URL (inkl.
 * query-streng) er FORSKJELLIGE modulinstanser med hver sin modul-tilstand.
 * En cachet verdi her ville dermed kunnet gå ut av synk mellom instanser -
 * oppdaget i tests/unit/coobserver-picker.test.js, der setLanguage() fra én
 * instans ikke nådde t() sin cache i en annen. Direkte localStorage-lesing
 * deler alltid samme kilde uansett hvor mange modulinstanser som finnes.
 * @returns {string} språkkode, f.eks. 'nb' eller 'nn'
 */
export function getLanguage() {
  return readStoredLanguage() || DEFAULT_LANGUAGE;
}

/**
 * Convenience-sjekk for det smale tilfellet der bare bokmål/nynorsk er
 * relevant (artsnavn, AO-aktivitetskoder) - se activityDisplayName() i
 * storage.js. Resten av appen bør bruke t()/getLanguage(), ikke denne.
 * @returns {boolean}
 */
export function isNynorsk() {
  return getLanguage() === 'nn';
}

/**
 * Bytt aktivt språk. Lagrer valget og speiler det inn i den gamle
 * nynorsk_artsnavn_v1-nøkkelen, slik at ikke-migrert kode (speciesDisplayName
 * i storage.js m.fl.) fortsetter å virke korrekt gjennom overgangsperioden -
 * se migreringsplanen i docs/i18n-arkitektur-analyse.md.
 * @param {string} code
 * @returns {boolean} true hvis språket ble satt (gyldig kode)
 */
export function setLanguage(code) {
  const norm = normalizeLanguage(code);
  if (!norm) return false;

  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.setItem(LANGUAGE_KEY, norm);
      window.localStorage.setItem(LEGACY_NYNORSK_KEY, norm === 'nn' ? '1' : '0');
    } catch (e) {
      // Lagring feilet (full kvote) - språket gjelder likevel for denne
      // sideinnlastingen, det er ikke verre enn andre innstillinger her.
    }
  }

  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.lang = norm;
  }
  if (typeof document !== 'undefined' && typeof document.dispatchEvent === 'function') {
    document.dispatchEvent(new CustomEvent('i18n:language-changed', { detail: { language: norm } }));
  }

  applyTranslations();
  return true;
}

/**
 * Oversett en nøkkel til et EKSPLISITT språk, uten å lese getLanguage(). For
 * rene funksjoner som selv tar språk som parameter (f.eks. kart-visning.js
 * sin knappetekst()/knappetittel()) - slik forblir de testbare uten
 * localStorage/DOM, i stedet for at hver av dem skriver sin egen lokale
 * erNynorsk(lang)-variant. t() under er bekvemmelighetsvarianten som leser
 * aktivt språk selv.
 * @param {string} lang
 * @param {string} key
 * @param {Record<string, string|number>} [vars] - enkel {navn}-interpolasjon
 * @returns {string}
 */
export function tFor(lang, key, vars) {
  const dict = DICTIONARIES[lang] || DICTIONARIES[DEFAULT_LANGUAGE];
  let text = (dict && dict[key]) ?? DICTIONARIES[DEFAULT_LANGUAGE][key];

  if (text === undefined) {
    console.warn(`i18n: mangler oversettelse for nøkkel "${key}"`);
    return key;
  }

  if (vars) {
    for (const [name, value] of Object.entries(vars)) {
      text = text.replaceAll(`{${name}}`, String(value));
    }
  }

  return text;
}

/**
 * Oversett en nøkkel til aktivt språk (getLanguage()). Mangler nøkkelen i
 * aktivt språk, brukes bokmål som fallback; mangler den der også, logges en
 * advarsel og selve nøkkelen returneres - en synlig "ukjent.key" i
 * grensesnittet er langt lettere å oppdage i test/felt enn en stille tom
 * streng.
 * @param {string} key
 * @param {Record<string, string|number>} [vars]
 * @returns {string}
 */
export function t(key, vars) {
  return tFor(getLanguage(), key, vars);
}

/**
 * Sett tekst/attributter fra data-i18n-markup under `root` til aktivt språk.
 * Kjøres automatisk av setLanguage(), og bør også kjøres én gang ved
 * sideinnlasting (f.eks. fra main.js) for at startspråket skal vises riktig.
 *
 * - `data-i18n="nøkkel"` setter textContent
 * - `data-i18n-html="nøkkel"` setter innerHTML - KUN for de få nøklene som
 *   bevisst inneholder enkel, utvikler-skrevet markup (en lenke, <strong>) -
 *   aldri for noe som inneholder brukerinnhold eller interpolerte variabler
 * - `data-i18n-attr="placeholder:nøkkel,title:annen.nøkkel"` setter
 *   attributter i stedet for textContent (kommaseparert liste av par)
 * @param {Document|Element} [root]
 */
export function applyTranslations(root) {
  const scope = root || (typeof document !== 'undefined' ? document : null);
  if (!scope || typeof scope.querySelectorAll !== 'function') return;

  if (!root && typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.lang = getLanguage();
  }

  scope.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.getAttribute('data-i18n'));
  });

  scope.querySelectorAll('[data-i18n-html]').forEach((el) => {
    el.innerHTML = t(el.getAttribute('data-i18n-html'));
  });

  scope.querySelectorAll('[data-i18n-attr]').forEach((el) => {
    const spec = el.getAttribute('data-i18n-attr') || '';
    spec.split(',').forEach((pair) => {
      const [attr, key] = pair.split(':').map((s) => s.trim());
      if (attr && key) el.setAttribute(attr, t(key));
    });
  });
}

/**
 * Visningsnavn for kjønn (Hunn/Hunnfarget -> Ho/Hofarga på nynorsk).
 * Kaller-verdier som lagres og sendes til AO skal alltid forbli kanonisk bokmål.
 * @param {string} gender
 * @param {string} [lang]
 * @returns {string}
 */
export function genderDisplayName(gender, lang) {
  if (!gender) return '';
  const activeLang = lang || getLanguage();
  if (gender === 'Hunn') return tFor(activeLang, 'index.common.gender_hunn');
  if (gender === 'Hunnfarget') return tFor(activeLang, 'index.common.gender_hunnfarget');
  return gender;
}

/**
 * Språkene appen faktisk har en ordbok for, i visningsrekkefølge - brukes av
 * settings.html til å bygge språkvelgeren fra denne ene listen i stedet for
 * å hardkode alternativene der også.
 * @returns {{code: string, label: string}[]}
 */
export function getAvailableLanguages() {
  return SUPPORTED_LANGUAGES.map((code) => ({ code, label: t(`settings.language.${code}`) }));
}

/**
 * Nynorsk-oversettelse av AO-aktivitetskodene fra public/data/activities.json.
 * Nøkkel er det kanoniske bokmål-navnet AO selv bruker, verdi er
 * nynorsk-visningsnavnet.
 */
export const ACTIVITY_NYNORSK_MAP = {
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
  'Stationær': 'Stasjonær',
  'Overflyvende': 'Overflygande',
  'Syngende': 'Syngjande',
  'Spill/sang': 'Spel/song',
  'Sang/spill': 'Song/spel',
  'Reir med unger eller hørt unger': 'Reir med ungar eller høyrt ungar',
};

const ACTIVITY_BOKMAL_MAP = (() => {
  const rev = {};
  for (const [nbVal, nnVal] of Object.entries(ACTIVITY_NYNORSK_MAP)) {
    if (!rev[nnVal]) rev[nnVal] = nbVal;
  }
  rev['Stasjonær'] = 'Stasjonær';
  rev['Overflygande'] = 'Overflygende';
  rev['Trekkjande mot Ø'] = 'Trekkende mot Ø';
  rev['Trekkjande mot NØ'] = 'Trekkende mot NØ';
  rev['Trekkjande mot SØ'] = 'Trekkende mot SØ';
  return rev;
})();

/**
 * Visningsnavn for en AO-aktivitetskode, etter aktivt språk (eller `userLanguage`).
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
 * bokmål-navnet AO forventer.
 * @param {string} label
 * @returns {string}
 */
export function activityBokmalName(label) {
  if (!label) return '';
  const trimmed = label.trim();
  return ACTIVITY_BOKMAL_MAP[label] || ACTIVITY_BOKMAL_MAP[trimmed] || label;
}
