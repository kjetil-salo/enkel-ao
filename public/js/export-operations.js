/**
 * Eksport-modul for CSV-eksport, kopiering og sletting av observasjoner
 */

import { toCsv } from './observations.js';
import { flashButton, showToast } from './ui.js';
import { appendSentBatch, loadAoDirectAutoClear, speciesDisplayName } from './storage.js';
import { t, getLanguage } from './i18n.js?v=v1.60.20';
import { isOfflineMode } from './offline-db.js';
import { hentAktivFellestur } from './fellestur-client.js';
import { aktivInnhentetListe } from './arbeidsliste-lokal.js';
import { kontoKontekst, sammeKontoKontekst } from './arbeidsliste-sesjon.js';

let senderTilAo = false;

export function aoSendingPagar() {
  return senderTilAo;
}

function _statusColor(type) {
  const light = document.body.classList.contains('theme-light');
  const colors = {
    info:    light ? '#2563eb' : '#93c5fd',
    success: light ? '#16a34a' : '#86efac',
    error:   light ? '#dc2626' : '#fca5a5',
  };
  return colors[type];
}

// Viser stegvis progresjon med animert linje under «Publiser til AO».
// Gir brukeren trygghet om at noe faktisk skjer under sending.
function _renderProgress(dom, step, totalSteps, text, pct = null) {
  dom.aoDirectStatus.style.display = 'block';
  dom.aoDirectStatus.style.cssText = `display:block;margin-top:8px;padding:10px;border-radius:8px;font-size:0.9rem;background:rgba(59,130,246,0.1);border:1px solid rgba(59,130,246,0.3);color:${_statusColor('info')};`;
  // pct === null → indeterminert animert linje; ellers determinat bredde
  const bar = pct == null
    ? '<div class="ao-progress-bar"></div>'
    : `<div class="ao-progress-bar ao-progress-bar-det" style="width:${Math.max(4, Math.min(100, pct))}%"></div>`;
  dom.aoDirectStatus.innerHTML = `
    <div class="ao-progress-head">
      <span class="ao-progress-step">${step}/${totalSteps}</span>
      <span>${text}</span>
    </div>
    <div class="ao-progress-track">${bar}</div>`;
}

// Hvor lenge et hentet kø-antall regnes som ferskt nok å vise. Køen endrer seg bare
// ved at brukeren selv gjør noe hos AO, så et par minutter er rikelig — og sparer et
// AO-kall per gang lista endres (renderObservations kaller inn hit ofte).
const _KO_CACHE_MS = 120000;
let _koCache = { ts: 0, count: null };
let _koHenter = null;

/**
 * Vis en nøytral opplysning over «Publiser til AO» hvis det ALLEREDE ligger funn til
 * gjennomgang («Kontroller funn») hos AO.
 *
 * Hensikten er at scoped publisering ikke skal være usynlig: ligger det noe der fra før,
 * publiserer appen kun din egen sending og lar resten stå — det bør man få vite FØR man
 * trykker send, ikke oppdage etterpå. Se docs/ao-publish-selective-capture.md.
 *
 * Rent opplysende og best-effort: feiler kallet, eller svarer AO «vet ikke» (null), vises
 * ingenting. En tom kø (0) er normaltilfellet og skal heller ikke si noe.
 */
