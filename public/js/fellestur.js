/**
 * Fellestur — delt kladdebok for en gruppe fuglefolk på samme feltøkt.
 *
 * Selve registreringen skjer på hovedsiden (index.html) med det helt
 * vanlige fullverdige skjemaet (artsøk, stedssøk+GPS, aktivitetspills) —
 * storage.js sin loadObservations()/saveObservations()-bryter ruter
 * lagringen til den delte loggen i stedet for den lokale arbeidslista så
 * lenge en fellestur er aktiv (se fellestur-client.js/fellestur-sync.js).
 * Denne siden er «kontrollrommet»: opprette/bli med, medobservatører,
 * se/rette den delte loggen, og til slutt hente alt inn i arbeidslista.
 *
 * Ingen kontoer: tilgang styres av en kort kode i URL-en (?kode=XXXXXX).
 * Alle med koden kan se, rette tall på og slette oppføringer.
 * Se docs/deling-av-observasjoner-plan.md for søsterfunksjonen "deling"
 * (read-only, én skriver) — fellestur er det motsatte: flere skrivere.
 */
import { loadObservations, saveObservations } from './storage.js';
import { resolveVisitIdForNewObservation } from './visits.js';
import { hentAktivFellestur, settAktivFellestur, forlatFellestur, hentMittNavn, settMittNavn } from './fellestur-client.js';

const POLL_MS = 12000;

const app = document.getElementById('app');

const state = {
  kode: null,
  tur: null,
  pollHandle: null,
  kjenteIder: new Set(),
  nyeSidenSist: 0,
};

function hentKodeFraUrl() {
  const q = new URLSearchParams(location.search);
  const kode = (q.get('kode') || '').trim().toUpperCase();
  return kode || null;
}

function settKodeIUrl(kode) {
  const url = new URL(location.href);
  url.searchParams.set('kode', kode);
  history.replaceState(null, '', url);
}

function tekst(v) {
  const el = document.createElement('span');
  el.textContent = v == null ? '' : String(v);
  return el.innerHTML;
}

function formatKlokkeslett(createdTs) {
  if (!createdTs) return '';
  const d = new Date(createdTs * 1000);
  return d.toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' });
}

async function apiPost(path, body) {
  const r = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
}

async function hentTur(kode) {
  const r = await fetch(`/api/fellestur?kode=${encodeURIComponent(kode)}`);
  if (!r.ok) return null;
  const data = await r.json();
  return data.ok ? data : null;
}

// ---------- Oppstartsvalg (start ny / bli med) ----------

function renderValg() {
  app.innerHTML = `
    <div class="kort">
      <div class="valg">
        <button class="valg-btn" id="btn-start">🆕<br>Start ny fellestur</button>
        <button class="valg-btn" id="btn-bli-med">🔑<br>Bli med (har kode)</button>
      </div>
      <div id="skjema-omrade"></div>
    </div>`;

  document.getElementById('btn-start').addEventListener('click', renderStartSkjema);
  document.getElementById('btn-bli-med').addEventListener('click', renderBliMedSkjema);
}

function renderStartSkjema() {
  const omrade = document.getElementById('skjema-omrade');
  const iDag = new Date().toLocaleDateString('nb-NO', { day: 'numeric', month: 'long' });
  omrade.innerHTML = `
    <label for="tur-navn">Turnavn (valgfritt)</label>
    <input type="text" id="tur-navn" placeholder="Tur ${tekst(iDag)}" maxlength="100">
    <div class="rad-btn">
      <button class="btn primar" id="btn-opprett">Start fellestur</button>
    </div>
    <div class="feilmelding" id="feil" style="display:none;"></div>`;

  document.getElementById('btn-opprett').addEventListener('click', async (e) => {
    e.target.disabled = true;
    const navn = document.getElementById('tur-navn').value.trim();
    const { ok, data } = await apiPost('/api/fellestur', { navn, medobservatorer: [] });
    if (!ok || !data.kode) {
      e.target.disabled = false;
      const feil = document.getElementById('feil');
      feil.textContent = 'Kunne ikke starte fellesturen — prøv igjen om litt.';
      feil.style.display = 'block';
      return;
    }
    settKodeIUrl(data.kode);
    state.kode = data.kode;
    await lastOgVisAktivTur();
  });
}

