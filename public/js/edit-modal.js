/**
 * «✎ Rediger observasjon»-modalen i observasjonslisten (③). Erstatter tidligere
 * navigering til edit.html — samme felt, men vises som modal over index.html i
 * stedet for en egen side. Gjenbruker photo-picker.js og coobserver-picker.js,
 * som også brukes av registrerings-modalen (✎ Flere felt i ②).
 */
import { saveObservations, lastSaveError } from './storage.js';
import { initPhotoPicker } from './photo-picker.js';
import { initCoObserverPicker } from './coobserver-picker.js';
import { isoToDate, isoToTime, updateDateTimeInIso } from './datetime-helpers.js';

let els = null;
let photoPicker = null;
let coObserverPicker = null;
let activitiesPromise = null;
let currentObservations = null;
let currentIdx = null;
let currentOnSaved = null;

function isOpen() {
  return !!(els && els.modal.style.display === 'flex');
}

function queryEls() {
  return {
    modal: document.getElementById('observation-edit-modal'),
    form: document.getElementById('em-form'),
    species: document.getElementById('em-species'),
    count: document.getElementById('em-count'),
    activity: document.getElementById('em-activity'),
    age: document.getElementById('em-age'),
    gender: document.getElementById('em-gender'),
    place: document.getElementById('em-place'),
    date: document.getElementById('em-date'),
    timeFrom: document.getElementById('em-time-from'),
    timeTo: document.getElementById('em-time-to'),
    comment: document.getElementById('em-comment'),
    hideUntil: document.getElementById('em-hide-until'),
    uncertain: document.getElementById('em-uncertain'),
    notSpontaneous: document.getElementById('em-not-spontaneous'),
    interesting: document.getElementById('em-interesting'),
    notRefound: document.getElementById('em-not-refound'),
    notFound: document.getElementById('em-not-found'),
    privateComment: document.getElementById('em-private-comment'),
    cancelBtn: document.getElementById('em-cancel-btn'),
    medobsPicker: document.getElementById('em-medobs-picker'),
    medobsNewName: document.getElementById('em-medobs-new-name'),
    medobsAddBtn: document.getElementById('em-medobs-new-add-btn'),
  };
}

function loadActivitiesOnce() {
  if (!activitiesPromise) {
    activitiesPromise = fetch('/data/activities.json')
      .then((r) => r.json())
      .catch((e) => { console.error('Kunne ikke laste aktiviteter:', e); return []; });
  }
  return activitiesPromise;
}

function closeModal() {
  els.modal.style.display = 'none';
  currentObservations = null;
  currentIdx = null;
  currentOnSaved = null;
}

function ensureInit() {
  if (els) return;
  els = queryEls();

  photoPicker = initPhotoPicker({
    fileInput: document.getElementById('em-photo'),
    pickBtn: document.getElementById('em-photo-pick-btn'),
    pasteBtn: document.getElementById('em-photo-paste-btn'),
    previewWrap: document.getElementById('em-photo-preview-wrap'),
    previewImg: document.getElementById('em-photo-preview'),
    removeBtn: document.getElementById('em-photo-remove-btn'),
  }, isOpen);

  coObserverPicker = initCoObserverPicker({
    container: els.medobsPicker,
    newNameInput: els.medobsNewName,
    addBtn: els.medobsAddBtn,
  });

  els.cancelBtn.addEventListener('click', closeModal);
  els.modal.addEventListener('click', (e) => {
    if (e.target === els.modal) closeModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen()) closeModal();
  });

  els.form.addEventListener('submit', handleSubmit);
}

async function populateActivitySelect(currentActivity) {
  const activities = await loadActivitiesOnce();
  els.activity.innerHTML = '';
  activities.forEach((a) => {
    const opt = document.createElement('option');
    opt.value = a.value;
    opt.textContent = a.label;
    if (a.selected) opt.selected = true;
    els.activity.appendChild(opt);
  });
  if (currentActivity) {
    for (let i = 0; i < els.activity.options.length; i++) {
      if (els.activity.options[i].text.trim() === currentActivity.trim()) {
        els.activity.selectedIndex = i;
        break;
      }
    }
  }
}

/**
 * Åpne redigeringsmodalen for observations[index].
 * @param {Array} observations - samme array-referanse som resten av appen bruker
 * @param {number} index
 * @param {() => void} onSaved - kalles etter vellykket lagring, slik at kalleren kan
 *   re-rendre listen (modalen lagrer selv til localStorage, men rendrer ikke om lista)
 */
export function openEditModal(observations, index, onSaved) {
  ensureInit();
  const obs = observations[index];
  if (!obs) return;

  currentObservations = observations;
  currentIdx = index;
  currentOnSaved = onSaved;

  els.species.value = (obs.species && obs.species.taxonName) || '';
  els.count.value = obs.count != null ? obs.count : '';
  els.age.value = obs.age || '';
  els.gender.value = obs.gender || '';
  els.place.value = obs.placeName || '';
  els.date.value = isoToDate(obs.timestamp);
  els.timeFrom.value = isoToTime(obs.timestamp);
  els.timeTo.value = isoToTime(obs.tilKlokkeslett);
  els.comment.value = obs.comment || '';
  els.hideUntil.value = obs.hideUntil || '';
  els.uncertain.checked = !!obs.uncertain;
  els.notSpontaneous.checked = !!obs.notSpontaneous;
  els.interesting.checked = !!obs.interesting;
  els.notRefound.checked = !!obs.notRefound;
  els.notFound.checked = !!obs.notFound;
  els.privateComment.value = obs.privateComment || '';

  photoPicker.resetToUntouched();
  if (obs.photo) photoPicker.loadExisting(obs.photo);

  coObserverPicker.setSelected(obs.coObservers);

  populateActivitySelect(obs.activity);

  els.modal.style.display = 'flex';
}

