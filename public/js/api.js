/**
 * API-modul for kommunikasjon med backend
 */

// localStorage-basert cache for artssøk med 1 års TTL
const SPECIES_CACHE_PREFIX = 'species_';
const SPECIES_CACHE_TTL = 365 * 24 * 60 * 60 * 1000; // 1 år

// Cache for private lokasjoner
const PRIVATE_SITES_KEY = 'ao_private_sites';
const PRIVATE_SITES_TTL = 24 * 60 * 60 * 1000; // 24 timer

/**
 * Hent cachet liste over brukerens private lokasjoner
 * @returns {Array} - Liste med {id, name, lat, lon, acc}, eller tom liste
 */
export function getCachedPrivateSites() {
  try {
    const item = localStorage.getItem(PRIVATE_SITES_KEY);
    if (!item) return [];
    const { ts, sites } = JSON.parse(item);
    if (Date.now() - ts > PRIVATE_SITES_TTL) return [];
    return Array.isArray(sites) ? sites : [];
  } catch {
    return [];
  }
}

/**
 * Hent og cache alle brukerens private lokasjoner fra AO
 * Kjøres i bakgrunnen etter innlogging
 */
export async function fetchAndCachePrivateSites() {
  try {
    const tokens = JSON.parse(localStorage.getItem('ao_tokens') || '{}');
    if (!tokens.authCookie) return;
    const headers = { 'X-AO-Auth-Cookie': tokens.authCookie };
    if (tokens.loginToken) headers['X-AO-Login-Token'] = tokens.loginToken;
    if (tokens.userId) headers['X-AO-User-Id'] = tokens.userId;
    const resp = await fetch('/api/ao-private-sites', { headers });
    if (!resp.ok) return;
    const data = await resp.json();
    // Persister fornyet auth-cookie hvis sesjonen ble revitalisert server-side
    if (data.refreshedAuthCookie) {
      tokens.authCookie = data.refreshedAuthCookie;
      localStorage.setItem('ao_tokens', JSON.stringify(tokens));
    }
    if (!Array.isArray(data.sites)) return;
    localStorage.setItem(PRIVATE_SITES_KEY, JSON.stringify({ ts: Date.now(), sites: data.sites }));
    console.log(`[AO] Cachet ${data.sites.length} private lokasjoner`);
  } catch (e) {
    console.warn('[AO] Kunne ikke hente private lokasjoner:', e);
  }
}

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
 * Auto-relogin med lagrede credentials
 * @returns {Promise<boolean>} - true hvis relogin var vellykket
 */
async function tryAutoRelogin() {
  const username = localStorage.getItem('ao_username');
  const password = localStorage.getItem('ao_password');

  if (!username || !password) {
    console.log('[Auto-relogin] Ingen lagrede credentials');
    return false;
  }

  console.log('[Auto-relogin] Prøver å logge inn på nytt...');

  try {
    const response = await fetch('/api/ao-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    if (!response.ok) {
      console.warn('[Auto-relogin] Innlogging feilet:', response.status);
      return false;
    }

    const result = await response.json();

    if (result.success) {
      // Oppdater tokens i localStorage
      const savedTokens = JSON.parse(localStorage.getItem('ao_tokens') || '{}');
      savedTokens.loginToken = result.loginToken;
      savedTokens.authCookie = result.authCookie;
      // Behold eksisterende userId/mapUserId hvis satt
      if (!savedTokens.userId) {
        savedTokens.userId = result.userId;
      }
      localStorage.setItem('ao_tokens', JSON.stringify(savedTokens));
      console.log('[Auto-relogin] Vellykket! Nye tokens lagret.');
      fetchAndCachePrivateSites();
      return true;
    }
  } catch (e) {
    console.warn('[Auto-relogin] Feil:', e);
  }

  return false;
}

/**
 * Hent AO-lokaliteter nær posisjon
 * @param {number} lat - Breddegrad
 * @param {number} lon - Lengdegrad
 * @param {number} sizeMeters - Radius i meter
 * @param {boolean} isRetry - Om dette er et retry etter auto-relogin
 * @returns {Promise<Array>} - Liste med lokaliteter
 */
