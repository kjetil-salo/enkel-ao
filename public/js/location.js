/**
 * Location-modul for geolokasjon og AO-sites
 */


import { fetchAoSites } from './api.js';
import { setLocationStatus, haversine } from './ui.js';


/**
 * Sjekk om et site er privat
 * @param {Object} site - Site-objekt
 * @returns {boolean} - true hvis privat
 */
export function isPrivateSite(site) {
  if (!site || typeof site !== 'object') return false;
  
  const raw = site.raw && typeof site.raw === 'object' ? site.raw : site;
  if (!raw || typeof raw !== 'object') return false;

  // Bruk isPrivate-flagget fra AO. Kun eksplisitt true / "true" er privat.
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
 * Hent navn på site
 * @param {Object} site - Site-objekt
 * @returns {string} - Site-navn
 */
export function getSiteLabel(site) {
  if (!site || typeof site !== 'object') return '';
  
  // Bruk konsekvent "name" fra AO som lokalitetsnavn
  if (typeof site.name === 'string' && site.name.trim()) {
    return site.name.trim();
  }
  
  const raw = site.raw && typeof site.raw === 'object' ? site.raw : site;
  if (raw && typeof raw.name === 'string' && raw.name.trim()) {
    return raw.name.trim();
  }
  
  return '';
}

/**
 * Sett AO-site forslag i dropdown
 * @param {Array} sites - Liste med sites
 * @param {Object} currentPosition - Nåværende posisjon {lat, lon}
 * @param {HTMLElement} dropdown - Dropdown-element
 * @param {HTMLElement} aoSitesEl - AO-sites info-element
 * @param {HTMLInputElement} placeInput - Stedsnavn input-felt
 * @param {Function} setCurrentPlace - Callback for å sette nåværende sted
 * @returns {Array} - Oppdatert liste med sites
 */
export function setAoSiteSuggestions(sites, currentPosition, dropdown, aoSitesEl, placeInput, setCurrentPlace) {
  console.log('currentPosition:', currentPosition);
  
  const currentAoSites = Array.isArray(sites) ? sites : [];
  
  if (!dropdown) return currentAoSites;
  
  dropdown.innerHTML = '';
  dropdown.style.display = 'block';
  aoSitesEl.style.display = 'none';

  if (!currentAoSites.length) {
    dropdown.style.display = 'none';
    aoSitesEl.innerHTML = 'Ingen lokasjoner fra Artsobservasjoner i nærheten.';
    aoSitesEl.style.display = 'block';
    return currentAoSites;
  }

  // Sorter: superlokasjon > offentlig > privat, deretter på avstand
  const userLat = currentPosition && typeof currentPosition.lat === 'number' ? currentPosition.lat : null;
  const userLon = currentPosition && typeof currentPosition.lon === 'number' ? currentPosition.lon : null;
  
  if (userLat == null || userLon == null) {
    aoSitesEl.innerHTML = 'Kan ikke vise avstand til lokasjoner fordi posisjonen til enheten ikke er tilgjengelig. Godta posisjonsdeling i nettleseren.';
    aoSitesEl.style.display = 'block';
  }
  
  const withDist = currentAoSites.map(site => {
    let dist = null;
    const lat = parseFloat(site.lat);
    const lon = parseFloat(site.lon);
    if (userLat != null && userLon != null && !isNaN(lat) && !isNaN(lon)) {
      dist = haversine(userLat, userLon, lat, lon);
    }
    return { ...site, _distance: dist };
  });
  
  withDist.sort((a, b) => {
    // Superlokasjon først
    if ((a.isSuper ? 1 : 0) !== (b.isSuper ? 1 : 0)) return (b.isSuper ? 1 : 0) - (a.isSuper ? 1 : 0);
    // Offentlig før privat
    if (isPrivateSite(a) !== isPrivateSite(b)) return isPrivateSite(a) - isPrivateSite(b);
    // Mine lokaliteter (⭐) først blant private
    if ((a.isMine ? 1 : 0) !== (b.isMine ? 1 : 0)) return (b.isMine ? 1 : 0) - (a.isMine ? 1 : 0);
    // Nærmest først
    if (a._distance != null && b._distance != null) return a._distance - b._distance;
    return 0;
  });

  // Maks 20 elementer
  const visibleSites = withDist.filter(s => s && typeof s.name === 'string' && s.name.trim()).slice(0, 20);

  
  if (!visibleSites.length) {
    dropdown.style.display = 'none';
    aoSitesEl.innerHTML = 'Ingen lokasjoner fra Artsobservasjoner i nærheten.';
    aoSitesEl.style.display = 'block';
    return currentAoSites;
  }

  // Legg til en tom "Velg lokasjon"-rad
  const emptyDiv = document.createElement('div');
  emptyDiv.className = 'ao-site-suggestion ao-site-empty';
  emptyDiv.textContent = 'Velg lokasjon...';
  emptyDiv.style.color = 'var(--muted)';
  emptyDiv.style.cursor = 'default';
  dropdown.appendChild(emptyDiv);

  visibleSites.forEach((site) => {
    const item = document.createElement('div');
    item.className = 'ao-site-suggestion';
    item.style.display = 'flex';
    item.style.justifyContent = 'space-between';
    item.style.alignItems = 'center';
    item.style.gap = '8px';

    // Tekstdel
    const textSpan = document.createElement('span');
    textSpan.style.flex = '1';

    let label = getSiteLabel(site) || site.name;
    if (site.isMine) label = '⭐ ' + label;
    if (site.isSuper) label = '🏷️ ' + label;
    if (isPrivateSite(site)) label = '🔒 ' + label;

    let distStr = '';
    if (site._distance != null) {
      distStr = site._distance < 1000
        ? ` (${Math.round(site._distance)} m)`
        : ` (${(site._distance / 1000).toFixed(1)} km)`;
    }

    label = label + distStr;
    textSpan.textContent = label;
    textSpan.tabIndex = 0;

    const selectSite = () => {
      const name = getSiteLabel(site) || site.name;
      setCurrentPlace(name);
      if (placeInput) {
        placeInput.value = name;
        placeInput.dataset.autofilled = 'true';
      }
      dropdown.style.display = 'none';
    };

    textSpan.addEventListener('click', selectSite);
    textSpan.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        selectSite();
      }
    });

    // Kartknapp
    const mapBtn = document.createElement('button');
    mapBtn.textContent = '🗺️';
    mapBtn.title = 'Vis i kart';
    mapBtn.style.cssText = `
      background: transparent;
      border: 1px solid rgba(148, 163, 184, 0.3);
      border-radius: 6px;
      padding: 4px 8px;
      cursor: pointer;
      font-size: 1rem;
      opacity: 0.7;
      transition: all 0.2s;
      flex-shrink: 0;
    `;

    mapBtn.addEventListener('mouseenter', () => {
      mapBtn.style.opacity = '1';
      mapBtn.style.background = 'rgba(59, 130, 246, 0.15)';
      mapBtn.style.borderColor = 'rgba(59, 130, 246, 0.6)';
    });

    mapBtn.addEventListener('mouseleave', () => {
      mapBtn.style.opacity = '0.7';
      mapBtn.style.background = 'transparent';
      mapBtn.style.borderColor = 'rgba(148, 163, 184, 0.3)';
    });

    mapBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openMapWithTwoPoints(currentPosition, { lat: site.lat, lon: site.lon }, getSiteLabel(site) || site.name);
    });

    item.appendChild(textSpan);
    item.appendChild(mapBtn);
    dropdown.appendChild(item);
  });
  
  return currentAoSites;
}

