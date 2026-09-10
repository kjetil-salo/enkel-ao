/**
 * Fellestur-synk — eier localStorage-speilet av den delte fellesturlisten
 * (`fellesturMirror_v1`) og synker det mot serveren.
 *
 * Speilet er datakilden storage.js leser/skriver til når en fellestur er
 * aktiv (se bryteren i dens loadObservations()/saveObservations()). I
 * tillegg til den synlige observasjonslista (`observasjoner`) holder det et
 * "sist bekreftede server-tilstand"-øyeblikksbilde (`bekreftet`) som
 * diff-motoren bruker til å avgjøre hva som faktisk må sendes, samt turens
 * `medobservatorer` og hvilken `kode` speilet gjelder for.
 *
 * Offline-robusthet er gratis: mislykkes en synk, lar vi `bekreftet` stå
 * urørt — neste lagring eller poll finner samme diff og prøver på nytt.
 * Ingenting går tapt, ingenting dobbeltsendes stille.
 *
 * Bytter man aktiv fellestur (forlater én, blir med i en annen), tilhører
 * et gammelt speil en annen tur og må ikke blandes inn i den nye — derfor
 * sjekkes `kode` mot hentAktivFellestur() før hver lesing/skriving, og
 * speilet nullstilles ved mismatch.
 */
import { hentAktivFellestur, hentMittNavn } from './fellestur-client.js';
import { showToast } from './ui.js';

const MIRROR_KEY = 'fellesturMirror_v1';
const FEIL_TOAST_INTERVAL_MS = 30000;

/**
 * Bumpes for hver vellykkede skriving til speilet. Brukes til å oppdage at en
 * GET (poll) svarte med data som er eldre enn det vi allerede har fått inn
 * lokalt mens den var underveis (f.eks. en synk som rakk å fullføre først) —
 * uten dette kunne en treg poll som startet FØR en ny observasjon ble lagt
 * til, men svarte ETTERPÅ, overskrive og fjerne den igjen.
 */
let versjon = 0;
export function hentSpeilVersjon() {
  return versjon;
}

function tomtSpeil(kode = null) {
  return { observasjoner: [], bekreftet: [], medobservatorer: [], kode };
}

function lesSpeilRaw() {
  try {
    const raw = localStorage.getItem(MIRROR_KEY);
    if (!raw) return tomtSpeil();
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') return tomtSpeil();
    return {
      observasjoner: Array.isArray(data.observasjoner) ? data.observasjoner : [],
      bekreftet: Array.isArray(data.bekreftet) ? data.bekreftet : [],
      medobservatorer: Array.isArray(data.medobservatorer) ? data.medobservatorer : [],
      kode: data.kode || null,
    };
  } catch (e) {
    console.warn('Kunne ikke lese fellestur-speil', e);
    return tomtSpeil();
  }
}

function skrivSpeil(speil) {
  try {
    localStorage.setItem(MIRROR_KEY, JSON.stringify(speil));
    versjon++;
    return true;
  } catch (e) {
    console.warn('Kunne ikke lagre fellestur-speil', e);
    return false;
  }
}

/**
 * Speilet for turen som faktisk er aktiv akkurat nå. Tilhører det lagrede
 * speilet en annen kode (eller ingen), regnes det som tomt og ferskt —
 * beskytter mot å blande data fra en tidligere/annen fellestur inn i denne.
 */
function lesSpeilForAktivTur() {
  const aktiv = hentAktivFellestur();
  const aktivKode = aktiv ? aktiv.kode : null;
  const speil = lesSpeilRaw();
  if (speil.kode !== aktivKode) {
    return tomtSpeil(aktivKode);
  }
  return speil;
}

export function lastSpeil() {
  return lesSpeilForAktivTur().observasjoner;
}

export function hentTurMedobservatorer() {
  return lesSpeilForAktivTur().medobservatorer;
}

/**
 * Feltene som sendes til/sammenlignes mot serveren. `obsId`, `photo`,
 * `sentTs` og `position` er bevisst aldri med her — serveren hvitelister
 * uansett hva som lagres, men vi skal verken sende søppel eller la et
 * lokalt-only felt (bilde, sendt-stempel) trigge en unødvendig upsert.
 */
function saneringForSynk(obs) {
  const { obsId, photo, sentTs, position, ...rest } = obs || {};
  return rest;
}

/**
 * Ren funksjon, ingen IO: sammenlign nåværende liste mot sist bekreftede
 * server-tilstand og finn ut nøyaktig hva som må sendes.
 * @returns {{upserts: Array<{id: string, obs: object}>, deletes: string[]}}
 */
