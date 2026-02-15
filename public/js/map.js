/**
 * Kart-modul for visning av brukerposisjon og AO-lokaliteter
 */

// Hent data fra localStorage
const mapData = localStorage.getItem('mapData');
if (!mapData) {
  document.body.innerHTML = '<div style="padding: 20px; color: white;">Ingen kartdata tilgjengelig. <a href="/" style="color: #3b82f6;">Gå tilbake</a></div>';
  throw new Error('Ingen kartdata i localStorage');
}

const data = JSON.parse(mapData);
const { userPosition, sites } = data;
console.log('mapData sites-array:', sites);

if (!userPosition || !userPosition.lat || !userPosition.lon) {
  document.body.innerHTML = '<div style="padding: 20px; color: white;">Ugyldig posisjon. <a href="/" style="color: #3b82f6;">Gå tilbake</a></div>';
  throw new Error('Ugyldig brukerposisjon');
}

// Initialiser kart sentrert på brukerens posisjon
const map = L.map('map').setView([userPosition.lat, userPosition.lon], 13);

// Legg til OpenStreetMap tiles
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  maxZoom: 19
}).addTo(map);

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

// Legg til alle markers i en bounds for auto-zoom
const bounds = L.latLngBounds([[userPosition.lat, userPosition.lon]]);

// Filtrer og legg til AO-lokaliteter
let siteCount = 0;
if (sites && Array.isArray(sites)) {
  // Logging: vis alle sites med isMine=true
  const mineSites = sites.filter(s => s.isMine);
  if (mineSites.length > 0) {
    console.log('Mine lokasjoner (isMine=true):', mineSites.map(s => ({ name: s.name, id: s.id, lat: s.lat, lon: s.lon })));
  } else {
    console.log('Ingen egne lokasjoner (isMine=true) funnet i sites-array.');
  }

  sites.forEach(site => {
    // Sjekk om site er privat
    const isPrivate = isPrivateSite(site);
    // Private lokasjoner vises på kartet hvis de er mine
    if (isPrivate && !site.isMine) {
      return; // Hopp over private som ikke er mine
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
    } else if (site.isSuper) {
      markerColor = 'orange';
      polygonColor = '#f97316';  // Oransje
    } else {
      markerColor = 'green';
      polygonColor = '#22c55e';  // Grønn
    }

    // Tegn polygon hvis det er en polygon-lokalitet
    if (site.raw && site.raw.isPolygon && site.raw.polygonCoordinates) {
      const coords = site.raw.polygonCoordinates;
      if (coords && coords.length > 0) {
        // ByBoundingBox returnerer [lon, lat], Leaflet trenger [lat, lon] - må bytte om
        const leafletCoords = coords.map(coord => [coord[1], coord[0]]);

        L.polygon(leafletCoords, {
          color: polygonColor,
          weight: 2,
          opacity: 0.8,
          fillColor: polygonColor,
          fillOpacity: 0.15
        }).addTo(map);
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
    }).addTo(map);

    // Navn for visning
    const siteName = site.name || 'Ukjent lokalitet';
    let displayName = site.isSuper ? `🏷️ ${siteName}` : siteName;
    if (site.isMine) displayName = `★ ${siteName}`;

    // Beregn avstand
    const distance = haversine(userPosition.lat, userPosition.lon, lat, lon);
    let distStr = '';
    if (distance !== null) {
      distStr = distance < 1000
        ? `${Math.round(distance)} m`
        : `${(distance / 1000).toFixed(1)} km`;
    }

    // Popup med detaljert info (vises ved klikk)
    let popupHtml = `<strong>${displayName}</strong>`;
    if (distStr) {
      popupHtml += `<br>Avstand: ${distStr}`;
    }
    popupHtml += `<br><br><button onclick="selectLocation('${siteName.replace(/'/g, "\\'")}')">Velg denne lokaliteten</button>`;
    marker.bindPopup(popupHtml);

    // Tooltip med navn (vises permanent)
    const tooltipText = distStr ? `${siteName} (${distStr})` : siteName;
    marker.bindTooltip(tooltipText, {
      permanent: true,
      direction: 'top',
      className: site.isMine ? 'site-label mine-label' : 'site-label',
      offset: [0, -35]
    });

    // Klikk på markør velger lokalitet
    marker.on('click', () => {
      selectLocation(siteName);
    });

    // Legg til i bounds
    bounds.extend([lat, lon]);
    siteCount++;
  });
}

// Zoom kartet til å vise alle markers
if (siteCount > 0) {
  map.fitBounds(bounds, { padding: [50, 50] });

  // Vis info-boks
  const infoBox = document.getElementById('info-box');
  const siteCountEl = document.getElementById('site-count');
  if (infoBox && siteCountEl) {
    siteCountEl.textContent = siteCount;
    infoBox.style.display = 'block';
  }
}

/**
 * Sjekk om et site er privat (samme logikk som location.js)
 * @param {Object} site - Site-objekt
 * @returns {boolean} - true hvis privat
 */
function isPrivateSite(site) {
  if (!site || typeof site !== 'object') return false;

  const raw = site.raw && typeof site.raw === 'object' ? site.raw : site;
  if (!raw || typeof raw !== 'object') return false;

  // Bruk isPrivate-flagget fra AO
  if (Object.prototype.hasOwnProperty.call(raw, 'isPrivate')) {
    const v = raw.isPrivate;
    if (v === true || v === 'true') return true;
    if (v === false || v === 'false') return false;
  }

  if (Object.prototype.hasOwnProperty.call(raw, 'IsPrivate')) {
    const v = raw.IsPrivate;
    if (v === true || v === 'true') return true;
    if (v === false || v === 'false') return false;
  }

  return false;
}

/**
 * Velg lokalitet og gå tilbake til hovedsiden
 * @param {string} locationName - Navn på valgt lokalitet
 */
function selectLocation(locationName) {
  // Lagre valgt lokalitet i localStorage
  localStorage.setItem('selectedLocation', locationName);

  // Gå tilbake til hovedsiden
  window.location.href = '/';
}

// Gjør selectLocation tilgjengelig globalt for onclick i popup
window.selectLocation = selectLocation;

/**
 * Beregn avstand mellom to punkter (haversine-formel)
 * @param {number} lat1 - Latitude punkt 1
 * @param {number} lon1 - Longitude punkt 1
 * @param {number} lat2 - Latitude punkt 2
 * @param {number} lon2 - Longitude punkt 2
 * @returns {number|null} - Avstand i meter, eller null hvis ugyldig
 */
function haversine(lat1, lon1, lat2, lon2) {
  if (lat1 == null || lon1 == null || lat2 == null || lon2 == null) return null;
  const R = 6371e3; // Jordens radius i meter
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}
