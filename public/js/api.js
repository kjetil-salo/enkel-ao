/**
 * API-modul for kommunikasjon med backend
 */

// localStorage-basert cache for artssøk med 1 års TTL
const SPECIES_CACHE_PREFIX = 'species_';
const SPECIES_CACHE_TTL = 365 * 24 * 60 * 60 * 1000; // 1 år

/**
 * Hent fra localStorage cache
 */
function getCachedSpecies(key) {
  try {
    const item = localStorage.getItem(SPECIES_CACHE_PREFIX + key);
    if (!item) return null;
    const { data, ts } = JSON.parse(item);
    if (Date.now() - ts > SPECIES_CACHE_TTL) {
      localStorage.removeItem(SPECIES_CACHE_PREFIX + key);
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

/**
 * Lagre i localStorage cache
 */
function setCachedSpecies(key, data) {
  try {
    localStorage.setItem(SPECIES_CACHE_PREFIX + key, JSON.stringify({ data, ts: Date.now() }));
  } catch {
    // localStorage full eller utilgjengelig - ignorer
  }
}

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

  // Cache-nøkkel: søkestreng (lowercase) + includeSubtaxa
  const cacheKey = `${q.toLowerCase()}::${includeSubtaxa ? 'sub' : 'nosub'}`;

  // Sjekk cache
  const cached = getCachedSpecies(cacheKey);
  if (cached) {
    return cached;
  }

  let url = `/api/species?search=${encodeURIComponent(q)}`;
  url += `&dontIncludeSubSpecies=${includeSubtaxa ? 'false' : 'true'}`;

  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}`);
  }

  const data = await resp.json();
  const result = Array.isArray(data) ? data : [];

  // Lagre i cache
  setCachedSpecies(cacheKey, result);

  return result;
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
