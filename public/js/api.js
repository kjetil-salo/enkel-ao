/**
 * API-modul for kommunikasjon med backend
 */

import { haversine } from './utils.js';
import { kontoKontekst, sammeKontoKontekst } from './arbeidsliste-sesjon.js';

// localStorage-basert cache for artssøk med 1 års TTL
const SPECIES_CACHE_PREFIX = 'species_';
const SPECIES_CACHE_TTL = 365 * 24 * 60 * 60 * 1000; // 1 år

// Cache for private lokasjoner
const PRIVATE_SITES_KEY = 'ao_private_sites';
const PRIVATE_SITES_TTL = 24 * 60 * 60 * 1000; // 24 timer
// En TOM cache får mye kortere levetid enn en full. To grunner:
//
// 1. Den kan være resultatet av et degradert svar lagret av en eldre versjon
//    (før `needsLogin`), og da er brukeren låst ut av sine egne lokaliteter i
//    et helt døgn — også etter at hun har logget inn på nytt.
// 2. «Null private lokaliteter» endrer seg i det brukeren oppretter sin første.
//
// 10 minutter er valgt for å slippe å gjeninnføre feilen fra v1.53.19: en
// bruker som FAKTISK har null private lokaliteter skal ikke få et nytt
// nettverkskall ved hver panorering på kartet. Ett kall per tiende minutt er
// en helt annen sak enn ett per panorering.
const PRIVATE_SITES_EMPTY_TTL = 10 * 60 * 1000; // 10 minutter
let privatOppslag = null;
let mislykketPrivatOppslag = null;

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
 * Sjekk om brukeren er innlogget på Artsobservasjoner (har gyldige sesjons-tokens
 * eller lagret brukernavn og passord på enheten).
 * @returns {boolean}
 */
export function hasActiveAoLogin() {
  try {
    const tokens = JSON.parse(localStorage.getItem('ao_tokens') || '{}');
    if (tokens && tokens.loginToken && tokens.authCookie) return true;
    const username = localStorage.getItem('ao_username');
    const password = localStorage.getItem('ao_password');
    return Boolean(username && password);
  } catch {
    return false;
  }
}

/**
 * Hent cachet liste over brukerens private lokasjoner
 * @returns {Array} - Liste med {id, name, lat, lon, acc}, eller tom liste
 */
export function getCachedPrivateSites() {
  try {
    if (!hasActiveAoLogin()) return [];
    const item = localStorage.getItem(PRIVATE_SITES_KEY);
    if (!item) return [];
    const { ts, sites, konto } = JSON.parse(item);
    if (konto && !sammeKontoKontekst(konto)) return [];
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
    const { ts, sites, konto } = JSON.parse(item);
    if (konto && !sammeKontoKontekst(konto)) return false;
    const tomCache = !Array.isArray(sites) || sites.length === 0;
    const levetid = tomCache ? PRIVATE_SITES_EMPTY_TTL : PRIVATE_SITES_TTL;
    return Date.now() - ts <= levetid;
  } catch {
    return false;
  }
}

/**
 * Hent og cache alle brukerens private lokasjoner fra AO
 * Kjøres i bakgrunnen etter innlogging
 */
export function lagrePrivateAoLokaliteter(sites, via) {
  if (via === 'ao3') sites = sites.map(site => ({ ...site, fraAo3: true }));
  localStorage.setItem(PRIVATE_SITES_KEY, JSON.stringify({ ts: Date.now(), sites, konto: kontoKontekst() }));
}

/**
 * Oppdater lagrede AO-tokens med det serveren eventuelt sendte tilbake etter en
 * stille sesjonsfornyelse — BÅDE en ny `.ASPXAUTHNO` og et eventuelt nytt, rotert
 * `logintoken`. AO gir et logintoken nøyaktig ÉN vellykket stille revival (se
 * docs/ao-token-autentisering.md korreksjon 6); uten å lagre det roterte tokenet
 * her ville enheten brukt opp sin ene sjanse og falt tilbake til passord for
 * alltid i stedet for å kunne fornyes via token igjen neste gang.
 * @param {{refreshedAuthCookie?: string, refreshedLoginToken?: string}} data
 * @returns {object|null} de oppdaterte tokens, eller null hvis ingenting å oppdatere
 */