function renderBliMedSkjema() {
  const omrade = document.getElementById('skjema-omrade');
  omrade.innerHTML = `
    <label for="tur-kode">Kode fra den som startet turen</label>
    <input type="text" id="tur-kode" placeholder="F.EKS. 48213" maxlength="5" inputmode="numeric"
           style="letter-spacing:0.1em;">
    <div class="rad-btn">
      <button class="btn primar" id="btn-bli-med-send">Bli med</button>
    </div>
    <div class="feilmelding" id="feil" style="display:none;"></div>`;

  const kodeInput = document.getElementById('tur-kode');
  kodeInput.addEventListener('input', () => {
    kodeInput.value = kodeInput.value.toUpperCase();
  });
  kodeInput.focus();

  document.getElementById('btn-bli-med-send').addEventListener('click', async () => {
    const kode = kodeInput.value.trim().toUpperCase();
    if (kode.length !== 5) {
      const feil = document.getElementById('feil');
      feil.textContent = 'Koden skal være 5 tegn.';
      feil.style.display = 'block';
      return;
    }
    settKodeIUrl(kode);
    state.kode = kode;
    await lastOgVisAktivTur();
  });
}

// ---------- Aktiv tur ----------

async function lastOgVisAktivTur() {
  const tur = await hentTur(state.kode);
  if (!tur) {
    renderIkkeFunnet();
    return;
  }
  state.tur = tur;
  state.kjenteIder = new Set(tur.observasjoner.map((o) => o.id));
  // Å åpne/opprette en fellestur gjør den aktiv for registrering på
  // hovedsiden — se storage.js sin loadObservations()/saveObservations()-bryter.
  settAktivFellestur({ kode: state.kode, navn: tur.navn });
  renderAktivTur();
  startPolling();
}

function renderIkkeFunnet() {
  app.innerHTML = `
    <div class="kort">
      <p>Fant ingen aktiv fellestur med koden <strong>${tekst(state.kode)}</strong> —
      den kan være feilstavet, eller ha utløpt (fellesturer varer i 48 timer).</p>
      <div class="rad-btn">
        <button class="btn primar" id="btn-tilbake">Start på nytt</button>
      </div>
    </div>`;
  document.getElementById('btn-tilbake').addEventListener('click', () => {
    const url = new URL(location.href);
    url.searchParams.delete('kode');
    history.replaceState(null, '', url);
    renderValg();
  });
}

