/**
 * Sjeldenhetsvarsel-modul.
 *
 * Sjekker AO sin sanntidsvalidering (art x lokalitet x dato) via
 * /api/ao-rarity og viser en ⚠️-boks når AO returnerer en Warning.
 * Information alene vises ikke i v1 (bevisst terskel).
 *
 * Stille no-op ved uinnlogget bruker eller nettverks-/AO-feil — aldri en
 * feilmelding brukeren merker mens skjemaet fylles ut.
 */

import { getVisitTimeSpan, visitExists } from './visits.js';

const DEBOUNCE_MS = 400;

let debounceTimer = null;
let requestSeq = 0;
let lastKey = null;

function getAoHeaders() {
  const headers = {};
  try {
    const tokens = JSON.parse(localStorage.getItem('ao_tokens') || '{}');
    if (tokens.loginToken) headers['X-AO-Login-Token'] = tokens.loginToken;
    if (tokens.authCookie) headers['X-AO-Auth-Cookie'] = tokens.authCookie;
    if (tokens.userId) headers['X-AO-User-Id'] = tokens.userId;
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
 * Kalles fra updateSectionStates() hver gang art eller lokasjon endres.
 * Gjør ingenting nytt hvis nøkkelen (art+lokasjon+dato) er uendret siden
 * sist — unngår unødvendig re-sjekk og flimring ved f.eks. antall-endring.
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

  const seq = ++requestSeq;
  debounceTimer = setTimeout(async () => {
    const headers = getAoHeaders();
    if (!headers['X-AO-Login-Token']) return; // uinnlogget = stille no-op

    try {
      const url = `/api/ao-rarity?taxonId=${encodeURIComponent(taxonId)}`
        + `&siteId=${encodeURIComponent(siteId)}&date=${encodeURIComponent(dateStr)}`;
      const resp = await fetch(url, { headers });
      if (seq !== requestSeq) return; // utdatert - art/plass/dato endret i mellomtiden
      if (!resp.ok) return;

      const data = await resp.json();
      if (seq !== requestSeq) return;

      if (data.refreshedAuthCookie) {
        try {
          const tokens = JSON.parse(localStorage.getItem('ao_tokens') || '{}');
          tokens.authCookie = data.refreshedAuthCookie;
          localStorage.setItem('ao_tokens', JSON.stringify(tokens));
        } catch (e) {
          // ignorer - samme best-effort som andre AO-kall
        }
      }

      if (data.warning) {
        showRarityBox(dom, data.warning);
      }
    } catch (e) {
      // Nettverksfeil e.l. - stille no-op, jf. konvensjonen for eksterne API-feil
    }
  }, DEBOUNCE_MS);
}
