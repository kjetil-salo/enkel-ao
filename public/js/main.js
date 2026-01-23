/**
 * Main entry point for fugleobservasjoner app
 * Koordinerer alle moduler og setter opp event listeners
 */

// Importer fra moduler
import { searchSpecies, logPageView, loadActivities } from './api.js';
import { searchOfflineSpecies } from './species_offline.js';
import { loadObservations, saveObservations, defaultCoObservers } from './storage.js';
import { flashButton, showToast, setStatus, setLocationStatus } from './ui.js';
import { setAoSiteSuggestions, initLocation, openMap } from './location.js';
import { renderObservations, toCsv } from './observations.js';

// ============================================================
// Applikasjonstilstand (MÅ komme ALLER FØRST!)
// ============================================================
let currentResults = [];
let activeIndex = -1;
let debounceTimer = null;
let selectedSpecies = null;
const COMMON_ACTIVITIES = ['Stasjonær', 'Rastende', 'Overflygende', 'Næringssøkende'];
const observations = [];
let currentPosition = null;
let currentPlaceName = '';
let currentAoSites = [];
let currentAoSizeMeters = 1000;

// ============================================================
// DOM-elementreferanser
// ============================================================
const input = document.getElementById('search');
const resultsEl = document.getElementById('results');
const emptyMsgEl = document.getElementById('empty-msg');
const chosenEl = document.getElementById('chosen');
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const resultCount = document.getElementById('result-count');
const countInput = document.getElementById('count');
const activitySelect = document.getElementById('activity');
const activitySubmitBtn = document.getElementById('activity-submit');
const activityPillsEl = document.getElementById('activity-pills');
const obsListEl = document.getElementById('obs-list');
const exportBtn = document.getElementById('export-btn');
const copyBtn = document.getElementById('copy-btn');
const copyOpenBtn = document.getElementById('copy-open-btn');
const clearBtn = document.getElementById('clear-btn');
const locDot = document.getElementById('loc-dot');
const locText = document.getElementById('loc-text');
const locMapBtn = document.getElementById('loc-map-btn');
const locBtn = document.getElementById('loc-btn');
const placeInput = document.getElementById('place');
const aoSitesEl = document.getElementById('ao-sites');
const aoSitesDropdown = document.getElementById('ao-sites-dropdown');
const aoSizeInput = document.getElementById('ao-size');
// Seksjoner for progressiv flyt
const sectionLokasjon = document.querySelector('.section-main:nth-of-type(1)');
const sectionObservasjon = document.querySelector('.section-main:nth-of-type(2)');
const sectionAktivitet = document.querySelector('.row .activity-input-row');

// Avanserte felter
const ageSelect = document.getElementById('age');
const genderSelect = document.getElementById('gender');

// ============================================================
// Progressiv aktivering/deaktivering av seksjoner
// ============================================================
function updateSectionStates() {
  // Lokasjon må være fylt inn for å aktivere observasjon
  const hasLocation = !!(placeInput && placeInput.value.trim());
  if (sectionObservasjon) {
    sectionObservasjon.classList.toggle('dimmed', !hasLocation);
    // Deaktiver alle input i observasjonsseksjonen hvis ingen lokasjon
    input.disabled = !hasLocation;
    countInput.disabled = !hasLocation || !selectedSpecies;
    activitySelect.disabled = !hasLocation || !selectedSpecies || !countInput.value.trim();
    activitySubmitBtn.disabled = activitySelect.disabled;
    // ALDRI disable locBtn! (Oppdater posisjon skal alltid virke)
    if (!hasLocation) {
      input.value = '';
      countInput.value = '';
      selectedSpecies = null;
      chosenEl.style.display = 'none';
      ageSelect.disabled = true;
      genderSelect.disabled = true;
    }
  }
  // Antall må være fylt inn for å aktivere aktivitet
  const hasCount = !!(countInput && countInput.value.trim() && !countInput.disabled);
  if (sectionAktivitet) {
    sectionAktivitet.classList.toggle('dimmed', !hasCount);
    activitySelect.disabled = !hasCount;
    activitySubmitBtn.disabled = !hasCount;
  }
  // Avanserte felter
  ageSelect.disabled = !hasLocation || !selectedSpecies;
  genderSelect.disabled = !hasLocation || !selectedSpecies;
}