function renderAktivTur() {
  const tur = state.tur;
  const mittNavn = hentMittNavn();

  app.innerHTML = `
    <div class="kort">
      <div class="kode-visning">${tekst(state.kode)}</div>
      <div class="rad-btn">
        <button class="btn liten" id="btn-kopier">🔗 Kopier delbar lenke</button>
      </div>
      ${tur.navn ? `<p><strong>${tekst(tur.navn)}</strong></p>` : ''}

      <div class="rad-btn">
        <a class="btn primar" href="/" style="text-decoration:none;text-align:center;flex:1;">➕ Registrer på hovedsiden</a>
      </div>
      <p class="obs-meta">Alt du registrerer på hovedsiden mens denne fellesturen er aktiv (se bjelken øverst der),
        havner automatisk i loggen under — hele det vanlige skjemaet med artsøk og stedssøk virker som normalt.</p>

      <label>Medobservatører (krediteres når turen sendes til AO)</label>
      <div class="medobs-liste" id="medobs-liste"></div>
      <div class="medobs-legg-til">
        <input type="text" id="medobs-nytt-navn" placeholder="Legg til navn…" maxlength="40">
        <button class="btn liten" id="btn-medobs-legg-til">+ Legg til</button>
      </div>

      <label for="mitt-navn">Ditt navn (valgfritt, vises kun til de andre i gruppa)</label>
      <input type="text" id="mitt-navn" value="${tekst(mittNavn)}" maxlength="40" placeholder="F.eks. Kjetil">

      <div class="rad-btn">
        <button class="btn liten" id="btn-forlat">Forlat fellestur</button>
      </div>
    </div>

    <div class="liste-header">
      <h2>Loggen (${tur.observasjoner.length})</h2>
      <div>
        <button class="nye-badge" id="btn-nye" style="display:none;"></button>
        <button class="btn liten" id="btn-oppdater-na">🔄 Oppdater nå</button>
      </div>
    </div>
    <div id="obs-liste"></div>

    <div class="rad-btn">
      <button class="btn primar" id="btn-send-ao">📥 Hent inn i min lokale liste og forlat</button>
    </div>
    <p class="oppdater-status" id="poll-status"></p>
  `;

  renderMedobsListe();
  renderObsListe();
  koblOppMedobs();

  document.getElementById('mitt-navn').addEventListener('change', (e) => {
    settMittNavn(e.target.value);
  });

  document.getElementById('btn-kopier').addEventListener('click', async () => {
    const url = `${location.origin}/fellestur.html?kode=${state.kode}`;
    try {
      await navigator.clipboard.writeText(url);
      document.getElementById('btn-kopier').textContent = '✅ Kopiert!';
      setTimeout(() => { document.getElementById('btn-kopier').textContent = '🔗 Kopier delbar lenke'; }, 1500);
    } catch (_) {
      prompt('Kopier lenken manuelt:', url);
    }
  });

  document.getElementById('btn-oppdater-na').addEventListener('click', () => oppdaterFraServer(true));
  document.getElementById('btn-send-ao').addEventListener('click', sendTilArbeidsliste);
  document.getElementById('btn-forlat').addEventListener('click', () => {
    if (!confirm('Forlate fellesturen på denne enheten? Loggen består, og du kan bli med igjen med samme kode.')) return;
    forlatFellestur();
    stopPolling();
    const url = new URL(location.origin + '/fellestur.html');
    history.replaceState(null, '', url);
    renderValg();
  });
}

function renderMedobsListe() {
  const wrap = document.getElementById('medobs-liste');
  const navn = state.tur.medobservatorer || [];
  if (!navn.length) {
    wrap.innerHTML = '<span class="obs-meta">Ingen satt ennå</span>';
    return;
  }
  wrap.innerHTML = navn.map((n, i) =>
    `<span class="medobs-chip">${tekst(n)} <button data-fjern="${i}" title="Fjern">✕</button></span>`
  ).join('');
  wrap.querySelectorAll('[data-fjern]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const idx = Number(btn.dataset.fjern);
      const ny = state.tur.medobservatorer.filter((_, i) => i !== idx);
      state.tur.medobservatorer = ny;
      renderMedobsListe();
      await apiPost('/api/fellestur-oppdater', { kode: state.kode, medobservatorer: ny });
    });
  });
}

function koblOppMedobs() {
  async function leggTilMedobs() {
    const input = document.getElementById('medobs-nytt-navn');
    const navn = input.value.trim();
    if (!navn) return;
    const ny = [...(state.tur.medobservatorer || []), navn];
    state.tur.medobservatorer = ny;
    input.value = '';
    renderMedobsListe();
    await apiPost('/api/fellestur-oppdater', { kode: state.kode, medobservatorer: ny });
  }

  document.getElementById('btn-medobs-legg-til').addEventListener('click', leggTilMedobs);
  document.getElementById('medobs-nytt-navn').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      leggTilMedobs();
    }
  });
}

// ---------- Selve loggen ----------

