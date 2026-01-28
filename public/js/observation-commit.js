/**
 * Observasjons-modul for validering, lagring og aktivitets-pills
 */

import { defaultCoObservers } from './storage.js';
import { showToast } from './ui.js';

const ALL_ACTIVITY_PILLS = ['Stasjonær', 'Rastende', 'Overflygende', 'Næringssøkende', 'Trekkende', 'Sang/spill'];
const DEFAULT_PILL_COUNT = 4;

/**
 * Hent timestamp for observasjon basert på modus
 * @returns {string} ISO timestamp
 */
function getObservationTimestamp() {
  const isAfterMode = localStorage.getItem('afterRegistrationMode') === '1';

  if (!isAfterMode) {
    // Feltmodus: bruk nå
    return new Date().toISOString();
  }

  // Etterregistreringsmodus: bruk valgt dato/tid
  const dateInput = document.getElementById('obs-date');
  const timeInput = document.getElementById('obs-time');

  if (!dateInput || !dateInput.value) {
    // Fallback til nå hvis dato mangler
    return new Date().toISOString();
  }

  const dateStr = dateInput.value; // "2026-01-28"
  const timeStr = timeInput && timeInput.value ? timeInput.value : '00:00'; // Midnatt hvis ikke oppgitt

  const combined = `${dateStr}T${timeStr}:00`; // "2026-01-28T14:30:00" eller "2026-01-28T00:00:00"
  const d = new Date(combined);

  if (isNaN(d.getTime())) {
    // Ugyldig dato - fallback til nå
    return new Date().toISOString();
  }

  return d.toISOString();
}

function getActivityPillCount() {
  const stored = localStorage.getItem('activityPillCount');
  if (stored) {
    const num = parseInt(stored, 10);
    if (num >= 1 && num <= 6) return num;
  }
  return DEFAULT_PILL_COUNT;
}

function getActivePills() {
  return ALL_ACTIVITY_PILLS.slice(0, getActivityPillCount());
}

export function commitObservation(state, dom, callbacks) {
  const place = (dom.placeInput && dom.placeInput.value.trim()) || state.currentPlaceName.trim();
  if (!place) {
    showToast('Du må fylle inn sted!');
    if (dom.placeInput) dom.placeInput.focus();
    return;
  }
  if (!state.selectedSpecies) {
    showToast('Du må velge art!');
    dom.input.focus();
    return;
  }
  const raw = dom.countInput.value.trim();
  const num = parseInt(raw, 10);
  if (!raw || isNaN(num) || num <= 0) {
    showToast('Du må fylle inn antall!');
    dom.countInput.focus();
    return;
  }

  let activity = 'Stasjonær';
  if (dom.activitySelect && !dom.activitySelect.disabled) {
    const opt = dom.activitySelect.options[dom.activitySelect.selectedIndex];
    if (opt && opt.text && opt.text.trim()) {
      activity = opt.text.trim();
    }
  }
  if (!activity || activity === '') {
    showToast('Du må velge aktivitet!');
    dom.activitySelect.focus();
    return;
  }

  let age = dom.ageSelect.value || '';
  let gender = dom.genderSelect.value || '';

  state.observations.unshift({
    species: state.selectedSpecies,
    count: num,
    position: state.currentPosition,
    activity,
    placeName: place,
    timestamp: getObservationTimestamp(),
    age,
    gender,
    coObservers: defaultCoObservers(),
  });

  callbacks.doRenderObservations();
  callbacks.saveState();

  const artNavnToast = state.selectedSpecies.taxonName;
  state.selectedSpecies = null;
  dom.countInput.value = '';
  dom.countInput.disabled = true;

  if (dom.activitySelect) {
    dom.activitySelect.disabled = true;
  }

  dom.ageSelect.disabled = true;
  dom.genderSelect.disabled = true;
  dom.ageSelect.value = '';
  dom.genderSelect.value = '';

  if (dom.activitySubmitBtn) {
    dom.activitySubmitBtn.disabled = true;
  }

  dom.input.value = '';
  dom.input.classList.remove('species-selected');
  state.currentResults = [];
  state.activeIndex = -1;
  callbacks.renderResults();

  showToast(artNavnToast);
  dom.input.focus();
  dom.input.select();
  dom.input.classList.remove('focus-flash');
  void dom.input.offsetWidth;
  dom.input.classList.add('focus-flash');

  callbacks.updateSectionStates();
}

export function renderActivityPills(dom, commitFn) {
  if (!dom.activityPillsEl) return;
  dom.activityPillsEl.innerHTML = '';

  getActivePills().forEach(act => {
    const pill = document.createElement('div');
    pill.className = 'activity-pill';
    pill.textContent = act;
    pill.role = 'button';
    pill.addEventListener('click', () => {
      if (dom.activitySelect) {
        for (let i = 0; i < dom.activitySelect.options.length; i++) {
          if (dom.activitySelect.options[i].text === act) {
            dom.activitySelect.selectedIndex = i;
            break;
          }
        }
      }
      commitFn();
    });
    dom.activityPillsEl.appendChild(pill);
  });
}