// ============================================================
// Hjelpefunksjoner for status
// ============================================================
function updateStatus(mode, text) {
  setStatus(statusDot, statusText, mode, text);
}

function updateLocationStatus(mode, text) {
  setLocationStatus(locDot, locText, mode, text);
}

// ============================================================
// Lagring
// ============================================================
function saveState() {
  saveObservations(observations);
}

function loadState() {
  const loaded = loadObservations();
  observations.splice(0, observations.length);
  loaded.forEach(o => observations.push(o));

  // Sett stedsnavn-felt til siste brukte sted
  const last = observations[observations.length - 1];
  if (last && last.placeName) {
    currentPlaceName = last.placeName;
    if (placeInput) {
      placeInput.value = currentPlaceName;
      placeInput.dataset.autofilled = 'false';
    }
  }
}

// ============================================================
// Rendering av søkeresultater
// ============================================================
function renderResults() {
  resultsEl.innerHTML = '';

  if (!currentResults.length) {
    resultCount.textContent = '0 treff';
    return;
  }

  currentResults.forEach((item, index) => {
    const div = document.createElement('div');
    div.className = 'result-item';
    div.setAttribute('role', 'option');
    if (index === activeIndex) {
      div.setAttribute('aria-selected', 'true');
    }

    const row = document.createElement('div');
    row.className = 'result-name-row';

    // Vis både norsk og latin hvis tilgjengelig
    const nameSpan = document.createElement('span');
    nameSpan.className = 'result-name';
    nameSpan.textContent = item.taxonName || item.norwegian || '(ukjent navn)';
    row.appendChild(nameSpan);

    if (item.scientificName || item.latin) {
      const sciSpan = document.createElement('span');
      sciSpan.className = 'result-sci';
      sciSpan.textContent = item.scientificName || item.latin;
      row.appendChild(sciSpan);
    }

    div.appendChild(row);

    // Sørg for at alle resultater (også underarter/offline) er klikkbare
    div.tabIndex = 0;
    div.addEventListener('click', () => {
      chooseItem(index);
    });
    div.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        chooseItem(index);
      }
    });

    resultsEl.appendChild(div);
  });

  resultCount.textContent = `${currentResults.length} treff`;
}

// ============================================================
// Valg av art
// ============================================================
function chooseItem(index) {
  const item = currentResults[index];
  if (!item) return;

  selectedSpecies = item;
  chosenEl.style.display = 'inline-flex';
  chosenEl.innerHTML = '';

  // Skjul/minimer artsvelgeren
  resultsEl.innerHTML = '';
  resultsEl.style.display = 'none';

  const nameSpan = document.createElement('span');
  nameSpan.textContent = item.taxonName;
  chosenEl.appendChild(nameSpan);

  // Sørg for at artsvelgeren kan vises igjen ved nytt søk
  setTimeout(() => {
    resultsEl.style.display = '';
  }, 200);


  // Aktiver antallsfelt og flytt fokus
  countInput.disabled = false;
  countInput.value = '';
  countInput.focus();
  // Flash antall-feltet tydelig
  countInput.classList.remove('focus-flash');
  void countInput.offsetWidth; // trigger reflow
  countInput.classList.add('focus-flash');

  // Når antall er fylt ut og fokus flyttes til aktivitetsdropdown, flash svakt
  countInput.addEventListener('keydown', function handler(e) {
    if ((e.key === 'Enter' || e.key === 'Tab') && countInput.value.trim()) {
      setTimeout(() => {
        activitySelect.classList.remove('focus-flash');
        void activitySelect.offsetWidth;
        activitySelect.classList.add('focus-flash');
      }, 0);
      countInput.removeEventListener('keydown', handler);
    }
  });

  if (activitySelect) {
    activitySelect.disabled = false;
  }
  if (activitySubmitBtn) {
    activitySubmitBtn.disabled = false;
  }

  // Aktiver avanserte felter
  ageSelect.disabled = false;
  genderSelect.disabled = false;
}
// Oppdater underartsboks og advarsel ut fra offline-modus
function updateSubtaxaCheckboxState() {
  const forceOffline = localStorage.getItem('forceOfflineSpecies') === '1';
  const subtaxaCheckbox = document.getElementById('include-subtaxa');
  const subtaxaWarning = document.getElementById('subtaxa-offline-warning');
  if (subtaxaCheckbox && subtaxaWarning) {
    if (forceOffline) {
      subtaxaCheckbox.checked = false;
      subtaxaCheckbox.disabled = true;
      subtaxaWarning.style.display = 'block';
    } else {
      subtaxaCheckbox.disabled = false;
      subtaxaWarning.style.display = 'none';
    }
  }
}

