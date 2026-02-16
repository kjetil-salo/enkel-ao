/**
 * Main entry point for fugleobservasjoner app
 * Koordinerer alle moduler og setter opp event listeners
 */

// Eksisterende moduler
import { logPageView, loadActivities } from './api.js';
import { loadObservations, saveObservations, loadAoSearchRadius, saveAoSearchRadius } from './storage.js';
import { setStatus, setLocationStatus } from './ui.js';
import { setAoSiteSuggestions, initLocation, openMap, openMapPage } from './location.js';
import { renderObservations } from './observations.js';

// Nye moduler
import { updateSectionStates, pulseSearchFieldAndFocus } from './form-state.js';
import { fetchResults, renderResults, chooseItem, updateSubtaxaCheckboxState } from './species-search.js';
import { commitObservation, renderActivityPills } from './observation-commit.js';
import { handleExport, handleCopy, handleCopyAndOpen, handleClear } from './export-operations.js';
import { initAutocomplete } from './autocomplete.js';

// ============================================================
// Applikasjonstilstand
// ============================================================
const appState = {
  currentResults: [],
  activeIndex: -1,
  debounceTimer: null,
  selectedSpecies: null,
  searchPulseTimeout: null,
  observations: [],
  currentPosition: null,
  currentPlaceName: '',
  currentPlaceId: null,
  currentAoSites: [],
  currentAoSizeMeters: 1000,
  _callbacks: null, // settes i init()
};

// Autocomplete cleanup-funksjon (kun aktivt i etterregistreringsmodus)
let autocompleteCleanup = null;

// ============================================================
// DOM-elementreferanser
// ============================================================
const dom = {
  input: document.getElementById('search'),
  resultsEl: document.getElementById('results'),
  emptyMsgEl: document.getElementById('empty-msg'),
  statusDot: document.getElementById('status-dot'),
  statusText: document.getElementById('status-text'),
  resultCount: document.getElementById('result-count'),
  countInput: document.getElementById('count'),
  activitySelect: document.getElementById('activity'),
  activitySubmitBtn: document.getElementById('activity-submit'),
  activityPillsEl: document.getElementById('activity-pills'),
  obsListEl: document.getElementById('obs-list'),
  exportBtn: document.getElementById('export-btn'),
  copyBtn: document.getElementById('copy-btn'),
  copyOpenBtn: document.getElementById('copy-open-btn'),
  clearBtn: document.getElementById('clear-btn'),
  locDot: document.getElementById('loc-dot'),
  locText: document.getElementById('loc-text'),
  locMapBtn: document.getElementById('loc-map-btn'),
  locBtn: document.getElementById('loc-btn'),
  placeInput: document.getElementById('place'),
  aoSitesEl: document.getElementById('ao-sites'),
  aoSitesDropdown: document.getElementById('ao-sites-dropdown'),
  aoSizeInput: document.getElementById('ao-size'),
  sectionLokasjon: document.querySelector('.section-main:nth-of-type(1)'),
  sectionObservasjon: document.querySelector('.section-main:nth-of-type(2)'),
  sectionAktivitet: document.querySelector('.row .activity-input-row'),
  ageSelect: document.getElementById('age'),
  genderSelect: document.getElementById('gender'),
};

// ============================================================
// Callbacks-objekt (unngår sirkulære imports)
// ============================================================
const callbacks = {
  updateSectionStates: () => updateSectionStates(appState, dom),
  updateStatus: (mode, text, html) => setStatus(dom.statusDot, dom.statusText, mode, text, html),
  updateLocationStatus: (mode, text) => setLocationStatus(dom.locDot, dom.locText, mode, text),
  doRenderObservations,
  saveState,
  renderResults: () => renderResults(appState, dom),
};
appState._callbacks = callbacks;

// ============================================================
// Korte wrappere
// ============================================================
function saveState() {
  saveObservations(appState.observations);
}

function loadState() {
  const loaded = loadObservations();
  appState.observations.splice(0, appState.observations.length);
  loaded.forEach(o => appState.observations.push(o));

  const last = appState.observations[appState.observations.length - 1];
  if (last && last.placeName) {
    appState.currentPlaceName = last.placeName;
    if (dom.placeInput) {
      dom.placeInput.value = appState.currentPlaceName;
      dom.placeInput.dataset.autofilled = 'false';
    }
  }
}

