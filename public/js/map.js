/**
 * Kart-modul for visning av brukerposisjon og AO-lokaliteter
 */

import { createAoSite, ensureAoTokens, fetchAoSites } from './api.js';
// Versjonert import (i motsetning til de andre): dette er en HARD avhengighet
// til en navngitt eksport (mergeAoSitesWithPrivateCache) som ikke fantes i
// tidligere versjoner av location.js. Uten ?v= her serverer Cloudflare
// (max-age=14400) en cachet, gammel location.js — siden den ellers ALDRI
// hentes med noen versjonert URL noe sted (kun `import ... from './location.js'`
// uten query) — helt til den utløper naturlig, opptil 4 timer etter deploy.
// Resultat: en SyntaxError ved modul-lasting som stopper HELE map.js, altså
// et blankt kart (oppdaget i staging v1.53.15). Bump denne SAMTIDIG som
// map.html sin egen ?v=-tag, hver gang location.js endres.
import { mergeAoSitesWithPrivateCache, isPrivateSite } from './location.js?v=v1.53.16';
import { haversine } from './utils.js';

// Hent data fra localStorage
const mapData = localStorage.getItem('mapData');
if (!mapData) {
  document.body.innerHTML = '<div style="padding: 20px; color: white;">Ingen kartdata tilgjengelig. <a href="/" style="color: #3b82f6;">Gå tilbake</a></div>';
  throw new Error('Ingen kartdata i localStorage');
}

const data = JSON.parse(mapData);
const { userPosition, sites } = data;
// Valgt søkeradius fra registreringssiden — brukes UENDRET når kartet henter
// nye lokaliteter ved panorering (se moveend-håndteringen lenger ned).
const sizeMeters = (typeof data.sizeMeters === 'number' && data.sizeMeters > 0) ? data.sizeMeters : 1000;
console.log('mapData sites-array:', sites);

if (!userPosition || !userPosition.lat || !userPosition.lon) {
  document.body.innerHTML = '<div style="padding: 20px; color: white;">Ugyldig posisjon. <a href="/" style="color: #3b82f6;">Gå tilbake</a></div>';
  throw new Error('Ugyldig brukerposisjon');
}

// Initialiser kart sentrert på brukerens posisjon
const map = L.map('map').setView([userPosition.lat, userPosition.lon], 13);

// Kartlag å velge mellom
const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  maxZoom: 19
});

const kartverketTopoLayer = L.tileLayer('https://cache.kartverket.no/v1/wmts/1.0.0/topo/default/webmercator/{z}/{y}/{x}.png', {
  attribution: '© <a href="https://www.kartverket.no/">Kartverket</a>',
  maxZoom: 18
});

const kartverketGrayscaleLayer = L.tileLayer('https://cache.kartverket.no/v1/wmts/1.0.0/topograatone/default/webmercator/{z}/{y}/{x}.png', {
  attribution: '© <a href="https://www.kartverket.no/">Kartverket</a>',
  maxZoom: 18
});

osmLayer.addTo(map);

L.control.layers({
  'OpenStreetMap': osmLayer,
  'Kartverket Topo': kartverketTopoLayer,
  'Kartverket Gråtone': kartverketGrayscaleLayer
}, null, { position: 'bottomleft', collapsed: true }).addTo(map);

// Vis/skjul navn på lokalitetene — permanente tooltips kan forkludre kartet
// når det er mange lokaliteter tett i tett. Husket per enhet.
// Default PÅ: viderefører dagens oppførsel for de fleste. Den som synes
// navnene er i veien skrur dem av med ett trykk, og valget huskes til neste
// gang kartet åpnes.
const SHOW_LABELS_KEY = 'mapShowLabels_v1';
let showLabels = localStorage.getItem(SHOW_LABELS_KEY) !== '0';
// Manuelt opprettede lokasjoner (pin-drop, se addNewSiteMarker) — disse ligger
// utenfor siteLayerGroup og overlever derfor en panorer-oppdatering uendret.
const labelMarkers = [];
// Hentede AO-lokaliteter — bygges på nytt for hvert kall til renderSites().
const siteLabelMarkers = [];

