/**
 * Henting og caching av AO-meldinger (innboks + driftsvarsler) fra
 * `/api/ao-messages`. Delt av profil.html (fullstendig seksjon med lenker
 * ut) og header-ikonet i main.js (badge). Se docs/ao-meldinger.md.
 *
 * Rent opplysende, samme ekstern-API-konvensjon som resten av appen: ingen
 * lagrede tokens eller et feilende AO-kall gir aldri en feilmelding brukeren
 * må reagere på — bare `null`, som kalleren tolker som «vet ikke».
 */

const AO_MESSAGES_CACHE_KEY = 'ao_messages_cache_v1';
const AO_MESSAGES_CACHE_TTL_MS = 10 * 60 * 1000;

let henter = null;

function lesCache(username) {
  try {
    const cached = JSON.parse(localStorage.getItem(AO_MESSAGES_CACHE_KEY) || 'null');
    if (cached && cached.username === username && Date.now() - cached.ts < AO_MESSAGES_CACHE_TTL_MS) {
      return cached.data;
    }
  } catch {
    // korrupt cache, hent på nytt
  }
  return undefined;
}

export function totalAoMeldinger(data) {
  if (!data) return 0;
  return (data.nyeMeldinger || 0) + (data.nyeVarsler || 0);
}

/**
 * Henter en kort forhåndsvisning (emne, avsender, dato, ulest) av de nyeste
 * radene i AOs Innboks — se docs/ao-meldinger.md og `/api/ao-messages-preview`
 * i server.py.
 *
 * I MOTSETNING til `hentAoMeldinger()` over: dette er IKKE cachet og skal
 * IKKE kalles automatisk i bakgrunnen. AO gjør en full HTML-sidelasting for
 * dette kallet (ikke et lett JSON-endepunkt), og — viktigere — selve det å
 * vise innholdet kan ha bieffekter hos AO (research 20.11.2026 markerte et
 * ulest driftsvarsel som lest bare ved å åpne siden). Kall derfor KUN når
 * brukeren selv eksplisitt ber om å se innholdet (et knappetrykk).
 *
 * Returnerer en liste med rader, eller `null` ved feil/uinnlogget/uforståelig
 * markup.
 */
export async function hentAoInnboksForhandsvisning() {
  let tokens;
  try {
    tokens = JSON.parse(localStorage.getItem('ao_tokens') || '{}');
  } catch {
    tokens = {};
  }
  if (!tokens.loginToken || !tokens.authCookie) return null;
  try {
    const resp = await fetch('/api/ao-messages-preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ loginToken: tokens.loginToken, authCookie: tokens.authCookie }),
    });
    const data = await resp.json();
    return data.meldinger ?? null;
  } catch {
    return null;
  }
}

/**
 * Henter siste innlegg (menneskeskrevet eller automatisk statusendring) i
 * én Innboks-samtale — selve meldingsteksten `hentAoInnboksForhandsvisning()`
 * ikke har (den har kun emnet). Se `/api/ao-conversation-latest` i server.py.
 *
 * `samtaleId` er `rad.samtaleId` fra en rad `hentAoInnboksForhandsvisning()`
 * allerede har returnert — ALDRI en fritt oppgitt verdi. Samme forsiktighet
 * som forhåndsvisningen over: ikke cachet, ikke kalt automatisk, kun på et
 * eksplisitt brukertrykk per samtale.
 *
 * Returnerer `{avsender, tekst, tidIso, tidTekst}`, eller `null` ved
 * feil/uinnlogget/uforståelig markup.
 */
export async function hentAoSamtaleSisteMelding(samtaleId) {
  let tokens;
  try {
    tokens = JSON.parse(localStorage.getItem('ao_tokens') || '{}');
  } catch {
    tokens = {};
  }
  if (!tokens.loginToken || !tokens.authCookie) return null;
  try {
    const resp = await fetch('/api/ao-conversation-latest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ loginToken: tokens.loginToken, authCookie: tokens.authCookie, samtaleId }),
    });
    const data = await resp.json();
    return data.melding ?? null;
  } catch {
    return null;
  }
}

/**
 * Henter en kort forhåndsvisning (avsender, FULL tekst, tidspunkt, ulest) av
 * de nyeste radene i AOs Driftsmeldinger — se `/api/ao-notifications-preview`
 * i server.py. ULIKT `hentAoInnboksForhandsvisning()`: hele meldingsteksten
 * er allerede her, ingen egen "vis siste melding"-handling trengs i tillegg.
 *
 * **Viktig, IKKE teoretisk bieffekt:** å hente dette gjør nøyaktig samme
 * HTTP-forespørsel som å åpne AO-siden i en nettleser, og det ER bekreftet
 * (20.11.2026) at selve det å åpne siden markerer varsler som lest hos AO —
 * badge-tallet i toppmenyen kan altså forsvinne som følge av å kalle dette.
 * Samme forsiktighet som Innboks-forhåndsvisningen: IKKE cachet, IKKE kalt
 * automatisk — kun på et eksplisitt brukertrykk, og knappen som trigger
 * dette MÅ si fra om bieffekten (se profil.html).
 *
 * Returnerer en liste med rader, eller `null` ved feil/uinnlogget/uforståelig
 * markup.
 */
export async function hentAoDriftsmeldingerForhandsvisning() {
  let tokens;
  try {
    tokens = JSON.parse(localStorage.getItem('ao_tokens') || '{}');
  } catch {
    tokens = {};
  }
  if (!tokens.loginToken || !tokens.authCookie) return null;
  try {
    const resp = await fetch('/api/ao-notifications-preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ loginToken: tokens.loginToken, authCookie: tokens.authCookie }),
    });
    const data = await resp.json();
    return data.meldinger ?? null;
  } catch {
    return null;
  }
}

/**
 * Returnerer `{nyeMeldinger, nyeVarsler}` (tall, eller `null` per felt hvis
 * AO ikke kunne spørres), eller `null` på toppnivå hvis brukeren ikke har
 * lagrede AO-tokens eller selve kallet feiler.
 */
export async function hentAoMeldinger({ force = false } = {}) {
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

  // Et kall er allerede underveis — del resultatet i stedet for å starte et nytt.
  if (henter) return henter;
  henter = (async () => {
    try {
      const resp = await fetch('/api/ao-messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ loginToken: tokens.loginToken, authCookie: tokens.authCookie }),
      });
      const data = await resp.json();
      try {
        localStorage.setItem(AO_MESSAGES_CACHE_KEY, JSON.stringify({ username, ts: Date.now(), data }));
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
