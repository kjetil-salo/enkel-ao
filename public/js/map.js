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
  sites.forEach(site => {
    // Sjekk om site er privat (bruker samme logikk som location.js)
    const isPrivate = isPrivateSite(site);
    if (isPrivate) {
      return; // Hopp over private lokaliteter
    }

    const lat = parseFloat(site.lat);
    const lon = parseFloat(site.lon);

    if (isNaN(lat) || isNaN(lon)) {
      return;
    }

    // Velg farge basert på om det er superlokasjon
    const iconUrl = site.isSuper
      ? 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-orange.png'
      : 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png';

    const marker = L.marker([lat, lon], {
      icon: L.icon({
        iconUrl: iconUrl,
        shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
        iconSize: [25, 41],
        iconAnchor: [12, 41],
        popupAnchor: [1, -34],
        shadowSize: [41, 41]
      })
    }).addTo(map);

    // Navn for visning
    const siteName = site.name || 'Ukjent lokalitet';
    const displayName = site.isSuper ? `🏷️ ${siteName}` : siteName;

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
    marker.bindPopup(popupHtml);

    // Tooltip med navn (vises permanent)
    const tooltipText = distStr ? `${siteName} (${distStr})` : siteName;
    marker.bindTooltip(tooltipText, {
      permanent: true,
      direction: 'top',
      className: 'site-label',
      offset: [0, -35]
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