const toggleLabelsBtn = document.getElementById('toggle-labels-btn');
function updateToggleLabelsBtnText() {
  if (!toggleLabelsBtn) return;
  toggleLabelsBtn.textContent = showLabels ? '🏷️ Skjul navn' : '🏷️ Vis navn';
}
function setShowLabels(value) {
  showLabels = value;
  try {
    localStorage.setItem(SHOW_LABELS_KEY, value ? '1' : '0');
  } catch (e) {
    // Ikke kritisk om preferansen ikke lar seg lagre
  }
  [...labelMarkers, ...siteLabelMarkers].forEach((marker) => {
    if (value) marker.openTooltip();
    else marker.closeTooltip();
  });
  updateToggleLabelsBtnText();
}
if (toggleLabelsBtn) {
  updateToggleLabelsBtnText();
  toggleLabelsBtn.addEventListener('click', () => setShowLabels(!showLabels));
}

// Marker for brukerens posisjon
const userMarker = L.circleMarker([userPosition.lat, userPosition.lon], {
  color: '#3b82f6',
  fillColor: '#3b82f6',
  fillOpacity: 0.8,
  radius: 10,
  weight: 3
}).addTo(map);

let popupContent = '<strong>📍 Din posisjon</strong>';
if (userPosition.accuracy) {
  popupContent += `<br>Nøyaktighet: ±${Math.round(userPosition.accuracy)} m`;
}
userMarker.bindPopup(popupContent);

// Lag som holder KUN de hentede AO-lokalitetene (markers/polygoner/sirkler).
// Skilt fra brukermarkør, pin-drop og manuelt opprettede lokasjoner, slik at
// en panorer-oppdatering (renderSites) kan tømme og tegne på nytt uten å
// røre noe av det andre på kartet.
const siteLayerGroup = L.layerGroup().addTo(map);

/**
 * Tegn AO-lokaliteter på kartet. Kalles ved første last (fitToBounds: true)
 * og ved hver panorer-oppdatering (fitToBounds: false — å re-zoome ville
 * kjempet mot brukerens egen panorering).
 * @param {Array} sitesToRender - Lokaliteter å tegne
 * @param {Object} [options]
 * @param {boolean} [options.fitToBounds] - Zoom kartet til å vise alle markers
 * @returns {number} Antall tegnede lokaliteter
 */
// IDer for lokasjoner opprettet med pin-drop i DENNE kartøkten (se
// addNewSiteMarker/createBtn under). De har allerede sin egen permanente
// markør direkte på kartet — uten dette ville en panorer-oppdatering rett
// etter opprettelse tegnet den samme lokasjonen en gang til inne i
// siteLayerGroup, siden den nå også ligger i privat-cachen som
// mergeAoSitesWithPrivateCache henter fra.
const manuallyPlacedSiteIds = new Set();