export async function oppdaterAoKoHint(dom) {
  const hint = dom.aoKoHint || document.getElementById('ao-queue-hint');
  if (!hint) return;

  const vis = (count) => {
    if (!count) { hint.style.display = 'none'; return; }
    hint.style.display = 'block';
    hint.innerHTML = t('export.ao_queue_hint_html', { count });
  };

  // I streng Offline-modus skal det ikke gjøres bakgrunnskall mot nettverket
  if (isOfflineMode()) return;

  // Fersk nok fra sist? Vis den uten å spørre AO på nytt.
  if (Date.now() - _koCache.ts < _KO_CACHE_MS) { vis(_koCache.count); return; }
  // Et kall er allerede underveis — ikke start et parallelt.
  if (_koHenter) return;

  const tokens = JSON.parse(localStorage.getItem('ao_tokens') || '{}');
  if (!tokens.loginToken || !tokens.authCookie) return;

  _koHenter = (async () => {
    try {
      const res = await fetch('/api/ao-queue-count', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ loginToken: tokens.loginToken, authCookie: tokens.authCookie })
      });
      const data = await res.json();
      // null = «kunne ikke spørre AO», ikke «tom» — da cacher vi ingenting og viser ingenting.
      if (typeof data.count === 'number') {
        _koCache = { ts: Date.now(), count: data.count };
        vis(data.count);
      }
    } catch (_) {
      // Stille: et hint som ikke kan hentes skal aldri stå i veien for å sende.
    } finally {
      _koHenter = null;
    }
  })();
}

export function handleExport(observations, dom) {
  const csv = toCsv(observations);
  if (!csv) return;

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'fugleobservasjoner.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  flashButton(dom.exportBtn, t('export.downloaded_flash'));
}

async function copyToClipboard(csv) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    await navigator.clipboard.writeText(csv);
  } else {
    const ta = document.createElement('textarea');
    ta.value = csv;
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try {
      document.execCommand('copy');
    } finally {
      document.body.removeChild(ta);
    }
  }
}

export async function handleCopy(observations, dom) {
  const csv = toCsv(observations);
  if (!csv) return;

  try {
    await copyToClipboard(csv);
    flashButton(dom.copyBtn, t('common.copied'));
  } catch (e) {
    console.warn('Kunne ikke kopiere CSV til utklippstavlen', e);
  }
}

export async function handleCopyAndOpen(observations, dom) {
  const csv = toCsv(observations);
  if (!csv) return;

  try {
    await copyToClipboard(csv);
    window.open('https://www.artsobservasjoner.no/ImportSighting', '_blank');
    flashButton(dom.copyOpenBtn, t('export.opened_flash'));
    fetch('/api/log-export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'copy_open' }) }).catch(() => {});
  } catch (e) {
    console.warn('Kunne ikke kopiere CSV til utklippstavlen', e);
  }
}

// AO underkjenner observasjoner med tidspunkt frem i tid («Angi et tidspunkt som ikke
// er passert») — de importeres, men publiseres aldri. Fang dem her, ikke i AOs
// gjennomgangskø. Observasjoner kan ha fått fremtidig tid via redigering (edit.html),
// feil dato ved etterregistrering, eller feilstilt klokke.
function _findFutureObservation(observations) {
  const now = new Date();
  return observations.find((o) => {
    const from = o.timestamp ? new Date(o.timestamp) : null;
    const to = o.tilKlokkeslett ? new Date(o.tilKlokkeslett) : null;
    return (from && !isNaN(from) && from > now) || (to && !isNaN(to) && to > now);
  });
}

// Lista tømmes ikke automatisk etter sending. Svarer brukeren nei på «tøm lista?» og
// registrerer nye funn senere, ville et nytt trykk sendt de gamle på nytt — og de blir
// liggende dobbelt i AO uten at noe sa fra. Dialogen er stille når alt er nytt.
function _visDublettAdvarsel(antallSendt, antallTotalt, sendtTs) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    Object.assign(overlay.style, {
      position: 'fixed', inset: '0', zIndex: '1000', background: 'rgba(0,0,0,0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px',
    });

    const box = document.createElement('div');
    Object.assign(box.style, {
      background: 'var(--card-bg, #1e293b)', borderRadius: '12px', padding: '20px',
      maxWidth: '380px', width: '100%', boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
    });

    const nye = antallTotalt - antallSendt;
    const naar = sendtTs ? new Date(sendtTs) : null;
    const naarTekst = naar && !isNaN(naar)
      ? t('export.dublett2.when_prefix', {
          dag: naar.toDateString() === new Date().toDateString() ? t('export.dublett2.when_today') : t('export.dublett2.when_earlier'),
          tid: `${String(naar.getHours()).padStart(2, '0')}:${String(naar.getMinutes()).padStart(2, '0')}`,
        })
      : '';

    const knapp = 'padding:9px 14px;border-radius:8px;font-size:0.9em;cursor:pointer;width:100%;margin-top:8px;';
    box.innerHTML = `
      <h3 style="margin:0 0 10px 0;font-size:1.05em;">${t('export.dublett2.heading')}</h3>
      <p style="margin:0 0 16px 0;font-size:0.9em;line-height:1.45;">
        ${t('export.dublett2.body', { sent: antallSendt, total: antallTotalt, when: naarTekst })}
      </p>
      <button id="dub-nye" style="${knapp}border:none;background:var(--accent,#3b82f6);color:#fff;font-weight:500;">
        ${nye === 1 ? t('export.dublett2.send_one_new') : t('export.dublett2.send_many_new', { n: nye })}
      </button>
      <button id="dub-alt" style="${knapp}border:1px solid var(--border,rgba(148,163,184,0.25));background:transparent;color:var(--text);">
        ${t('export.dublett2.send_all')}
      </button>
      <button id="dub-avbryt" style="${knapp}border:none;background:transparent;color:var(--muted);">
        ${t('common.cancel')}
      </button>`;

    overlay.appendChild(box);
    document.body.appendChild(overlay);

    const svar = (verdi) => { overlay.remove(); resolve(verdi); };
    box.querySelector('#dub-nye').addEventListener('click', () => svar('kun-nye'));
    box.querySelector('#dub-alt').addEventListener('click', () => svar('alt'));
    box.querySelector('#dub-avbryt').addEventListener('click', () => svar('avbryt'));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) svar('avbryt'); });
  });
}

