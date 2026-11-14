import { isOfflineMode } from './offline-db.js';
import { hentAktivFellestur } from './fellestur-client.js';
import { lesArbeidslisteForOverforing, lesPrivatArbeidsliste, speciesDisplayName } from './storage.js?v=v1.60.20';
import { activityDisplayName, genderDisplayName } from './storage.js';
import { t, getLanguage } from './i18n.js?v=v1.60.20';
import {
  aktivInnhentetListe, apneInnhentetListe, lagreInnhentetKopi,
  lesInnhentetListe, lukkInnhentetListe,
} from './arbeidsliste-lokal.js';
import {
  OVERFORING_API, KONTOKONTEKST_ENDRET, kontoKontekst, sammeKontoKontekst,
  lesOverforingssesjon, lagreOverforingssesjon, erOverforingskontoendring,
} from './arbeidsliste-sesjon.js';

function tidspunkt(ts) {
  const locale = getLanguage() === 'nn' ? 'nn-NO' : 'nb-NO';
  return new Date(ts * 1000).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' });
}

function oppsummer(kopi) {
  if (!kopi) return t('arbeidsliste.no_copy');
  const periode = kopi.fraDato === kopi.tilDato ? kopi.fraDato : [kopi.fraDato, kopi.tilDato].filter(Boolean).join('–');
  const obsOrd = kopi.antall === 1 ? t('observations.word_singular') : t('observations.word_plural');
  return [
    `${kopi.antall} ${obsOrd}`,
    kopi.kilde,
    periode,
    t('arbeidsliste.summary_saved_at', { tid: tidspunkt(kopi.lagretTs) }),
  ].filter(Boolean).join(' · ');
}

function beskrivObservasjon(obs) {
  const rad = document.createElement('li');
  const navn = speciesDisplayName(obs.species) || obs.species?.scientificName ||
    obs.species?.scientificNameHtml?.replace(/<[^>]+>/g, '') || t('common.unknown_species');
  const art = document.createElement('strong');
  art.textContent = `${navn} · ${obs.count ?? t('arbeidsliste.unknown_count')}`;
  rad.append(art);
  const tid = obs.timestamp?.replace('T', ' ');
  const til = obs.tilKlokkeslett?.replace('T', ' ');
  const detaljer = [
    obs.placeName,
    tid,
    til && t('arbeidsliste.to_time', { til }),
    obs.activity && activityDisplayName(obs.activity),
    obs.age,
    obs.gender && genderDisplayName(obs.gender),
    obs.hideUntil && t('arbeidsliste.hidden_until', { date: obs.hideUntil }),
    obs.sentTs && t('arbeidsliste.already_sent'),
    obs.comment,
    obs.privateComment && t('arbeidsliste.private_comment', { text: obs.privateComment }),
  ].filter(Boolean);
  if (detaljer.length) {
    const tekst = document.createElement('p');
    tekst.textContent = detaljer.join(' · ');
    rad.append(tekst);
  }
  if (obs.photo?.startsWith('data:image/jpeg;base64,')) {
    const bilde = document.createElement('img');
    bilde.alt = t('arbeidsliste.image_alt', { navn });
    bilde.loading = 'lazy';
    bilde.addEventListener('error', () => {
      const tekst = document.createElement('p');
      tekst.textContent = t('arbeidsliste.image_error');
      bilde.replaceWith(tekst);
    }, { once: true });
    bilde.src = obs.photo;
    rad.append(bilde);
  }
  return rad;
}

