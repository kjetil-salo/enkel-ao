/**
 * Main entry point for fugleobservasjoner app
 * Koordinerer alle moduler og setter opp event listeners
 */

// Eksisterende moduler
// Versjonert import: hasFreshPrivateSitesCache er en NY navngitt eksport i
// api.js (v1.53.20). Uten ?v= her kan Cloudflare servere en cachet, gammel
// api.js uten denne eksporten i opptil 4 timer etter deploy — samme fallgruve
// som storage.js-importen under og map.js sin api.js-import.
import { logPageView, loadActivities, fetchAoSites, fetchAndCachePrivateSites, hasFreshPrivateSitesCache } from './api.js?v=v1.53.20';
// Versjonert import: denne linjen har en HARD avhengighet til to navngitte
// eksporter (loadAoDirectAutoClear/saveAoDirectAutoClear) som ikke fantes i
// tidligere versjoner av storage.js. Uten ?v= her kan Cloudflare servere en
// cachet, gammel storage.js (aldri hentet med noen versjonert URL noe annet
// sted) og gi en SyntaxError ved modul-lasting som stopper HELE main.js —
// altså hele appen, se samme fallgruve for map.js/location.js (v1.53.15) og
// sjekklisten i CLAUDE.md. Bump SAMTIDIG som index.html sin egen ?v=-tag for
// main.js, hver gang storage.js får en ny eksport main.js begynner å bruke.
import { loadObservations, saveObservations, loadAoSearchRadius, saveAoSearchRadius, loadLocationSortMode, saveLocationSortMode, loadAoDirectAutoClear, saveAoDirectAutoClear } from './storage.js?v=v1.53.23';
import { setStatus, setLocationStatus, showToast, haversine } from './ui.js';
import { setAoSiteSuggestions, initLocation, openMap, openMapPage, updateCreateSiteBtnVisibility, initCreateSite } from './location.js';
// Versjonert import: observations.js sitt eget innhold (ikke bare hvilke
// eksporter den har) endret seg vesentlig i dag (speciesDisplayName-bruk i
// ③-lista og slett-toasten). En stale cachet kopi av selve FILEN - ikke bare
// manglende eksport - er like reell en fallgruve: main.js sin import her har
// ALDRI vært versjonert, så en nettleser som besøkte siden tidligere i dag
// (før nynorsk-arbeidet) kan sitte igjen med gammel oppførsel i opptil 4
// timer, uten noen SyntaxError som varsler om det (funksjonene fantes jo
// allerede - bare med gammel logikk). Se species-search.js/
// observation-commit.js under for samme fiks, og docs/CLAUDE.md.
import { renderObservations } from './observations.js?v=v1.53.25';
import { getVisitTimeSpan, isVisitLocked, visitExists } from './visits.js';