/**
 * Vis bekreftelsesdialog når brukeren forsøker å sende inn observasjoner til AO
 * mens streng Offline-modus er aktiv. Varsler om nettverksbruk og at mobildatakostnader kan påløpe.
 * @param {number} antall
 * @returns {Promise<boolean>} true hvis brukeren tillater nettverksbruk for innsendingen
 */
export function _visOfflineInnsendingBekreftelse(antall) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.id = 'offline-send-confirm-modal';
    Object.assign(overlay.style, {
      position: 'fixed', inset: '0', zIndex: '1000', background: 'rgba(0,0,0,0.55)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px',
    });

    const box = document.createElement('div');
    Object.assign(box.style, {
      background: 'var(--card-bg, #1e293b)', borderRadius: '14px', padding: '20px',
      maxWidth: '390px', width: '100%', boxShadow: '0 8px 32px rgba(0,0,0,0.35)',
      border: '1px solid var(--border, rgba(148,163,184,0.25))',
    });

    const knapp = 'padding:10px 14px;border-radius:8px;font-size:0.92em;cursor:pointer;width:100%;margin-top:8px;';
    const ord = antall === 1 ? t('observations.word_singular') : t('observations.word_plural');
    box.innerHTML = `
      <h3 style="margin:0 0 10px 0;font-size:1.05em;">${t('export.offline_confirm.title')}</h3>
      <p style="margin:0 0 16px 0;font-size:0.9em;line-height:1.45;">
        ${t('export.offline_confirm.body', { n: antall, ord })}
      </p>
      <button type="button" id="offline-send-tillat" style="${knapp}border:none;background:var(--accent,#3b82f6);color:#fff;font-weight:600;">
        ${t('export.offline_confirm.allow')}
      </button>
      <button type="button" id="offline-send-avbryt" style="${knapp}border:1px solid var(--border,rgba(148,163,184,0.25));background:transparent;color:var(--muted);">
        ${t('common.cancel')}
      </button>`;

    overlay.appendChild(box);
    document.body.appendChild(overlay);

    const svar = (tillat) => {
      overlay.remove();
      resolve(tillat);
    };
    box.querySelector('#offline-send-tillat').addEventListener('click', () => svar(true));
    box.querySelector('#offline-send-avbryt').addEventListener('click', () => svar(false));
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) svar(false);
    });
  });
}