function doRenderObservations() {
  const buttons = { exportBtn: dom.exportBtn, copyBtn: dom.copyBtn, copyOpenBtn: dom.copyOpenBtn, clearBtn: dom.clearBtn };
  renderObservations(appState.observations, dom.obsListEl, buttons, saveState);
}

function commitFromActivity() {
  commitObservation(appState, dom, callbacks);
}

// ============================================================
// Posisjonshåndtering
// ============================================================
function handlePositionUpdate(position, sites) {
  appState.currentPosition = position;

  function setCurrentPlaceAndUpdate(name, siteId = null) {
    appState.currentPlaceName = name;
    appState.currentPlaceId = siteId;
    if (dom.placeInput) {
      dom.placeInput.value = name;
      dom.placeInput.dataset.autofilled = 'true';
    }
    updateSectionStates(appState, dom);
    pulseSearchFieldAndFocus(appState, dom);
  }

  appState.currentAoSites = setAoSiteSuggestions(
    (sites && sites.length) ? sites : [],
    appState.currentPosition,
    dom.aoSitesDropdown,
    dom.aoSitesEl,
    dom.placeInput,
    setCurrentPlaceAndUpdate
  );
  updateSectionStates(appState, dom);
  updateMapBtnVisibility();
}

// ============================================================
// Event listeners
// ============================================================
function setupEventListeners() {
  const includeSubtaxaCheckbox = document.getElementById('include-subtaxa');
  if (includeSubtaxaCheckbox) {
    includeSubtaxaCheckbox.addEventListener('change', () => {
      fetchResults(dom.input.value, appState, dom, callbacks);
    });
  }

  if (dom.placeInput) {
    dom.placeInput.addEventListener('input', () => {
      appState.currentPlaceName = dom.placeInput.value;
      appState.currentPlaceId = null; // Nullstill ID når brukeren skriver manuelt
      dom.placeInput.dataset.autofilled = 'false';
      updateSectionStates(appState, dom);
    });
  }
  if (dom.countInput) {
    dom.countInput.addEventListener('input', () => updateSectionStates(appState, dom));
  }
  if (dom.input) {
    dom.input.addEventListener('input', () => updateSectionStates(appState, dom));
  }

  // Søkefelt
  dom.input.addEventListener('input', () => {
    // Ved første tastetrykk etter registrering - nullstill state
    // IKKE tøm feltet - .select() gjør at første tastetrykk automatisk erstatter teksten
    if (dom.input.dataset.pendingClear === 'true') {
      dom.input.dataset.pendingClear = 'false';
      appState.selectedSpecies = null;
      dom.input.classList.remove('species-selected');
    }

    if (appState.searchPulseTimeout) {
      clearTimeout(appState.searchPulseTimeout);
      appState.searchPulseTimeout = null;
    }
    dom.input.classList.remove('field-highlight');

    if (appState.selectedSpecies) {
      appState.selectedSpecies = null;
      dom.input.classList.remove('species-selected');
      dom.countInput.disabled = true;
      dom.countInput.value = '';
      dom.activitySelect.disabled = true;
      dom.activitySubmitBtn.disabled = true;
      dom.ageSelect.disabled = true;
      dom.genderSelect.disabled = true;
    }
    if (appState.debounceTimer) {
      clearTimeout(appState.debounceTimer);
    }
    appState.debounceTimer = setTimeout(() => {
      fetchResults(dom.input.value, appState, dom, callbacks);
    }, 300);
  });

  dom.input.addEventListener('focus', () => {
    // Re-select teksten hvis pendingClear (hvis bruker klikker i stedet for å skrive)
    if (dom.input.dataset.pendingClear === 'true') {
      dom.input.select();
    } else if (appState.selectedSpecies) {
      dom.input.select();
    }
  });

  dom.input.addEventListener('keydown', (e) => {
    if (!appState.currentResults.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      appState.activeIndex = (appState.activeIndex + 1) % appState.currentResults.length;
      renderResults(appState, dom);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      appState.activeIndex = (appState.activeIndex - 1 + appState.currentResults.length) % appState.currentResults.length;
      renderResults(appState, dom);
    } else if (e.key === 'Enter') {
      if (appState.activeIndex >= 0) {
        e.preventDefault();
        chooseItem(appState.activeIndex, appState, dom, callbacks);
      }
    }
  });

  dom.countInput.addEventListener('keydown', (e) => {
    // Tillat kun sifre, navigasjon og kontrolltaster
    const allowed = ['Backspace', 'Delete', 'Tab', 'Enter', 'ArrowLeft', 'ArrowRight', 'Home', 'End'];
    if (!allowed.includes(e.key) && !e.ctrlKey && !e.metaKey && !/^[0-9]$/.test(e.key)) {
      e.preventDefault();
      return;
    }
    if (e.key !== 'Enter') return;
    if (!appState.selectedSpecies) return;
    const raw = dom.countInput.value.trim();
    const num = parseInt(raw, 10);
    if (!raw || isNaN(num) || num <= 0) return;
    if (dom.activitySelect && !dom.activitySelect.disabled) {
      dom.activitySelect.focus();
    }
  });

  if (dom.activitySubmitBtn) {
    dom.activitySubmitBtn.addEventListener('click', commitFromActivity);
  }

  if (dom.activitySelect) {
    dom.activitySelect.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') commitFromActivity();
    });
    // Fjernet auto-commit ved dropdown-endring - bruker må klikke grønn knapp
    // Pills (hurtigvalg) lagrer fortsatt umiddelbart
  }

  if (dom.locMapBtn) {
    dom.locMapBtn.style.display = 'none'; // Skjul som default
    dom.locMapBtn.addEventListener('click', () => openMapPage(appState.currentPosition, appState.currentAoSites));
  }