export function diffObservasjoner(naavarende, bekreftet) {
  const bekreftetMap = new Map();
  (bekreftet || []).forEach((o) => {
    if (o && o.obsId) bekreftetMap.set(o.obsId, o);
  });

  const upserts = [];
  const idBrukt = new Set();

  (naavarende || []).forEach((obs) => {
    if (!obs || !obs.obsId) return; // tildeles i lagreSpeilOgSynk — skal aldri forekomme her
    idBrukt.add(obs.obsId);
    const gammel = bekreftetMap.get(obs.obsId);
    if (!gammel) {
      upserts.push({ id: obs.obsId, obs: saneringForSynk(obs) });
      return;
    }
    if (JSON.stringify(saneringForSynk(obs)) !== JSON.stringify(saneringForSynk(gammel))) {
      upserts.push({ id: obs.obsId, obs: saneringForSynk(obs) });
    }
  });

  const deletes = [];
  bekreftetMap.forEach((_, obsId) => {
    if (!idBrukt.has(obsId)) deletes.push(obsId);
  });

  return { upserts, deletes };
}

/** Bygg klient-formen av én server-rad — obsId settes fra radens id. */
function serverRadTilObs(rad) {
  const { id, registrert_av, created_ts, updated_ts, ...felt } = rad || {};
  return { ...felt, obsId: id };
}

/**
 * Server-lista har aldri `photo`/`sentTs` (serveren lagrer dem ikke). Bevar
 * dem fra speilets nåværende rader der de finnes, slik at et bilde eller et
 * sendt-stempel ikke forsvinner bare fordi en synk/poll skrev over lista.
 */
export function flettServerListe(serverListe) {
  const speil = lesSpeilForAktivTur();
  const lokalMap = new Map();
  speil.observasjoner.forEach((o) => {
    if (o && o.obsId) lokalMap.set(o.obsId, o);
  });

  return (serverListe || []).map((rad) => {
    const obs = serverRadTilObs(rad);
    const lokal = lokalMap.get(obs.obsId);
    if (lokal) {
      if (lokal.photo !== undefined) obs.photo = lokal.photo;
      if (lokal.sentTs !== undefined) obs.sentTs = lokal.sentTs;
    }
    return obs;
  });
}

/**
 * Skriv fersk server-tilstand til speilet UTEN å miste lokale endringer som
 * ennå ikke er bekreftet av serveren. Uten dette ville en poll som lander
 * rett etter at nettet kom tilbake (men før synken rakk å sende) overskrevet
 * offline-registrerte rader — og diffen ville aldri sett dem igjen.
 *
 * Ventende lokale upserts vinner over serverversjonen til de er bekreftet;
 * ventende lokale sletting holder raden borte. Finnes ventende endringer,
 * utløses en ny synk med en gang så de kommer seg til serveren.
 */
function skrivSpeilFraServer(serverListe, medobservatorer) {
  const speilNaa = lesSpeilForAktivTur();
  const ventende = diffObservasjoner(speilNaa.observasjoner, speilNaa.bekreftet);

  const lokalMap = new Map();
  speilNaa.observasjoner.forEach((o) => {
    if (o && o.obsId) lokalMap.set(o.obsId, o);
  });

  const resMap = new Map();
  flettServerListe(serverListe).forEach((o) => resMap.set(o.obsId, o));
  ventende.upserts.forEach(({ id }) => {
    const lokal = lokalMap.get(id);
    if (lokal) resMap.set(id, lokal);
  });
  ventende.deletes.forEach((id) => resMap.delete(id));
  const resultat = [...resMap.values()];

  skrivSpeil({
    kode: speilNaa.kode,
    observasjoner: resultat,
    bekreftet: (serverListe || []).map(serverRadTilObs),
    medobservatorer: Array.isArray(medobservatorer) ? medobservatorer : speilNaa.medobservatorer,
  });

  if (ventende.upserts.length || ventende.deletes.length) {
    synk();
  }
  return resultat;
}

/**
 * Brukes av polling i main.js: fletter inn fersk server-tilstand (med vern
 * for usynkede lokale endringer) og returnerer lista til rendring.
 *
 * @param {number} [versjonVedForesporsel] - hentSpeilVersjon() slik den var
 *   idet GET-en som ga oss `turData` ble sendt. Har speilet blitt skrevet til
 *   siden (f.eks. fordi en synk rakk å fullføre mens GET-en var underveis),
 *   er `turData` potensielt eldre enn det vi allerede har — svaret droppes da
 *   stille, neste poll henter fersk data i stedet.
 */
export function oppdaterSpeilFraServer(turData, versjonVedForesporsel) {
  if (versjonVedForesporsel != null && versjonVedForesporsel !== versjon) {
    return lesSpeilForAktivTur().observasjoner;
  }
  const serverListe = (turData && Array.isArray(turData.observasjoner)) ? turData.observasjoner : [];
  const medobs = (turData && Array.isArray(turData.medobservatorer)) ? turData.medobservatorer : null;
  return skrivSpeilFraServer(serverListe, medobs);
}

let sisteFeilToastTs = 0;
function varsleSynkFeil(detalj) {
  const naa = Date.now();
  if (naa - sisteFeilToastTs < FEIL_TOAST_INTERVAL_MS) return;
  sisteFeilToastTs = naa;
  // Vis den faktiske årsaken (f.eks. "For mange forespørsler") i stedet for
  // en generisk tekst — gjorde det unødvendig vanskelig å feilsøke rate-limit-
  // treffet som utløste denne meldingen første gang.
  const tekst = detalj ? `Fellestur: får ikke synket (${detalj}) — prøver igjen`
                       : 'Fellestur: får ikke synket — prøver igjen';
  showToast(tekst, { raw: true, borderColor: '#f87171', duration: 3500 });
}