/**
 * Trygg parsing av SSE-hendelser fra rå tekst eller ufullstendig buffer.
 * Håndterer både standard «data: {...}\n\n», delvis overførte buffere og ren JSON.
 * @param {string} text
 * @returns {Array<object>}
 */
export function _parseSseEvents(text) {
  const events = [];
  if (!text || typeof text !== 'string') return events;

  // 1. Let etter vanlige data:-linjer
  const lines = text.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('data:')) {
      const payload = trimmed.slice(5).trim();
      if (payload) {
        try {
          const parsed = JSON.parse(payload);
          if (parsed && typeof parsed === 'object') {
            events.push(parsed);
          }
        } catch (_) {}
      }
    }
  }

  // 2. Fallback: hvis ingen data:-linjer matchet (f.eks. ved rå JSON-respons eller kuttet format)
  if (!events.length) {
    try {
      const parsed = JSON.parse(text.trim());
      if (parsed && typeof parsed === 'object') {
        events.push(parsed);
      }
    } catch (_) {
      const matches = text.match(/\{[^{}]*"phase"\s*:\s*"[^"]+"[^{}]*\}/g);
      if (matches) {
        for (const m of matches) {
          try {
            const parsed = JSON.parse(m);
            if (parsed && typeof parsed === 'object') {
              events.push(parsed);
            }
          } catch (_) {}
        }
      }
    }
  }

  return events;
}

