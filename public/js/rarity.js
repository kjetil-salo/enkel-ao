/**
 * Sjeldenhetsvarsel-modul.
 *
 * Sjekker AO sin sanntidsvalidering (art x lokalitet x dato) via
 * /api/ao-rarity og viser en ⚠️-boks når AO returnerer en Warning.
 * Information alene vises ikke i v1 (bevisst terskel).
 *
 * Alle sjeldenhetskall som har blitt gjort på telefonen huskes lokalt i
 * localStorage (ao_rarity_cache_v1) for bruk i offline- og hybridmodus:
 * - Online-modus: henter alltid fersk informasjon fra server (og oppdaterer cachen).
 * - Hybrid-modus: bruker lokal cache direkte når den er yngre enn 180 dager. Er
 *   den over 180 dager gammel (LRSK/NSKF kan ha gjort endringer) eller mangler,
 *   hentes den fra server én om gangen.
 * - Offline-modus: bruker alltid lokal cache (uansett alder), aldri nettverkskall.
 *
 * Stille no-op ved uinnlogget bruker eller nettverks-/AO-feil — aldri en
 * feilmelding brukeren merker mens skjemaet fylles ut.
 */

import { getVisitTimeSpan, visitExists } from './visits.js';

const DEBOUNCE_MS = 400;
const RARITY_CACHE_KEY = 'ao_rarity_cache_v1';
const RARITY_SITE_AREAS_KEY = 'ao_site_areas_v1';
const RARITY_TTL_MS = 180 * 24 * 60 * 60 * 1000; // 180 dager
const NETWORK_MODE_STORAGE_KEY = 'enkel_ao_network_mode_v1';

let debounceTimer = null;
let requestSeq = 0;
let lastKey = null;

// Sekvensiell kø så nettverkskall mot AO alltid kjører én om gangen
let fetchQueuePromise = Promise.resolve();

function enqueueRarityFetch(taskFn) {
  const next = fetchQueuePromise.then(() => taskFn()).catch(() => {});
  fetchQueuePromise = next;
  return next;
}

function getNetworkMode() {
  try {
    const raw = localStorage.getItem(NETWORK_MODE_STORAGE_KEY);
    const mode = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
    if (mode === 'online' || mode === 'hybrid' || mode === 'offline') {
      return mode;
    }
  } catch (e) {
    // ignorer
  }
  return 'hybrid';
}

function isOfflineMode() {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return true;
  }
  return getNetworkMode() === 'offline';
}

