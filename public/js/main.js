/**
 * Main entry point for fugleobservasjoner app
 * Koordinerer alle moduler og setter opp event listeners
 */

// Eksisterende moduler
import { logPageView, loadActivities, fetchAoSites, fetchAndCachePrivateSites, getCachedPrivateSites } from './api.js';
import { loadObservations, saveObservations, loadAoSearchRadius, saveAoSearchRadius, loadLocationSortMode, saveLocationSortMode } from './storage.js';
import { setStatus, setLocationStatus, showToast } from './ui.js';
import { setAoSiteSuggestions, initLocation, openMap, openMapPage, updateCreateSiteBtnVisibility, initCreateSite } from './location.js';
import { renderObservations } from './observations.js';
import { getVisitTimeSpan, isVisitLocked, visitExists } from './visits.js';

// Nye moduler
import { updateSectionStates, pulseSearchFieldAndFocus } from './form-state.js';
import { fetchResults, renderResults, chooseItem, updateSubtaxaCheckboxState } from './species-search.js';
import { commitObservation, renderActivityPills } from './observation-commit.js';
import { handleExport, handleCopy, handleCopyAndOpen, handleClear, handleDirectSend } from './export-operations.js';
import { openShareDialog } from './share.js';
import { initAutocomplete } from './autocomplete.js';
import { initNewsSplash } from './news-splash.js';
import { initFirstRunHint, shouldShowHint } from './first-run-hint.js';
import { hentAktivFellestur, forlatFellestur } from './fellestur-client.js';
import { oppdaterSpeilFraServer, hentSpeilVersjon } from './fellestur-sync.js';

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
  // Satt når man hopper tilbake til et besøk med blyanten i ③. Da er nye
  // observasjoner etterregistreringer *inni* det besøket, og arver besøkets
  // klokkeslett i stedet for å få «nå». Nullstilles så snart plassen endres
  // på en hvilken som helst annen måte.
  etterregVisitKey: null,
  currentAoSites: [],
  currentAoSizeMeters: 1000,
  locationSortMode: loadLocationSortMode(),
  _callbacks: null, // settes i init()
};

// Autocomplete cleanup-funksjon
let autocompleteCleanup = null;

