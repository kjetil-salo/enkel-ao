/**
 * API-modul for kommunikasjon med backend
 */

// Enkel in-memory cache for artssøk med 1 time TTL
const speciesCache = {};

/**
 * Søk etter arter i Artsobservasjoner
 * @param {string} term - Søkestreng
 * @param {boolean} includeSubtaxa - Om undertaxa skal inkluderes
 * @returns {Promise<Array>} - Liste med arter
 */
export async function searchSpecies(term, includeSubtaxa = false) {
  const q = term.trim();
  
  if (q.length < 2) {
    return [];
  }

  // Cache-nøkkel: søkestreng + includeSubtaxa
  const cacheKey = `${q}::${includeSubtaxa ? 'sub' : 'nosub'}`;
  const now = Date.now();
  
  // Sjekk cache
  if (speciesCache[cacheKey] && (now - speciesCache[cacheKey].ts < 3600_000)) {
    return speciesCache[cacheKey].data;
  }

  let url = `/api/species?search=${encodeURIComponent(q)}`;
  url += `&dontIncludeSubSpecies=${includeSubtaxa ? 'false' : 'true'}`;
  
  console.log('Arts-søk URL:', url);
  
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}`);
  }
  
  const data = await resp.json();
  
  // Lagre i cache
  speciesCache[cacheKey] = { data, ts: now };
  
  return Array.isArray(data) ? data : [];
}

/**
 * Hent AO-lokaliteter nær posisjon
 * @param {number} lat - Breddegrad
 * @param {number} lon - Lengdegrad
 * @param {number} sizeMeters - Radius i meter
 * @returns {Promise<Array>} - Liste med lokaliteter
 */
export async function fetchAoSites(lat, lon, sizeMeters = 1000) {
  const url = `/api/ao-sites?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&size=${encodeURIComponent(sizeMeters)}`;
  
  const resp = await fetch(url);
  if (!resp.ok) {
    return [];
  }
  
  const data = await resp.json();
  if (!data || !Array.isArray(data.sites)) {
    return [];
  }
  
  return data.sites.filter(s => s && typeof s.name === 'string' && s.name.trim());
}

/**
 * Logg sidevisning til server
 */
export function logPageView() {
  fetch('/api/logview', { method: 'POST' }).catch(() => {});
}

/**
 * Last aktiviteter fra JSON-fil
 * @returns {Promise<Array>} - Liste med aktiviteter
 */
export async function loadActivities() {
  const resp = await fetch('/data/activities.json');
  return await resp.json();
}