// Oppdater synlighet og stil på kart-ikonet basert på posisjon
function updateMapBtnVisibility() {
  if (!dom.locMapBtn) return;
  if (appState.currentPosition && typeof appState.currentPosition.lat === 'number' && typeof appState.currentPosition.lon === 'number') {
    dom.locMapBtn.style.display = '';
    dom.locMapBtn.style.background = 'var(--accent)';
    dom.locMapBtn.style.color = 'white';
    dom.locMapBtn.style.borderColor = 'var(--accent)';
    dom.locMapBtn.style.boxShadow = '0 0 0 3px #22c55e55, 0 2px 8px rgba(59,130,246,0.18)';
    dom.locMapBtn.style.fontWeight = 'bold';
    dom.locMapBtn.style.fontSize = '1.7em';
    dom.locMapBtn.title = 'Vis posisjon og AO-lokaliteter i kart';
    dom.locMapBtn.classList.add('map-btn-active');
  } else {
    dom.locMapBtn.style.display = 'none';
    dom.locMapBtn.classList.remove('map-btn-active');
  }
}

// Gjør funksjonen globalt tilgjengelig for andre moduler (f.eks. location.js)
window.updateMapBtnVisibility = updateMapBtnVisibility;

  if (dom.aoSizeInput) {
    // Last lagret radius fra localStorage
    const savedRadius = loadAoSearchRadius();
    dom.aoSizeInput.value = savedRadius;
    appState.currentAoSizeMeters = savedRadius;

    dom.aoSizeInput.addEventListener('input', () => {
      const v = parseFloat(dom.aoSizeInput.value);
      if (isNaN(v) || v <= 0) return;
      appState.currentAoSizeMeters = v;
      saveAoSearchRadius(v);
    });
  }

  if (dom.exportBtn) dom.exportBtn.addEventListener('click', () => handleExport(appState.observations, dom));
  if (dom.copyBtn) dom.copyBtn.addEventListener('click', () => handleCopy(appState.observations, dom));
  if (dom.copyOpenBtn) dom.copyOpenBtn.addEventListener('click', () => handleCopyAndOpen(appState.observations, dom));
  if (dom.clearBtn) dom.clearBtn.addEventListener('click', () => handleClear(appState.observations, dom, callbacks));
}

