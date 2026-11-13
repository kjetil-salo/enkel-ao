/**
 * Tema-håndtering
 *
 * Leser brukerens temavalg fra localStorage og setter klasse(r) på body.
 * Importeres som vanlig script (ikke module) for å unngå FOUC.
 *
 * Tema-modell (familie + modifikator):
 *   'dark'  → ingen klasse            (mørkt, basetokens i :root)
 *   'light' → .theme-light            (lys-familie)
 *   'clean' → .theme-light .theme-clean (lys-familie + monokrom-modifikator)
 *
 * Clean arver hele lys-familiens layout og legger kun de monokrome
 * forskjellene (svart aksent, flate skygger) oppå. Nytt tema senere =
 * ny modifikator-klasse + en token-blokk i 1-tokens.css.
 *
 * Default er 'light' (lyst). Ukjent/manglende verdi → 'light'.
 */
(function() {
  var THEMES = ['dark', 'light', 'clean'];
  var theme = localStorage.getItem('ao_theme');
  if (THEMES.indexOf(theme) === -1) theme = 'light';

  var b = document.body;
  b.classList.remove('theme-light', 'theme-clean');
  if (theme === 'light') {
    b.classList.add('theme-light');
  } else if (theme === 'clean') {
    b.classList.add('theme-light', 'theme-clean');
  }
  // 'dark' = ingen klasse (basetokens gjelder)

  // Settes som klassisk <script>, ikke type="module" (se filkommentaren over
  // - unngå FOUC), så dette er den ENE stedet appen kan lese språkvalget
  // synkront før i18n.js (en ES-modul) er lastet. window.__isNynorsk er en
  // bevisst smal, read-only unntaks-global for nettopp dette: pre-paint-bruk
  // i et klassisk <script> som ikke kan importere i18n.js. Modulkode skal
  // importere isNynorsk()/getLanguage() fra i18n.js direkte, ikke denne.
  function checkIsNynorsk() {
    try {
      var lang = localStorage.getItem('app_language_v1');
      if (lang === 'nn') return true;
      if (lang === 'nb') return false;
      var ny = localStorage.getItem('nynorsk_artsnavn_v1');
      return ny === '1' || ny === 'true';
    } catch (e) {
      return false;
    }
  }

  window.__isNynorsk = checkIsNynorsk;
  if (document.documentElement) {
    document.documentElement.lang = checkIsNynorsk() ? 'nn' : 'nb';
  }
})();