export function oppdaterAoTokensFraRespons(data) {
  if (!data || (!data.refreshedAuthCookie && !data.refreshedLoginToken)) return null;
  try {
    const tokens = JSON.parse(localStorage.getItem('ao_tokens') || '{}');
    if (data.refreshedAuthCookie) tokens.authCookie = data.refreshedAuthCookie;
    if (data.refreshedLoginToken) tokens.loginToken = data.refreshedLoginToken;
    localStorage.setItem('ao_tokens', JSON.stringify(tokens));
    return tokens;
  } catch (e) {
    console.warn('[AO] Kunne ikke lagre fornyede AO-tokens:', e);
    return null;
  }
}

async function hentPrivateAo2Lokaliteter(tokens) {
  try {
    if (!tokens.authCookie) return;
    const headers = { 'X-AO-Auth-Cookie': tokens.authCookie };
    if (tokens.loginToken) headers['X-AO-Login-Token'] = tokens.loginToken;
    if (tokens.userId) headers['X-AO-User-Id'] = tokens.userId;
    const savedUsername = localStorage.getItem('ao_username');
    if (savedUsername) headers['X-AO-Username'] = savedUsername;
    const resp = await fetch('/api/ao-private-sites', { headers });
    if (resp.ok) return await resp.json();
  } catch {
    // AO3 kan fortsatt ha en fungerende innlogging.
  }
}

export async function fetchAndCachePrivateSites() {
  if (!hasActiveAoLogin()) return false;
  if (privatOppslag && sammeKontoKontekst(privatOppslag.konto)) return privatOppslag.svar;
  const konto = kontoKontekst();
  const passord = localStorage.getItem('ao_password');
  const sammeKonto = () => sammeKontoKontekst(konto) && passord === localStorage.getItem('ao_password');
  const oppslag = { konto };
  privatOppslag = oppslag;
  oppslag.svar = (async () => {
    try {
      let tokens = JSON.parse(localStorage.getItem('ao_tokens') || '{}');
      if (!tokens.authCookie && await loggInnMedLagretLegitimasjon('mangler-token')) {
        tokens = JSON.parse(localStorage.getItem('ao_tokens') || '{}');
      }
      if (!sammeKonto()) return false;
      let data = await hentPrivateAo2Lokaliteter(tokens);
      if (!sammeKonto()) return false;
      if (data && (data.refreshedAuthCookie || data.refreshedLoginToken)
          && tokens.authCookie === JSON.parse(localStorage.getItem('ao_tokens') || '{}').authCookie) {
        oppdaterAoTokensFraRespons(data);
      }
      if ((!data || data.needsLogin || data.degradert) && konto.brukernavn.includes('@') && passord) {
        const resp = await fetch('/api/ao-private-sites', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: konto.brukernavn, password: passord }),
        });
        data = resp.ok ? await resp.json() : null;
      }
      if (!sammeKonto() || !Array.isArray(data?.sites) || data.needsLogin || data.degradert) return false;
      lagrePrivateAoLokaliteter(data.sites, data.via);
      return true;
    } catch {
      return false;
    }
  })();
  try {
    const ok = await oppslag.svar;
    if (sammeKonto()) mislykketPrivatOppslag = ok ? null : { konto, til: Date.now() + 5 * 60_000 };
    return ok;
  } finally {
    if (privatOppslag === oppslag) privatOppslag = null;
  }
}