// Nye moduler
import { updateSectionStates, pulseSearchFieldAndFocus } from './form-state.js';
// Versjonert import: samme begrunnelse som observations.js over - selve
// innholdet i species-search.js (online-søk beriker nå med nynorsk via
// getNynorskByLatin) endret vesentlig i dag, uten at denne importen noen
// gang har vært versjonert. Dette var den faktiske årsaken til at Kjetil
// testet v1.53.25 og fortsatt bare så gammel oppførsel i vanlig søk -
// nettleseren hans hadde en cachet species-search.js fra v1.53.24.
import { fetchResults, renderResults, chooseItem, updateSubtaxaCheckboxState } from './species-search.js?v=v1.53.25';
import { commitObservation, renderActivityPills } from './observation-commit.js?v=v1.53.25';
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
  // Siste ikke-tomme bbox-resultat FØR privat-cache-merge (rå input til
  // setAoSiteSuggestions/mergeAoSitesWithPrivateCache), pluss posisjon,
  // søkeradius og tidspunkt det ble hentet MED — brukt som fallback i
  // handlePositionUpdate() når en fersk henting kommer tom tilbake, slik at
  // offentlige lokaliteter som kun finnes via bbox ikke forsvinner ved en
  // forbigående AO-feil. Posisjon/radius/tidspunkt lagres for å unngå å vise
  // disse når de ikke lenger er relevante (brukeren har flyttet seg for
  // langt, endret søkeradius, eller det er gått for lang tid) — se
  // handlePositionUpdate for full begrunnelse.
  lastBboxSites: [],
  lastBboxPosition: null,
  lastBboxSizeMeters: null,
  lastBboxTs: 0,
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
  aoDirectAutoClear: document.getElementById('ao-direct-auto-clear'),
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
  extraSecondhand: document.getElementById('extra-secondhand'),
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

  // Vis forrige lokalitetsliste med en gang — uten dette sto dropdownen tom
  // (kun skjult via display:none siden forrige valg, ikke tømt) helt til
  // brukeren rørte feltet selv. Hent samtidig en fersk GPS-posisjon og nye
  // AO-lokaliteter i BAKGRUNNEN, som oppdaterer lista når den er klar — ingen
  // ventetid før noe vises, men fortsatt fersk data uten et eget GPS-trykk.
  // Gjenbruker «Bruk GPS»-knappen (samme knapp/flyt brukeren selv trykker) i
  // stedet for å duplisere GPS-/fetch-logikken fra location.js.
  const hadCachedSites = !!(appState.currentAoSites && appState.currentAoSites.length && dom.placeInput);
  if (hadCachedSites) {
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
  // location.js sin initLocation() fester ALDRI noen click-listener på locBtn
  // hvis nettleseren mangler geolokasjon-støtte (navigator.geolocation) i det
  // hele tatt — da blir .click() en total no-op, og locBtn.disabled forblir
  // false for alltid (ingenting setter den). Uten denne sjekken kunne
  // "henter oppdaterte lokaliteter"-meldingen under bli hengende PERMANENT i
  // et slikt tilfelle, siden ingenting noensinne ville kalt
  // setAoSiteSuggestions() på nytt for å rydde den bort (se den funksjonens
  // egen selvopprydding, location.js linje ~153). Alle andre feilveier
  // (avslått tillatelse, timeout) fungerer fint — de går via samme
  // onPositionUpdate()-kall som en vellykket henting.
  const gpsStøttet = typeof navigator !== 'undefined' && !!navigator.geolocation;
  if (dom.locBtn && !dom.locBtn.disabled && gpsStøttet) {
    dom.locBtn.click();
  }
  // Tydelig TEKSTMELDING om at GPS jobber i bakgrunnen — den pulserende
  // loc-dot-prikken (setLocationStatus) alene viste seg for diskret til å
  // legges merke til når blikket er på selve lista, ikke på GPS-knappen.
  // Overskriver bevisst det setAoSiteSuggestions() over nettopp satte på
  // aoSitesEl — ryddes automatisk bort av NESTE setAoSiteSuggestions-kall
  // (den nullstiller alltid aoSitesEl aller først), altså når den ferske
  // bakgrunnsdataen faktisk er klar og lista tegnes på nytt.
  if (hadCachedSites && dom.locBtn && dom.aoSitesEl && gpsStøttet) {
    dom.aoSitesEl.textContent = '🔄 Henter oppdaterte lokaliteter …';
    dom.aoSitesEl.style.display = 'block';
  }
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

// Hvor lenge et tidligere bbox-resultat regnes som en gyldig fallback ved en
// tom fersk henting (se handlePositionUpdate) — kort nok til at det kun bygger
// bro over en forbigående AO-feil, ikke lenge nok til å vise reelt utdaterte
// lokaliteter (f.eks. en offentlig lokalitet som siden er fjernet/gjort privat).
const LAST_BBOX_FALLBACK_TTL_MS = 2 * 60 * 1000;

function handlePositionUpdate(position, sites, radiusUsed = appState.currentAoSizeMeters) {
  // En gyldig, fersk GPS-fiks skal ALLTID oppdatere posisjonen — uansett om
  // AO-lokalitetene i det hele tatt kom med. Posisjonen må aldri fryse på et
  // gammelt sted bare fordi et samtidig AO-kall feilet/degraderte til tom liste.
  if (position) {
    appState.currentPosition = position;
  }

  // Merge-steget (setAoSiteSuggestions → mergeAoSitesWithPrivateCache) kjøres
  // ALLTID, uansett om bbox-resultatet er tomt — det er dette steget som også
  // henter inn cache-baserte endringer (f.eks. en nyopprettet privat lokasjon,
  // se initCreateSite-kallet lenger ned og v1.53.0 i CLAUDE.md). Å hoppe over
  // det helt ved et tomt bbox-svar var en tidligere feil her: da forsvant
  // nyopprettede lokasjoner stille fordi de aldri ble slått sammen inn i lista,
  // selv om de allerede lå i privat-cachen.
  //
  // Det som derimot beskyttes er selve BBOX-INPUTEN til merget: en fersk,
  // TOM bbox-liste (feilet/degradert AO-kall — backend-konvensjonen er å
  // svare 200 med {sites:[]} på eksterne feil, se CLAUDE.md — umulig å skille
  // fra et ekte "ingen offentlige lokaliteter her" fra frontend) faller
  // tilbake til forrige kjente, ikke-tomme bbox-resultat i stedet for å late
  // som om det ikke finnes offentlige lokaliteter i det hele tatt. Spesielt
  // viktig nå som «Bytt lokasjon» (expandLocation()) trigger GPS i
  // BAKGRUNNEN uten at brukeren eksplisitt ba om en ny henting akkurat da.
  //
  // Fallback brukes KUN hvis ALLE stemmer: (1) brukeren er fortsatt innenfor
  // valgt søkeradius fra der forrige bbox-resultat faktisk ble hentet — uten
  // dette kunne en som beveget seg til et sted UTEN offentlige lokaliteter
  // (et ekte tomt resultat, ikke en feil) i stedet se gamle, fjerne
  // lokaliteter og risikere å velge feil AO-lokalitet for en observasjon;
  // (2) søkeradius er UENDRET siden — en smalere radius kan gyldig gi et tomt
  // resultat der en bredere ikke gjorde det, så et radiusbytte skal aldri
  // maskeres av den gamle, bredere lista; (3) ikke eldre enn
  // LAST_BBOX_FALLBACK_TTL_MS — kun ment å bygge bro over en forbigående
  // AO-feil, ikke vise reelt utdaterte lokaliteter på ubestemt tid. Gjelder
  // heller ikke et helt FØRSTE forsøk (ingen fallback å falle tilbake på) —
  // der vises et ekte tomt bbox-resultat normalt.
  const forrigeBboxFortsattRelevant = appState.lastBboxPosition
    && appState.currentPosition
    && appState.lastBboxSizeMeters === appState.currentAoSizeMeters
    && (Date.now() - appState.lastBboxTs) <= LAST_BBOX_FALLBACK_TTL_MS
    && haversine(
      appState.lastBboxPosition.lat, appState.lastBboxPosition.lon,
      appState.currentPosition.lat, appState.currentPosition.lon
    ) <= appState.currentAoSizeMeters;

  if (sites && sites.length) {
    appState.lastBboxSites = sites;
    appState.lastBboxPosition = position ? { lat: position.lat, lon: position.lon } : appState.currentPosition;
    // radiusUsed (radiusen FAKTISK sendt til fetchAoSites for DETTE resultatet)
    // — ikke appState.currentAoSizeMeters, som kan ha rukket å bli endret av
    // brukeren (radius-slideren) mens denne hentingen fortsatt pågikk. Uten
    // dette kunne betingelse (2) over bli lurt av en race: et resultat hentet
    // med gammel radius ble feilmerket med en NY, senere valgt radius.
    appState.lastBboxSizeMeters = radiusUsed;
    appState.lastBboxTs = Date.now();
  }
  const bboxSites = (sites && sites.length)
    ? sites
    : (forrigeBboxFortsattRelevant ? appState.lastBboxSites : []);
  // Radiusen sendt til privat-cache-avstandsfilteret i mergeAoSitesWithPrivateCache
  // skal matche radiusen bboxSites over FAKTISK ble hentet med — samme
  // forgrening som bboxSites: radiusUsed for et ferskt resultat,
  // lastBboxSizeMeters KUN når fallback-lista faktisk brukes, ellers
  // live currentAoSizeMeters (et EKTE tomt resultat, f.eks. etter at
  // brukeren nettopp har snevret inn radiusen, skal filtreres med DEN nye
  // radiusen — ikke en gammel, irrelevant en).
  const radiusForMerge = (sites && sites.length)
    ? radiusUsed
    : (forrigeBboxFortsattRelevant ? appState.lastBboxSizeMeters : appState.currentAoSizeMeters);

  appState.currentAoSites = setAoSiteSuggestions(
    bboxSites,
    appState.currentPosition,
    dom.aoSitesDropdown,
    dom.aoSitesEl,
    dom.placeInput,
    makeSetCurrentPlaceAndUpdate(),
    radiusForMerge,
    appState.locationSortMode
  );
  updateSectionStates(appState, dom);
  updateMapBtnVisibility();
  updateCreateSiteBtnVisibility(appState.currentPosition);

  if (apneKartEtterGps) {
    apneKartEtterGps = false;
    if (position && typeof position.lat === 'number') {
      openMapPage(appState.currentPosition, appState.currentAoSites, appState.currentAoSizeMeters);
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
        openMapPage(appState.currentPosition, appState.currentAoSites, appState.currentAoSizeMeters);
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

  if (dom.aoDirectAutoClear) {
    dom.aoDirectAutoClear.checked = loadAoDirectAutoClear();
    dom.aoDirectAutoClear.addEventListener('change', () => {
      saveAoDirectAutoClear(dom.aoDirectAutoClear.checked);
    });
  }
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
    (name, siteId) => {
      // Brukeren opprettet lokasjonen fordi hen er der nå — velg den automatisk
      // som gjeldende lokasjon, i stedet for å la ① stå uendret.
      makeSetCurrentPlaceAndUpdate()(name, siteId);
      // Re-hent AO-sites etter opprettelse. Radius fanges i en lokal variabel
      // FØR kallet, slik at et eventuelt radiusbytte fra brukeren mens dette
      // kallet pågår ikke feilmerker resultatet med feil radius i
      // handlePositionUpdate() sin ferskhets-sjekk (se der for begrunnelse).
      if (appState.currentPosition) {
        const radiusForDetteKallet = appState.currentAoSizeMeters;
        fetchAoSites(appState.currentPosition.lat, appState.currentPosition.lon, radiusForDetteKallet)
          .then(sites => handlePositionUpdate(appState.currentPosition, sites, radiusForDetteKallet))
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

  // Hent private lokasjoner i bakgrunnen hvis cache mangler eller er utdatert.
  // hasFreshPrivateSitesCache() — ikke .length === 0 — for at en bruker med
  // faktisk null private lokasjoner ikke skal hente på nytt ved HVER
  // sideinnlasting for alltid (se api.js sin ensureAoTokens() for samme fiks).
  if (!hasFreshPrivateSitesCache()) {
    const tokens = JSON.parse(localStorage.getItem('ao_tokens') || '{}');
    if (tokens.authCookie) {
      fetchAndCachePrivateSites();
    }
  }
});
