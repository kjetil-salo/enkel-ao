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
})();