function renderSites(sitesToRender, { fitToBounds = false } = {}) {
  siteLayerGroup.clearLayers();
  siteLabelMarkers.length = 0;

  // Legg til alle markers i en bounds for auto-zoom
  const bounds = L.latLngBounds([[userPosition.lat, userPosition.lon]]);

  // Filtrer og legg til AO-lokaliteter
  let siteCount = 0;
  if (sitesToRender && Array.isArray(sitesToRender)) {
    // Logging: vis alle sites med isMine=true
    const mineSites = sitesToRender.filter(s => s.isMine);
    if (mineSites.length > 0) {
      console.log('Mine lokasjoner (isMine=true):', mineSites.map(s => ({ name: s.name, id: s.id, lat: s.lat, lon: s.lon })));
    } else {
      console.log('Ingen egne lokasjoner (isMine=true) funnet i sites-array.');
    }

    sitesToRender.forEach(site => {
    // Allerede vist via egen, permanent markør fra pin-drop i denne økten.
    // Normalisert til streng — AO-endepunktene er ikke konsekvente på om en
    // site-id kommer som tall eller streng (se _normalize_site() i
    // src/api_handlers.py), og et number/string-mismatch her ville stille
    // sluppet gjennom akkurat den dobbel-tegningen denne sjekken finnes for.
    if (site.id != null && manuallyPlacedSiteIds.has(String(site.id))) {
      return;
    }

    // Sjekk om site er privat
    const isPrivate = isPrivateSite(site);
    const showPrivateSites = localStorage.getItem('showPrivateSitesOnMap') === '1'; // av som standard
    // Private lokasjoner vises på kartet hvis de er mine, eller hvis innstillingen er på
    if (isPrivate && !site.isMine && !showPrivateSites) {
      return; // Hopp over private som ikke er mine (med mindre innstillingen er på)
    }

    const lat = parseFloat(site.lat);
    const lon = parseFloat(site.lon);
    if (isNaN(lat) || isNaN(lon)) {
      return;
    }

    // Bestem farger basert på type
    let markerColor, polygonColor;
    if (site.isMine) {
      markerColor = 'yellow';
      polygonColor = '#eab308';  // Gul
    } else if (isPrivate) {
      markerColor = 'grey';
      polygonColor = '#9ca3af';  // Grå — andres private, dempet
    } else if (site.isSuper) {
      markerColor = 'orange';
      polygonColor = '#f97316';  // Oransje
    } else {
      markerColor = 'green';
      polygonColor = '#22c55e';  // Grønn
    }

    // Navn for visning
    const siteName = site.name || 'Ukjent lokalitet';
    let displayName = siteName;
    if (site.isMine) displayName = `★ ${siteName}`;

    // Beregn avstand
    const distance = haversine(userPosition.lat, userPosition.lon, lat, lon);
    let distStr = '';
    if (distance !== null) {
      distStr = distance < 1000
        ? `${Math.round(distance)} m`
        : `${(distance / 1000).toFixed(1)} km`;
    }

    // Popup med navn, avstand og en eksplisitt velg-knapp. Deles av både
    // polygonet og senter-markøren under, slik at et trykk ALLTID viser
    // hvilken lokalitet du er i ferd med å velge først — nyttig især med
    // stedsnavn skrudd av på kartet (se toggle-labels-btn), der man ellers
    // ikke ville visst hva man trykket på før det var for sent å angre.
    const siteIdStr = site.id != null ? String(site.id) : '';
    let popupHtml = `<strong>${displayName}</strong>`;
    if (distStr) {
      popupHtml += `<br>Avstand: ${distStr}`;
    }
    popupHtml += `<br><br><button onclick="selectLocation('${siteName.replace(/'/g, "\\'")}', '${siteIdStr}')">Velg denne lokaliteten</button>`;

    // Tegn polygon hvis det er en polygon-lokalitet
    const hasPolygon = !!(site.raw && site.raw.isPolygon && site.raw.polygonCoordinates && site.raw.polygonCoordinates.length > 0);
    if (hasPolygon) {
      const coords = site.raw.polygonCoordinates;
      // ByBoundingBox returnerer [lon, lat], Leaflet trenger [lat, lon] - må bytte om
      const leafletCoords = coords.map(coord => [coord[1], coord[0]]);

      // Er navn synlig på kartet, vet du allerede hva du trykker på — da
      // går valget rett gjennom uten en ekstra bekreftelse. Er navn
      // skrudd av, spiller Leaflets standard popup-på-klikk (bindPopup)
      // inn i stedet: navn + avstand + en eksplisitt velg-knapp. Sjekkes
      // ved hvert klikk (ikke ved oppretting), så toggling av navn
      // underveis endrer oppførselen med en gang.
      const polygon = L.polygon(leafletCoords, {
        color: polygonColor,
        weight: 2,
        opacity: 0.8,
        fillColor: polygonColor,
        fillOpacity: 0.15
      }).addTo(siteLayerGroup).bindPopup(popupHtml);
      polygon.on('click', () => {
        if (showLabels) selectLocation(site.name || 'Ukjent lokalitet', site.id ?? null);
      });
    }

    // Tegn radius-sirkel hvis det er en radiuslokalitet (punkt + nøyaktighet i
    // meter — AO sitt `accuracy`-felt, se docs/mobil-artsobservasjoner-api.md).
    // Samme idé som polygonet over, bare rund i stedet for fritegnet. En
    // punktlokalitet (accuracy 0/mangler) skal ikke ha noen sirkel.
    if (!hasPolygon && site.raw) {
      const accuracyM = parseFloat(site.raw.accuracy ?? site.raw.Accuracy);
      if (!isNaN(accuracyM) && accuracyM > 0) {
        const radiusCircle = L.circle([lat, lon], {
          radius: accuracyM,
          color: polygonColor,
          weight: 2,
          opacity: 0.8,
          fillColor: polygonColor,
          fillOpacity: 0.12,
          dashArray: '5 5'
        }).addTo(siteLayerGroup).bindPopup(popupHtml);
        radiusCircle.on('click', () => {
          if (showLabels) selectLocation(site.name || 'Ukjent lokalitet', site.id ?? null);
        });
      }
    }

    // Marker i senter (alltid, uavhengig av om det er polygon)
    const markerIconUrl = `https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-${markerColor}.png`;
    const marker = L.marker([lat, lon], {
      icon: L.icon({
        iconUrl: markerIconUrl,
        shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
        iconSize: [25, 41],
        iconAnchor: [12, 41],
        popupAnchor: [1, -34],
        shadowSize: [41, 41]
      })
    }).addTo(siteLayerGroup);
    marker.bindPopup(popupHtml);

    // Tooltip med navn (vises permanent)
    const tooltipText = distStr ? `${siteName} (${distStr})` : siteName;
    const tooltipClasses = ['site-label'];
    if (site.isMine) tooltipClasses.push('mine-label');
    if (site.isSuper) tooltipClasses.push('super-label');
    marker.bindTooltip(tooltipText, {
      permanent: true,
      direction: 'top',
      className: tooltipClasses.join(' '),
      offset: [0, -35]
    });
    if (!showLabels) marker.closeTooltip();
    siteLabelMarkers.push(marker);

    // Samme logikk som polygonet over: navn synlig → velg direkte, navn
    // skrudd av → popup med bekreftelse (Leaflets standard popup-på-klikk).
    marker.on('click', () => {
      if (showLabels) selectLocation(siteName, site.id ?? null);
    });

    // Legg til i bounds
    bounds.extend([lat, lon]);
    siteCount++;
    });
  }

  // Zoom kartet til å vise alle markers (kun ved første last — en
  // panorer-oppdatering skal ikke kjempe mot brukerens egen panorering).
  // animate:false gjør at Leaflet flytter/zoomer OG fyrer sin egen moveend
  // synkront, FØR denne linjen returnerer — se bruken like under kallet til
  // renderSites() for hvorfor det er det som gjør panorer-lytteren trygg å
  // sette opp uten noen tidsbasert gjetning.
  if (fitToBounds && siteCount > 0) {
    map.fitBounds(bounds, { padding: [50, 50], animate: false });
  }

  // Oppdater info-boksen — vis/skjul basert på om det faktisk er noe å vise
  // i det nåværende utsnittet (viktig etter panorering til et tomt område)
  const infoBox = document.getElementById('info-box');
  const siteCountEl = document.getElementById('site-count');
  if (infoBox && siteCountEl) {
    if (siteCount > 0) {
      siteCountEl.textContent = siteCount;
      infoBox.style.display = 'block';
    } else {
      infoBox.style.display = 'none';
    }
  }

  return siteCount;
}