// ============================================================
// Søk etter arter
// ============================================================
async function fetchResults(term) {
  updateSubtaxaCheckboxState();
  const q = term.trim();

  if (q.length < 2) {
    currentResults = [];
    activeIndex = -1;
    renderResults();
    emptyMsgEl.style.display = q.length ? 'block' : 'none';
    if (!q.length) emptyMsgEl.textContent = 'Ingen treff ennå. Skriv minst 2 tegn.';
    else emptyMsgEl.textContent = 'Skriv litt mer for å få treff.';
    return;
  }

  updateStatus('loading', 'Søker i Artsobservasjoner …');
  emptyMsgEl.style.display = 'none';

  // Sjekk om tvungen offline-modus er aktivert
  const forceOffline = localStorage.getItem('forceOfflineSpecies') === '1';
  const subtaxaCheckbox = document.getElementById('include-subtaxa');
  const subtaxaWarning = document.getElementById('subtaxa-offline-warning');
  if (forceOffline) {
    if (subtaxaCheckbox) {
      subtaxaCheckbox.checked = false;
      subtaxaCheckbox.disabled = true;
    }
    if (subtaxaWarning) {
      subtaxaWarning.style.display = 'block';
    }
  } else {
    if (subtaxaCheckbox) {
      subtaxaCheckbox.disabled = false;
    }
    if (subtaxaWarning) {
      subtaxaWarning.style.display = 'none';
    }
  }
  if (forceOffline) {
    const includeSubtaxa = document.getElementById('include-subtaxa')?.checked;
    const offline = await searchOfflineSpecies(q, includeSubtaxa);
    currentResults = offline.map(s => ({
      taxonName: s.taxonName,
      scientificName: s.scientificName,
      source: 'offline'
    }));
    activeIndex = currentResults.length ? 0 : -1;
    renderResults();
    emptyMsgEl.style.display = currentResults.length ? 'none' : 'block';
    emptyMsgEl.textContent = currentResults.length
      ? 'Viser offline artsliste (innstilling: kun offline)'
      : 'Ingen treff i offline-listen.';
    updateStatus('idle', 'Klar for søk (offline)');
    return;
  }

  // Timeout for AO-søk (10 sekunder)
  function withTimeout(promise, ms) {
    return Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))
    ]);
  }

  let aoTimedOut = false;
  try {
    // Default: ikke vis underarter (kun hovedarter)
    let includeSubtaxa = false;
    const cb = document.getElementById('include-subtaxa');
    if (cb && cb.checked) includeSubtaxa = true;
    const data = await withTimeout(searchSpecies(q, includeSubtaxa), 10000);

    currentResults = data;
    activeIndex = currentResults.length ? 0 : -1;
    renderResults();

    if (!currentResults.length) {
      emptyMsgEl.style.display = 'block';
      emptyMsgEl.textContent = 'Ingen treff fra Artsobservasjoner.';
    }

    updateStatus('idle', 'Klar for søk');
  } catch (err) {
    aoTimedOut = err && err.message === 'timeout';
    if (aoTimedOut) {
      emptyMsgEl.style.display = 'block';
      emptyMsgEl.textContent = 'Ingen svar fra Artsobservasjoner etter 10 sekunder. Du kan bruke offline artsliste fra innstillinger.';
      updateStatus('error', 'Timeout mot AO');
      // Ikke automatisk fallback, men viser melding
      currentResults = [];
      activeIndex = -1;
      renderResults();
      return;
    }
    // Prøv offline fallback ved andre feil
    console.warn('AO-søk feilet, prøver offline fallback:', err);
    const offline = await searchOfflineSpecies(q);
    currentResults = offline.map(s => ({
      taxonName: s.norwegian,
      scientificName: s.latin,
      source: 'offline'
    }));
    activeIndex = currentResults.length ? 0 : -1;
    renderResults();
    emptyMsgEl.style.display = currentResults.length ? 'none' : 'block';
    emptyMsgEl.textContent = currentResults.length
      ? 'Viser offline artsliste (ingen kontakt med Artsobservasjoner)'
      : 'Ingen treff i offline-listen.';
    updateStatus('idle', 'Klar for søk (offline)');
  }
}

