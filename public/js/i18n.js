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

let currentLanguage = null;

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
 * Aktivt språk. Leser lagret valg kun ved første kall per sideinnlasting
 * (deretter cachet i minnet) - samme mønster som andre innstillinger i
 * storage.js.
 * @returns {string} språkkode, f.eks. 'nb' eller 'nn'
 */
export function getLanguage() {
  if (currentLanguage === null) {
    currentLanguage = readStoredLanguage() || DEFAULT_LANGUAGE;
    if (typeof document !== 'undefined' && document.documentElement) {
      document.documentElement.lang = currentLanguage;
    }
  }
  return currentLanguage;
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

  currentLanguage = norm;

  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.setItem(LANGUAGE_KEY, norm);
      window.localStorage.setItem(LEGACY_NYNORSK_KEY, norm === 'nn' ? '1' : '0');
    } catch (e) {
      // Lagring feilet (full kvote) - språket gjelder likevel for denne
      // sideinnlastingen, det er ikke verre enn andre innstillinger her.
    }
  }

  if (typeof document !== 'undefined' && typeof document.dispatchEvent === 'function') {
    document.dispatchEvent(new CustomEvent('i18n:language-changed', { detail: { language: norm } }));
  }

  applyTranslations();
  return true;
}

/**
 * Oversett en nøkkel til aktivt språk. Mangler nøkkelen i aktivt språk,
 * brukes bokmål som fallback; mangler den der også, logges en advarsel og
 * selve nøkkelen returneres - en synlig "ukno.key" i grensesnittet er langt
 * lettere å oppdage i test/felt enn en stille tom streng.
 * @param {string} key
 * @param {Record<string, string|number>} [vars] - enkel {navn}-interpolasjon
 * @returns {string}
 */
export function t(key, vars) {
  const dict = DICTIONARIES[getLanguage()] || DICTIONARIES[DEFAULT_LANGUAGE];
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
 * Sett tekst/attributter fra data-i18n-markup under `root` til aktivt språk.
 * Kjøres automatisk av setLanguage(), og bør også kjøres én gang ved
 * sideinnlasting (f.eks. fra main.js) for at startspråket skal vises riktig.
 *
 * - `data-i18n="nøkkel"` setter textContent
 * - `data-i18n-attr="placeholder:nøkkel,title:annen.nøkkel"` setter
 *   attributter i stedet for textContent (kommaseparert liste av par)
 * @param {Document|Element} [root]
 */
export function applyTranslations(root) {
  const scope = root || (typeof document !== 'undefined' ? document : null);
  if (!scope || typeof scope.querySelectorAll !== 'function') return;

  scope.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.getAttribute('data-i18n'));
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
 * Språkene appen faktisk har en ordbok for, i visningsrekkefølge - brukes av
 * settings.html til å bygge språkvelgeren fra denne ene listen i stedet for
 * å hardkode alternativene der også.
 * @returns {{code: string, label: string}[]}
 */
export function getAvailableLanguages() {
  return SUPPORTED_LANGUAGES.map((code) => ({ code, label: t(`settings.language.${code}`) }));
}
