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
import { t, applyTranslations, isNynorsk } from './i18n.js?v=v1.60.20';
import { activityDisplayName } from './i18n.js';
import { translateDedicatedSubspeciesToNynorsk } from './species-matcher.js?v=v1.60.20';

applyTranslations(); // oversetter statisk data-i18n-markup i fellestur.html (back-link, ingress)

function visArtNavnFellestur(species) {
  if (!species) return '';
  if (typeof species === 'string') return species;
  if (isNynorsk()) {
    const nno = species.nameNno || species.nynorsk;
    if (nno) return nno;
    const nob = species.taxonName || species.nameNob || species.norwegian || '';
    if (nob) {
      const trans = translateDedicatedSubspeciesToNynorsk(nob);
      if (trans && trans.toLowerCase() !== nob.toLowerCase()) return trans;
    }
  }
  return species.taxonName || species.nameNob || species.norwegian || '';
}

const POLL_MS = 12000;

const app = document.getElementById('app');

const state = {
  kode: null,
  tur: null,
  pollHandle: null,
  kjenteIder: new Set(),
  nyeSidenSist: 0,
  oppslag: 0,
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
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(t('fellestur.check_failed_error'));
  const data = await r.json();
  if (!data.ok) throw new Error(t('fellestur.unexpected_reply'));
  return data;
}

// ---------- Oppstartsvalg (start ny / bli med) ----------