// ============================================================
// DOM-elementreferanser
// ============================================================
const dom = {
  input: document.getElementById('search'),
  resultsEl: document.getElementById('results'),
  emptyMsgEl: document.getElementById('empty-msg'),
  rarityWarning: document.getElementById('rarity-warning'),
  rarityWarningHeader: document.getElementById('rarity-warning-header'),
  rarityWarningBody: document.getElementById('rarity-warning-body'),
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
  shareBtn: document.getElementById('share-btn'),
  clearBtn: document.getElementById('clear-btn'),
  aoDirectBtn: document.getElementById('ao-direct-btn'),
  aoDirectRow: document.getElementById('ao-direct-row'),
  aoDirectStatus: document.getElementById('ao-direct-status'),
  fellesturSperreHint: document.getElementById('fellestur-sperre-hint'),
  locDot: document.getElementById('loc-dot'),
  locText: document.getElementById('loc-text'),
  locMapBtn: document.getElementById('loc-map-btn'),
  locBtn: document.getElementById('loc-btn'),
  placeInput: document.getElementById('place'),
  aoSitesEl: document.getElementById('ao-sites'),
  aoSitesDropdown: document.getElementById('ao-sites-dropdown'),
  aoSizeInput: document.getElementById('ao-size'),
  locSortStandardBtn: document.getElementById('loc-sort-standard'),
  locSortAvstandBtn: document.getElementById('loc-sort-avstand'),
  sectionLokasjon: document.querySelector('.section-main:nth-of-type(1)'),
  sectionObservasjon: document.querySelector('.section-main:nth-of-type(2)'),
  sectionAktivitet: document.querySelector('.row .activity-input-row'),
  ageSelect: document.getElementById('age'),
  genderSelect: document.getElementById('gender'),
  countEstimatedCheckbox: document.getElementById('count-estimated'),
  extraUncertain: document.getElementById('extra-uncertain'),
  extraNotSpontaneous: document.getElementById('extra-not-spontaneous'),
  extraInteresting: document.getElementById('extra-interesting'),
  extraNotRefound: document.getElementById('extra-not-refound'),
  extraNotFound: document.getElementById('extra-not-found'),
  extraPrivateComment: document.getElementById('extra-private-comment'),
  extraComment: document.getElementById('extra-comment'),
  extraHideUntil: document.getElementById('extra-hide-until'),
  extraPhotoValue: document.getElementById('extra-photo-value'),
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

/**
 * Forlat etterregistrerings-modus for et besøk. Kalles fra alle steder som
 * setter aktiv plass på annen måte enn blyanten — GPS-dropdown, autocomplete,
 * kartvalg og manuell skriving. Da er man ikke lenger i det gamle besøket.
 */
function avsluttEtterregistrering() {
  if (!appState.etterregVisitKey) return;
  appState.etterregVisitKey = null;
  oppdaterEtterregMerke();
}

function loadState() {
  const loaded = loadObservations();
  appState.observations.splice(0, appState.observations.length);
  loaded.forEach(o => appState.observations.push(o));

  const last = appState.observations[appState.observations.length - 1];
  if (last && last.placeName) {
    appState.currentPlaceName = last.placeName;
    appState.currentPlaceId = last.placeId || null;
    if (dom.placeInput) {
      dom.placeInput.value = appState.currentPlaceName;
      dom.placeInput.dataset.autofilled = 'false';
    }
  }
}

function doRenderObservations() {
  const buttons = { exportBtn: dom.exportBtn, copyBtn: dom.copyBtn, copyOpenBtn: dom.copyOpenBtn, shareBtn: dom.shareBtn, clearBtn: dom.clearBtn, aoDirectBtn: dom.aoDirectBtn };
  renderObservations(appState.observations, dom.obsListEl, buttons, saveState);
  // renderObservations() aktiverer knappene rent basert på antall — overstyr
  // dem tilbake til sperret om en fellestur er aktiv (se
  // oppdaterInnsendingssperreForFellestur()).
  oppdaterInnsendingssperreForFellestur(!!hentAktivFellestur());
  // Lista kan ha endret besøket vi etterregistrerer i (låst, tømt, nye tider)
  oppdaterEtterregMerke();
}

function updateAoDirectVisibility() {
  if (!dom.aoDirectRow) return;
  const username = localStorage.getItem('ao_username');
  const hasCredentials = username && localStorage.getItem('ao_password');
  dom.aoDirectRow.style.display = hasCredentials ? 'block' : 'none';
  // Uten innlogging: vis CTA så nye brukere ser at direkte publisering finnes
  const loginCta = document.getElementById('ao-login-cta');
  if (loginCta) loginCta.style.display = hasCredentials ? 'none' : 'flex';
  const statusDot = document.getElementById('ao-status-dot');
  if (statusDot) {
    statusDot.classList.toggle('online', !!hasCredentials);
    if (hasCredentials) {
      // Initialer i stedet for en tom grønn prikk — viser i tillegg hvilken
      // konto som er logget inn (nyttig på delte/felles enheter).
      // Array.from (ikke .slice) for å dele opp i Unicode-tegn, ikke UTF-16-
      // enheter — kutter aldri et surrogatpar i to.
      statusDot.textContent = Array.from(username.trim()).slice(0, 2).join('').toUpperCase();
      statusDot.title = `Innlogget som ${username} mot Artsobservasjoner`;
      statusDot.setAttribute('aria-label', `Innlogget som ${username}. Trykk for å endre innlogging.`);
    } else {
      // Rødt leses som «noe er galt» — men å ikke være innlogget er appens
      // helt normale starttilstand. Tekst i stedet for farge fjerner tvetydigheten.
      statusDot.textContent = 'logg inn';
      statusDot.title = 'Ikke innlogget mot Artsobservasjoner – trykk for å logge inn';
      statusDot.setAttribute('aria-label', 'Ikke innlogget mot Artsobservasjoner. Trykk for å logge inn.');
    }
  }
}

function commitFromActivity() {
  commitObservation(appState, dom, callbacks);
}

// ============================================================
// Fellestur-banner (vises når en fellestur er aktiv på denne enheten)
// ============================================================
// Ferskeste avsluttet-varsel fra serveren (satt av fellestur.js sin
// sendTilArbeidsliste() når noen henter loggen inn og forlater) — kun i
// minnet, oppdateres av hver vellykkede poll. Rent informasjonsvarsel: vi
// stopper aldri registrering pga. dette, vi bare advarer mot dobbeltsending.
let fellesturAvsluttetAv = null;
let fellesturAvsluttetTs = null;

function updateFellesturBanner() {
  const banner = document.getElementById('fellestur-banner');
  const varselEl = document.getElementById('fellestur-avsluttet-varsel');
  const fellestur = hentAktivFellestur();
  const avsluttet = !!(fellestur && fellesturAvsluttetAv);
  if (banner) {
    banner.style.display = fellestur ? 'flex' : 'none';
    if (fellestur) {
      const navnEl = document.getElementById('fellestur-banner-navn');
      if (navnEl) navnEl.textContent = fellestur.navn || fellestur.kode;
    }
    // Bytt banneret til rød varselfarge når turen er avsluttet — skal ikke
    // kunne blandes med den vanlige, rolige «du er på fellestur»-fargen.
    banner.style.background = avsluttet ? 'rgba(239,68,68,0.15)' : 'var(--accent-soft)';
    banner.style.borderColor = avsluttet ? '#ef4444' : 'var(--accent)';
  }
  if (varselEl) {
    if (avsluttet) {
      varselEl.innerHTML = `🛑 <strong>Turen er avsluttet:</strong> ${tekst(fellesturAvsluttetAv)} har hentet loggen
        inn i sin lokale liste og sender den til AO. <strong>Ikke registrer flere funn eller send selv</strong> —
        si fra til ${tekst(fellesturAvsluttetAv)} hvis noe mangler.`;
      varselEl.style.display = 'block';
      varselEl.style.fontSize = '1em';
    } else {
      varselEl.style.display = 'none';
    }
  }
  oppdaterInnsendingssperreForFellestur(!!fellestur);
}

function tekst(v) {
  const el = document.createElement('span');
  el.textContent = v == null ? '' : String(v);
  return el.innerHTML;
}

/**
 * Publiser/kopier-til-AO/del/tøm på hovedsiden virker på nøyaktig samme
 * liste som fellestur-loggen mens en fellestur er aktiv (samme
 * loadObservations()/saveObservations()-bryter, se storage.js). Uten denne
 * sperren kan HVEM SOM HELST i gruppa trykke «Publiser til AO» og siden
 * bekrefte «tøm lista» — og dermed sende og slette DEN DELTE loggen for
 * alle, ikke bare sin egen kopi. Innsending skal alltid gå via den dedikerte
 * «Send inn listen og avslutt fellestur»-flyten på fellestur.html, som
 * gjør riktig opprydding (kronologi, visitId, medobservatør-kreditering) og
 * varsler resten av gruppa (se oppdaterAvsluttetVarsel() i fellestur.js).
 */
function oppdaterInnsendingssperreForFellestur(aktiv) {
  [dom.aoDirectBtn, dom.copyOpenBtn, dom.shareBtn, dom.clearBtn].forEach((btn) => {
    if (!btn) return;
    btn.disabled = aktiv || !appState.observations.length;
    btn.title = aktiv ? 'Deaktivert under fellestur — bruk 👥 Fellestur-siden for å hente inn og sende til AO' : '';
  });
  if (dom.fellesturSperreHint) dom.fellesturSperreHint.style.display = aktiv ? 'block' : 'none';
}

/**
 * Kopier fellestur-speilet inn i den private arbeidslista og forlat turen på
 * denne enheten. Trygg exit også om turen skulle være utløpt eller slettet
 * på serveren, siden vi bare leser det lokale speilet.
 */
function kopierFellesturSpeilTilPrivatListeOgForlat() {
  const turObs = loadObservations(); // speilet — vi er fortsatt i fellestur-modus her
  forlatFellestur(); // fra nå av ruter loadObservations/saveObservations til den private lista
  const privatListe = loadObservations();
  turObs.forEach((obs) => {
    const { obsId, ...uten } = obs;
    privatListe.push(uten);
  });
  saveObservations(privatListe);
}

/**
 * Forlat fellesturen på denne enheten. Spør først om den delte lista skal
 * kopieres inn i den private arbeidslista.
 */
function forlatFellesturMedValg() {
  const kopier = confirm('Vil du kopiere fellestur-lista inn i din egen lokale liste før du forlater?');

  if (kopier) {
    kopierFellesturSpeilTilPrivatListeOgForlat();
  } else {
    forlatFellestur();
  }

  fellesturAvsluttetAv = null;
  fellesturAvsluttetTs = null;
  stopFellesturPolling();
  loadState();
  doRenderObservations();
  updateFellesturBanner();
}

function setupFellesturBanner() {
  const forlatBtn = document.getElementById('fellestur-forlat-btn');
  if (forlatBtn) {
    forlatBtn.addEventListener('click', forlatFellesturMedValg);
  }
  updateFellesturBanner();
  startFellesturPollingHvisAktiv();
}

// ============================================================
// Fellestur-polling: så lenge en fellestur er aktiv, hent den delte lista
// jevnlig og speil den inn i appState.observations — andre deltakeres
// registreringer dukker da opp i den vanlige ③-lista, uten noe eget panel.
// ============================================================
const FELLESTUR_POLL_MS = 12000;
let fellesturPollHandle = null;

async function pollFellestur() {
  const fellestur = hentAktivFellestur();
  if (!fellestur) return;

  // Tas før GET-en sendes: brukes til å oppdage at speilet ble skrevet til
  // (f.eks. en synk som fullførte) mens denne pollen var underveis — svaret
  // kan da være eldre enn det vi allerede har fått inn lokalt. Uten dette
  // kunne en treg poll som startet før en nyregistrert observasjon ble lagt
  // til, men svarte etterpå, overskrive og fjerne den igjen.
  const versjonVedStart = hentSpeilVersjon();

  let r;
  try {
    r = await fetch(`/api/fellestur?kode=${encodeURIComponent(fellestur.kode)}`);
  } catch (_) {
    return; // nettverksfeil — prøv igjen neste runde
  }

  if (r.status === 404) {
    // Turen er borte server-side (utløpt/slettet), men enheten sto fortsatt i
    // fellestur-modus — uten opprydding ville loadObservations()/
    // saveObservations() blitt værende låst til det døde speilet på ubestemt
    // tid (se storage.js), og nye registreringer ville stille sluttet å synke
    // uten at brukeren fikk noen tydelig vei ut. Reddes automatisk inn i den
    // private lista i stedet, samme trygge vei som «Forlat» bruker.
    kopierFellesturSpeilTilPrivatListeOgForlat();
    fellesturAvsluttetAv = null;
    fellesturAvsluttetTs = null;
    stopFellesturPolling();
    loadState();
    doRenderObservations();
    updateFellesturBanner();
    showToast('Fellesturen er utløpt eller slettet — det du hadde ble lagt i din private liste', { raw: true, borderColor: '#f59e0b', duration: 4500 });
    return;
  }
  if (!r.ok) return;

  const data = await r.json().catch(() => null);
  if (!data || !data.ok) return;

  if (data.avsluttetAv !== fellesturAvsluttetAv) {
    const erNyttAvsluttetVarsel = !fellesturAvsluttetAv && !!data.avsluttetAv;
    fellesturAvsluttetAv = data.avsluttetAv || null;
    fellesturAvsluttetTs = data.avsluttetTs || null;
    updateFellesturBanner();
    // Banneret alene er lett å overse midt i registrering — et engangsvarsel
    // midt på skjermen første gang dette oppdages, i tillegg til at banneret
    // forblir rødt resten av økta (se updateFellesturBanner()).
    if (erNyttAvsluttetVarsel) {
      showToast(`🛑 ${fellesturAvsluttetAv} har avsluttet fellesturen og sender til AO — ikke registrer flere funn eller send selv`,
        { raw: true, borderColor: '#ef4444', duration: 6000 });
    }
  }

  const flettet = oppdaterSpeilFraServer(data, versjonVedStart);
  if (JSON.stringify(flettet) !== JSON.stringify(appState.observations)) {
    appState.observations.splice(0, appState.observations.length, ...flettet);
    doRenderObservations();
  }
}

function startFellesturPollingHvisAktiv() {
  if (!hentAktivFellestur()) return;
  stopFellesturPolling();
  pollFellestur(); // umiddelbar første runde — lista skal være fersk med en gang
  fellesturPollHandle = setInterval(() => {
    if (document.hidden) return;
    pollFellestur();
  }, FELLESTUR_POLL_MS);
}

function stopFellesturPolling() {
  if (fellesturPollHandle) {
    clearInterval(fellesturPollHandle);
    fellesturPollHandle = null;
  }
}

// ============================================================
// Radius-formattering (500 m – 3 km)
// ============================================================
function formatRadius(meters) {
  if (meters < 1000) return `${Math.round(meters)} m`;
  const km = meters / 1000;
  const str = Number.isInteger(km) ? String(km) : km.toFixed(1).replace('.', ',');
  return `${str} km`;
}

// ============================================================
// Kollaps/utvid ① Lokasjon (festet kompakt linje når plass er valgt)
// ============================================================
function collapseLocation() {
  const name = (dom.placeInput && dom.placeInput.value.trim()) || (appState.currentPlaceName || '').trim();
  if (!name) return; // Kollaps aldri uten en valgt plass
  const locPinned = document.getElementById('loc-pinned');
  const locPinnedName = document.getElementById('loc-pinned-name');
  const sectionLokasjon = document.querySelector('.section-lokasjon');
  if (locPinnedName) locPinnedName.textContent = name;
  if (locPinned) locPinned.style.display = 'flex';
  if (sectionLokasjon) sectionLokasjon.style.display = 'none';
}

/** Besøkets tidsspenn som «17:09–17:18», eller «17:09» hvis det er ett punkt. */
function visittid(span) {
  if (!span) return '';
  const fra = klokke(span.fra);
  const til = span.til ? klokke(span.til) : '';
  return til && til !== fra ? `${fra}–${til}` : fra;
}

function klokke(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * Merket i den festede lokasjonslinja som viser at nye observasjoner går inn
 * i et tidligere besøk, og hvilket klokkeslett de får. Uten dette ville tida
 * bli satt stille i bakgrunnen — brukeren skal se hva som skjer.
 */
function oppdaterEtterregMerke() {
  const merke = document.getElementById('loc-pinned-visit');
  if (!merke) return;

  // Besøket kan ha blitt tømt (slettede obser, «tøm lista») siden ↩ ble
  // trykket. Da finnes det ikke lenger å gå tilbake til. Et *låst* besøk
  // beholdes derimot — ↩ er nettopp et eksplisitt valg om å gå inn i det.
  if (appState.etterregVisitKey
      && !visitExists(appState.observations, appState.etterregVisitKey)) {
    appState.etterregVisitKey = null;
  }

  const span = appState.etterregVisitKey
    ? getVisitTimeSpan(appState.observations, appState.etterregVisitKey)
    : null;

  if (!span) {
    merke.style.display = 'none';
    merke.textContent = '';
    return;
  }

  // Nye arter arver besøkets tidsspenn. Merket viser akkurat de klokkeslettene,
  // så tida aldri settes i det skjulte.
  const laast = isVisitLocked(appState.observations, appState.etterregVisitKey);
  merke.textContent = `${laast ? '🔒 ' : ''}↩ ${visittid(span)}`;
  merke.title = laast
    ? 'Avsluttet besøk. Nye arter legges likevel inn her, med besøkets klokkeslett.'
    : 'Nye arter legges inn i dette besøket og får dette klokkeslettet';
  merke.style.display = '';
}

function expandLocation() {
  // Åpner man ① for å bytte plass, er man ute av etterregistreringen — det er
  // den enkle veien tilbake til vanlig «nå»-registrering på samme lokalitet.
  avsluttEtterregistrering();
  const locPinned = document.getElementById('loc-pinned');
  const sectionLokasjon = document.querySelector('.section-lokasjon');
  if (locPinned) locPinned.style.display = 'none';
  if (sectionLokasjon) sectionLokasjon.style.display = '';
  // Scroll den gjenåpnede seksjonen til topp — ellers ser det ut som ingenting
  // skjer når man trykker «Bytt plass» mens man er scrollet ned i obs-lista.
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ============================================================
// Posisjonshåndtering
// ============================================================
function makeSetCurrentPlaceAndUpdate() {
  return (name, siteId = null) => {
    avsluttEtterregistrering();
    appState.currentPlaceName = name;
    appState.currentPlaceId = siteId;
    if (dom.placeInput) {
      dom.placeInput.value = name;
      dom.placeInput.dataset.autofilled = 'true';
    }
    updateSectionStates(appState, dom);
    collapseLocation();
    pulseSearchFieldAndFocus(appState, dom);
  };
}

// Satt av kartknappen når den trigger GPS-henting selv (ingen posisjon fra
// før) — så kartet kan åpnes automatisk så snart posisjonen er klar, i
// stedet for at brukeren må trykke «Bruk GPS» og så kartknappen på nytt.
let apneKartEtterGps = false;

function handlePositionUpdate(position, sites) {
  appState.currentPosition = position;

  appState.currentAoSites = setAoSiteSuggestions(
    (sites && sites.length) ? sites : [],
    appState.currentPosition,
    dom.aoSitesDropdown,
    dom.aoSitesEl,
    dom.placeInput,
    makeSetCurrentPlaceAndUpdate(),
    appState.currentAoSizeMeters,
    appState.locationSortMode
  );
  updateSectionStates(appState, dom);
  updateMapBtnVisibility();
  updateCreateSiteBtnVisibility(appState.currentPosition);

  if (apneKartEtterGps) {
    apneKartEtterGps = false;
    if (position && typeof position.lat === 'number') {
      openMapPage(appState.currentPosition, appState.currentAoSites);
    }
  }
}

// Bytt sorteringsmodus for lokasjonsforslaget. Gjenbruker allerede hentede
// sites (appState.currentAoSites) — trenger ikke ny GPS-runde for å sortere om.
function setLocationSortMode(mode) {
  if (mode !== 'standard' && mode !== 'avstand') return;
  appState.locationSortMode = mode;
  saveLocationSortMode(mode);

  if (dom.locSortStandardBtn) dom.locSortStandardBtn.setAttribute('aria-checked', String(mode === 'standard'));
  if (dom.locSortAvstandBtn) dom.locSortAvstandBtn.setAttribute('aria-checked', String(mode === 'avstand'));

  if (appState.currentAoSites && appState.currentAoSites.length) {
    appState.currentAoSites = setAoSiteSuggestions(
      appState.currentAoSites,
      appState.currentPosition,
      dom.aoSitesDropdown,
      dom.aoSitesEl,
      dom.placeInput,
      makeSetCurrentPlaceAndUpdate(),
      appState.currentAoSizeMeters,
      appState.locationSortMode
    );
  }
}

// ============================================================
// Event listeners
// ============================================================
function setupEventListeners() {
  // Utvid ① Lokasjon fra festet kompakt linje (ingen auto-GPS)
  const locChangeBtn = document.getElementById('loc-change-btn');
  const locPinnedLabel = document.getElementById('loc-pinned-label');
  if (locChangeBtn) locChangeBtn.addEventListener('click', expandLocation);
  if (locPinnedLabel) locPinnedLabel.addEventListener('click', expandLocation);

  // Sorteringsvalg for lokasjonsforslaget: standard (type + avstand) eller
  // kun avstand
  if (dom.locSortStandardBtn) {
    dom.locSortStandardBtn.setAttribute('aria-checked', String(appState.locationSortMode === 'standard'));
    dom.locSortStandardBtn.addEventListener('click', () => setLocationSortMode('standard'));
  }
  if (dom.locSortAvstandBtn) {
    dom.locSortAvstandBtn.setAttribute('aria-checked', String(appState.locationSortMode === 'avstand'));
    dom.locSortAvstandBtn.addEventListener('click', () => setLocationSortMode('avstand'));
  }

  // Blyant i gruppeoverskrifta i ③: bytt aktiv lokalitet tilbake til den
  // gruppens sted, uten å måtte søke det opp på nytt. Observasjons-modulen
  // eier ikke appState, så den varsler hit via CustomEvent.
  document.addEventListener('obs:bruk-lokalitet', (e) => {
    const placeName = (e.detail && e.detail.placeName || '').trim();
    if (!placeName) return;
    appState.currentPlaceName = placeName;
    appState.currentPlaceId = (e.detail && e.detail.placeId) || null;
    if (dom.placeInput) {
      dom.placeInput.value = placeName;
      dom.placeInput.dataset.autofilled = 'true';
    }
    // Å gå tilbake hit er en etterregistrering inn i besøket, ikke noe man ser
    // nå: nye arter får besøkets starttidspunkt (se observation-commit.js).
    // Vil man registrere et *nytt* besøk på samme sted, velger man lokaliteten
    // på vanlig måte i ① i stedet — da blir tida «nå».
    appState.etterregVisitKey = (e.detail && e.detail.visitKey) || null;
    updateSectionStates(appState, dom);
    collapseLocation();
    oppdaterEtterregMerke();
    // Brukeren står nede i obs-lista når hen trykker — ta hen tilbake til
    // toppen der art-feltet står, ellers ser det ut som ingenting skjedde.
    window.scrollTo({ top: 0, behavior: 'smooth' });
    const span = appState.etterregVisitKey
      ? getVisitTimeSpan(appState.observations, appState.etterregVisitKey)
      : null;
    const tid = visittid(span);
    // Lett advarsel ved låst besøk: brukeren har selv sagt at besøket er
    // avsluttet, så det skal ikke være stille at nye arter havner der — og
    // enda mindre at klokka settes tilbake i tid. Ikke-blokkerende med vilje.
    if (e.detail && e.detail.visitLocked) {
      showToast(
        `↩ ${placeName} — avsluttet besøk. Nye arter får kl. ${tid}, tilbake i tid.`,
        { raw: true, borderColor: '#f59e0b', duration: 3500 }
      );
    } else {
      showToast(`↩ ${placeName}${tid ? ` — nye arter får kl. ${tid}` : ''}`, { raw: true });
    }
    pulseSearchFieldAndFocus(appState, dom);
  });

  const includeSubtaxaCheckbox = document.getElementById('include-subtaxa');
  if (includeSubtaxaCheckbox) {
    includeSubtaxaCheckbox.addEventListener('change', () => {
      fetchResults(dom.input.value, appState, dom, callbacks);
    });
  }

  if (dom.placeInput) {
    dom.placeInput.addEventListener('input', () => {
      // Manuell redigering fjerner alltid ID — ID kjem berre frå dropdown-val
      avsluttEtterregistrering();
      appState.currentPlaceId = null;
      dom.placeInput.dataset.autofilled = 'false';
      appState.currentPlaceName = dom.placeInput.value;
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
      // Denne handleren kjører etter listeneren over (samme event) som allerede
      // kalte updateSectionStates() med den GAMLE arten — sjeldenhetsboksen ville
      // ellers blitt hengende synlig for en art brukeren nettopp forlot.
      updateSectionStates(appState, dom);
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
    // Alltid synlig — trenger ikke posisjon fra før. Har vi ikke GPS-fix
    // ennå, henter vi det først (som ved «Bruk GPS»-knappen) og åpner
    // kartet automatisk når posisjonen er klar.
    dom.locMapBtn.style.display = '';
    dom.locMapBtn.addEventListener('click', () => {
      if (appState.currentPosition && typeof appState.currentPosition.lat === 'number') {
        openMapPage(appState.currentPosition, appState.currentAoSites);
        return;
      }
      apneKartEtterGps = true;
      if (dom.locBtn) dom.locBtn.click();
    });
  }




// Oppdater stil på kart-ikonet basert på posisjon. Knappen er alltid synlig
// (se setup over) — her styres kun den «aktive» glødende stilen som viser om
// vi faktisk har et GPS-fix å vise i kartet.
function updateMapBtnVisibility() {
  if (!dom.locMapBtn) return;
  dom.locMapBtn.style.display = '';
  if (appState.currentPosition && typeof appState.currentPosition.lat === 'number' && typeof appState.currentPosition.lon === 'number') {
    dom.locMapBtn.style.background = 'var(--accent)';
    dom.locMapBtn.style.color = 'white';
    dom.locMapBtn.style.borderColor = 'var(--accent)';
    dom.locMapBtn.style.boxShadow = '0 0 0 3px #22c55e55, 0 2px 8px rgba(59,130,246,0.18)';
    dom.locMapBtn.style.fontWeight = 'bold';
    dom.locMapBtn.style.fontSize = '1.7em';
    dom.locMapBtn.title = 'Vis posisjon og AO-lokaliteter i kart';
    dom.locMapBtn.classList.add('map-btn-active');
  } else {
    dom.locMapBtn.style.background = '';
    dom.locMapBtn.style.color = '';
    dom.locMapBtn.style.borderColor = '';
    dom.locMapBtn.style.boxShadow = '';
    dom.locMapBtn.style.fontWeight = '';
    dom.locMapBtn.style.fontSize = '';
    dom.locMapBtn.title = 'Åpne kart (henter posisjon først)';
    dom.locMapBtn.classList.remove('map-btn-active');
  }
}

// Gjør funksjonen globalt tilgjengelig for andre moduler (f.eks. location.js)
window.updateMapBtnVisibility = updateMapBtnVisibility;

  if (dom.aoSizeInput) {
    const aoSizeValueEl = document.getElementById('ao-size-value');
    const renderRadiusValue = (v) => {
      if (aoSizeValueEl) aoSizeValueEl.textContent = formatRadius(v);
    };

    // Last lagret radius fra localStorage
    const savedRadius = loadAoSearchRadius();
    dom.aoSizeInput.value = savedRadius;
    appState.currentAoSizeMeters = savedRadius;
    renderRadiusValue(savedRadius);

    dom.aoSizeInput.addEventListener('input', () => {
      const v = parseFloat(dom.aoSizeInput.value);
      if (isNaN(v) || v <= 0) return;
      appState.currentAoSizeMeters = v;
      saveAoSearchRadius(v);
      renderRadiusValue(v);
    });
  }

  if (dom.exportBtn) dom.exportBtn.addEventListener('click', () => handleExport(appState.observations, dom));
  if (dom.copyBtn) dom.copyBtn.addEventListener('click', () => handleCopy(appState.observations, dom));
  if (dom.copyOpenBtn) dom.copyOpenBtn.addEventListener('click', () => handleCopyAndOpen(appState.observations, dom));
  if (dom.shareBtn) dom.shareBtn.addEventListener('click', () => openShareDialog(appState.observations));
  if (dom.clearBtn) dom.clearBtn.addEventListener('click', () => handleClear(appState.observations, dom, callbacks));
  if (dom.aoDirectBtn) dom.aoDirectBtn.addEventListener('click', () => handleDirectSend(appState.observations, dom, callbacks));
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
    avsluttEtterregistrering();
    appState.currentPlaceName = selectedLocation;
    const selectedLocationId = localStorage.getItem('selectedLocationId');
    appState.currentPlaceId = selectedLocationId ? parseInt(selectedLocationId, 10) || selectedLocationId : null;
    if (dom.placeInput) {
      dom.placeInput.value = selectedLocation;
      dom.placeInput.dataset.autofilled = 'true';
    }
    localStorage.removeItem('selectedLocation');
    localStorage.removeItem('selectedLocationId');
  }

  setupEventListeners();

  if (dom.placeInput && !autocompleteCleanup) {
    autocompleteCleanup = initAutocomplete(
      dom.placeInput,
      (name, id) => {
        avsluttEtterregistrering();
        appState.currentPlaceName = name;
        appState.currentPlaceId = id;
        dom.placeInput.dataset.autofilled = 'true';
        updateSectionStates(appState, dom);
        collapseLocation();
      },
      () => appState.currentPosition
    );
  }

  updateSectionStates(appState, dom);

  // Gjenopprettet/sticky plass ved oppstart → vis festet kompakt linje
  if (dom.placeInput && dom.placeInput.value.trim()) {
    collapseLocation();
  }

  // Hvis lokalitet ble valgt fra kart, sett fokus på art-feltet
  if (selectedLocation) {
    pulseSearchFieldAndFocus(appState, dom);
  }

  initLocation(
    { locBtn: dom.locBtn, locMapBtn: dom.locMapBtn, locDot: dom.locDot, locText: dom.locText },
    handlePositionUpdate,
    appState.currentAoSizeMeters
  );

  // Initialiser opprett-lokasjon-funksjonalitet
  initCreateSite(
    () => appState.currentPosition,
    () => appState.currentPlaceName,
    () => {
      // Re-hent AO-sites etter opprettelse
      if (appState.currentPosition) {
        fetchAoSites(appState.currentPosition.lat, appState.currentPosition.lon, appState.currentAoSizeMeters)
          .then(sites => handlePositionUpdate(appState.currentPosition, sites))
          .catch(() => {});
      }
    }
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
  // Skal «👋 Start her»-hintet vises akkurat nå, skal det møte brukeren
  // først — ikke en teknisk nyhetsmelding om sjeldenhetsvarsel. Nyheten
  // vises normalt igjen så snart hintet er lukket (eller aldri var aktuelt).
  if (!shouldShowHint()) {
    initNewsSplash();
  }
  initFirstRunHint();
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
  const radiusRow = document.getElementById('radius-row');
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
    if (radiusRow) radiusRow.style.display = 'none';
    if (aoSitesDropdown) aoSitesDropdown.style.display = 'none';

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

    // Vis GPS-relaterte rader
    if (locStatusRow) locStatusRow.style.display = 'flex';
    if (gpsControlsRow) gpsControlsRow.style.display = 'flex';
    if (radiusRow) radiusRow.style.display = 'flex';
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
  updateAoDirectVisibility();
  setupFellesturBanner();

  // Hent private lokasjoner i bakgrunnen hvis cache mangler eller er utdatert
  if (getCachedPrivateSites().length === 0) {
    const tokens = JSON.parse(localStorage.getItem('ao_tokens') || '{}');
    if (tokens.authCookie) {
      fetchAndCachePrivateSites();
    }
  }
});
