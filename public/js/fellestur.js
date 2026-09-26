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
import { showToast } from './ui.js';
import { attachAoObserverAutocomplete } from './ao-observer-autocomplete.js';

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

/**
 * Samme sjekk som resten av appen bruker (main.js/location.js/map.js) for
 * «kan denne enheten publisere til AO uten å måtte logge inn på nytt».
 * Brukes her til å la «Ditt navn» reflektere den ekte AO-identiteten når den
 * finnes, og til å kreve innlogging før «Hent inn og forlat» — den som
 * ender opp med ansvaret for å sende til AO, skal faktisk kunne gjøre det.
 */
function erInnloggetMotAo() {
  return !!(localStorage.getItem('ao_username') && localStorage.getItem('ao_password'));
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
  const innlogget = erInnloggetMotAo();
  // Innlogget: navnet er den ekte AO-identiteten, ikke noe man kan skrive fritt
  // — det er DENNE som vises til de andre og brukes i avsluttet-varselet, så
  // det skal faktisk stemme med hvem som er ansvarlig for AO-innsendingen.
  const aoBrukernavn = innlogget ? (localStorage.getItem('ao_username') || '') : '';
  if (innlogget && aoBrukernavn) settMittNavn(aoBrukernavn);
  const mittNavn = hentMittNavn();

  const mittNavnHtml = innlogget
    ? `<p class="obs-meta">Innlogget på AO som <strong>${tekst(aoBrukernavn)}</strong> — dette navnet brukes på det du registrerer.</p>`
    : `<label for="mitt-navn">Ditt navn (valgfritt, vises kun til de andre i gruppa)</label>
       <input type="text" id="mitt-navn" value="${tekst(mittNavn)}" maxlength="40" placeholder="F.eks. Kjetil">
       <p class="obs-meta">Ikke innlogget på AO på denne enheten — du kan likevel registrere funn i fellesturen,
         men den som til slutt henter inn og sender til AO må være innlogget (⚙️ Innstillinger).</p>`;

  app.innerHTML = `
    <div class="kort">
      <div class="kode-visning">${tekst(state.kode)}</div>
      <div id="avsluttet-varsel"></div>
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

      ${mittNavnHtml}

      <p class="obs-meta" style="margin-top:14px;"><strong>Ferdig med turen?</strong> Bruk knappen under — den
        henter alle oppføringene i loggen inn i din lokale liste, klar til å sendes til AO fra hovedsiden.</p>
      <div class="rad-btn">
        <button class="btn primar" id="btn-send-ao" style="flex:1;">📤 Send inn listen og avslutt fellestur</button>
      </div>
      <div class="rad-btn">
        <button class="btn liten" id="btn-forlat">Forlat uten å sende inn</button>
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
    <p class="oppdater-status" id="poll-status"></p>
  `;

  renderMedobsListe();
  renderObsListe();
  koblOppMedobs();
  oppdaterAvsluttetVarsel();

  const mittNavnInput = document.getElementById('mitt-navn');
  if (mittNavnInput) {
    mittNavnInput.addEventListener('change', (e) => {
      settMittNavn(e.target.value);
    });
  }

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
    if (!confirm('Forlate fellesturen på denne enheten UTEN å hente inn og sende loggen? Loggen består uansett, og du kan bli med igjen med samme kode.')) return;
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
  const input = document.getElementById('medobs-nytt-navn');

  async function leggTilMedobs(navnOverride) {
    const navn = (navnOverride != null ? navnOverride : input.value).trim();
    if (!navn) return;
    const ny = [...(state.tur.medobservatorer || []), navn];
    state.tur.medobservatorer = ny;
    input.value = '';
    renderMedobsListe();
    try {
      const { ok, data } = await apiPost('/api/fellestur-oppdater', { kode: state.kode, medobservatorer: ny });
      if (!ok || !data.ok) varsleRedigeringFeilet();
    } catch (_) {
      varsleRedigeringFeilet();
    }
  }

  document.getElementById('btn-medobs-legg-til').addEventListener('click', () => leggTilMedobs());
  // Autocomplete mot AO sitt observatørregister (samme som ✎ Flere felt/
  // redigeringsmodalen bruker) — nyttig når personen ikke er lagt til fra før.
  attachAoObserverAutocomplete(input, leggTilMedobs);
}