export async function fetchAoSites(lat, lon, sizeMeters = 1000, isRetry = false) {
  let url = `/api/ao-sites?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&size=${encodeURIComponent(sizeMeters)}`;

  // Hent tokens fra localStorage og send som headers
  const headers = {};
  let hadTokens = false;
  try {
    const savedTokens = JSON.parse(localStorage.getItem('ao_tokens') || '{}');
    if (savedTokens.userId) {
      headers['X-AO-User-Id'] = savedTokens.userId;
    }
    if (savedTokens.loginToken) {
      headers['X-AO-Login-Token'] = savedTokens.loginToken;
      hadTokens = true;
    }
    if (savedTokens.authCookie) {
      headers['X-AO-Auth-Cookie'] = savedTokens.authCookie;
    }
  } catch (e) {
    // Ignorer feil ved parsing
  }

  const resp = await fetch(url, { headers });
  if (!resp.ok) {
    return [];
  }

  const data = await resp.json();
  if (!data) return [];

  // Håndter refreshed auth cookie hvis mottatt
  if (data.refreshedAuthCookie) {
    try {
      const savedTokens = JSON.parse(localStorage.getItem('ao_tokens') || '{}');
      savedTokens.authCookie = data.refreshedAuthCookie;
      localStorage.setItem('ao_tokens', JSON.stringify(savedTokens));
      console.log('[AO] Oppdaterte auth cookie fra sliding expiration');

      // Dispatch custom event for å notifisere ao-direct.html
      window.dispatchEvent(new CustomEvent('ao_tokens_updated', {
        detail: { source: 'ao-sites', tokens: savedTokens }
      }));
    } catch (e) {
      console.warn('[AO] Kunne ikke lagre refreshed auth cookie:', e);
    }
  }

  // Backend håndterer all auth-refresh (sliding → logintoken → credentials).
  // Frontend prøver kun auto-relogin som siste utvei når backend eksplisitt sier authRequired
  // OG backend ikke allerede refreshet (unngår dobbel-refresh race condition).
  if (!isRetry && data.authRequired && !data.refreshedAuthCookie && hadTokens) {
    console.log('[AO] Backend indikerer ugyldig auth, prøver frontend auto-relogin...');
    const reloginOk = await tryAutoRelogin();
    if (reloginOk) {
      return fetchAoSites(lat, lon, sizeMeters, true);
    } else {
      console.log('[AO] Auto-relogin feilet - bruker må logge inn manuelt');
    }
  }

  if (!data || !Array.isArray(data.sites)) {
    return [];
  }

  return data.sites.filter(s => s && typeof s.name === 'string' && s.name.trim());
}

/**
 * Opprett ny AO-lokasjon
 * @param {string} name - Navn på lokasjon
 * @param {number} lat - Breddegrad
 * @param {number} lon - Lengdegrad
 * @param {number} accuracy - Nøyaktighet i meter
 * @returns {Promise<Object>} - {success, siteId, message}
 */
/**
 * Sikre at ao_tokens er satt — logg inn automatisk hvis de mangler
 * @returns {Promise<boolean>} true hvis tokens er tilgjengelige
 */
export async function ensureAoTokens() {
  const tokens = JSON.parse(localStorage.getItem('ao_tokens') || '{}');
  if (tokens.loginToken && tokens.authCookie) return true;

  const username = localStorage.getItem('ao_username');
  const password = localStorage.getItem('ao_password');
  if (!username || !password) return false;

  const resp = await fetch('/api/ao-login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const result = await resp.json();
  if (!resp.ok || !result.success) return false;

  const saved = JSON.parse(localStorage.getItem('ao_tokens') || '{}');
  saved.loginToken = result.loginToken;
  saved.authCookie = result.authCookie;
  if (!saved.userId) saved.userId = result.userId;
  localStorage.setItem('ao_tokens', JSON.stringify(saved));
  return true;
}

export async function createAoSite(name, lat, lon, accuracy) {
  const savedTokens = JSON.parse(localStorage.getItem('ao_tokens') || '{}');
  const loginToken = savedTokens.loginToken;
  const authCookie = savedTokens.authCookie;

  if (!loginToken || !authCookie) {
    return { success: false, message: 'Ikke innlogget på AO' };
  }

  const resp = await fetch('/api/ao-create-site', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, lat, lon, accuracy, loginToken, authCookie }),
  });

  const data = await resp.json();

  // Oppdater refreshed auth cookie
  if (data.refreshedAuthCookie) {
    savedTokens.authCookie = data.refreshedAuthCookie;
    localStorage.setItem('ao_tokens', JSON.stringify(savedTokens));
  }

  return data;
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
