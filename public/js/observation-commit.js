/**
 * Observasjons-modul for validering, lagring og aktivitets-pills
 */

import { defaultCoObservers, loadActivityPills } from './storage.js';
import { showToast } from './ui.js';
import { toLocalISOString } from './utils.js';
import { resolveVisitIdForNewObservation, getVisitTimeSpan, isVisitLocked, visitExists } from './visits.js';
import { celebrateRareFind } from './celebrate.js';

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
    return toLocalISOString(new Date());
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

  return toLocalISOString(d);
}

function getActivePills() {
  return loadActivityPills(); // Fulle objekter {label, value, short?}
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

  const isAfterMode = localStorage.getItem('afterRegistrationMode') === '1';
  const now = new Date();

  let timestamp = getObservationTimestamp();
  let tilKlokkeslett = getObservationTimestampTo();

  // «Gå tilbake til dette besøket» (↩ i gruppeoverskrifta i ③): observasjonen
  // hører hjemme i akkurat det besøket, ikke i et nytt. Den arver besøkets
  // tidsspenn (fra–til), fordi man vet at arten ble sett i løpet av besøket,
  // ikke nøyaktig når. Er besøket ett enkelt tidspunkt, blir det ingen til-tid.
  //
  // Dette overstyrer bevisst låsen: 🔒 hindrer at nye observasjoner *automatisk*
  // havner i et avsluttet besøk, men ↩ er et eksplisitt valg om nettopp det.
  // Da må obsen også arve låsen, ellers ville gruppa stille låse seg opp igjen
  // (gruppa regnes som låst bare når alle obsene i den er det).
  const etterreg = state.etterregVisitKey
    && visitExists(state.observations, state.etterregVisitKey);

  let visitId;
  let visitLocked = false;

  if (etterreg) {
    visitId = state.etterregVisitKey;
    visitLocked = isVisitLocked(state.observations, visitId);
    const span = getVisitTimeSpan(state.observations, visitId);
    if (span) {
      timestamp = span.fra;
      tilKlokkeslett = span.til;
    }
  } else {
    visitId = resolveVisitIdForNewObservation(
      state.observations, place, state.currentPlaceId || null, new Date(timestamp));
  }

  // Valider tidene som faktisk blir lagret — ikke skjemaets. Sto klokka i
  // skjemaet frem i tid mens man etterregistrerte inn i et besøk, ble
  // registreringen ellers avvist for en tid som aldri kom til å bli brukt.
  if (isAfterMode && new Date(timestamp) > now) {
    showToast('Fra-tidspunkt er frem i tid — AO underkjenner observasjonen');
    return;
  }
  if (tilKlokkeslett && new Date(tilKlokkeslett) > now) {
    showToast('Til-tidspunkt er frem i tid — AO underkjenner observasjonen');
    return;
  }

  const obs = {
    species: state.selectedSpecies,
    count: num,
    position: state.currentPosition,
    activity,
    placeName: place,
    placeId: state.currentPlaceId || null,
    visitId,
    visitLocked,
    timestamp,
    age,
    gender,
    coObservers: defaultCoObservers(),
  };

  // Kommentar: fritekst fra flere felt-modalen, med «Estimert antal» lagt til på slutten
  // hvis ca-boksen er hukket av (kan begge være satt samtidig).
  let comment = (dom.extraComment && dom.extraComment.value.trim()) || '';
  if (dom.countEstimatedCheckbox && dom.countEstimatedCheckbox.checked) {
    comment = comment ? `${comment}. Estimert antal` : 'Estimert antal';
  }
  if (comment) obs.comment = comment;

  // Flere felt-modalen (✎-knappen i ② Observasjon) — sjeldent brukte AO-felt.
  // Kun satt når faktisk huket av/utfylt, samme sparsomme mønster som obs.comment over.
  if (dom.extraUncertain && dom.extraUncertain.checked) obs.uncertain = true;
  if (dom.extraNotSpontaneous && dom.extraNotSpontaneous.checked) obs.notSpontaneous = true;
  if (dom.extraInteresting && dom.extraInteresting.checked) obs.interesting = true;
  if (dom.extraNotRefound && dom.extraNotRefound.checked) obs.notRefound = true;
  if (dom.extraNotFound && dom.extraNotFound.checked) obs.notFound = true;
  if (dom.extraHideUntil && dom.extraHideUntil.value) {
    obs.hideUntil = dom.extraHideUntil.value;
  }
  if (dom.extraPrivateComment && dom.extraPrivateComment.value.trim()) {
    obs.privateComment = dom.extraPrivateComment.value.trim();
  }
  if (dom.extraPhotoValue && dom.extraPhotoValue.value) {
    obs.photo = dom.extraPhotoValue.value;
  }

  // Sjeldenhetsvarsel: fanger boksens innhold på registreringstidspunktet —
  // ellers er AOs advarsel usynlig igjen så snart neste art skrives inn.
  // AO garanterer ikke at Warning har en Header (kan i teorien være tom med
  // kun Body) — krev derfor bare at boksen faktisk vises, ikke at header har tekst.
  const rarityHeaderText = dom.rarityWarningHeader ? dom.rarityWarningHeader.textContent : '';
  const rarityBodyText = dom.rarityWarningBody ? dom.rarityWarningBody.textContent : '';
  let celebratedRareFind = false;
  if (dom.rarityWarning && dom.rarityWarning.style.display !== 'none'
      && (rarityHeaderText || rarityBodyText)) {
    obs.rarityWarning = {
      header: rarityHeaderText,
      body: rarityBodyText,
    };
    // Rent kosmetisk — skal aldri kunne kaste og ta med seg selve lagringen
    // av observasjonen (unshift/saveState) lenger ned i funksjonen.
    try {
      celebrateRareFind(obs.species.taxonName);
      celebratedRareFind = true;
    } catch (e) {
      // ignorer - fyrverkeriet er ikke kritisk
    }
  }

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
  if (dom.countEstimatedCheckbox) dom.countEstimatedCheckbox.checked = false;

  // Nullstill flere felt-modalen — feltene gjelder kun én registrering
  if (dom.extraUncertain) dom.extraUncertain.checked = false;
  if (dom.extraNotSpontaneous) dom.extraNotSpontaneous.checked = false;
  if (dom.extraInteresting) dom.extraInteresting.checked = false;
  if (dom.extraNotRefound) dom.extraNotRefound.checked = false;
  if (dom.extraNotFound) dom.extraNotFound.checked = false;
  if (dom.extraHideUntil) dom.extraHideUntil.value = '';
  if (dom.extraPrivateComment) dom.extraPrivateComment.value = '';
  if (dom.extraComment) dom.extraComment.value = '';
  // Modalens egen inline-script (index.html) oppdaterer knappens badge ved dette eventet.
  document.dispatchEvent(new CustomEvent('obs:extra-felt-nullstilt'));

  if (dom.activitySubmitBtn) {
    dom.activitySubmitBtn.disabled = true;
  }

  // Behold både artnavnet OG selectedSpecies - tømmes ved første tastetrykk
  dom.input.dataset.pendingClear = 'true';
  state.currentResults = [];
  state.activeIndex = -1;
  callbacks.renderResults();

  // Ved sjeldent funn dekker den store feiringsbanneren («Sjeldent funn: X!»)
  // allerede både registrerings-bekreftelsen og sjeldenheten — den vanlige
  // toasten ville bare krasjet visuelt med den (begge sentrert på skjermen).
  if (!celebratedRareFind) {
    showToast(artNavnToast);
  }
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

  getActivePills().forEach(p => {
    const label = p.label;
    const short = (p.short || '').trim();
    const display = short || label;

    const pill = document.createElement('div');
    pill.className = 'activity-pill';
    pill.textContent = display;
    if (display !== label) pill.title = label; // fullt navn ved forkortelse
    pill.role = 'button';
    pill.addEventListener('click', () => {
      if (dom.activitySelect) {
        // Match på fullt navn – kortnavnet er kun visning
        for (let i = 0; i < dom.activitySelect.options.length; i++) {
          if (dom.activitySelect.options[i].text === label) {
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