function renderValg() {
  app.innerHTML = `
    <div class="kort">
      <div class="valg">
        <button class="valg-btn" id="btn-start">🆕<br>${t('fellestur.start_new')}</button>
        <button class="valg-btn" id="btn-bli-med">🔑<br>${t('fellestur.join_code')}</button>
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
    <label for="tur-navn">${t('fellestur.trip_name_label')}</label>
    <input type="text" id="tur-navn" placeholder="${t('fellestur.trip_name_placeholder', { date: tekst(iDag) })}" maxlength="100">
    <div class="rad-btn">
      <button class="btn primar" id="btn-opprett">${t('fellestur.start_btn')}</button>
    </div>
    <div class="feilmelding" id="feil" style="display:none;"></div>`;

  document.getElementById('btn-opprett').addEventListener('click', async (e) => {
    e.target.disabled = true;
    const navn = document.getElementById('tur-navn').value.trim();
    const { ok, data } = await apiPost('/api/fellestur', { navn, medobservatorer: [] });
    if (!ok || !data.kode) {
      e.target.disabled = false;
      const feil = document.getElementById('feil');
      feil.textContent = t('fellestur.start_failed');
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
    <label for="tur-kode">${t('fellestur.code_label')}</label>
    <input type="text" id="tur-kode" placeholder="${t('fellestur.code_placeholder')}" maxlength="5" inputmode="numeric"
           style="letter-spacing:0.1em;">
    <div class="rad-btn">
      <button class="btn primar" id="btn-bli-med-send">${t('fellestur.check_join_btn')}</button>
    </div>
    <div class="feilmelding" id="feil" style="display:none;"></div>`;

  const kodeInput = document.getElementById('tur-kode');
  kodeInput.addEventListener('input', () => {
    kodeInput.value = kodeInput.value.toUpperCase();
  });
  kodeInput.focus();

  document.getElementById('btn-bli-med-send').addEventListener('click', async () => {
    const kode = kodeInput.value.trim().toUpperCase();
    if (!/^[0-9]{5}$/.test(kode)) {
      const feil = document.getElementById('feil');
      feil.textContent = t('fellestur.code_invalid');
      feil.style.display = 'block';
      return;
    }
    settKodeIUrl(kode);
    state.kode = kode;
    document.getElementById('btn-bli-med-send').disabled = true;
    document.getElementById('btn-bli-med-send').textContent = t('fellestur.checking_code');
    await lastOgVisAktivTur();
  });
}

// ---------- Aktiv tur ----------

async function lastOgVisAktivTur() {
  const kode = state.kode;
  const oppslag = ++state.oppslag;
  if (!/^[0-9]{5}$/.test(kode || '')) {
    visOppstartsfeil(t('fellestur.code_invalid'));
    return;
  }
  let tur;
  try {
    tur = await hentTur(kode);
  } catch (_) {
    if (oppslag !== state.oppslag || kode !== state.kode) return;
    visOppstartsfeil(t('fellestur.check_failed_network'), true);
    return;
  }
  if (oppslag !== state.oppslag || kode !== state.kode) return;
  if (!tur) {
    renderIkkeFunnet();
    return;
  }
  if (erUbekreftet(tur) && hentAktivFellestur()?.kode !== state.kode) {
    renderIkkeFunnet();
    return;
  }
  visAktivTur(tur);
}

function visAktivTur(tur) {
  state.kode = tur.kode;
  state.tur = tur;
  state.kjenteIder = new Set(tur.observasjoner.map((o) => o.id));
  // Å åpne/opprette en fellestur gjør den aktiv for registrering på
  // hovedsiden — se storage.js sin loadObservations()/saveObservations()-bryter.
  settAktivFellestur({ kode: state.kode, navn: tur.navn });
  renderAktivTur();
  startPolling();
}

function erUbekreftet(tur) {
  return tur.opprinnelse === 'ekstern' && !tur.eksternBekreftet;
}

function tilbakeTilKodevalg() {
  stopPolling();
  state.kode = null;
  state.oppslag += 1;
  const url = new URL(location.href);
  url.searchParams.delete('kode');
  history.replaceState(null, '', url);
  renderValg();
  renderBliMedSkjema();
}

function visOppstartsfeil(melding, kanProveIgjen = false) {
  app.innerHTML = `<div class="kort">
    <p class="feilmelding" role="alert">${tekst(melding)}</p>
    <div class="rad-btn">
      ${kanProveIgjen ? `<button class="btn primar" id="btn-prov-igjen">${t('fellestur.try_again')}</button>` : ''}
      <button class="btn" id="btn-tilbake">${t('fellestur.change_code')}</button>
    </div></div>`;
  document.getElementById('btn-tilbake').addEventListener('click', tilbakeTilKodevalg);
  document.getElementById('btn-prov-igjen')?.addEventListener('click', lastOgVisAktivTur);
}

function turStatusHtml(tur) {
  if (erUbekreftet(tur)) {
    return `<div class="tur-advarsel" role="status"><strong>${t('fellestur.unconfirmed.title')}</strong>
      <p>${t('fellestur.unconfirmed.body', { kode: tekst(tur.kode) })}</p></div>`;
  }
  if (tur.opprinnelse === 'ekstern') {
    return `<p class="tur-kilde">${t('fellestur.found_external')}</p>`;
  }
  return `<p class="tur-kilde">${t('fellestur.found_locally')}${tur.eksternBekreftet
    ? ` ${t('fellestur.found_locally.also_external')}` : ''}</p>`;
}

function renderIkkeFunnet() {
  app.innerHTML = `
    <div class="kort">
      <div class="tur-advarsel" role="alert">
        <strong>${t('fellestur.not_found.title', { kode: tekst(state.kode) })}</strong>
        <p>${t('fellestur.not_found.p1')}</p>
        <p>${t('fellestur.not_found.p2')}</p>
        <p>${t('fellestur.not_found.p3')}</p>
      </div>
      <div class="rad-btn">
        <button class="btn primar" id="btn-bli-med-likevel">${t('fellestur.join_anyway')}</button>
        <button class="btn" id="btn-tilbake">${t('fellestur.change_code')}</button>
      </div>
      <p class="feilmelding" id="feil" role="alert" hidden></p>
    </div>`;
  document.getElementById('btn-tilbake').addEventListener('click', tilbakeTilKodevalg);
  document.getElementById('btn-bli-med-likevel').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const tilbake = document.getElementById('btn-tilbake');
    btn.disabled = true;
    tilbake.disabled = true;
    btn.textContent = t('fellestur.connecting');
    try {
      const { ok, data } = await apiPost('/api/fellestur-bli-med', {
        kode: state.kode, godtaUbekreftet: true,
      });
      if (!ok || !data.ok) throw new Error(data.error || t('fellestur.connect_failed'));
      visAktivTur(data);
    } catch (err) {
      const feil = document.getElementById('feil');
      feil.textContent = err.message || t('fellestur.connect_failed');
      feil.hidden = false;
      btn.disabled = false;
      tilbake.disabled = false;
      btn.textContent = t('fellestur.join_anyway');
    }
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
    ? `<p class="obs-meta">${t('fellestur.logged_in_as', { navn: `<strong>${tekst(aoBrukernavn)}</strong>` })}</p>`
    : `<label for="mitt-navn">${t('fellestur.name_label')}</label>
       <input type="text" id="mitt-navn" value="${tekst(mittNavn)}" maxlength="40" placeholder="${t('fellestur.name_placeholder')}">
       <p class="obs-meta">${t('fellestur.not_logged_in_hint')}</p>`;
  const kopierTekst = t('fellestur.copy_link_button');

  app.innerHTML = `
    <div class="kort">
      <div class="kode-visning">${tekst(state.kode)}</div>
      <div id="tur-kilde-status" aria-live="polite">${turStatusHtml(tur)}</div>
      <div id="avsluttet-varsel"></div>
      <div class="rad-btn">
        <button class="btn liten" id="btn-kopier">${kopierTekst}</button>
      </div>
      ${tur.navn ? `<p><strong>${tekst(tur.navn)}</strong></p>` : ''}

      <div class="rad-btn">
        <a class="btn primar" href="/" style="text-decoration:none;text-align:center;flex:1;">${t('fellestur.register_on_main')}</a>
      </div>
      <p class="obs-meta">${t('fellestur.register_on_main.desc')}</p>

      <label>${t('fellestur.coobservers_label')}</label>
      <div class="medobs-liste" id="medobs-liste"></div>
      <div class="medobs-legg-til">
        <input type="text" id="medobs-nytt-navn" placeholder="${t('fellestur.coobservers_add_placeholder')}" maxlength="40">
        <button class="btn liten" id="btn-medobs-legg-til">${t('index.medobs.add_button')}</button>
      </div>

      ${mittNavnHtml}

      <p class="obs-meta" style="margin-top:14px;">${t('fellestur.finished_hint')}</p>
      <div class="rad-btn">
        <button class="btn primar" id="btn-send-ao" style="flex:1;">${t('fellestur.send_and_finish_button')}</button>
      </div>
      <div class="rad-btn">
        <button class="btn liten" id="btn-forlat">${t('fellestur.leave_button')}</button>
      </div>
    </div>

    <div class="liste-header">
      <h2>${t('fellestur.log_heading', { n: tur.observasjoner.length })}</h2>
      <div>
        <button class="nye-badge" id="btn-nye" style="display:none;"></button>
        <button class="btn liten" id="btn-oppdater-na">${t('fellestur.update_now_button')}</button>
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
      document.getElementById('btn-kopier').textContent = t('fellestur.copied');
      setTimeout(() => { document.getElementById('btn-kopier').textContent = kopierTekst; }, 1500);
    } catch (_) {
      prompt(t('fellestur.copy_link_prompt'), url);
    }
  });

  document.getElementById('btn-oppdater-na').addEventListener('click', () => oppdaterFraServer(true));
  document.getElementById('btn-send-ao').addEventListener('click', sendTilArbeidsliste);
  document.getElementById('btn-forlat').addEventListener('click', () => {
    if (!confirm(t('fellestur.leave_confirm'))) return;
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
    wrap.innerHTML = `<span class="obs-meta">${t('fellestur.no_coobservers')}</span>`;
    return;
  }
  const fjernTekst = tekst(t('index.common.remove'));
  wrap.innerHTML = navn.map((n, i) =>
    `<span class="medobs-chip">${tekst(n && typeof n === 'object' ? n.name : n)} <button data-fjern="${i}" title="${fjernTekst}" aria-label="${fjernTekst}">✕</button></span>`
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

  async function leggTilMedobs(navnOverride, alias) {
    const navn = (navnOverride != null ? navnOverride : input.value).trim();
    if (!navn) return;
    // Alias (AOs unike UserAlias) følger med fra autocomplete-valget — se
    // ao-observer-autocomplete.js. Uten den sendes bare navnet, som før.
    const lagt = alias ? { name: navn, alias } : navn;
    const ny = [...(state.tur.medobservatorer || []), lagt];
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
  const tidStr = tid ? t('fellestur.ended_at_time', { tid: tekst(tid) }) : '';
  el.innerHTML = `
    <div style="background:rgba(239,68,68,0.15);border:2px solid #ef4444;border-radius:10px;
                padding:12px 14px;margin:10px 0;">
      <p style="margin:0 0 4px;font-size:1.05em;font-weight:700;color:#ef4444;">${t('fellestur.ended_heading')}</p>
      <p style="margin:0;font-size:0.9em;">
        ${t('fellestur.ended_body', { navn: tekst(navn), tid: tidStr })}
      </p>
    </div>`;
}

// ---------- Selve loggen ----------

function renderObsListe() {
  const listeEl = document.getElementById('obs-liste');
  const obs = [...state.tur.observasjoner].sort((a, b) => b.created_ts - a.created_ts);

  if (!obs.length) {
    listeEl.innerHTML = `<div class="tom">${t('fellestur.log_empty')}</div>`;
    return;
  }

  const slettTekst = tekst(t('index.common.delete'));
  listeEl.innerHTML = obs.map((o) => {
    const artNavn = visArtNavnFellestur(o.species);
    const aktNavn = o.activity ? activityDisplayName(o.activity) : '';
    return `
    <div class="obs-rad" data-id="${o.id}">
      <div class="obs-art">
        <div class="obs-art-navn">${tekst(artNavn)}</div>
        <div class="obs-meta">${tekst(o.placeName || '')}${o.placeName && aktNavn ? ' · ' : ''}${tekst(aktNavn)}
          · ${formatKlokkeslett(o.created_ts)}${o.registrert_av ? ' · ' + tekst(o.registrert_av) : ''}</div>
      </div>
      <input type="number" class="obs-antall" min="0" value="${o.count != null ? o.count : ''}"
             data-antall-id="${o.id}">
      <button class="obs-slett" data-slett-id="${o.id}" title="${slettTekst}" aria-label="${slettTekst}">🗑️</button>
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
      if (!confirm(t('fellestur.delete_entry_confirm'))) return;
      try {
        const { ok, data } = await apiPost('/api/fellestur-sync', { kode: state.kode, deletes: [id] });
        if (ok && data.ok) {
          oppdaterFraSyncSvar(data);
          document.querySelector('.liste-header h2').textContent = t('fellestur.log_heading', { n: state.tur.observasjoner.length });
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
  showToast(t('fellestur.edit_failed_toast'), { raw: true, borderColor: '#f87171', duration: 3000 });
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
  const kode = state.kode;
  let tur;
  try {
    tur = await hentTur(kode);
  } catch (_) {
    if (statusEl) statusEl.textContent = t('fellestur.poll_failed');
    return;
  }
  if (state.kode !== kode || document.getElementById('poll-status') !== statusEl) return;
  if (!tur) return; // utløpt midt i økta — ikke forstyrr brukeren, prøv igjen neste runde

  const nyeIder = tur.observasjoner.map((o) => o.id).filter((id) => !state.kjenteIder.has(id));

  state.tur = tur;
  document.getElementById('tur-kilde-status').innerHTML = turStatusHtml(tur);
  state.kjenteIder = new Set(tur.observasjoner.map((o) => o.id));
  // Varselet om noen har avsluttet er viktig sikkerhetsinformasjon — vis det
  // med en gang, uavhengig av om resten av lista oppdateres stille i bakgrunnen.
  oppdaterAvsluttetVarsel();

  if (manuell || nyeIder.length === 0) {
    renderMedobsListe();
    renderObsListe();
    document.querySelector('.liste-header h2').textContent = t('fellestur.log_heading', { n: tur.observasjoner.length });
    const badge = document.getElementById('btn-nye');
    badge.style.display = 'none';
    state.nyeSidenSist = 0;
  } else {
    // Ikke overskriv det brukeren ser midt i polling uanmodet — vis heller en
    // badge de kan trykke for å hente inn de nye.
    const badge = document.getElementById('btn-nye');
    state.nyeSidenSist += nyeIder.length;
    badge.textContent = t('fellestur.new_entries_badge', { n: state.nyeSidenSist });
    badge.style.display = 'inline-block';
    badge.onclick = () => {
      renderMedobsListe();
      renderObsListe();
      document.querySelector('.liste-header h2').textContent = t('fellestur.log_heading', { n: tur.observasjoner.length });
      badge.style.display = 'none';
      state.nyeSidenSist = 0;
    };
  }

  if (statusEl) {
    const na = new Date().toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' });
    statusEl.textContent = t('fellestur.last_updated', { tid: na });
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
    alert(t('fellestur.empty_trip_alert'));
    return;
  }
  // Denne handlingen er starten på AO-innsending (arbeidslista blir sendt
  // videre derfra) — den som gjør dette må faktisk kunne fullføre det, ikke
  // bare parkere loggen lokalt hos noen som uansett ikke kan sende den.
  if (!erInnloggetMotAo()) {
    alert(t('fellestur.login_required_alert'));
    return;
  }
  if (!confirm(t('fellestur.confirm_take_all', { n: tur.observasjoner.length }))) {
    return;
  }

  // Varsle resten av gruppa FØR vi forlater — best effort: venter til den er
  // sendt (unngår at navigasjonen videre kutter forespørselen), men blokkerer
  // aldri selve innhentingen om varselet skulle feile pga. dårlig dekning.
  // Se oppdaterAvsluttetVarsel() for hvordan dette vises hos de andre.
  await apiPost('/api/fellestur-oppdater', { kode: state.kode, avsluttetAv: hentMittNavn() || t('fellestur.someone') }).catch(() => {});

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
    alert(t('fellestur.save_failed_alert'));
    return;
  }

  if (confirm(t('fellestur.confirm_go_to_list'))) {
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
