/**
 * API-modul for kommunikasjon med backend
 */

import { haversine } from './utils.js';

// localStorage-basert cache for artssøk med 1 års TTL
const SPECIES_CACHE_PREFIX = 'species_';
const SPECIES_CACHE_TTL = 365 * 24 * 60 * 60 * 1000; // 1 år

// Cache for private lokasjoner
const PRIVATE_SITES_KEY = 'ao_private_sites';
const PRIVATE_SITES_TTL = 24 * 60 * 60 * 1000; // 24 timer

// Cache for offentlige/bbox-lokaliteter hentet ved panorering på kartet
// (map.js). Helt offentlige AO-lokaliteter opprettes svært sjelden (appen har
// eksistert i 15 år) — 7 dagers TTL dekker Espens bruksmønster («95 % av
// tiden på Bømlo») uten reell fare for at nye lokaliteter forblir usynlige
// lenge. Brukerens EGNE nyopprettede lokasjoner er upåvirket av denne cachen:
// de legges rett inn i PRIVATE_SITES_KEY over ved opprettelse (se
// createAoSite under) og slås sammen med bbox-resultatet ved hver visning,
// uansett hvor gammelt selve bbox-cache-treffet er.
const BBOX_CACHE_KEY = 'ao_bbox_cache_v1';
const BBOX_CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 dager
// Holdt lavt med vilje: hver AO-respons kan inneholde opptil 1000 sites
// (maxSites, se src/api_handlers.py) med fullt `raw`-objekt hver (polygoner
// m.m.) — i en tett by kan én eneste slik respons bli flere hundre KB. Et
// par favorittsteder (Espens Bømlo-bruk) er det reelle målet, ikke en
// generell flate-cache over hele landet, så 5 gir god nok dekning uten å
// presse localStorage-kvoten (typisk 5–10 MB per origin, delt med resten
// av appens egne cacher) i verstefall-scenarioet.
const BBOX_CACHE_MAX_ENTRIES = 5;
// Et cachet treff gjenbrukes kun for et senter innenfor denne avstanden fra
// det som faktisk ble hentet — nok til å dekke normal GPS-unøyaktighet og
// småpanorering, uten å late som et helt annet sted er «det samme».
const BBOX_CACHE_MATCH_DISTANCE_M = 300;

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
 * Sjekk om private lokasjoner er hentet og fortsatt friske — UAVHENGIG av om
 * resultatet var tomt. `getCachedPrivateSites().length === 0` klarer ikke å
 * skille «aldri hentet ennå» fra «hentet, brukeren har faktisk null private
 * lokasjoner» — for en bruker uten egne private lokasjoner var den andre
 * tilstanden PERMANENT, og ga et ekte, ekstra nettverkskall til
 * `/api/ao-private-sites` ved HVER eneste kall til ensureAoTokens() (altså
 * hver panorering på kartet), for alltid. Brukt i stedet for lengde-sjekken
 * der ensureAoTokens() avgjør om fetchAndCachePrivateSites() trengs.
 * @returns {boolean}
 */