function renderObsListe() {
  const listeEl = document.getElementById('obs-liste');
  const obs = [...state.tur.observasjoner].sort((a, b) => b.created_ts - a.created_ts);

  if (!obs.length) {
    listeEl.innerHTML = '<div class="tom">Ingen oppføringer ennå — registrer på hovedsiden for å komme i gang!</div>';
    return;
  }

  listeEl.innerHTML = obs.map((o) => {
    const artNavn = (o.species && o.species.taxonName) || '';
    return `
    <div class="obs-rad" data-id="${o.id}">
      <div class="obs-art">
        <div class="obs-art-navn">${tekst(artNavn)}</div>
        <div class="obs-meta">${tekst(o.placeName || '')}${o.placeName && o.activity ? ' · ' : ''}${tekst(o.activity || '')}
          · ${formatKlokkeslett(o.created_ts)}${o.registrert_av ? ' · ' + tekst(o.registrert_av) : ''}</div>
      </div>
      <input type="number" class="obs-antall" min="0" value="${o.count != null ? o.count : ''}"
             data-antall-id="${o.id}">
      <button class="obs-slett" data-slett-id="${o.id}" title="Slett">🗑️</button>
    </div>`;
  }).join('');

  listeEl.querySelectorAll('[data-antall-id]').forEach((input) => {
    input.addEventListener('change', async () => {
      const id = input.dataset.antallId;
      const antall = parseInt(input.value, 10);
      if (isNaN(antall)) return;
      const rad = state.tur.observasjoner.find((o) => o.id === id);
      if (!rad) return;
      const obs = { ...obsUtenMeta(rad), count: antall };
      const { ok, data } = await apiPost('/api/fellestur-sync', { kode: state.kode, upserts: [{ id, obs }] });
      if (ok && data.ok) {
        oppdaterFraSyncSvar(data);
      }
    });
  });

  listeEl.querySelectorAll('[data-slett-id]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.slettId;
      if (!confirm('Slette denne oppføringen?')) return;
      const { ok, data } = await apiPost('/api/fellestur-sync', { kode: state.kode, deletes: [id] });
      if (ok && data.ok) {
        oppdaterFraSyncSvar(data);
        document.querySelector('.liste-header h2').textContent = `Loggen (${state.tur.observasjoner.length})`;
      }
    });
  });
}

/** Radens obs-felt uten server-metadata — grunnlaget for en ny upsert. */
function obsUtenMeta(rad) {
  const { id, registrert_av, created_ts, updated_ts, ...obs } = rad;
  return obs;
}

/** Svaret fra /api/fellestur-sync er hele turens ferske liste — bruk den direkte. */
function oppdaterFraSyncSvar(data) {
  state.tur.observasjoner = Array.isArray(data.observasjoner) ? data.observasjoner : [];
  state.kjenteIder = new Set(state.tur.observasjoner.map((o) => o.id));
  renderObsListe();
}

// ---------- Polling ----------

function startPolling() {
  stopPolling();
  state.pollHandle = setInterval(() => {
    if (document.hidden) return;
    oppdaterFraServer(false);
  }, POLL_MS);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) oppdaterFraServer(false);
  });
}

function stopPolling() {
  if (state.pollHandle) {
    clearInterval(state.pollHandle);
    state.pollHandle = null;
  }
}

async function oppdaterFraServer(manuell) {
  const statusEl = document.getElementById('poll-status');
  const tur = await hentTur(state.kode);
  if (!tur) return; // utløpt midt i økta — ikke forstyrr brukeren, prøv igjen neste runde

  const nyeIder = tur.observasjoner.map((o) => o.id).filter((id) => !state.kjenteIder.has(id));

  state.tur = tur;
  state.kjenteIder = new Set(tur.observasjoner.map((o) => o.id));

  if (manuell || nyeIder.length === 0) {
    renderMedobsListe();
    renderObsListe();
    document.querySelector('.liste-header h2').textContent = `Loggen (${tur.observasjoner.length})`;
    const badge = document.getElementById('btn-nye');
    badge.style.display = 'none';
    state.nyeSidenSist = 0;
  } else {
    // Ikke overskriv det brukeren ser midt i polling uanmodet — vis heller en
    // badge de kan trykke for å hente inn de nye.
    const badge = document.getElementById('btn-nye');
    state.nyeSidenSist += nyeIder.length;
    badge.textContent = `🔔 ${state.nyeSidenSist} nye`;
    badge.style.display = 'inline-block';
    badge.onclick = () => {
      renderMedobsListe();
      renderObsListe();
      document.querySelector('.liste-header h2').textContent = `Loggen (${tur.observasjoner.length})`;
      badge.style.display = 'none';
      state.nyeSidenSist = 0;
    };
  }

  if (statusEl) {
    const na = new Date().toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' });
    statusEl.textContent = `Sist oppdatert ${na}`;
  }
}