/**
 * Initialiser geolokasjon
 * @param {Object} elements - Objekt med DOM-elementer
 * @param {Function} onPositionUpdate - Callback når posisjon er oppdatert
 * @param {number} aoSizeMeters - Radius for AO-sites søk
 */
export function initLocation(elements, onPositionUpdate, aoSizeMeters = 1000) {
  const { locBtn, locMapBtn, locDot, locText } = elements;
  
  console.log('[initLocation] Kalles');
  
  if (!locBtn) {
    console.warn('[initLocation] Fant ikke #loc-btn');
    return;
  }
  
  console.log('[initLocation] Fant #loc-btn, setter event-listener');
  
  if (!navigator.geolocation) {
    setLocationStatus(locDot, locText, 'error', 'Ingen geolokasjon-støtte i denne nettleseren.');
    return;
  }

  // Gjenopprett lagret status fra localStorage hvis tilgjengelig
  try {
    const savedStatus = localStorage.getItem('locationStatus');
    if (savedStatus) {
      const { mode, text } = JSON.parse(savedStatus);
      // Gjenopprett status uten å oppdatere klokkeslett
      if (locText) locText.textContent = text;
      if (locDot) {
        if (mode === 'ok') {
          locDot.style.background = '#22c55e';
        } else if (mode === 'error') {
          locDot.style.background = '#ef4444';
        } else {
          locDot.style.background = '#6b7280';
        }
      }
    } else {
      setLocationStatus(locDot, locText, 'idle', 'Trykk «Oppdater lokasjon» før registrering.');
    }
  } catch (e) {
    // Hvis localStorage feiler, bruk default
    setLocationStatus(locDot, locText, 'idle', 'Trykk «Oppdater lokasjon» før registrering.');
  }

  locBtn.addEventListener('click', () => {
    console.log('[loc-btn] Klikk registrert, starter geolokasjon');
    setLocationStatus(locDot, locText, 'pending', 'Henter lokasjon …');
    locBtn.disabled = true;

    // Les radius direkte fra inputfeltet hvis det finnes
    let effectiveAoSize = aoSizeMeters;
    const aoSizeInput = document.getElementById('ao-size');
    if (aoSizeInput) {
      const v = parseFloat(aoSizeInput.value);
      if (!isNaN(v) && v > 0) {
        effectiveAoSize = v;
      }
    }

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const currentPosition = {
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        };

        const { lat, lon, accuracy } = currentPosition;
        const latStr = lat.toFixed(5);
        const lonStr = lon.toFixed(5);
        const accStr = Math.round(accuracy);

        setLocationStatus(locDot, locText, 'ok', 'Lokasjon hentet');

        if (locText) {
          locText.title = `${latStr}, ${lonStr} (±${accStr} m)`;
        }

        // Hent forslag til lokaliteter fra Artsobservasjoner med OPPDATERT radius

        try {
          const sites = await fetchAoSites(lat, lon, effectiveAoSize);
          onPositionUpdate(currentPosition, sites);
        } catch (err) {
          console.warn('Feil ved henting av AO-lokaliteter', err);
          onPositionUpdate(currentPosition, []);
        }
        // Oppdater kartknappens synlighet etter posisjonsoppdatering
        if (typeof updateMapBtnVisibility === 'function') updateMapBtnVisibility();


        if (locMapBtn) {
          locMapBtn.style.display = 'block';
        }
        // Oppdater kartknappens synlighet
        if (typeof updateMapBtnVisibility === 'function') updateMapBtnVisibility();

        locBtn.disabled = false;
      },
      (err) => {
        console.warn('Feil ved geolokasjon', err);
        setLocationStatus(locDot, locText, 'error', 'Kunne ikke hente lokasjon. Sjekk tillatelser og prøv igjen.');

        onPositionUpdate(null, []);
        if (locMapBtn) {
          locMapBtn.style.display = 'none';
        }
        // Oppdater kartknappens synlighet
        if (typeof updateMapBtnVisibility === 'function') updateMapBtnVisibility();
        locBtn.disabled = false;
      },
      {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 30000,
      }
    );
  });
}