renderSites(sites, { fitToBounds: true });

// --- Panorer-og-oppdater: hent nye lokaliteter for kartets senter ---
// Samme mønster som drivstoffprisene (public/js/map.js: initKartBevegelse):
// debounce + minimumsavstand, så vi ikke hamrer løs på AO ved hver liten
// bevegelse eller zoom. Radius (sizeMeters) endres ALDRI her — kun SENTERET
// for hva som hentes flytter seg med panoreringen.
//
// renderSites() over kaller ev. fitBounds MED animate:false (se der), som gjør
// at Leaflet flytter/zoomer OG fyrer sin egen moveend HELT synkront — altså
// FØR linjen over i det hele tatt returnerer. Dermed er map.getCenter() her
// garantert den endelige, ferdig-bosatte posisjonen, og moveend-lytteren under
// kan trygt kobles på med en gang: JS er entrådet, så INGEN brukerhandling kan
// ha rukket å skje i vinduet mellom oppstarts-fitBounds og denne linjen. Ingen
// tidsbasert gjetning nødvendig (tidligere forsøk med map.once()/karantenetid
// hadde begge egne rekkefølge-svakheter — se git-historikk).
let lastFetchedCenter = { lat: map.getCenter().lat, lon: map.getCenter().lng };
let moveendTimer = null;
// Øker for hvert forsøk — brukes til å forkaste svar fra et eldre, tregere
// kall som kommer tilbake ETTER at en nyere panorering allerede har startet
// (og kanskje allerede fått svar og tegnet) sitt eget kall. Uten dette kunne
// et sent svar for et sted brukeren har forlatt overskrive et korrekt,
// ferskere kart.
let fetchSeq = 0;
const MIN_REFETCH_DISTANCE_M = Math.max(150, sizeMeters / 4);