// ---------- Hent inn i lokal arbeidsliste og forlat ----------

function medobsPadded(navn) {
  const res = Array(10).fill('');
  (navn || []).slice(0, 10).forEach((n, i) => { res[i] = n; });
  return res;
}

async function sendTilArbeidsliste() {
  const tur = state.tur;
  if (!tur.observasjoner.length) {
    alert('Fellesturen er tom — ingenting å hente inn.');
    return;
  }
  if (!confirm(`Hente alle ${tur.observasjoner.length} oppføringer inn i din lokale liste, og forlate fellesturen?`)) {
    return;
  }

  // Forlat FØRST: loadObservations()/saveObservations() ruter til det delte
  // speilet så lenge en fellestur er aktiv (samme bryter som hovedsiden
  // bruker) — uten dette ville "den lokale lista" vi bygger her faktisk
  // vært speilet, og aldri havne i den private arbeidslista.
  forlatFellestur();
  stopPolling();

  const eksisterende = loadObservations();
  const coObservers = medobsPadded(tur.medobservatorer);

  // Sorter kronologisk så besøks-grupperingen (resolveVisitIdForNewObservation)
  // bygges i riktig rekkefølge, akkurat som når man registrerer fortløpende.
  const sortert = [...tur.observasjoner].sort((a, b) => a.created_ts - b.created_ts);

  for (const o of sortert) {
    // Bruker det lagrede tidspunktet fra registreringen (f.eks. hvis den ble
    // gjort i etterregistreringsmodus), med server-tidspunktet som fallback.
    const now = o.timestamp ? new Date(o.timestamp) : new Date(o.created_ts * 1000);
    const visitId = resolveVisitIdForNewObservation(eksisterende, o.placeName || '', o.placeId || null, now);
    const nyObs = {
      species: o.species,
      count: o.count,
      position: null,
      activity: o.activity || '',
      placeName: o.placeName || '',
      placeId: o.placeId || null,
      visitId,
      visitLocked: false,
      timestamp: now.toISOString(),
      age: o.age || '',
      gender: o.gender || '',
      coObservers,
      comment: o.comment || '',
    };
    if (o.tilKlokkeslett) nyObs.tilKlokkeslett = o.tilKlokkeslett;
    eksisterende.push(nyObs);
  }

  const lagretOk = saveObservations(eksisterende);
  if (!lagretOk) {
    alert('Kunne ikke lagre i arbeidslista på denne enheten (full lagringsplass?). Prøv å slette gamle bilder/observasjoner og forsøk igjen.');
    return;
  }

  if (confirm('Lagt til i arbeidslista! Gå dit nå for å gå gjennom og sende til AO?')) {
    location.href = '/';
  }
}

// ---------- Oppstart ----------

(async function init() {
  const kode = hentKodeFraUrl();
  if (!kode) {
    // Ingen kode i URL-en, men enheten kan likevel ha en aktiv fellestur fra
    // før (satt via denne siden tidligere) — vis den i stedet for valgskjermen.
    const aktiv = hentAktivFellestur();
    if (aktiv) {
      settKodeIUrl(aktiv.kode);
      state.kode = aktiv.kode;
      await lastOgVisAktivTur();
      return;
    }
    renderValg();
    return;
  }
  state.kode = kode;
  await lastOgVisAktivTur();
})();
