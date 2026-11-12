import { isOfflineMode } from './offline-db.js';
import { hentAktivFellestur } from './fellestur-client.js';
import { lesArbeidslisteForOverforing, lesPrivatArbeidsliste, speciesDisplayName } from './storage.js?v=v1.60.15';
import {
  aktivInnhentetListe, apneInnhentetListe, lagreInnhentetKopi,
  lesInnhentetListe, lukkInnhentetListe,
} from './arbeidsliste-lokal.js';
import {
  OVERFORING_API, KONTOKONTEKST_ENDRET, kontoKontekst, sammeKontoKontekst,
  lesOverforingssesjon, lagreOverforingssesjon, erOverforingskontoendring,
} from './arbeidsliste-sesjon.js';

function tidspunkt(ts) {
  return new Date(ts * 1000).toLocaleString('nb-NO', { dateStyle: 'short', timeStyle: 'short' });
}

function oppsummer(kopi) {
  if (!kopi) return 'Ingen lagret kopi. Lagre lista fra enheten du registrerte på.';
  const periode = kopi.fraDato === kopi.tilDato ? kopi.fraDato : [kopi.fraDato, kopi.tilDato].filter(Boolean).join('–');
  return [`${kopi.antall} observasjoner`, kopi.kilde, periode, `lagret ${tidspunkt(kopi.lagretTs)}`].filter(Boolean).join(' · ');
}