/**
 * Åpne kart med nåværende posisjon
 * Bruker native kart-app på mobil (Apple Maps/Google Maps), Google Maps på desktop
 * @param {Object} position - Posisjon {lat, lon}
 */
export function openMap(position) {
  if (!position) return;

  const { lat, lon } = position;

  // Detekter plattform
  const ua = navigator.userAgent || '';
  const isIOS = /iPhone|iPad|iPod/.test(ua);
  const isAndroid = /Android/.test(ua);

  let url;

  if (isIOS) {
    // Apple Maps på iOS
    url = `https://maps.apple.com/?q=${encodeURIComponent(lat)},${encodeURIComponent(lon)}&ll=${encodeURIComponent(lat)},${encodeURIComponent(lon)}&z=16`;
  } else if (isAndroid) {
    // Google Maps på Android
    url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(lat)},${encodeURIComponent(lon)}`;
  } else {
    // Desktop: Google Maps
    url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(lat)},${encodeURIComponent(lon)}`;
  }

  window.open(url, '_blank', 'noopener');
}

/**
 * Åpne kartside med brukerposisjon og alle AO-lokaliteter
 * @param {Object} userPosition - Brukerens posisjon {lat, lon, accuracy}
 * @param {Array} sites - Liste med AO-lokaliteter
 */
