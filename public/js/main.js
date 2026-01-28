/**
 * Main entry point for fugleobservasjoner app
 * Koordinerer alle moduler og setter opp event listeners
 */

// Eksisterende moduler
import { logPageView, loadActivities } from './api.js';
import { loadObservations, saveObservations } from './storage.js';
import { setStatus, setLocationStatus } from './ui.js';
import { setAoSiteSuggestions, initLocation, openMap, openMapPage } from './location.js';
import { renderObservations } from './observations.js';

// Nye moduler
import { updateSectionStates, pulseSearchFieldAndFocus } from './form-state.js';
import { fetchResults, renderResults, chooseItem, updateSubtaxaCheckboxState } from './species-search.js';
import { commitObservation, renderActivityPills } from './observation-commit.js';
import { handleExport, handleCopy, handleCopyAndOpen, handleClear } from './export-operations.js';

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
  currentAoSites: [],
  currentAoSizeMeters: 1000,
  _callbacks: null, // settes i init()
};

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

  function setCurrentPlaceAndUpdate(name) {
    appState.currentPlaceName = name;
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
    if (appState.selectedSpecies) {
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
    const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    if (isTouchDevice) {
      dom.activitySelect.addEventListener('change', commitFromActivity);
    }
  }

  if (dom.locMapBtn) {
    dom.locMapBtn.addEventListener('click', () => openMapPage(appState.currentPosition, appState.currentAoSites));
  }

  if (dom.aoSizeInput) {
    const initial = parseFloat(dom.aoSizeInput.value);
    if (!isNaN(initial) && initial > 0) {
      appState.currentAoSizeMeters = initial;
    }
    dom.aoSizeInput.addEventListener('input', () => {
      const v = parseFloat(dom.aoSizeInput.value);
      if (isNaN(v) || v <= 0) return;
      appState.currentAoSizeMeters = v;
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

window.addEventListener('DOMContentLoaded', () => {
  updateSubtaxaCheckboxState();
  init();
});
