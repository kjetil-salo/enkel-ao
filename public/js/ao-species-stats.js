/**
 * Henting og caching av brukerens egne arts-tall (kun Fugler denne runden)
 * fra `/api/ao-my-species-stats`. Se src/ao_species_stats.py og
 * public/artsobservasjoner.html.
 *
 * Samme ekstern-API-konvensjon som ao-messages.js: ingen lagrede tokens eller
 * et feilende AO-kall gir noen gang en feilmelding brukeren må reagere på —
 * bare `null`, som kalleren tolker som «vet ikke».
 */

const CACHE_KEY = 'ao_species_stats_cache_v1';
const CACHE_TTL_MS = 30 * 60 * 1000;

let henter = null;

function lesCache(username) {
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    if (cached && cached.username === username && Date.now() - cached.ts < CACHE_TTL_MS) {
      return cached.data;
    }
  } catch {
    // korrupt cache, hent på nytt
  }
  return undefined;
}

/**
 * Returnerer `{fuglerTotalt, fuglerIAr}` (tall, eller `null` per felt hvis AO
 * ikke kunne spørres), eller `null` på toppnivå hvis brukeren ikke har
 * lagrede AO-tokens eller selve kallet feiler.
 */
export async function hentAoArtstall({ force = false } = {}) {
  let tokens;
  try {
    tokens = JSON.parse(localStorage.getItem('ao_tokens') || '{}');
  } catch {
    tokens = {};
  }
  if (!tokens.loginToken || !tokens.authCookie) return null;

  const username = (localStorage.getItem('ao_username') || '').trim();
  if (!force) {
    const cached = lesCache(username);
    if (cached !== undefined) return cached;
  }

  if (henter) return henter;
  henter = (async () => {
    try {
      const resp = await fetch('/api/ao-my-species-stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ loginToken: tokens.loginToken, authCookie: tokens.authCookie }),
      });
      const data = await resp.json();
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify({ username, ts: Date.now(), data }));
      } catch {
        // full kvote — cachen er bare en optimalisering, ikke kritisk
      }
      return data;
    } catch {
      return null;
    } finally {
      henter = null;
    }
  })();
  return henter;
}