function loadRarityCache() {
  try {
    const raw = localStorage.getItem(RARITY_CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (e) {
    return {};
  }
}

function saveRarityCache(cache) {
  try {
    localStorage.setItem(RARITY_CACHE_KEY, JSON.stringify(cache));
  } catch (e) {
    // localStorage full eller utilgjengelig - ignorer stille
  }
}

function loadSiteAreasMap() {
  try {
    const raw = localStorage.getItem(RARITY_SITE_AREAS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (e) {
    return {};
  }
}

function saveSiteArea(siteId, areasCsv) {
  if (!siteId || !areasCsv || typeof areasCsv !== 'string') return;
  try {
    const map = loadSiteAreasMap();
    map[String(siteId)] = areasCsv.trim();
    localStorage.setItem(RARITY_SITE_AREAS_KEY, JSON.stringify(map));
  } catch (e) {
    // ignorer
  }
}

function resolveAreasForSite(siteId, state) {
  if (!siteId) return null;
  if (state && typeof state.currentPlaceAreas === 'string' && state.currentPlaceAreas.trim()) {
    return state.currentPlaceAreas.trim();
  }
  const map = loadSiteAreasMap();
  return map[String(siteId)] || null;
}

/**
 * Slå opp sjeldenhetsdata i telefonens lokale cache.
 * Sjekker først på Areas-streng (delt mellom lokaliteter i samme kommune/region),
 * deretter direkte på siteId.
 *
 * @returns {{ warning: {Header?: string, Body?: string}|null, ts: number, isStale: boolean } | null}
 */
export function getCachedRarity(taxonId, siteId, state = null) {
  if (!taxonId || !siteId) return null;
  const cache = loadRarityCache();
  const areas = resolveAreasForSite(siteId, state);

  let entry = null;
  if (areas) {
    entry = cache[`areas:${areas}::${taxonId}`] || null;
  }
  if (!entry) {
    entry = cache[`site:${siteId}::${taxonId}`] || null;
  }
  if (!entry || typeof entry.ts !== 'number') return null;

  const isStale = Date.now() - entry.ts > RARITY_TTL_MS;
  return {
    warning: entry.warning || null,
    ts: entry.ts,
    isStale,
  };
}

/**
 * Lagre sjeldenhetsresultat på telefonen for bruk i offline- og hybridmodus.
 */
export function setCachedRarity(taxonId, siteId, areasCsv, warning) {
  if (!taxonId || !siteId) return;
  const now = Date.now();
  const normalizedWarning =
    warning && (warning.Header || warning.Body)
      ? { Header: warning.Header || '', Body: warning.Body || '' }
      : null;

  const record = {
    warning: normalizedWarning,
    ts: now,
  };

  const cache = loadRarityCache();
  cache[`site:${siteId}::${taxonId}`] = record;

  if (areasCsv && typeof areasCsv === 'string' && areasCsv.trim()) {
    const cleanAreas = areasCsv.trim();
    cache[`areas:${cleanAreas}::${taxonId}`] = record;
    saveSiteArea(siteId, cleanAreas);
  }

  saveRarityCache(cache);
}

function getAoHeaders() {
  const headers = {};
  try {
    const tokens = JSON.parse(localStorage.getItem('ao_tokens') || '{}');
    if (tokens.loginToken) headers['X-AO-Login-Token'] = tokens.loginToken;
    if (tokens.authCookie) headers['X-AO-Auth-Cookie'] = tokens.authCookie;
    if (tokens.userId) headers['X-AO-User-Id'] = tokens.userId;
    const savedUsername = localStorage.getItem('ao_username');
    if (savedUsername) headers['X-AO-Username'] = savedUsername;
  } catch (e) {
    // localStorage utilgjengelig/korrupt - behandles som uinnlogget
  }
  return headers;
}

function toDateOnly(dateOrIso) {
  const d = typeof dateOrIso === 'string' ? new Date(dateOrIso) : dateOrIso;
  if (isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Dato å sjekke sjeldenhet for: besøkets dato ved etterregistrering
 * (arter arver besøkets tidsspenn, se observations.js), ellers i dag.
 */
function resolveRarityDate(state) {
  if (state.etterregVisitKey && visitExists(state.observations, state.etterregVisitKey)) {
    const span = getVisitTimeSpan(state.observations, state.etterregVisitKey);
    if (span && span.fra) {
      return toDateOnly(span.fra);
    }
  }
  return toDateOnly(new Date());
}

function hideRarityBox(dom) {
  if (dom.rarityWarning) dom.rarityWarning.style.display = 'none';
}

function showRarityBox(dom, warning) {
  if (!dom.rarityWarning) return;
  dom.rarityWarningHeader.textContent = warning.Header || '';
  dom.rarityWarningBody.textContent = warning.Body || '';
  dom.rarityWarning.style.display = '';
}

function resetRarity(dom) {
  lastKey = null;
  // Kansellér en ventende debounce/fetch — uten dette kan et utdatert svar
  // dukke opp for en art/lokasjon brukeren allerede har forlatt.
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  requestSeq++;
  hideRarityBox(dom);
}

/**
 * Sjekk sjeldenhet for valgt art x lokalitet x dato (debounced, race-safe).
 *
 * - Offline-modus: bruker kun telefonens lokale cache (aldri nettverkskall).
 * - Hybrid-modus: bruker lokal cache direkte hvis yngre enn 180 dager. Hvis
 *   eldre enn 180 dager (eller ikke sjekket før), sjekkes /api/ao-rarity én om gangen.
 * - Online-modus: henter alltid fersk status fra /api/ao-rarity (og lagrer svaret
 *   i lokal cache for senere offline-/hybridbruk).
 */
export function checkRarity(state, dom) {
  const taxonId = state.selectedSpecies && state.selectedSpecies.taxonId;
  const siteId = state.currentPlaceId;

  if (!taxonId || !siteId) {
    resetRarity(dom);
    return;
  }

  const dateStr = resolveRarityDate(state);
  if (!dateStr) {
    resetRarity(dom);
    return;
  }

  const key = `${taxonId}::${siteId}::${dateStr}`;
  if (key === lastKey) return;
  lastKey = key;

  hideRarityBox(dom);
  if (debounceTimer) clearTimeout(debounceTimer);

  const mode = isOfflineMode() ? 'offline' : getNetworkMode();
  const cached = getCachedRarity(taxonId, siteId, state);

  if (cached && cached.warning) {
    showRarityBox(dom, cached.warning);
  }

  // I offline-modus brukes kun lokal cache (aldri nettverkskall)
  if (mode === 'offline') {
    return;
  }

  // I hybrid-modus brukes lokal cache uten nettverkskall så lenge den er under 180 dager gammel.
  // I online-modus hentes alltid fersk informasjon fra server.
  if (mode === 'hybrid' && cached && !cached.isStale) {
    return;
  }

  const seq = ++requestSeq;
  debounceTimer = setTimeout(() => {
    const headers = getAoHeaders();
    if (!headers['X-AO-Login-Token']) return; // uinnlogget = stille no-op
    if (isOfflineMode()) return;

    // Kjør nettverkskallet sekvensielt (én om gangen)
    enqueueRarityFetch(async () => {
      if (seq !== requestSeq) return; // bruker har allerede byttet art/lokalitet

      try {
        const url = `/api/ao-rarity?taxonId=${encodeURIComponent(taxonId)}`
          + `&siteId=${encodeURIComponent(siteId)}&date=${encodeURIComponent(dateStr)}`;
        const resp = await fetch(url, { headers });
        if (!resp.ok) return;

        const data = await resp.json();
        if (!data || typeof data !== 'object') return;

        if (data.refreshedAuthCookie) {
          try {
            const tokens = JSON.parse(localStorage.getItem('ao_tokens') || '{}');
            tokens.authCookie = data.refreshedAuthCookie;
            localStorage.setItem('ao_tokens', JSON.stringify(tokens));
          } catch (e) {
            // ignorer - samme best-effort som andre AO-kall
          }
        }

        // Husk svaret på telefonen for senere offline- og hybridbruk
        if ('warning' in data || 'information' in data || 'areas' in data) {
          setCachedRarity(taxonId, siteId, data.areas || null, data.warning || null);
        }

        if (seq !== requestSeq) return;

        if (data.warning) {
          showRarityBox(dom, data.warning);
        } else if ('warning' in data) {
          hideRarityBox(dom);
        }
      } catch (e) {
        // Nettverksfeil e.l. - behold eventuelt cacha varsel på skjermen, stille no-op
      }
    });
  }, DEBOUNCE_MS);
}