// ============================================================
// Registrering av observasjon
// ============================================================
function commitObservationFromActivity() {
  // Valider obligatoriske felt
  const place = (placeInput && placeInput.value.trim()) || currentPlaceName.trim();
  if (!place) {
    showToast('Du må fylle inn sted!');
    if (placeInput) placeInput.focus();
    return;
  }
  if (!selectedSpecies) {
    showToast('Du må velge art!');
    input.focus();
    return;
  }
  const raw = countInput.value.trim();
  const num = parseInt(raw, 10);
  if (!raw || isNaN(num) || num <= 0) {
    showToast('Du må fylle inn antall!');
    countInput.focus();
    return;
  }

  let activity = 'Stasjonær';
  if (activitySelect && !activitySelect.disabled) {
    const opt = activitySelect.options[activitySelect.selectedIndex];
    if (opt && opt.text && opt.text.trim()) {
      activity = opt.text.trim();
    }
  }
  if (!activity || activity === '') {
    showToast('Du må velge aktivitet!');
    activitySelect.focus();
    return;
  }

  // Hent alder og kjønn
  let age = ageSelect.value || '';
  let gender = genderSelect.value || '';

  observations.unshift({
    species: selectedSpecies,
    count: num,
    position: currentPosition,
    activity,
    placeName: place,
    timestamp: new Date().toISOString(),
    age,
    gender,
    coObservers: defaultCoObservers(),
  });

  doRenderObservations();
  saveState();

  // Nullstill valgt art
  const artNavnToast = selectedSpecies.taxonName;
  selectedSpecies = null;
  // Flash valgt art før den skjules
  chosenEl.classList.remove('focus-flash');
  void chosenEl.offsetWidth;
  chosenEl.classList.add('focus-flash');
  setTimeout(() => {
    chosenEl.style.display = 'none';
  }, 250);
  countInput.value = '';
  countInput.disabled = true;

  if (activitySelect) {
    activitySelect.disabled = true;
  }

  // Deaktiver avanserte felter og nullstill verdier
  ageSelect.disabled = true;
  genderSelect.disabled = true;
  ageSelect.value = '';
  genderSelect.value = '';

  if (activitySubmitBtn) {
    activitySubmitBtn.disabled = true;
  }

  // Tøm søkefeltet og resultater
  input.value = '';
  currentResults = [];
  activeIndex = -1;
  renderResults();

  showToast(artNavnToast);
  input.focus();
  input.select();
  // Flash artsvelgeren svakt ved programmatisk fokus
  input.classList.remove('focus-flash');
  void input.offsetWidth;
  input.classList.add('focus-flash');
}

// ============================================================
// Render observasjoner med riktige referanser
// ============================================================
function doRenderObservations() {
  const buttons = { exportBtn, copyBtn, copyOpenBtn, clearBtn };
  renderObservations(observations, obsListEl, buttons, saveState);
}

// ============================================================
// CSV-eksport og kopiering
// ============================================================
function handleExport() {
  const csv = toCsv(observations);
  if (!csv) return;

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'fugleobservasjoner.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  flashButton(exportBtn, 'Lastet ned!');
}