map.on('moveend', handleMapMoveEnd);

function handleMapMoveEnd() {
  clearTimeout(moveendTimer);
  moveendTimer = setTimeout(async () => {
    const center = map.getCenter();
    const moved = haversine(lastFetchedCenter.lat, lastFetchedCenter.lon, center.lat, center.lng);
    if (moved != null && moved < MIN_REFETCH_DISTANCE_M) return;

    const seq = ++fetchSeq;
    try {
      await ensureAoTokens();
      const bboxSites = await fetchAoSites(center.lat, center.lng, sizeMeters);
      // En nyere panorering kan ha rukket å starte (og fullføre) sitt eget
      // kall mens dette ventet — da skal IKKE dette eldre svaret tegnes,
      // og lastFetchedCenter skal heller ikke oppdateres til dette stedet.
      if (seq !== fetchSeq) return;
      // Oppdateres først NÅ (ikke før fetch startet) — en feilet henting skal
      // fortsatt kunne prøves på nytt ved neste panorering i samme område,
      // i stedet for at MIN_REFETCH_DISTANCE_M stille blokkerer den for godt.
      lastFetchedCenter = { lat: center.lat, lon: center.lng };
      const merged = mergeAoSitesWithPrivateCache(bboxSites, { lat: center.lat, lon: center.lng }, sizeMeters);
      renderSites(merged, { fitToBounds: false });
    } catch (e) {
      // Ekstern-API-feil ved panorering: behold forrige visning i stedet for
      // å krasje eller tømme kartet — samme prinsipp som andre AO-kall.
      console.warn('Kunne ikke oppdatere lokaliteter etter panorering:', e);
    }
  }, 600);
}

/**
 * Velg lokalitet og gå tilbake til hovedsiden
 * @param {string} locationName - Navn på valgt lokalitet
 * @param {string|number|null} locationId - AO-lokalitets-ID
 */
function selectLocation(locationName, locationId) {
  localStorage.setItem('selectedLocation', locationName);
  if (locationId != null) {
    localStorage.setItem('selectedLocationId', String(locationId));
  } else {
    localStorage.removeItem('selectedLocationId');
  }
  window.location.href = '/';
}

// Gjør selectLocation tilgjengelig globalt for onclick i popup
window.selectLocation = selectLocation;