export function openMapPage(userPosition, sites) {
  if (!userPosition || !userPosition.lat || !userPosition.lon) {
    console.warn('openMapPage: Mangler brukerposisjon');
    return;
  }

  // Lagre data i localStorage
  const mapData = {
    userPosition: {
      lat: userPosition.lat,
      lon: userPosition.lon,
      accuracy: userPosition.accuracy
    },
    sites: sites || []
  };

  localStorage.setItem('mapData', JSON.stringify(mapData));

  // Åpne kartside
  window.open('/map.html', '_blank');
}

/**
 * Åpne kart med to punkter (egen posisjon og lokalitet)
 * Bruker native kart-app på mobil (Apple Maps/Google Maps), Google Maps på desktop
 * @param {Object} fromPos - Fra-posisjon {lat, lon}
 * @param {Object} toPos - Til-posisjon {lat, lon}
 * @param {string} locationName - Navn på destinasjonen
 */
export function openMapWithTwoPoints(fromPos, toPos, locationName = 'Lokalitet') {
  if (!fromPos || !toPos) {
    console.warn('openMapWithTwoPoints: Mangler posisjon(er)');
    return;
  }

  const fromLat = fromPos.lat;
  const fromLon = fromPos.lon;
  const toLat = parseFloat(toPos.lat);
  const toLon = parseFloat(toPos.lon);

  if (isNaN(toLat) || isNaN(toLon)) {
    console.warn('openMapWithTwoPoints: Ugyldig til-posisjon', toPos);
    return;
  }

  // Detekter plattform
  const ua = navigator.userAgent || '';
  const isIOS = /iPhone|iPad|iPod/.test(ua);
  const isAndroid = /Android/.test(ua);

  let url;

  if (isIOS) {
    // Apple Maps på iOS - støtter directions med saddr og daddr
    url = `https://maps.apple.com/?saddr=${encodeURIComponent(fromLat)},${encodeURIComponent(fromLon)}&daddr=${encodeURIComponent(toLat)},${encodeURIComponent(toLon)}&dirflg=d`;
  } else if (isAndroid) {
    // Google Maps på Android - bruker saddr og daddr for directions
    url = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(fromLat)},${encodeURIComponent(fromLon)}&destination=${encodeURIComponent(toLat)},${encodeURIComponent(toLon)}&travelmode=driving`;
  } else {
    // Desktop: Google Maps directions
    url = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(fromLat)},${encodeURIComponent(fromLon)}&destination=${encodeURIComponent(toLat)},${encodeURIComponent(toLon)}&travelmode=driving`;
  }

  window.open(url, '_blank', 'noopener');
}