function handleSubmit(e) {
  e.preventDefault();
  const obs = currentObservations && currentObservations[currentIdx];
  if (!obs) return;

  // Fanget ved registrering (observation-commit.js) — gjelder kun den opprinnelige
  // art+lokalitet+dato-kombinasjonen. Endres noen av dem her, kan ikke det gamle
  // AO-svaret lenger stoles på, og merket ville ellers misvisende bli hengende igjen.
  const gammelArt = obs.species && obs.species.taxonName;
  const gammeltSted = obs.placeName;
  const gammelDato = (obs.timestamp || '').slice(0, 10);

  obs.species = obs.species || {};
  obs.species.taxonName = els.species.value.trim();
  obs.count = parseInt(els.count.value, 10) || 1;
  const actOpt = els.activity.options[els.activity.selectedIndex];
  obs.activity = actOpt && actOpt.text ? actOpt.text.trim() : '';
  obs.age = els.age.value || '';
  obs.gender = els.gender.value || '';
  obs.placeName = els.place.value.trim();

  const nyTimestamp = updateDateTimeInIso(obs.timestamp, els.date.value, els.timeFrom.value);
  const nyTilKlokkeslett = els.timeTo.value
    ? updateDateTimeInIso(obs.tilKlokkeslett || obs.timestamp, els.date.value, els.timeTo.value)
    : null;

  // AO underkjenner tidspunkt frem i tid — samme regel som ved registrering
  // (observation-commit.js). Uten denne kunne redigering smugle inn en
  // observasjon AO importerer, men aldri publiserer.
  const naa = new Date();
  if (new Date(nyTimestamp) > naa) {
    alert('Fra-tidspunkt er frem i tid — AO underkjenner observasjonen');
    return;
  }
  if (nyTilKlokkeslett && new Date(nyTilKlokkeslett) > naa) {
    alert('Til-tidspunkt er frem i tid — AO underkjenner observasjonen');
    return;
  }

  obs.timestamp = nyTimestamp;
  if (nyTilKlokkeslett) {
    obs.tilKlokkeslett = nyTilKlokkeslett;
  } else {
    delete obs.tilKlokkeslett;
  }

  if (obs.rarityWarning
      && (obs.species.taxonName !== gammelArt
          || obs.placeName !== gammeltSted
          || nyTimestamp.slice(0, 10) !== gammelDato)) {
    delete obs.rarityWarning;
  }

  obs.comment = els.comment.value.trim();
  if (els.hideUntil.value) obs.hideUntil = els.hideUntil.value; else delete obs.hideUntil;
  if (els.uncertain.checked) obs.uncertain = true; else delete obs.uncertain;
  if (els.notSpontaneous.checked) obs.notSpontaneous = true; else delete obs.notSpontaneous;
  if (els.interesting.checked) obs.interesting = true; else delete obs.interesting;
  if (els.notRefound.checked) obs.notRefound = true; else delete obs.notRefound;
  if (els.notFound.checked) obs.notFound = true; else delete obs.notFound;
  if (els.privateComment.value.trim()) obs.privateComment = els.privateComment.value.trim(); else delete obs.privateComment;

  const photoValue = photoPicker.getValue();
  if (photoValue) obs.photo = photoValue;
  else if (photoValue === '') delete obs.photo;

  obs.coObservers = coObserverPicker.getSelected();

  currentObservations[currentIdx] = obs;
  let lagret = saveObservations(currentObservations);

  // localStorage kan være full — særlig på iOS Safari, som har en lav kvote og der
  // et 1600px-bilde som base64 kan sprenge den. Uten dette forsvant bildet i
  // stillhet: setItem kastet, modalen lukket seg som om alt var lagret, og bildet
  // var borte neste gang man så etter.
  if (!lagret && obs.photo) {
    const nyttBilde = typeof photoValue === 'string' && photoValue !== '';
    const kastBildet = nyttBilde || confirm(
      'Det er ikke plass til å lagre endringene på denne enheten.\n\n'
      + 'Vil du fjerne bildet fra denne observasjonen for å få plass? Bildet er da borte for godt.\n\n'
      + 'Trykk Avbryt hvis du heller vil frigjøre plass først (f.eks. tømme gamle observasjoner).');
    if (kastBildet) {
      delete obs.photo;
      currentObservations[currentIdx] = obs;
      lagret = saveObservations(currentObservations);
      if (lagret) {
        alert(nyttBilde
          ? 'Bildet var for stort til å lagres på denne enheten (tom lagringsplass). Resten av endringene er lagret, men uten bildet.'
          : 'Endringene er lagret, men bildet måtte fjernes for å få plass.');
      }
    }
  }
  if (!lagret) {
    alert('Kunne ikke lagre endringene — enheten har trolig ikke nok ledig lagringsplass. '
      + 'Prøv å tømme noen gamle observasjoner eller last ned en sikkerhetskopi og forsøk igjen.'
      + (lastSaveError ? `\n\n(${lastSaveError})` : ''));
    return;
  }

  const onSaved = currentOnSaved;
  closeModal();
  if (onSaved) onSaved();
}