export function hasFreshPrivateSitesCache() {
  try {
    const item = localStorage.getItem(PRIVATE_SITES_KEY);
    if (!item) return false;
    const { ts } = JSON.parse(item);
    return Date.now() - ts <= PRIVATE_SITES_TTL;
  } catch {
    return false;
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
    const savedUsername = localStorage.getItem('ao_username');
    if (savedUsername) headers['X-AO-Username'] = savedUsername;
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
      // Ventet på — se samme begrunnelse i ensureAoTokens(). Kalleren her
      // (fetchAoSites) gjør et nytt fetchAoSites-kall rett etter relogin, som
      // igjen leser denne cachen synkront for isMine-merking.
      await fetchAndCachePrivateSites();
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
    const savedUsername = localStorage.getItem('ao_username');
    if (savedUsername) headers['X-AO-Username'] = savedUsername;
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

function getBboxCacheEntries() {
  try {
    const raw = JSON.parse(localStorage.getItem(BBOX_CACHE_KEY) || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch (e) {
    return [];
  }
}

function saveBboxCacheEntries(entries) {
  try {
    localStorage.setItem(BBOX_CACHE_KEY, JSON.stringify(entries));
  } catch (e) {
    // localStorage full/utilgjengelig — cachen er kun en optimalisering,
    // ikke kritisk om den ikke lar seg lagre (samme prinsipp som ellers i
    // denne fila, se setCachedSpecies).
  }
}

/**
 * Som fetchAoSites(), men med en lokal 7-dagers cache for å spare gjentatte
 * kall til samme kartområde over tid (se BBOX_CACHE_TTL over). Cacher den RÅ
 * AO-responsen (kun offentlige/bbox-lokaliteter) — brukerens egne private
 * lokasjoner ligger i en helt separat, alltid fersk cache
 * (getCachedPrivateSites) og slås sammen med resultatet herfra ved hver
 * visning, uavhengig av hvor gammelt selve bbox-treffet er.
 *
 * Et cache-treff krever at et tidligere hentet punkt ligger innenfor
 * BBOX_CACHE_MATCH_DISTANCE_M fra `lat,lon` OG dekket minst `radiusMeters` —
 * en cachet liste hentet med en MINDRE radius enn det som nå trengs
 * inneholder ikke nødvendigvis alt som skal vises, og brukes derfor ikke.
 *
 * Partisjonert på innlogget AO-brukernavn (eller "anonym" hvis ingen): selve
 * AO-svaret markerer `isMine` ut fra HVEM som spør, ikke bare hvor. Uten
 * dette ville en logg-inn/logg-ut eller brukerbytte kunne gjenbruke et
 * cachet svar beregnet for en annen identitet — egne lokasjoner ville da
 * feilaktig vist som andres (eller omvendt) i opptil 7 dager.
 *
 * @param {number} lat
 * @param {number} lon
 * @param {number} radiusMeters
 * @returns {Promise<Array>}
 */
export async function fetchAoSitesCached(lat, lon, radiusMeters) {
  const now = Date.now();
  const userKey = localStorage.getItem('ao_username') || '__anon__';
  const entries = getBboxCacheEntries().filter(e => now - e.ts < BBOX_CACHE_TTL);

  const hit = entries.find(e => {
    if (e.userKey !== userKey) return false;
    if (e.radius < radiusMeters) return false;
    const dist = haversine(lat, lon, e.lat, e.lon);
    return dist != null && dist <= BBOX_CACHE_MATCH_DISTANCE_M;
  });
  if (hit) {
    return hit.sites;
  }

  const sites = await fetchAoSites(lat, lon, radiusMeters);

  // Ikke cache et tomt resultat: backend degraderer alltid ekstern-API-feil
  // til en tom, men HTTP 200-liste (se CLAUDE.md, "External API Error
  // Handling") — en forbigående AO-feil er derfor umulig å skille fra et
  // genuint tomt område her. Å cache den ville låst fast en tilfeldig
  // glipp som "bekreftet tomt" i opptil 7 dager. Et ekte tomt område er
  // uansett billig å spørre på nytt — ingen treff å hente uansett.
  if (sites.length > 0) {
    const updated = [{ lat, lon, radius: radiusMeters, sites, userKey, ts: now }, ...entries];
    saveBboxCacheEntries(updated.slice(0, BBOX_CACHE_MAX_ENTRIES));
  }

  return sites;
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
  let ok = !!(tokens.loginToken && tokens.authCookie);

  if (!ok) {
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
    ok = true;
  }

  // Både «tokens akkurat etablert» og «tokens fantes fra før, men cachen med
  // private lokasjoner er ALDRI HENTET (eller utløpt)» skal utløse henting —
  // ellers ser en bruker som logget inn et helt annet sted (f.eks.
  // Innstillinger, som ikke selv lagrer tokens) ingen private lokaliteter før
  // neste sideinnlasting. `hasFreshPrivateSitesCache()` — IKKE
  // `getCachedPrivateSites().length === 0` — avgjør dette: en bruker som
  // faktisk har null private lokasjoner ville ellers sett denne betingelsen
  // være sann for alltid, og fått et ekte, ekstra nettverkskall til
  // /api/ao-private-sites ved HVER eneste ensureAoTokens()-kall (altså hver
  // panorering på kartet) i uendelig tid — oppdaget som «kartet føles sakte
  // selv med cache» i felt, v1.53.19.
  //
  // MÅ ventes på (ikke fire-and-forget): kalleren gjør typisk fetchAoSites()
  // rett etter ensureAoTokens() returnerer, og setAoSiteSuggestions() leser
  // cachen synkront for å markere isMine. Uten await var dette en race —
  // kartet kunne rekke å tegne markørene (som grå «privat», ikke gul «min»)
  // før nettverkskallet til /api/ao-private-sites var ferdig.
  if (ok && !hasFreshPrivateSitesCache()) {
    await fetchAndCachePrivateSites();
  }
  return ok;
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

  // En helt ny privat lokasjon dukker ALDRI opp i /api/ao-sites (anonymt
  // ByBoundingBox-kall ser den aldri, og lokal-DB-cachen er en sjelden
  // batch-import) — kun i denne 24-timers-cachen. Uten en oppdatering her
  // ville nyopprettede private lokasjoner vært usynlige i «Velg lokasjon»
  // helt til cachen tilfeldigvis ble tom og fylt på nytt.
  //
  // Legger til lokalt fra det vi allerede vet (unngår en runde-tripp mot
  // AOs read-endepunkt rett etter en write — et refetch her kunne i verste
  // fall komme tilbake uten den splitter nye siden og stille la bugen bestå).
  if (data.success && data.siteId) {
    try {
      const existing = getCachedPrivateSites().filter(s => s.id !== data.siteId);
      const newSite = { id: data.siteId, name: data.siteName || name, lat, lon, acc: accuracy };
      localStorage.setItem(PRIVATE_SITES_KEY, JSON.stringify({ ts: Date.now(), sites: [newSite, ...existing] }));
    } catch (e) {
      // localStorage utilgjengelig — ikke kritisk, tas igjen ved neste normale refresh
    }
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