export async function ensureAoPrivateSites() {
  if (!hasActiveAoLogin()) return false;
  if (hasFreshPrivateSitesCache()) return true;
  if (mislykketPrivatOppslag && Date.now() < mislykketPrivatOppslag.til
      && sammeKontoKontekst(mislykketPrivatOppslag.konto)) {
    return false;
  }
  return fetchAndCachePrivateSites();
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
  // Kalles kun når backend har et token fra før og eksplisitt avviser det
  // (authRequired) — altså en reell token-utløpsrelogin, ikke "aldri logget inn".
  if (!await loggInnMedLagretLegitimasjon('token-avvist')) return false;
  await fetchAndCachePrivateSites();
  return true;
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
  const konto = kontoKontekst();
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
  if (!data || !sammeKontoKontekst(konto)) return [];

  // Håndter refreshed auth cookie / rotert logintoken hvis mottatt
  if (data.refreshedAuthCookie || data.refreshedLoginToken) {
    const savedTokens = oppdaterAoTokensFraRespons(data);
    if (savedTokens) {
      console.log('[AO] Oppdaterte auth cookie/logintoken fra sliding expiration');
      // Dispatch custom event for å notifisere ao-direct.html
      window.dispatchEvent(new CustomEvent('ao_tokens_updated', {
        detail: { source: 'ao-sites', tokens: savedTokens }
      }));
    }
  }

  // Backend håndterer all auth-refresh (sliding → logintoken → credentials).
  // Frontend prøver kun auto-relogin som siste utvei når backend eksplisitt sier authRequired
  // OG backend ikke allerede refreshet (unngår dobbel-refresh race condition).
  if (!isRetry && data.authRequired && !data.refreshedAuthCookie && hadTokens) {
    console.log('[AO] Backend indikerer ugyldig auth, prøver frontend auto-relogin...');
    const reloginOk = await tryAutoRelogin();
    if (!sammeKontoKontekst(konto)) return [];
    if (reloginOk) {
      return fetchAoSites(lat, lon, sizeMeters, true);
    }
    // Nettbrudd eller et uforståelig svar betyr ikke at sesjonen er utløpt.
    // Behold tokenene; bare eksplisitt utlogging eller kontobytte skal fjerne dem.
  }

  if (!data || !Array.isArray(data.sites)) {
    return [];
  }

  return data.sites.filter(s => s && typeof s.name === 'string' && s.name.trim());
}

/**
 * Hent alle AO-lokaliteter (offentlige og private) innenfor en eksplisitt bounding box.
 * Sender både senterpunkt/radius og eksakte north/south/east/west-koordinater til /api/ao-sites.
 *
 * @param {{ north: number, south: number, east: number, west: number }} bounds
 * @param {boolean} [isRetry=false]
 * @returns {Promise<Array>}
 */