async function handleCopy() {
  const csv = toCsv(observations);
  if (!csv) return;

  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(csv);
    } else {
      const ta = document.createElement('textarea');
      ta.value = csv;
      ta.style.position = 'fixed';
      ta.style.top = '-1000px';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      try {
        document.execCommand('copy');
      } finally {
        document.body.removeChild(ta);
      }
    }
    flashButton(copyBtn, 'Kopiert!');
  } catch (e) {
    console.warn('Kunne ikke kopiere CSV til utklippstavlen', e);
  }
}

async function handleCopyAndOpen() {
  const csv = toCsv(observations);
  if (!csv) return;

  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(csv);
    } else {
      const ta = document.createElement('textarea');
      ta.value = csv;
      ta.style.position = 'fixed';
      ta.style.top = '-1000px';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      try {
        document.execCommand('copy');
      } finally {
        document.body.removeChild(ta);
      }
    }

    // Åpne AO import-side i ny fane
    window.open('https://www.artsobservasjoner.no/ImportSighting', '_blank');
    flashButton(copyOpenBtn, 'Åpnet!');
  } catch (e) {
    console.warn('Kunne ikke kopiere CSV til utklippstavlen', e);
  }
}

function handleClear() {
  if (!observations.length) return;
  const ok = window.confirm('Slette alle observasjoner i listen?');
  if (!ok) return;
  observations.splice(0, observations.length);
  doRenderObservations();
  saveState();
}

// ============================================================
// Aktivitets-pills (hurtigvalg)
// ============================================================
function renderActivityPills() {
  if (!activityPillsEl) return;
  activityPillsEl.innerHTML = '';

  // De 4 faste hurtig-pills (bruker div for å unngå iOS form accessory bar)
  COMMON_ACTIVITIES.forEach(act => {
    const pill = document.createElement('div');
    pill.className = 'activity-pill';
    pill.textContent = act;
    pill.role = 'button';
    pill.addEventListener('click', () => {
      // Sett dropdown til denne aktiviteten
      if (activitySelect) {
        for (let i = 0; i < activitySelect.options.length; i++) {
          if (activitySelect.options[i].text === act) {
            activitySelect.selectedIndex = i;
            break;
          }
        }
      }
      commitObservationFromActivity();
    });
    activityPillsEl.appendChild(pill);
  });
}

