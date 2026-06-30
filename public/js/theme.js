/**
 * Tema-håndtering
 *
 * Laster brukerens temavalg fra localStorage og setter klassen på body.
 * Importeres som vanlig script (ikke module) for å unngå FOUC.
 */
(function() {
  var theme = localStorage.getItem('ao_theme');
  if (theme === 'light') {
    document.body.classList.add('theme-light');
  }
})();