export async function handleDirectSend(observations, dom, callbacks) {
  if (!observations.length || senderTilAo) return;

  const username = localStorage.getItem('ao_username');
  const password = localStorage.getItem('ao_password');
  if (!username || !password) return;

  const innhentet = aktivInnhentetListe();
  const sammeListe = () => !hentAktivFellestur() && aktivInnhentetListe()?.kopiId === innhentet?.kopiId;
  const konto = innhentet ? kontoKontekst() : null;

  const future = _findFutureObservation(observations);
  if (future) {
    const navn = (future.species && speciesDisplayName(future.species)) || t('export.stream.future_fallback');
    dom.aoDirectStatus.style.cssText = `display:block;margin-top:8px;padding:10px;border-radius:8px;font-size:0.9rem;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);color:${_statusColor('error')};`;
    dom.aoDirectStatus.textContent = t('export.stream.future_error', { navn });
    return;
  }

  if (innhentet) {
    const locale = getLanguage() === 'nn' ? 'nn-NO' : 'nb-NO';
    const kopitid = new Date(innhentet.lagretTs * 1000).toLocaleString(locale);
    if (!confirm(t('export.stream.confirm_fetched', { tid: kopitid }))) return;
  }

  // Allerede publiserte funn i lista → la brukeren velge før noe sendes
  let utvalg = [...observations];
  const alleredeSendt = observations.filter((o) => o.sentTs);
  if (alleredeSendt.length) {
    const valg = await _visDublettAdvarsel(alleredeSendt.length, observations.length,
                                           alleredeSendt[0].sentTs);
    if (valg === 'avbryt') return;
    if (valg === 'kun-nye') {
      utvalg = observations.filter((o) => !o.sentTs);
      if (!utvalg.length) return;
    }
  }

  const total = utvalg.length;

  // I streng Offline-modus spørres brukeren alltid før nettverket tas i bruk til innsending
  let allowOfflineBypass = false;
  if (isOfflineMode()) {
    const tillatNettverk = await _visOfflineInnsendingBekreftelse(total);
    if (!tillatNettverk) return;
    allowOfflineBypass = true;
  }

  dom.aoDirectBtn.disabled = true;
  _renderProgress(dom, 1, 3, t('export.stream.logging_in'));

  const extraHeaders = allowOfflineBypass ? { 'X-Allow-Offline-Network': '1' } : {};
  const listeVedStart = JSON.stringify(observations);
  let awaitingImportReceipt = false;
  senderTilAo = true;

  try {
    const loginResp = await fetch('/api/ao-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...extraHeaders },
      body: JSON.stringify({ username, password, ...(innhentet && { arbeidslisteEier: innhentet.eier }) }),
    });
    const loginResult = await loginResp.json();
    if (!loginResp.ok || !loginResult.success) {
      throw new Error(loginResult.error || t('export.send.login_failed'));
    }
    if (innhentet && (!sammeListe() || !sammeKontoKontekst(konto))) {
      throw new Error(t('export.stream.list_changed'));
    }

    const tokens = JSON.parse(localStorage.getItem('ao_tokens') || '{}');
    tokens.loginToken = loginResult.loginToken;
    tokens.authCookie = loginResult.authCookie;
    tokens.userId = tokens.mapUserId || loginResult.userId;
    if (!innhentet) {
      localStorage.setItem('ao_tokens', JSON.stringify(tokens));
      // Fersk sesjon: en cache med private lokaliteter hentet under den forrige,
      // eventuelt døde, sesjonen skal ikke overleve (se api.js, 09.11.2026).
      localStorage.removeItem('ao_private_sites');
    }

    const totalOrd = total === 1 ? t('observations.word_singular') : t('observations.word_plural');
    _renderProgress(dom, 2, 3, t('export.stream.sending', { n: total, ord: totalOrd }), 0);

    awaitingImportReceipt = true;
    const importResp = await fetch('/api/ao-import-stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...extraHeaders },
      body: JSON.stringify({
        observations: utvalg,
        loginToken: tokens.loginToken,
        authCookie: tokens.authCookie,
        areaId: localStorage.getItem('ao_area') ? JSON.parse(localStorage.getItem('ao_area')).id : '',
      }),
    });

    // Feil før strømmen starter (f.eks. 400-validering) kommer som vanlig JSON
    if (!importResp.ok) {
      let msg = t('export.stream.import_failed');
      try {
        const j = await importResp.json();
        msg = j.error || msg;
      } catch (_) {
        try {
          const txt = await importResp.text();
          if (txt && txt.trim()) msg = txt.trim();
        } catch (__) { /* ignorer */ }
      }
      awaitingImportReceipt = false;
      throw new Error(msg);
    }

    let buffer = '';
    let importResult = null;

    // Et tomt svar bekrefter aldri at AO tok imot observasjonene.
    if (importResp.status === 204 || !importResp.body) {
      throw new Error(t('export.stream.unconfirmed_full'));
    } else if (typeof importResp.body.getReader !== 'function') {
      // Fallback for miljøer der getReader ikke er tilgjengelig: les hele kroppen som tekst
      const fullText = await importResp.text();
      const events = _parseSseEvents(fullText);
      const doneEvt = [...events].reverse().find((e) => e.phase === 'done');
      if (doneEvt) {
        importResult = doneEvt;
      } else {
        const errorEvt = [...events].reverse().find((e) => e.phase === 'error');
        if (errorEvt) {
          awaitingImportReceipt = false;
          throw new Error(errorEvt.error || t('export.stream.import_failed'));
        }
        throw new Error(t('export.stream.import_failed'));
      }
    } else {
      // Les SSE-strømmen og oppdater fremdrift i sanntid
      const reader = importResp.body.getReader();
      const decoder = new TextDecoder();
      let streamDone = false;

      while (!streamDone) {
        let readResult;
        try {
          readResult = await reader.read();
        } catch (streamErr) {
          // Firefox, Safari og visse proxyer/nettverkslag kaster feil
          // som "TypeError: Error in input stream" eller "The operation was aborted"
          // når socketen lukkes fra serversiden ved strømslutt.
          try {
            buffer += decoder.decode();
          } catch (_) {}

          const bufferedEvents = _parseSseEvents(buffer);
          const doneEvt = [...bufferedEvents].reverse().find((e) => e.phase === 'done');
          if (doneEvt) {
            importResult = doneEvt;
            streamDone = true;
            break;
          }

          const errorEvt = [...bufferedEvents].reverse().find((e) => e.phase === 'error');
          if (errorEvt) {
            awaitingImportReceipt = false;
            throw new Error(errorEvt.error || t('export.stream.import_failed'));
          }

          throw streamErr;
        }

        const { done, value } = readResult;
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        let sep;
        while ((sep = buffer.indexOf('\n\n')) >= 0) {
          const rawEvent = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          const dataLine = rawEvent.split('\n').find((l) => l.startsWith('data:'));
          if (!dataLine) continue;
          let evt;
          try { evt = JSON.parse(dataLine.slice(5).trim()); } catch (_) { continue; }

          if (evt.phase === 'importing') {
            const tot = evt.total || total;
            const behandlet = Math.max(0, tot - (evt.remaining || 0));
            const pct = tot ? Math.round((behandlet / tot) * 100) : null;
            _renderProgress(dom, 2, 3, t('export.stream.processing', { done: behandlet, total: tot }), pct);
          } else if (evt.phase === 'uploading-images') {
            const tot = evt.total || 0;
            const d = evt.done || 0;
            const pct = tot ? Math.round((d / tot) * 100) : null;
            _renderProgress(dom, 2, 3, t('export.stream.uploading_images', { done: d, total: tot }), pct);
          } else if (evt.phase === 'publishing') {
            const tot = evt.total || total;
            const pubOrd = tot === 1 ? t('observations.word_singular') : t('observations.word_plural');
            _renderProgress(dom, 3, 3, t('export.stream.publishing', { n: tot, ord: pubOrd }), null);
          } else if (evt.phase === 'done') {
            importResult = evt;
            streamDone = true;
            break;
          } else if (evt.phase === 'error') {
            awaitingImportReceipt = false;
            throw new Error(evt.error || t('export.stream.import_failed'));
          }
        }
      }

      if (streamDone) {
        try { await reader.cancel(); } catch (_) { /* ignorer */ }
      }
    }

    // Hvis strømmen ble brutt før siste \n\n ble nådd, sjekk om ferdig-event ligger i bufferen
    if (!importResult && buffer.trim()) {
      const bufferedEvents = _parseSseEvents(buffer);
      const doneEvt = [...bufferedEvents].reverse().find((e) => e.phase === 'done');
      if (doneEvt) {
        importResult = doneEvt;
      } else {
        const errorEvt = [...bufferedEvents].reverse().find((e) => e.phase === 'error');
        if (errorEvt) {
          awaitingImportReceipt = false;
          throw new Error(errorEvt.error || t('export.stream.import_failed'));
        }

      }
    }

    if (importResult && typeof importResult.success === 'boolean') {
      awaitingImportReceipt = false;
    }
    if (!importResult || importResult.success !== true) {
      throw new Error((importResult && importResult.error) || t('export.stream.import_failed'));
    }

    if (importResult.refreshedAuthCookie && !innhentet) {
      const tok = JSON.parse(localStorage.getItem('ao_tokens') || '{}');
      tok.authCookie = importResult.refreshedAuthCookie;
      localStorage.setItem('ao_tokens', JSON.stringify(tok));
    }

    const notPublished = importResult.notPublished || [];
    if (notPublished.length || importResult.heldBack) {
      const biter = [];
      if (importResult.count) {
        const cOrd = importResult.count === 1 ? t('observations.word_singular') : t('observations.word_plural');
        biter.push(t('export.stream.published_count', { n: importResult.count, ord: cOrd }));
      }
      if (notPublished.length) {
        const n = notPublished.length;
        biter.push(n === 1
          ? t('export.stream.not_published_one', { list: notPublished.join(', ') })
          : t('export.stream.not_published_many', { n, list: notPublished.join(', ') }));
      }
      if (importResult.heldBack) {
        const detaljer = importResult.heldBackDetails
          ? ` <span style="opacity:.85">${importResult.heldBackDetails}</span>` : '';
        biter.push(importResult.heldBack === 1
          ? t('export.stream.held_back_one', { details: detaljer })
          : t('export.stream.held_back_many', { n: importResult.heldBack, details: detaljer }));
      }
      biter.push(t('export.stream.manual_review'));

      dom.aoDirectStatus.style.cssText = `display:block;margin-top:8px;padding:10px;border-radius:8px;font-size:0.9rem;background:rgba(234,179,8,0.1);border:1px solid rgba(234,179,8,0.4);color:${_statusColor('error')};`;
      dom.aoDirectStatus.innerHTML = biter.join('<br>');
      dom.aoDirectBtn.disabled = false;
      return;
    }

    // Tøm listen automatisk ved vellykket sending dersom innstillingen er aktivert
    const doClearList = (forventetListe) => {
      if (!sammeListe() || JSON.stringify(observations) !== forventetListe) return;
      try {
        if (callbacks.lesLagretListe && JSON.stringify(callbacks.lesLagretListe()) !== forventetListe) return;
      } catch {
        return;
      }
      observations.splice(0, observations.length);
      callbacks.doRenderObservations();
      callbacks.saveState();
      if (dom.aoDirectStatus) {
        dom.aoDirectStatus.style.display = 'none';
      }
    };

    const scheduleClearList = () => {
      const forventetListe = JSON.stringify(observations);
      const shouldAutoClear = Boolean(
        (dom.aoDirectAutoClear && dom.aoDirectAutoClear.checked) ||
        loadAoDirectAutoClear()
      );
      if (shouldAutoClear) {
        setTimeout(() => {
          doClearList(forventetListe);
        }, 800);
      } else {
        setTimeout(() => {
          try {
            if (confirm(t('export.send.confirm_clear'))) {
              doClearList(forventetListe);
            }
          } catch (_) {}
        }, 500);
      }
    };

    const completeSuccessfulSend = (res) => {
      const count = (res && res.count) || total;
      dom.aoDirectStatus.style.cssText = `display:block;margin-top:8px;padding:10px;border-radius:8px;font-size:0.9rem;background:rgba(34,197,94,0.1);border:1px solid rgba(34,197,94,0.3);color:${_statusColor('success')};`;
      const sentOrd = count === 1 ? t('observations.word_singular') : t('observations.word_plural');
      let statusText = t('export.send.published_ok', { n: count, ord: sentOrd });
      if (res && res.imagesFailed && res.imagesFailed.length) {
        statusText += t('export.stream.images_failed', { list: res.imagesFailed.join(', ') });
      }
      dom.aoDirectStatus.textContent = statusText;
      dom.aoDirectBtn.disabled = false;
      fetch('/api/log-export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'direct' }) }).catch(() => {});

      const sendtTidspunkt = new Date().toISOString();
      const tomKandidat = sammeListe() && JSON.stringify(observations) === listeVedStart;
      utvalg.forEach((o) => { o.sentTs = sendtTidspunkt; });
      appendSentBatch(utvalg.map((o) => {
        const { photo, _photoMarker, ...rest } = o;
        return photo ? { ...rest, hadPhoto: true } : rest;
      }));
      if (sammeListe() && observations.length) {
        callbacks.doRenderObservations();
        callbacks.saveState();
        if (tomKandidat) scheduleClearList();
      }
    };

    completeSuccessfulSend(importResult);
  } catch (error) {
    // Brudd uten fullstendig done-kvittering er usikkert, aldri grunnlag for å tømme listen.
    const message = awaitingImportReceipt
      ? t('export.stream.unconfirmed_full')
      : error.message;
    dom.aoDirectStatus.style.cssText = `display:block;margin-top:8px;padding:10px;border-radius:8px;font-size:0.9rem;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);color:${_statusColor('error')};`;
    dom.aoDirectStatus.textContent = `❌ ${message}`;
    dom.aoDirectBtn.disabled = false;
  } finally {
    senderTilAo = false;
  }
}

export function handleClear(observations, dom, callbacks) {
  if (!observations.length) return;
  const ok = window.confirm(t('export.clear.confirm'));
  if (!ok) return;
  observations.splice(0, observations.length);
  callbacks.doRenderObservations();
  callbacks.saveState();
  showToast(t('export.clear.toast'));
}