export function initArbeidslisteOverforing({ synligeFunn, listeEndret, varsle, sendingPagar }) {
  const dialog = document.getElementById('arbeidsliste-dialog');
  if (!dialog) return () => {};
  const overfor = document.getElementById('arbeidsliste-overfor');
  const hent = document.getElementById('arbeidsliste-hent');
  const lokal = document.getElementById('arbeidsliste-lokal');
  const status = document.getElementById('arbeidsliste-status');
  const info = document.getElementById('arbeidsliste-info');
  const kontoInfo = document.getElementById('arbeidsliste-konto');
  const loggInn = document.getElementById('arbeidsliste-logg-inn');
  const innstillinger = document.getElementById('arbeidsliste-innstillinger');
  const lagre = document.getElementById('arbeidsliste-lagre');
  const forhåndsvis = document.getElementById('arbeidsliste-forhandsvis');
  const slett = document.getElementById('arbeidsliste-slett');
  const taInn = document.getElementById('arbeidsliste-ta-inn');
  const rader = document.getElementById('arbeidsliste-rader');
  const advarsel = document.getElementById('arbeidsliste-advarsel');
  const handlinger = [loggInn, lagre, forhåndsvis, slett, taInn];
  let jobb = null;
  let sesjon = null;
  let kopi = null;
  let vistKopi = null;
  let forsok = null;
  let vilHente = false;
  let aktivPaServer = true;
  let lokalVarApen = false;

  function visKopi(valgt = null) {
    vistKopi = valgt;
    advarsel.hidden = !valgt;
    rader.replaceChildren(...(valgt ? valgt.liste.observations.map(beskrivObservasjon) : []));
    oppdaterKnapper();
  }

  function oppdaterKnapper() {
    loggInn.hidden = !aktivPaServer || Boolean(sesjon);
    innstillinger.hidden = !aktivPaServer || Boolean(sesjon);
    lagre.hidden = !aktivPaServer || !sesjon || vilHente;
    forhåndsvis.hidden = !aktivPaServer || !sesjon || !kopi || Boolean(vistKopi);
    slett.hidden = !aktivPaServer || !sesjon || !kopi;
    taInn.hidden = !aktivPaServer || !sesjon || !vistKopi;
    for (const knapp of handlinger) knapp.disabled = Boolean(jobb);
    info.textContent = sesjon ? oppsummer(kopi) : '';
    kontoInfo.textContent = sesjon ? t('arbeidsliste.account_prefix', { alias: sesjon.alias }) : '';
  }

  function oppdaterLokalt() {
    overfor.hidden = synligeFunn().length === 0;
    try {
      const innhentet = aktivInnhentetListe();
      lokal.hidden = !innhentet && !lesInnhentetListe();
      lokal.textContent = innhentet ? t('index.menu.local_show') : t('index.menu.local_open');
    } catch {
      lokal.hidden = true;
    }
  }

  async function api(sti, signal, { body, id, medSesjon = true } = {}) {
    const brukSesjon = medSesjon ? sesjon : null;
    const konto = kontoKontekst();
    function kontrollerKontekst() {
      if (signal.aborted || !sammeKontoKontekst(konto)) {
        throw new DOMException('Kontokonteksten er endret.', 'AbortError');
      }
      if (brukSesjon && lesOverforingssesjon()?.token !== brukSesjon.token) {
        const feil = new Error(t('arbeidsliste.relogin_required'));
        feil.status = 401;
        throw feil;
      }
    }
    kontrollerKontekst();
    const headers = {};
    if (brukSesjon) headers.Authorization = `Bearer ${brukSesjon.token}`;
    if (body) headers['Content-Type'] = 'application/json';
    if (id) headers['X-Arbeidsliste-Kopi'] = id;
    const svar = await fetch(OVERFORING_API + sti, {
      method: body ? 'POST' : 'GET', headers, body, signal, cache: 'no-store',
    });
    const data = await svar.json().catch(() => null);
    kontrollerKontekst();
    if (!svar.ok || !data || data.error) {
      const feil = new Error(data?.error || t('arbeidsliste.server_unreachable'));
      feil.status = svar.status;
      throw feil;
    }
    return data;
  }

  function brukNett(tekst, handling) {
    if (jobb) return;
    if (isOfflineMode() || navigator.onLine === false) {
      status.textContent = t('arbeidsliste.requires_network');
      return;
    }
    const aktivJobb = new AbortController();
    jobb = aktivJobb;
    status.textContent = tekst;
    oppdaterKnapper();
    Promise.resolve().then(() => handling(aktivJobb.signal)).catch((feil) => {
      if (aktivJobb.signal.aborted || feil.name === 'AbortError') return;
      if (feil.status === 401) {
        sesjon = null;
        kopi = null;
        visKopi();
      }
      if (feil.name === 'QuotaExceededError') {
        status.textContent = t('arbeidsliste.quota_exceeded');
      } else if (feil instanceof TypeError) {
        status.textContent = t('arbeidsliste.check_network');
      } else {
        status.textContent = feil.message;
      }
    }).finally(() => {
      if (jobb !== aktivJobb) return;
      jobb = null;
      oppdaterKnapper();
    });
  }

  async function lastMetadata(signal) {
    kopi = (await api('', signal)).kopi;
    visKopi();
  }

  async function lastForhandsvisning(signal) {
    if (!kopi) return;
    visKopi(await api('/innhold', signal, { id: kopi.id }));
  }

  function visDialog(hente) {
    vilHente = hente;
    sesjon = lesOverforingssesjon();
    kopi = null;
    visKopi();
    dialog.showModal();
    brukNett(t('arbeidsliste.checking_transfer'), async (signal) => {
      const { aktiv } = await api('/status', signal, { medSesjon: false });
      aktivPaServer = aktiv;
      if (!aktiv) {
        status.textContent = t('arbeidsliste.unavailable');
        return;
      }
      if (sesjon) {
        await lastMetadata(signal);
        if (vilHente) await lastForhandsvisning(signal);
      }
      status.textContent = sesjon ? '' : t('arbeidsliste.login_same_account');
    });
  }

  function bekreftPrivatListe() {
    if (hentAktivFellestur()) throw new Error(t('arbeidsliste.copy_fellestur_first'));
    return bekreftLagretListe();
  }

  function bekreftLagretListe() {
    if (sendingPagar()) throw new Error(t('arbeidsliste.wait_sending'));
    const lagret = lesArbeidslisteForOverforing();
    if (JSON.stringify(lagret) !== JSON.stringify(synligeFunn())) {
      throw new Error(t('arbeidsliste.unsaved_changes'));
    }
    return lagret;
  }

  function lukkMeny(knapp) {
    const meny = knapp.closest('#header-menu');
    if (!meny) return;
    meny.open = false;
    meny.querySelector('summary').focus();
  }

  overfor.addEventListener('click', () => {
    lukkMeny(overfor);
    visDialog(false);
  });
  hent.addEventListener('click', () => {
    lukkMeny(hent);
    visDialog(true);
  });
  loggInn.addEventListener('click', () => brukNett(t('arbeidsliste.confirming_account'), async (signal) => {
    const konto = kontoKontekst();
    const password = localStorage.getItem('ao_password');
    if (!konto.brukernavn || !password) throw new Error(t('arbeidsliste.login_in_settings'));
    const body = JSON.stringify({ username: konto.brukernavn, password });
    const data = await api('/innlogging', signal, { medSesjon: false, body });
    if (!data.sesjon || !lagreOverforingssesjon(data.sesjon, konto)) return;
    sesjon = lesOverforingssesjon();
    await lastMetadata(signal);
    if (vilHente) await lastForhandsvisning(signal);
    status.textContent = '';
  }));
  lagre.addEventListener('click', () => brukNett(t('arbeidsliste.saving_copy'), async (signal) => {
    const observations = bekreftPrivatListe();
    if (!observations.length) throw new Error(t('arbeidsliste.list_empty'));
    const lokalMetadata = aktivInnhentetListe();
    if (lokalMetadata && lokalMetadata.eier !== sesjon.eier) throw new Error(t('arbeidsliste.wrong_owner'));
    const kilde = matchMedia('(pointer: coarse)').matches ? t('arbeidsliste.source_mobile') : t('arbeidsliste.source_desktop');
    const pakke = { liste: { schemaVersion: 1, observations },
      kilde, erstatter: kopi?.id ?? null };
    const grunnlag = JSON.stringify(pakke);
    if (!forsok || forsok.grunnlag !== grunnlag) {
      if (kopi && !confirm(t('arbeidsliste.confirm_replace', { tid: tidspunkt(kopi.lagretTs), alias: sesjon.alias }))) {
        status.textContent = '';
        return;
      }
      forsok = { grunnlag, id: crypto.randomUUID() };
    }
    let resultat;
    try {
      resultat = await api('', signal, { body: JSON.stringify({ ...pakke, forsok: forsok.id }) });
    } catch (feil) {
      if (feil.status === 409) {
        forsok = null;
        await lastMetadata(signal);
      }
      throw feil;
    }
    forsok = null;
    const kvittering = resultat.kopi;
    kopi = kvittering;
    visKopi();
    const sendt = JSON.stringify(observations);
    let endret = sendt !== JSON.stringify(synligeFunn());
    try {
      endret ||= sendt !== JSON.stringify(lesArbeidslisteForOverforing());
    } catch {
      endret = true;
    }
    status.textContent = t('arbeidsliste.saved_for_fetch', {
      summary: oppsummer(kvittering),
      pending: endret ? t('arbeidsliste.pending_changes') : '',
    });
    try {
      await lastMetadata(signal);
      if (kopi?.id !== kvittering.id) status.textContent = t('arbeidsliste.saved_confirmed');
    } catch {
      // Lagringskvitteringen gjelder selv om oppdatering av serverstatus feiler.
    }
  }));
  forhåndsvis.addEventListener('click', () => brukNett(t('arbeidsliste.fetching_preview'), async (signal) => {
    await lastMetadata(signal);
    await lastForhandsvisning(signal);
    status.textContent = '';
  }));
  slett.addEventListener('click', () => brukNett(t('arbeidsliste.deleting_copy'), async (signal) => {
    if (!kopi || !confirm(t('arbeidsliste.confirm_delete_copy'))) {
      status.textContent = '';
      return;
    }
    try {
      await api('/slett', signal, { body: JSON.stringify({ id: kopi.id }) });
    } catch (feil) {
      if (feil.status === 409) await lastMetadata(signal);
      throw feil;
    }
    kopi = null;
    visKopi();
    status.textContent = t('arbeidsliste.copy_deleted');
  }));
  taInn.addEventListener('click', () => brukNett(t('arbeidsliste.checking_copy'), async (signal) => {
    if (!vistKopi) return;
    function bekreftTomListe() {
      if (bekreftPrivatListe().length || lesPrivatArbeidsliste().length || aktivInnhentetListe()) {
        throw new Error(t('arbeidsliste.must_be_empty'));
      }
    }
    bekreftTomListe();
    const id = vistKopi.kopi.id;
    let fersk;
    try {
      fersk = await api('/innhold', signal, { id });
    } catch (feil) {
      if (feil.status === 404) await lastMetadata(signal);
      throw feil;
    }
    await apneInnhentetListe(() => {
      if (signal.aborted || sesjon?.token !== lesOverforingssesjon()?.token) throw new DOMException('', 'AbortError');
      bekreftTomListe();
      return lagreInnhentetKopi(fersk.kopi, fersk.liste.observations, sesjon.eier);
    });
    listeEndret();
    dialog.close();
    varsle(t('arbeidsliste.fetched_toast'));
  }));

  lokal.addEventListener('click', async () => {
    lukkMeny(lokal);
    try {
      if (aktivInnhentetListe()) {
        bekreftLagretListe();
        lukkInnhentetListe();
      } else {
        bekreftPrivatListe();
        await apneInnhentetListe(() => {
          bekreftPrivatListe();
          return lesInnhentetListe();
        });
      }
      listeEndret();
    } catch (feil) {
      varsle(feil.message);
    }
  });
  function stengDialog() {
    jobb?.abort();
    jobb = null;
    sesjon = null;
    kopi = null;
    visKopi();
    if (dialog.open) dialog.close();
  }
  dialog.addEventListener('close', () => { if (!dialog.open) stengDialog(); });
  window.addEventListener(KONTOKONTEKST_ENDRET, stengDialog);
  window.addEventListener('storage', (event) => {
    if (erOverforingskontoendring(event)) {
      forsok = null;
      stengDialog();
    }
    oppdaterLokalt();
  });
  window.addEventListener('pagehide', () => {
    stengDialog();
    lokalVarApen = Boolean(aktivInnhentetListe());
    lukkInnhentetListe();
  });
  window.addEventListener('pageshow', (event) => {
    if (event.persisted && lokalVarApen) location.reload();
  });

  async function gjenapneLokalt() {
    try {
      if (!hentAktivFellestur() && lesInnhentetListe() && !bekreftPrivatListe().length) {
        await apneInnhentetListe(() => bekreftPrivatListe().length ? null : lesInnhentetListe());
        listeEndret();
      }
    } catch {
      // Brukeren kan åpne den lokale kopien fra menyen.
    }
  }
  oppdaterLokalt();
  gjenapneLokalt();
  return oppdaterLokalt;
}