function beskrivObservasjon(obs) {
  const rad = document.createElement('li');
  const navn = speciesDisplayName(obs.species) || obs.species?.scientificName ||
    obs.species?.scientificNameHtml?.replace(/<[^>]+>/g, '') || 'Ukjent art';
  const art = document.createElement('strong');
  art.textContent = `${navn} · ${obs.count ?? 'Ukjent antall'}`;
  rad.append(art);
  const tid = obs.timestamp?.replace('T', ' ');
  const til = obs.tilKlokkeslett?.replace('T', ' ');
  const detaljer = [obs.placeName, tid, til && `til ${til}`, obs.activity, obs.age, obs.gender,
    obs.hideUntil && `Skjult til ${obs.hideUntil}`, obs.sentTs && 'Allerede merket som sendt',
    obs.comment, obs.privateComment && `Privat kommentar: ${obs.privateComment}`].filter(Boolean);
  if (detaljer.length) {
    const tekst = document.createElement('p');
    tekst.textContent = detaljer.join(' · ');
    rad.append(tekst);
  }
  if (obs.photo?.startsWith('data:image/jpeg;base64,')) {
    const bilde = document.createElement('img');
    bilde.alt = `Bilde av ${navn}`;
    bilde.loading = 'lazy';
    bilde.addEventListener('error', () => {
      const tekst = document.createElement('p');
      tekst.textContent = 'Bildet kunne ikke vises.';
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
    kontoInfo.textContent = sesjon ? `AO-konto: ${sesjon.alias}` : '';
  }

  function oppdaterLokalt() {
    overfor.hidden = synligeFunn().length === 0;
    try {
      const innhentet = aktivInnhentetListe();
      lokal.hidden = !innhentet && !lesInnhentetListe();
      lokal.textContent = innhentet ? 'Vis lista fra denne enheten' : 'Åpne innhentet liste';
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
        const feil = new Error('Logg inn på nytt for å fortsette overføringen.');
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
      const feil = new Error(data?.error || 'Kunne ikke kontakte serveren. Prøv igjen.');
      feil.status = svar.status;
      throw feil;
    }
    return data;
  }

  function brukNett(tekst, handling) {
    if (jobb) return;
    if (isOfflineMode() || navigator.onLine === false) {
      status.textContent = 'Overføring krever nett. Velg Hybrid eller Online og prøv igjen.';
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
        status.textContent = 'Denne enheten har for lite lagringsplass. Serverkopien er beholdt.';
      } else if (feil instanceof TypeError) {
        status.textContent = 'Kunne ikke kontakte serveren. Kontroller nettet og prøv igjen.';
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
    brukNett('Sjekker overføring …', async (signal) => {
      const { aktiv } = await api('/status', signal, { medSesjon: false });
      aktivPaServer = aktiv;
      if (!aktiv) {
        status.textContent = 'Listeoverføring er midlertidig utilgjengelig.';
        return;
      }
      if (sesjon) {
        await lastMetadata(signal);
        if (vilHente) await lastForhandsvisning(signal);
      }
      status.textContent = sesjon ? '' : 'Logg inn med samme AO-konto på begge enhetene.';
    });
  }

  function bekreftPrivatListe() {
    if (hentAktivFellestur()) throw new Error('Kopier først fellesturen til privat liste fra Fellestur-siden.');
    return bekreftLagretListe();
  }

  function bekreftLagretListe() {
    if (sendingPagar()) throw new Error('Vent til den pågående AO-sendingen er ferdig.');
    const lagret = lesArbeidslisteForOverforing();
    if (JSON.stringify(lagret) !== JSON.stringify(synligeFunn())) {
      throw new Error('Den synlige lista har endringer som mangler i lokal lagring. Ta vare på dem og prøv igjen.');
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
  loggInn.addEventListener('click', () => brukNett('Bekrefter AO-kontoen …', async (signal) => {
    const konto = kontoKontekst();
    const password = localStorage.getItem('ao_password');
    if (!konto.brukernavn || !password) throw new Error('Legg inn AO-innloggingen i Innstillinger først.');
    const body = JSON.stringify({ username: konto.brukernavn, password });
    const data = await api('/innlogging', signal, { medSesjon: false, body });
    if (!data.sesjon || !lagreOverforingssesjon(data.sesjon, konto)) return;
    sesjon = lesOverforingssesjon();
    await lastMetadata(signal);
    if (vilHente) await lastForhandsvisning(signal);
    status.textContent = '';
  }));
  lagre.addEventListener('click', () => brukNett('Lagrer privat kopi …', async (signal) => {
    const observations = bekreftPrivatListe();
    if (!observations.length) throw new Error('Arbeidslista er tom.');
    const lokalMetadata = aktivInnhentetListe();
    if (lokalMetadata && lokalMetadata.eier !== sesjon.eier) throw new Error('Logg inn med AO-kontoen som eier lista.');
    const pakke = { liste: { schemaVersion: 1, observations },
      kilde: matchMedia('(pointer: coarse)').matches ? 'Mobil' : 'Datamaskin', erstatter: kopi?.id ?? null };
    const grunnlag = JSON.stringify(pakke);
    if (!forsok || forsok.grunnlag !== grunnlag) {
      if (kopi && !confirm(`Erstatte kopien fra ${tidspunkt(kopi.lagretTs)} for ${sesjon.alias}?`)) {
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
    status.textContent = `Lagret for henting på en annen enhet. ${oppsummer(kvittering)}.${endret ? ' Nyere lokale endringer venter på lagring.' : ''}`;
    try {
      await lastMetadata(signal);
      if (kopi?.id !== kvittering.id) status.textContent = 'Lagringen ble bekreftet. Serveren viser nå gjeldende status for kontoen.';
    } catch {
      // Lagringskvitteringen gjelder selv om oppdatering av serverstatus feiler.
    }
  }));
  forhåndsvis.addEventListener('click', () => brukNett('Henter forhåndsvisning …', async (signal) => {
    await lastMetadata(signal);
    await lastForhandsvisning(signal);
    status.textContent = '';
  }));
  slett.addEventListener('click', () => brukNett('Sletter serverkopien …', async (signal) => {
    if (!kopi || !confirm('Slette den private serverkopien? Lokale lister beholdes.')) {
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
    status.textContent = 'Serverkopien er slettet.';
  }));
  taInn.addEventListener('click', () => brukNett('Sjekker kopien …', async (signal) => {
    if (!vistKopi) return;
    function bekreftTomListe() {
      if (bekreftPrivatListe().length || lesPrivatArbeidsliste().length || aktivInnhentetListe()) {
        throw new Error('Arbeidslista må være tom. Ta vare på den via Sikkerhetskopi i Innstillinger før du henter inn.');
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
    varsle('Kopien er hentet inn i Lista di.');
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