async function utforSynk() {
  const speilVedStart = lesSpeilForAktivTur();
  if (!speilVedStart.kode) return;

  const { upserts, deletes } = diffObservasjoner(speilVedStart.observasjoner, speilVedStart.bekreftet);
  if (!upserts.length && !deletes.length) return;

  try {
    const r = await fetch('/api/fellestur-sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kode: speilVedStart.kode, upserts, deletes, registrertAv: hentMittNavn() }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data.ok) {
      throw new Error((data && data.error) || `HTTP ${r.status}`);
    }

    const serverListe = Array.isArray(data.observasjoner) ? data.observasjoner : [];

    // Byttet brukeren tur mens forespørselen var underveis, gjelder ikke
    // svaret lenger.
    const naavaerende = lesSpeilForAktivTur();
    if (naavaerende.kode !== speilVedStart.kode) return;

    // VIKTIG: sammenlign mot speilet slik det så ut da VI sendte akkurat
    // denne batchen — ikke mot det gamle "bekreftet". De radene vi nettopp
    // fikk bekreftet i dette svaret finnes per definisjon i den diffen (det
    // er derfor vi sendte dem), men er nå ferske — de skal adoptere
    // serverens kanoniske form (som bl.a. fyller inn felt vi ikke satte,
    // f.eks. tomt kommentarfelt), ikke bevare sin gamle, lokale form. Uten
    // dette ville de sett "endret" ut for alltid ved neste sammenligning,
    // og trigget en ny synk på hver eneste poll (sett i praksis: 429 hvert
    // 12. sekund, i takt med pollingen).
    //
    // Kun endringer gjort på ENHETEN etter at vi sendte akkurat denne
    // batchen (mens forespørselen var i flukt) er reelt fortsatt uavklarte.
    const underveis = diffObservasjoner(naavaerende.observasjoner, speilVedStart.observasjoner);
    const beskyttIder = new Set(underveis.upserts.map((u) => u.id));
    const slettetUnderveis = new Set(underveis.deletes);

    const naavaerendeMap = new Map();
    naavaerende.observasjoner.forEach((o) => {
      if (o && o.obsId) naavaerendeMap.set(o.obsId, o);
    });

    const resultat = serverListe
      .map(serverRadTilObs)
      .filter((o) => !slettetUnderveis.has(o.obsId))
      .map((o) => (beskyttIder.has(o.obsId) ? (naavaerendeMap.get(o.obsId) || o) : o));

    // Rader lagt til lokalt mens forespørselen var i flukt, og som serveren
    // derfor ikke vet om ennå.
    const serverIder = new Set(serverListe.map((rad) => rad.id));
    naavaerende.observasjoner.forEach((o) => {
      if (o && o.obsId && !serverIder.has(o.obsId) && !slettetUnderveis.has(o.obsId)) {
        resultat.push(o);
      }
    });

    skrivSpeil({
      kode: speilVedStart.kode,
      observasjoner: resultat,
      bekreftet: serverListe.map(serverRadTilObs),
      medobservatorer: Array.isArray(data.medobservatorer) ? data.medobservatorer : naavaerende.medobservatorer,
    });

    if (beskyttIder.size || slettetUnderveis.size) {
      synk(); // det som kom inn underveis må synkes i neste runde
    }
  } catch (e) {
    console.warn('Fellestur-synk feilet', e);
    varsleSynkFeil(e && e.message);
  }
}

let synkPagaar = false;
let synkKoerEnGangTil = false;

/**
 * Diff (nåværende, bekreftet) → batch-POST til serveren, fire-and-forget.
 * Aldri parallelt med seg selv — kjører en runde til etterpå hvis noe kalte
 * på synk mens en forespørsel allerede var underveis.
 */
export async function synk() {
  if (synkPagaar) {
    synkKoerEnGangTil = true;
    return;
  }
  synkPagaar = true;
  try {
    await utforSynk();
  } finally {
    synkPagaar = false;
    if (synkKoerEnGangTil) {
      synkKoerEnGangTil = false;
      synk();
    }
  }
}

/**
 * Skriv speilet synkront (samme retur-kontrakt som saveObservations i
 * storage.js: true/false for om selve lagringen lyktes) og utløs en
 * asynkron synk mot serveren i bakgrunnen.
 */
export function lagreSpeilOgSynk(observasjoner) {
  const speil = lesSpeilForAktivTur();
  const aktiv = hentAktivFellestur();

  (observasjoner || []).forEach((obs) => {
    if (obs && !obs.obsId) {
      obs.obsId = crypto.randomUUID();
    }
  });

  const ok = skrivSpeil({
    kode: aktiv ? aktiv.kode : speil.kode,
    observasjoner: observasjoner || [],
    bekreftet: speil.bekreftet,
    medobservatorer: speil.medobservatorer,
  });

  synk();
  return ok;
}