export async function fetchAoSitesByBounds(bounds, isRetry = false) {
  if (!bounds) return [];
  const konto = kontoKontekst();
  const north = Number(bounds.north);
  const south = Number(bounds.south);
  const east = Number(bounds.east);
  const west = Number(bounds.west);
  if ([north, south, east, west].some(v => isNaN(v))) return [];

  const centerLat = (north + south) / 2;
  const centerLon = (east + west) / 2;
  const heightM = haversine(south, centerLon, north, centerLon) || 2500;
  const widthM = haversine(centerLat, west, centerLat, east) || 2500;
  const sizeMeters = Math.ceil(Math.max(widthM, heightM) / 2);

  const params = new URLSearchParams({
    lat: String(centerLat),
    lon: String(centerLon),
    size: String(sizeMeters),
    north: String(north),
    south: String(south),
    east: String(east),
    west: String(west),
  });
  const url = `/api/ao-sites?${params.toString()}`;

  const headers = {};
  let hadTokens = false;
  try {
    const savedTokens = JSON.parse(localStorage.getItem('ao_tokens') || '{}');
    if (savedTokens.userId) headers['X-AO-User-Id'] = savedTokens.userId;
    if (savedTokens.loginToken) {
      headers['X-AO-Login-Token'] = savedTokens.loginToken;
      hadTokens = true;
    }
    if (savedTokens.authCookie) headers['X-AO-Auth-Cookie'] = savedTokens.authCookie;
    const savedUsername = localStorage.getItem('ao_username');
    if (savedUsername) headers['X-AO-Username'] = savedUsername;
  } catch (e) {
    // Ignorer feil ved parsing
  }

  const resp = await fetch(url, { headers });
  if (!resp.ok) return [];

  const data = await resp.json();
  if (!data || !sammeKontoKontekst(konto)) return [];

  if (data.refreshedAuthCookie || data.refreshedLoginToken) {
    const savedTokens = oppdaterAoTokensFraRespons(data);
    if (savedTokens) {
      window.dispatchEvent(new CustomEvent('ao_tokens_updated', {
        detail: { source: 'ao-sites-bbox', tokens: savedTokens }
      }));
    }
  }

  if (!isRetry && data.authRequired && !data.refreshedAuthCookie && hadTokens) {
    const reloginOk = await tryAutoRelogin();
    if (!sammeKontoKontekst(konto)) return [];
    if (reloginOk) {
      return fetchAoSitesByBounds(bounds, true);
    }
    // Et usikkert gjeninnloggingsforsøk skal ikke slette lagret sesjon.
  }

  if (!data || !Array.isArray(data.sites)) return [];
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
/**
 * Logg inn på AO med legitimasjonen som ligger lagret på enheten, og LAGRE
 * tokenene.
 *
 * Skilt ut fra `ensureAoTokens()` fordi den bare logger inn når tokens MANGLER.
 * En utløpt sesjon har fortsatt tokens i localStorage, og da hjalp den ikke —
 * brukeren satt igjen med en side som sa «logg inn», uten noen vei videre.
 * Sider som får et «sesjonen er utløpt»-svar fra serveren kaller denne direkte
 * og prøver på nytt.
 *
 * @returns {Promise<boolean>} false hvis det ikke finnes lagret legitimasjon,
 *   eller AO avviste den.
 * @param {string} [reason] - Hvorfor denne relogin-en skjer (kun til logging på
 *   serveren, aldri sensitivt). Brukes til å måle hvor ofte brukere ender opp
 *   med å levere passordet på nytt fordi et token ble avvist som utløpt, mot
 *   hvor ofte det skjer fordi det aldri fantes et token i utgangspunktet.
 */
export async function loggInnMedLagretLegitimasjon(reason = 'ukjent') {
  const konto = kontoKontekst();
  const username = konto.brukernavn;
  const password = localStorage.getItem('ao_password');
  if (!username || !password) return false;

  try {
    const resp = await fetch('/api/ao-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, reason }),
    });
    const result = await resp.json();
    if (!resp.ok || !result.success || !sammeKontoKontekst(konto) || password !== localStorage.getItem('ao_password')) return false;

    const saved = JSON.parse(localStorage.getItem('ao_tokens') || '{}');
    saved.loginToken = result.loginToken;
    saved.authCookie = result.authCookie;
    if (!saved.userId) saved.userId = result.userId;
    localStorage.setItem('ao_tokens', JSON.stringify(saved));
    // Grunnen til at vi logger inn her, er som regel at forrige sesjon var død.
    // Da er en cache hentet under den sesjonen ikke til å stole på — særlig en
    // tom en. Fjern den, så neste ensureAoTokens() henter på nytt i stedet for
    // å stole på et døgn gammelt, tomt svar.
    try {
      localStorage.removeItem(PRIVATE_SITES_KEY);
    } catch {
      // localStorage utilgjengelig — cachen hentes da ikke derfra likevel
    }
    return true;
  } catch (e) {
    console.warn('Kunne ikke logge inn med lagret legitimasjon', e);
    return false;
  }
}

export async function ensureAoTokens() {
  const tokens = JSON.parse(localStorage.getItem('ao_tokens') || '{}');
  let ok = !!(tokens.loginToken && tokens.authCookie);

  if (!ok) {
    ok = await loggInnMedLagretLegitimasjon('mangler-token');
    if (!ok) return false;
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
  if (ok) await ensureAoPrivateSites();
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
      lagrePrivateAoLokaliteter([newSite, ...existing]);
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
