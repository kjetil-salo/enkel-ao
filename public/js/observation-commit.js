/**
 * Observasjons-modul for validering, lagring og aktivitets-pills
 */

import { defaultCoObservers, loadActivityPills } from './storage.js';
import { showToast } from './ui.js';
import { toLocalISOString } from './utils.js';

function getObservationTimestamp() {
  const isAfterMode = localStorage.getItem('afterRegistrationMode') === '1';

  if (!isAfterMode) {
    // Feltmodus: bruk nå (lokal tid)
    return toLocalISOString(new Date());
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
    // Ugyldig dato - fallback til nå (lokal tid)
    return toLocalISOString(new Date());
  }

  return toLocalISOString(d);
}

function getObservationTimestampTo() {
  const isAfterMode = localStorage.getItem('afterRegistrationMode') === '1';

  if (!isAfterMode) {
    // Feltmodus: returner null (ingen "til"-tid)
    return null;
  }

  const dateInput = document.getElementById('obs-date');
  const timeInputTo = document.getElementById('obs-time-to');

  // Hvis "til"-tid ikke er fylt ut, returner null
  if (!timeInputTo || !timeInputTo.value || !dateInput || !dateInput.value) {
    return null;
  }

  const dateStr = dateInput.value;
  const timeStr = timeInputTo.value;

  const combined = `${dateStr}T${timeStr}:00`;
  const d = new Date(combined);

  if (isNaN(d.getTime())) {
    return null;
  }

  return d.toISOString();
}

function getActivePills() {
  const pills = loadActivityPills();
  return pills.map(p => p.label); // Returner kun labels
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

  const tilKlokkeslett = getObservationTimestampTo();
  const obs = {
    species: state.selectedSpecies,
    count: num,
    position: state.currentPosition,
    activity,
    placeName: place,
    placeId: state.currentPlaceId || null,
    timestamp: getObservationTimestamp(),
    age,
    gender,
    coObservers: defaultCoObservers(),
  };

  // Legg til tilKlokkeslett hvis det finnes
  if (tilKlokkeslett) {
    obs.tilKlokkeslett = tilKlokkeslett;
  }

  state.observations.unshift(obs);

  callbacks.doRenderObservations();
  callbacks.saveState();

  const artNavnToast = state.selectedSpecies.taxonName;

  // Behold selectedSpecies for å tillate umiddelbar ny registrering med nytt antall
  // Nullstilles først når bruker begynner å skrive nytt søk
  dom.countInput.value = '1';
  dom.countInput.disabled = false; // Hold aktivert så bruker kan endre antall

  // Lagre sist valgt aktivitet for gjenbruk
  if (dom.activitySelect && activity) {
    localStorage.setItem('lastActivity', activity);
  }

  if (dom.activitySelect) {
    dom.activitySelect.disabled = true;
  }

  dom.ageSelect.disabled = false; // Hold aktivert
  dom.genderSelect.disabled = false; // Hold aktivert
  dom.ageSelect.value = '';
  dom.genderSelect.value = '';

  if (dom.activitySubmitBtn) {
    dom.activitySubmitBtn.disabled = true;
  }

  // Behold både artnavnet OG selectedSpecies - tømmes ved første tastetrykk
  dom.input.dataset.pendingClear = 'true';
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