// ============================================================
// Initialisering
// ============================================================
async function init() {
  loadState();

  if (dom.placeInput && !dom.placeInput.value) {
    dom.placeInput.value = '';
    appState.currentPlaceName = '';
  }

  // Sjekk om bruker har valgt lokalitet fra kartet
  const selectedLocation = localStorage.getItem('selectedLocation');
  if (selectedLocation) {
    appState.currentPlaceName = selectedLocation;
    if (dom.placeInput) {
      dom.placeInput.value = selectedLocation;
      dom.placeInput.dataset.autofilled = 'true';
    }
    // Fjern fra localStorage etter bruk
    localStorage.removeItem('selectedLocation');
  }

  setupEventListeners();
  updateSectionStates(appState, dom);

  // Hvis lokalitet ble valgt fra kart, sett fokus på art-feltet
  if (selectedLocation) {
    pulseSearchFieldAndFocus(appState, dom);
  }

  initLocation(
    { locBtn: dom.locBtn, locMapBtn: dom.locMapBtn, locDot: dom.locDot, locText: dom.locText },
    handlePositionUpdate,
    appState.currentAoSizeMeters
  );

  doRenderObservations();

  try {
    const activities = await loadActivities();
    activities.forEach(a => {
      const opt = document.createElement('option');
      opt.value = a.value;
      opt.textContent = a.label;
      if (a.selected) opt.selected = true;
      dom.activitySelect.appendChild(opt);
    });
    renderActivityPills(dom, commitFromActivity);
  } catch (e) {
    console.error('Kunne ikke laste aktiviteter:', e);
  }

  logPageView();
}

/**
 * Oppdater UI for modus-pill (Felt vs Etterregistrering)
 */
function updateModeUI() {
  const modePill = document.getElementById('mode-pill');
  const datetimeFields = document.getElementById('datetime-fields');
  const obsDateInput = document.getElementById('obs-date');
  const obsTimeInput = document.getElementById('obs-time');

  // GPS-relaterte rader
  const locStatusRow = document.getElementById('loc-status-row');
  const gpsControlsRow = document.getElementById('gps-controls-row');
  const aoSitesDropdown = document.getElementById('ao-sites-dropdown');

  if (!modePill || !datetimeFields) return;

  const isAfterMode = localStorage.getItem('afterRegistrationMode') === '1';

  if (isAfterMode) {
    modePill.textContent = 'Etterregistrering';
    modePill.className = 'pill mode-pill after-mode';
    datetimeFields.style.display = 'block';

    // Skjul GPS-relaterte rader
    if (locStatusRow) locStatusRow.style.display = 'none';
    if (gpsControlsRow) gpsControlsRow.style.display = 'none';
    if (aoSitesDropdown) aoSitesDropdown.style.display = 'none';

    // Aktiver autocomplete på stedsnavn-felt
    if (dom.placeInput && !autocompleteCleanup) {
      autocompleteCleanup = initAutocomplete(dom.placeInput, (name, id) => {
        appState.currentPlaceName = name;
        appState.currentPlaceId = id;
        dom.placeInput.dataset.autofilled = 'true';
        updateSectionStates(appState, dom);
      });
    }

    // Sett dagens dato som default
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    if (obsDateInput) obsDateInput.value = `${yyyy}-${mm}-${dd}`;
    if (obsTimeInput) obsTimeInput.value = ''; // Ingen tid som default
    const obsTimeToInput = document.getElementById('obs-time-to');
    if (obsTimeToInput) obsTimeToInput.value = ''; // Clear "til"-tid
  } else {
    modePill.textContent = 'Felt';
    modePill.className = 'pill mode-pill field-mode';
    datetimeFields.style.display = 'none';

    // Deaktiver autocomplete
    if (autocompleteCleanup) {
      autocompleteCleanup();
      autocompleteCleanup = null;
    }

    // Vis GPS-relaterte rader
    if (locStatusRow) locStatusRow.style.display = 'flex';
    if (gpsControlsRow) gpsControlsRow.style.display = 'flex';
    // aoSitesDropdown styres av egen logikk
  }
}

/**
 * Setup modus-toggle event listener
 */
function setupModeToggle() {
  const modePill = document.getElementById('mode-pill');
  if (!modePill) return;

  modePill.addEventListener('click', () => {
    const current = localStorage.getItem('afterRegistrationMode') === '1';
    if (current) {
      localStorage.removeItem('afterRegistrationMode');
    } else {
      localStorage.setItem('afterRegistrationMode', '1');
    }
    updateModeUI();
  });
}

window.addEventListener('DOMContentLoaded', () => {
  updateSubtaxaCheckboxState();
  init();
  updateMapBtnVisibility();
  updateModeUI();
  setupModeToggle();
});