// ============================================================
// Oppsett av event listeners
// ============================================================
function setupEventListeners() {
    // Vis underarter: oppdater søk når checkboksen endres
    const includeSubtaxaCheckbox = document.getElementById('include-subtaxa');
    if (includeSubtaxaCheckbox) {
      includeSubtaxaCheckbox.addEventListener('change', () => {
        fetchResults(input.value);
      });
    }
  // Progressiv flyt: oppdater seksjonstilstand ved input
  if (placeInput) {
    placeInput.addEventListener('input', updateSectionStates);
  }
  if (countInput) {
    countInput.addEventListener('input', updateSectionStates);
  }
  if (input) {
    input.addEventListener('input', updateSectionStates);
  }
  // Stedsnavn-input
  if (placeInput) {
    placeInput.addEventListener('input', () => {
      currentPlaceName = placeInput.value;
      placeInput.dataset.autofilled = 'false';
    });
  }

  // Søkefelt
  input.addEventListener('input', () => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
      fetchResults(input.value);
    }, 300);
  });

  // Tastaturnavigering i søkefeltet
  input.addEventListener('keydown', (e) => {
    if (!currentResults.length) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeIndex = (activeIndex + 1) % currentResults.length;
      renderResults();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeIndex = (activeIndex - 1 + currentResults.length) % currentResults.length;
      renderResults();
    } else if (e.key === 'Enter') {
      if (activeIndex >= 0) {
        e.preventDefault();
        chooseItem(activeIndex);
      }
    }
  });

  // Antallsfelt: Enter går til første pill, tall 1-5 velger og registrerer
  // Antallsfelt: Enter går til aktivitet
  countInput.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    if (!selectedSpecies) return;

    const raw = countInput.value.trim();
    const num = parseInt(raw, 10);
    if (!raw || isNaN(num) || num <= 0) {
      return;
    }

    if (activitySelect && !activitySelect.disabled) {
      activitySelect.focus();
    }
  });

  // Aktivitetsknapp
  if (activitySubmitBtn) {
    activitySubmitBtn.addEventListener('click', () => {
      commitObservationFromActivity();
    });
  }

  // Aktivitets-select
  if (activitySelect) {
    activitySelect.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        commitObservationFromActivity();
      }
    });

    // På mobil/touch: lagre automatisk ved valg
    const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    if (isTouchDevice) {
      activitySelect.addEventListener('change', () => {
        commitObservationFromActivity();
      });
    }
  }

  // Kart-knapp
  if (locMapBtn) {
    locMapBtn.addEventListener('click', () => {
      openMap(currentPosition);
    });
  }

  // AO-størrelse input
  if (aoSizeInput) {
    const initial = parseFloat(aoSizeInput.value);
    if (!isNaN(initial) && initial > 0) {
      currentAoSizeMeters = initial;
    }
    aoSizeInput.addEventListener('input', () => {
      const v = parseFloat(aoSizeInput.value);
      if (isNaN(v) || v <= 0) return;
      currentAoSizeMeters = v;
    });
  }

  // Eksport-knapper
  if (exportBtn) {
    exportBtn.addEventListener('click', handleExport);
  }
  if (copyBtn) {
    copyBtn.addEventListener('click', handleCopy);
  }
  if (copyOpenBtn) {
    copyOpenBtn.addEventListener('click', handleCopyAndOpen);
  }
  if (clearBtn) {
    clearBtn.addEventListener('click', handleClear);
  }
}

// ============================================================
// Posisjonshåndtering
// ============================================================
function handlePositionUpdate(position, sites) {
  currentPosition = position;

  // Wrapper for å oppdatere seksjonstilstand etter valg
  function setCurrentPlaceAndUpdate(name) {
    currentPlaceName = name;
    if (placeInput) {
      placeInput.value = name;
      placeInput.dataset.autofilled = 'true';
    }
    updateSectionStates();
  }

  if (sites && sites.length) {
    currentAoSites = setAoSiteSuggestions(
      sites,
      currentPosition,
      aoSitesDropdown,
      aoSitesEl,
      placeInput,
      setCurrentPlaceAndUpdate
    );
  } else {
    currentAoSites = setAoSiteSuggestions(
      [],
      currentPosition,
      aoSitesDropdown,
      aoSitesEl,
      placeInput,
      setCurrentPlaceAndUpdate
    );
  }
  updateSectionStates();
}

// ============================================================
// Initialisering
// ============================================================
async function init() {

  // Last lagret state FØR rendering
  loadState();

  // Nullstill stedsnavn-input KUN hvis ingen lagret plass
  if (placeInput && !placeInput.value) {
    placeInput.value = '';
    currentPlaceName = '';
  }


  // Sett opp event listeners (inkl. underarts-checkbox)
  setupEventListeners();

  // Kjør progressiv seksjonsaktivering ved oppstart
  updateSectionStates();

  // Initialiser geolokasjon
  initLocation(
    { locBtn, locMapBtn, locDot, locText },
    handlePositionUpdate,
    currentAoSizeMeters
  );

  // Vis observasjoner
  doRenderObservations();

  // Last aktiviteter fra JSON
  try {
    const activities = await loadActivities();
    activities.forEach(a => {
      const opt = document.createElement('option');
      opt.value = a.value;
      opt.textContent = a.label;
      if (a.selected) opt.selected = true;
      activitySelect.appendChild(opt);
    });
    // Render hurtig-pills
    renderActivityPills();
  } catch (e) {
    console.error('Kunne ikke laste aktiviteter:', e);
  }

  // Logg sidevisning
  logPageView();
}

// Start appen når DOM er klar
window.addEventListener('DOMContentLoaded', () => {
  updateSubtaxaCheckboxState();
  init();
});
