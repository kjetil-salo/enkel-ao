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
    // Nærmest først
    if (a._distance != null && b._distance != null) return a._distance - b._distance;
    return 0;
  });

  // Maks 20 elementer
  const visibleSites = withDist.filter(s => s && typeof s.name === 'string' && s.name.trim()).slice(0, 20);
  console.log('AO visibleSites:', visibleSites);
  
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
    
    let label = getSiteLabel(site) || site.name;
    if (site.isSuper) label = '🏷️ ' + label;
    if (isPrivateSite(site)) label = '🔒 ' + label;
    
    let distStr = '';
    if (site._distance != null) {
      distStr = site._distance < 1000 
        ? ` (${Math.round(site._distance)} m)` 
        : ` (${(site._distance / 1000).toFixed(1)} km)`;
    }
    
    label = label + distStr;
    item.textContent = label;
    item.tabIndex = 0;
    
    const selectSite = () => {
      const name = getSiteLabel(site) || site.name;
      setCurrentPlace(name);
      if (placeInput) {
        placeInput.value = name;
        placeInput.dataset.autofilled = 'true';
      }
      dropdown.style.display = 'none';
    };
    
    item.addEventListener('click', selectSite);
    item.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        selectSite();
      }
    });
    
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

  setLocationStatus(locDot, locText, 'idle', 'Trykk «Oppdater posisjon» før registrering.');

  locBtn.addEventListener('click', () => {
    console.log('[loc-btn] Klikk registrert, starter geolokasjon');
    setLocationStatus(locDot, locText, 'pending', 'Oppdaterer posisjon …');
    locBtn.disabled = true;

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
        
        setLocationStatus(locDot, locText, 'ok', 'Posisjon oppdatert');
        
        if (locText) {
          locText.title = `${latStr}, ${lonStr} (±${accStr} m)`;
        }
        
        // Hent forslag til lokaliteter fra Artsobservasjoner
        try {
          const sites = await fetchAoSites(lat, lon, aoSizeMeters);
          onPositionUpdate(currentPosition, sites);
        } catch (err) {
          console.warn('Feil ved henting av AO-lokaliteter', err);
          onPositionUpdate(currentPosition, []);
        }
        
        if (locMapBtn) {
          locMapBtn.disabled = false;
        }
        
        locBtn.disabled = false;
      },
      (err) => {
        console.warn('Feil ved geolokasjon', err);
        setLocationStatus(locDot, locText, 'error', 'Fikk ikke tak i posisjon. Sjekk tillatelser og prøv igjen.');
        onPositionUpdate(null, []);
        locBtn.disabled = false;
      },
      {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 10000,
      }
    );
  });
}

/**
 * Åpne kart med nåværende posisjon
 * @param {Object} position - Posisjon {lat, lon}
 */
export function openMap(position) {
  if (!position) return;
  
  const { lat, lon } = position;
  const url = `https://www.openstreetmap.org/?mlat=${encodeURIComponent(lat)}&mlon=${encodeURIComponent(lon)}#map=16/${encodeURIComponent(lat)}/${encodeURIComponent(lon)}`;
  window.open(url, '_blank', 'noopener');
}