// --- Opprett ny lokasjon (pin-drop) ---

const fab = document.getElementById('add-site-fab');
const hint = document.getElementById('pin-drop-hint');
const cancelPinBtn = document.getElementById('cancel-pin-btn');
const panel = document.getElementById('create-site-panel');
const nameInput = document.getElementById('new-site-name');
const accuracySelect = document.getElementById('new-site-accuracy');
const createBtn = document.getElementById('panel-create-btn');
const panelCancelBtn = document.getElementById('panel-cancel-btn');
const panelStatus = document.getElementById('panel-status');

// Vis FAB kun hvis bruker har AO-credentials
function hasAoCredentials() {
  return !!(localStorage.getItem('ao_username') && localStorage.getItem('ao_password'));
}
if (hasAoCredentials() && fab) {
  fab.style.display = '';
}

let pinDropMode = false;
let dropMarker = null;
let mapClickHandler = null;
let accuracyCircle = null;

// Tegner radiusen ("nøyaktigheten") rundt lokasjonen som faktisk sendes til AO —
// uten denne var det umulig å se på kartet hvor stort området en radiuslokasjon
// faktisk dekker før man opprettet den.
function updateAccuracyCircle(latlng) {
  if (accuracyCircle) {
    map.removeLayer(accuracyCircle);
    accuracyCircle = null;
  }
  const radiusM = parseInt(accuracySelect.value, 10) || 0;
  if (radiusM > 0) {
    accuracyCircle = L.circle(latlng, {
      radius: radiusM,
      color: '#ef4444',
      weight: 2,
      dashArray: '5 5',
      fillColor: '#ef4444',
      fillOpacity: 0.12
    }).addTo(map);
  }
}

function removeAccuracyCircle() {
  if (accuracyCircle) {
    map.removeLayer(accuracyCircle);
    accuracyCircle = null;
  }
}

function enterPinDropMode() {
  pinDropMode = true;
  fab.style.display = 'none';
  hint.style.display = 'block';
  cancelPinBtn.style.display = 'block';
  map.getContainer().style.cursor = 'crosshair';

  mapClickHandler = (e) => {
    // Plasser draggbar marker
    if (dropMarker) {
      map.removeLayer(dropMarker);
    }
    const redIcon = L.icon({
      iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
      shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
      iconSize: [25, 41],
      iconAnchor: [12, 41],
      popupAnchor: [1, -34],
      shadowSize: [41, 41]
    });
    dropMarker = L.marker(e.latlng, { icon: redIcon, draggable: true }).addTo(map);
    updateAccuracyCircle(e.latlng);
    dropMarker.on('drag', (ev) => updateAccuracyCircle(ev.target.getLatLng()));
    hint.style.display = 'none';
    cancelPinBtn.style.display = 'none';

    // Fjern klikk-handler (kun én pin)
    map.off('click', mapClickHandler);

    // Vis opprett-panel
    openCreatePanel();
  };

  map.on('click', mapClickHandler);
}

function exitPinDropMode() {
  pinDropMode = false;
  hint.style.display = 'none';
  cancelPinBtn.style.display = 'none';
  panel.style.display = 'none';
  map.getContainer().style.cursor = '';

  if (mapClickHandler) {
    map.off('click', mapClickHandler);
    mapClickHandler = null;
  }
  if (dropMarker) {
    map.removeLayer(dropMarker);
    dropMarker = null;
  }
  removeAccuracyCircle();

  // Vis FAB igjen
  if (hasAoCredentials() && fab) {
    fab.style.display = '';
  }
}

function openCreatePanel() {
  nameInput.value = '';
  panelStatus.style.display = 'none';
  createBtn.disabled = false;
  panel.style.display = 'block';
}

function showPanelStatus(msg, isError) {
  panelStatus.textContent = msg;
  panelStatus.style.display = 'block';
  panelStatus.style.background = isError ? 'rgba(239,68,68,0.15)' : 'rgba(34,197,94,0.15)';
  panelStatus.style.color = isError ? '#ef4444' : '#22c55e';
}

