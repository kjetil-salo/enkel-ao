/**
 * Main entry point for fugleobservasjoner app
 * Koordinerer alle moduler og setter opp event listeners
 */

// Importer fra moduler
import { searchSpecies, logPageView, loadActivities } from './api.js';
import { loadObservations, saveObservations, defaultCoObservers } from './storage.js';
import { flashButton, showToast, setStatus, setLocationStatus } from './ui.js';
import { setAoSiteSuggestions, initLocation, openMap } from './location.js';
import { renderObservations, toCsv } from './observations.js';

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

// Avanserte felter
const ageSelect = document.getElementById('age');
const genderSelect = document.getElementById('gender');

// ============================================================
// Applikasjonstilstand
// ============================================================
let currentResults = [];
let activeIndex = -1;
let debounceTimer = null;
let selectedSpecies = null;
const observations = [];
let currentPosition = null;
let currentPlaceName = '';
let currentAoSites = [];
let currentAoSizeMeters = 1000;

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

    const nameSpan = document.createElement('span');
    nameSpan.className = 'result-name';
    nameSpan.textContent = item.taxonName || '(ukjent navn)';
    row.appendChild(nameSpan);

    div.appendChild(row);

    div.addEventListener('click', () => {
      chooseItem(index);
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

// ============================================================
// Søk etter arter
// ============================================================
async function fetchResults(term) {
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

  try {
    const includeSubtaxa = document.getElementById('include-subtaxa')?.checked;
    const data = await searchSpecies(q, includeSubtaxa);

    currentResults = data;
    activeIndex = currentResults.length ? 0 : -1;
    renderResults();

    if (!currentResults.length) {
      emptyMsgEl.style.display = 'block';
      emptyMsgEl.textContent = 'Ingen treff fra Artsobservasjoner.';
    }

    updateStatus('idle', 'Klar for søk');
  } catch (err) {
    console.error('Feil ved henting av artsliste', err);
    currentResults = [];
    activeIndex = -1;
    renderResults();
    emptyMsgEl.style.display = 'block';
    emptyMsgEl.textContent = 'Feil ved kontakt med proxy/Artsobservasjoner.';
    updateStatus('error', 'Feil ved søk');
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
  chosenEl.style.display = 'none';
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
// Oppsett av event listeners
// ============================================================
function setupEventListeners() {
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
      if (e.key !== 'Enter') return;
      commitObservationFromActivity();
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

  if (sites && sites.length) {
    currentAoSites = setAoSiteSuggestions(
      sites,
      currentPosition,
      aoSitesDropdown,
      aoSitesEl,
      placeInput,
      (name) => { currentPlaceName = name; }
    );
  } else {
    currentAoSites = setAoSiteSuggestions(
      [],
      currentPosition,
      aoSitesDropdown,
      aoSitesEl,
      placeInput,
      (name) => { currentPlaceName = name; }
    );
  }
}

// ============================================================
// Initialisering
// ============================================================
async function init() {
  // Nullstill stedsnavn-input
  if (placeInput) {
    placeInput.value = '';
    currentPlaceName = '';
  }

  // Sett opp event listeners
  setupEventListeners();

  // Initialiser geolokasjon
  initLocation(
    { locBtn, locMapBtn, locDot, locText },
    handlePositionUpdate,
    currentAoSizeMeters
  );

  // Last lagret state
  loadState();

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
  } catch (e) {
    console.error('Kunne ikke laste aktiviteter:', e);
  }

  // Logg sidevisning
  logPageView();
}

// Start appen når DOM er klar
window.addEventListener('DOMContentLoaded', init);