/**
 * Varsler resten av gruppa når noen har hentet loggen inn i sin egen lokale
 * liste og sendt (eller er i ferd med å sende) til AO — se avsluttetAv-feltet
 * satt av sendTilArbeidsliste(). Rent informasjonsvarsel: turen forblir åpen
 * og skrivbar, dette hindrer bare at flere uavhengig av hverandre tror de er
 * «den ansvarlige» og sender de samme observasjonene på nytt.
 */
function oppdaterAvsluttetVarsel() {
  const el = document.getElementById('avsluttet-varsel');
  if (!el) return;
  const navn = state.tur && state.tur.avsluttetAv;
  if (!navn) {
    el.innerHTML = '';
    return;
  }
  const tid = state.tur.avsluttetTs ? formatKlokkeslett(state.tur.avsluttetTs) : '';
  el.innerHTML = `
    <div style="background:rgba(239,68,68,0.15);border:2px solid #ef4444;border-radius:10px;
                padding:12px 14px;margin:10px 0;">
      <p style="margin:0 0 4px;font-size:1.05em;font-weight:700;color:#ef4444;">🛑 Turen er avsluttet</p>
      <p style="margin:0;font-size:0.9em;">
        <strong>${tekst(navn)}</strong> har hentet loggen inn i sin lokale liste${tid ? ' kl. ' + tekst(tid) : ''}
        og sender den (eller har allerede sendt) til AO.
        <strong>Ikke registrer flere funn eller send selv</strong> — si fra til ${tekst(navn)} hvis noe mangler.
      </p>
    </div>`;
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
      try {
        const { ok, data } = await apiPost('/api/fellestur-sync', { kode: state.kode, upserts: [{ id, obs }] });
        if (ok && data.ok) {
          oppdaterFraSyncSvar(data);
        } else {
          varsleRedigeringFeilet();
        }
      } catch (_) {
        varsleRedigeringFeilet();
      }
    });
  });

  listeEl.querySelectorAll('[data-slett-id]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.slettId;
      if (!confirm('Slette denne oppføringen?')) return;
      try {
        const { ok, data } = await apiPost('/api/fellestur-sync', { kode: state.kode, deletes: [id] });
        if (ok && data.ok) {
          oppdaterFraSyncSvar(data);
          document.querySelector('.liste-header h2').textContent = `Loggen (${state.tur.observasjoner.length})`;
        } else {
          varsleRedigeringFeilet();
        }
      } catch (_) {
        varsleRedigeringFeilet();
      }
    });
  });
}

/**
 * Antall-endring og sletting i kontrollrommet feilet stille før dette —
 * dårlig dekning i felt kunne gi inntrykk av at rettingen var lagret når
 * den ikke var det. Vis den samme røde toasten synken bruker på hovedsiden.
 */
function varsleRedigeringFeilet() {
  showToast('Fikk ikke lagret endringen — sjekk nettet og prøv igjen', { raw: true, borderColor: '#f87171', duration: 3000 });
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
  // Varselet om noen har avsluttet er viktig sikkerhetsinformasjon — vis det
  // med en gang, uavhengig av om resten av lista oppdateres stille i bakgrunnen.
  oppdaterAvsluttetVarsel();

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
  // Denne handlingen er starten på AO-innsending (arbeidslista blir sendt
  // videre derfra) — den som gjør dette må faktisk kunne fullføre det, ikke
  // bare parkere loggen lokalt hos noen som uansett ikke kan sende den.
  if (!erInnloggetMotAo()) {
    alert('Du må være innlogget på Artsobservasjoner for å hente inn og sende denne loggen — logg inn under ⚙️ Innstillinger, eller la en annen i gruppa som er innlogget gjøre dette.');
    return;
  }
  if (!confirm(`Hente alle ${tur.observasjoner.length} oppføringer inn i din lokale liste, og forlate fellesturen?`)) {
    return;
  }

  // Varsle resten av gruppa FØR vi forlater — best effort: venter til den er
  // sendt (unngår at navigasjonen videre kutter forespørselen), men blokkerer
  // aldri selve innhentingen om varselet skulle feile pga. dårlig dekning.
  // Se oppdaterAvsluttetVarsel() for hvordan dette vises hos de andre.
  await apiPost('/api/fellestur-oppdater', { kode: state.kode, avsluttetAv: hentMittNavn() || 'Noen' }).catch(() => {});

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