function addNewSiteMarker(name, lat, lon, siteId) {
  if (siteId != null) {
    manuallyPlacedSiteIds.add(String(siteId));
  }
  const yellowIcon = L.icon({
    iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-yellow.png',
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    shadowSize: [41, 41]
  });
  const marker = L.marker([lat, lon], { icon: yellowIcon }).addTo(map);
  marker.bindTooltip(`★ ${name}`, {
    permanent: true,
    direction: 'top',
    className: 'site-label mine-label',
    offset: [0, -35]
  });
  if (!showLabels) marker.closeTooltip();
  labelMarkers.push(marker);
  marker.bindPopup(`<strong>★ ${name}</strong><br><em>Nettopp opprettet</em>`);
}

// Event listeners
if (fab) {
  fab.addEventListener('click', enterPinDropMode);
}
if (cancelPinBtn) {
  cancelPinBtn.addEventListener('click', exitPinDropMode);
}
if (panelCancelBtn) {
  panelCancelBtn.addEventListener('click', exitPinDropMode);
}
if (accuracySelect) {
  accuracySelect.addEventListener('change', () => {
    if (dropMarker) updateAccuracyCircle(dropMarker.getLatLng());
  });
}
if (createBtn) {
  createBtn.addEventListener('click', async () => {
    const name = nameInput.value.trim();
    if (!name) {
      showPanelStatus('Skriv inn et lokalitetsnavn', true);
      return;
    }
    if (!dropMarker) {
      showPanelStatus('Ingen posisjon valgt', true);
      return;
    }

    const latlng = dropMarker.getLatLng();
    createBtn.disabled = true;
    showPanelStatus('Logger inn på AO...', false);

    try {
      const loggedIn = await ensureAoTokens();
      if (!loggedIn) {
        showPanelStatus('Innlogging feilet. Sjekk brukernavn/passord i innstillinger.', true);
        createBtn.disabled = false;
        return;
      }

      showPanelStatus('Oppretter lokasjon...', false);
      const result = await createAoSite(name, latlng.lat, latlng.lng, parseInt(accuracySelect.value));

      if (result.success) {
        showPanelStatus(result.message || 'Lokasjon opprettet!', false);
        // Fjern rød marker, legg til gul
        if (dropMarker) {
          map.removeLayer(dropMarker);
          dropMarker = null;
        }
        removeAccuracyCircle();
        // Sporer siteId uansett fortegn (også f.eks. -1, som AO kan returnere ved
        // success=true uten en gyldig id — se ao_create_site.py) — poenget her er
        // KUN å hindre dobbel tegning hvis samme id dukker opp igjen via
        // privat-cachen ved en senere panorer-oppdatering, ikke å validere IDen.
        // Bevisst akseptert restrisiko: -1 er en sentinel, ikke en unik AO-id, så
        // om AO NOEN gang skulle returnere -1 for en helt annen, ekte lokalitet i
        // et bbox-svar ville den (usannsynlig, men teoretisk) blitt hoppet over på
        // en panorer-oppdatering. For usannsynlig til å rettferdiggjøre en egen
        // navn+posisjon-basert dedup-mekanisme i et hobbyprosjekt.
        addNewSiteMarker(name, latlng.lat, latlng.lng, result.siteId);

        // Brukeren opprettet lokasjonen fordi hen er der nå — velg den
        // automatisk, samme vei tilbake som ved klikk på en eksisterende
        // lokalitet på kartet.
        setTimeout(() => {
          selectLocation(name, result.siteId > 0 ? result.siteId : null);
        }, 1500);
      } else {
        showPanelStatus(result.message || result.error || 'Ukjent feil', true);
        createBtn.disabled = false;
      }
    } catch (e) {
      showPanelStatus('Nettverksfeil: ' + e.message, true);
      createBtn.disabled = false;
    }
  });
}

