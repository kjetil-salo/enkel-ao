import { loadActivities, loggInnMedLagretLegitimasjon } from './api.js?v=v1.62.0';
import { activityBokmalName, activityDisplayName } from './storage.js';
import { initCoObserverPicker } from './coobserver-picker.js';

// Ett handlingsvindu for et sted/dag eller sletting av ett eget funn.
// Utvalget fryses ved åpning, og kall sendes sekvensielt uten automatisk retry.
export function initSendtHandlinger({ hentTokens, onEndring, onFjernet, erOpptatt }) {
  const dialog = document.createElement('dialog');
  dialog.className = 'gruppe-modal';
  dialog.tabIndex = -1;
  dialog.setAttribute('aria-labelledby', 'gm-tittel');
  dialog.innerHTML = `
    <div class="modal-topp"><h2 id="gm-tittel"></h2>
      <button type="button" class="lukk" id="gm-lukk" aria-label="Lukk">✕</button></div>
    <p id="gm-utvalg" class="modal-funn"></p>
    <p id="gm-omfang" class="seksjon-info"></p>
    <div id="gm-valg" class="em-rad">
      <label for="gm-handling">Hva vil du gjøre?</label>
      <select id="gm-handling">
        <option value="aktivitet">Endre aktivitet på mine funn</option>
        <option value="tid">Sett tidsrom på mine funn</option>
        <option value="medobs">Endre medobservatører på mine funn</option>
        <option value="fjern">Fjern meg som observatør</option>
        <option value="slett">Slett mine funn</option>
      </select>
    </div>
    <div id="gm-aktivitet-felt" class="em-rad">
      <label for="gm-aktivitet">Ny aktivitet</label><select id="gm-aktivitet"></select>
    </div>
    <div id="gm-tid-felt" class="em-rad-par" hidden>
      <div class="em-rad"><label for="gm-fra">Fra kl.</label><input id="gm-fra" type="time" required></div>
      <div class="em-rad"><label for="gm-til">Til kl.</label><input id="gm-til" type="time" required></div>
    </div>
    <div id="gm-medobs-felt" hidden>
      <p class="seksjon-info">Velg medobservatørene som skal stå på alle dine egne funn her. Listen erstatter dagens medobservatører. Du beholdes som observatør.</p>
      <div id="gm-medobs-liste" class="gruppe-medobs-liste"></div>
      <div class="em-rad">
        <label for="gm-medobs-sok">Søk etter en observatør hos AO</label>
        <div class="gruppe-medobs-sok">
          <input id="gm-medobs-sok" type="text" placeholder="Navn eller AO-alias" autocomplete="off">
          <button id="gm-medobs-legg-til" type="button" class="btn-liten">Legg til</button>
        </div>
      </div>
    </div>
    <p id="gm-gjelder" class="seksjon-info"></p>
    <p id="gm-advarsel" class="gruppe-advarsel" hidden></p>
    <p id="gm-status" class="modal-status" role="status" aria-live="polite"></p>
    <ol id="gm-resultater" class="gruppe-resultater"></ol>
    <div class="modal-bunn">
      <button type="button" class="btn-liten" id="gm-avbryt">Avbryt</button>
      <button type="button" class="btn-liten primar" id="gm-utfor">Utfør</button>
    </div>`;
  document.body.append(dialog);
  const el = (id) => dialog.querySelector(`#gm-${id}`);
  let utvalg = [];
  let gruppe = null;
  let opptatt = false;
  let ferdig = false;
  let retur = null;
  let aktivitetLasting = null;
  let harAktiviteter = false;
  let visningsnr = 0;
  let medobsKlar = false;
  let medobsHenter = false;
  const uavklarte = new Set();
  const medobsVelger = initCoObserverPicker({
    container: el('medobs-liste'), newNameInput: el('medobs-sok'), addBtn: el('medobs-legg-til'),
  }, tegnValg);

  function maal() {
    return utvalg.filter((f) => el('handling').value === 'fjern'
      ? f.canRemoveSelf === true : f.isReporter === true);
  }

  function tegnValg() {
    const handling = el('handling').value;
    const antall = maal().length;
    el('aktivitet-felt').hidden = handling !== 'aktivitet';
    el('tid-felt').hidden = handling !== 'tid';
    el('medobs-felt').hidden = handling !== 'medobs';
    el('advarsel').hidden = !['fjern', 'slett'].includes(handling);
    el('advarsel').textContent = handling === 'slett'
      ? `Sletter ${antall} egne funn hos Artsobservasjoner. Funn rapportert av andre beholdes. Sletting kan ikke angres her.`
      : `Fjerner deg som observatør på ${antall} funn. Funnene og de andre observatørene beholdes.`;
    const tekster = {
      aktivitet: `Sett aktivitet på ${antall} funn`, tid: `Sett tidsrom på ${antall} funn`,
      fjern: `Fjern meg fra ${antall} funn`, slett: `Slett ${antall} funn`,
      medobs: `Sett medobservatører på ${antall} funn`,
    };
    el('utfor').textContent = tekster[handling];
    if (handling === 'medobs') {
      const valgte = medobsVelger.getSelected().length;
      el('utfor').textContent = valgte
        ? `Sett ${valgte} medobservatør${valgte === 1 ? '' : 'er'} på ${antall} funn`
        : `Fjern medobservatører fra ${antall} funn`;
    }
    // Medobs-knappen skal ikke bare virke deaktivert — den skal være borte
    // helt til AO har bekreftet medobservatørvalgene, slik at ingen kan
    // trykke gjennom en masseendring som aldri ble kontrollert (testnavnet
    // «uten automatisk masseendring» beskriver nettopp dette).
    el('utfor').hidden = handling === 'medobs' && !medobsKlar;
    el('utfor').disabled = ferdig || opptatt || antall === 0
      || (handling === 'aktivitet' && !harAktiviteter);
    el('utfor').classList.toggle('farlig', handling === 'slett');
    el('gjelder').textContent = handling === 'fjern'
      ? `Gjelder ${antall} funn du er med på. Dine egne funn beholdes.`
      : `Gjelder ${antall} egne funn. Funn rapportert av andre endres ikke.`;
  }

  function laas(verdi) {
    opptatt = verdi;
    dialog.setAttribute('aria-busy', String(verdi));
    for (const felt of dialog.querySelectorAll('button, select, input')) felt.disabled = verdi;
    if (verdi) dialog.focus();
    if (!verdi) tegnValg();
  }

  function lukk() {
    if (opptatt) return;
    dialog.close();
    if (retur?.isConnected) {
      const meny = retur.closest('details');
      (meny && !meny.open ? meny.querySelector('summary') : retur).focus();
    } else {
      const sted = [...document.querySelectorAll('[data-sted-handlinger]')]
        .find((knapp) => knapp.dataset.stedHandlinger === retur?.dataset.stedHandlinger);
      (sted || document.getElementById('ao-oppdater'))?.focus();
    }
  }

  async function aapne(funn, info, utloeser, enkelt = false) {
    if (opptatt || erOpptatt()) return;
    const nr = ++visningsnr;
    utvalg = funn.map((f) => ({ ...f }));
    gruppe = info.expectedGroup || null;
    ferdig = false;
    medobsKlar = false;
    medobsHenter = false;
    retur = utloeser;
    el('tittel').textContent = enkelt ? `Slett ${utvalg[0].taxonName}` : info.tittel;
    const egne = utvalg.filter((f) => f.isReporter === true).length;
    const med = utvalg.filter((f) => f.canRemoveSelf === true).length;
    const ukjent = utvalg.length - egne - med;
    el('utvalg').textContent = `${utvalg.length} funn: ${egne} egne og ${med} du er med på`
      + (ukjent ? ` · ${ukjent} med ukjent rolle` : '');
    el('omfang').textContent = enkelt ? `${info.tittel} · ${utvalg[0].quantity} ${utvalg[0].taxonName}`
      : 'Gjelder alle innlastede funn på dette stedet denne dagen, også dem bildefilteret skjuler.'
        + (info.avkortet ? ' AO-listen er avkortet. Funn som ikke er lastet inn, er ikke med.' : '');
    el('valg').hidden = enkelt;
    el('handling').value = enkelt ? 'slett' : (egne ? 'aktivitet' : 'fjern');
    for (const opt of el('handling').options) opt.disabled = opt.value === 'fjern' ? med === 0 : egne === 0;
    el('status').textContent = '';
    el('status').className = 'modal-status';
    el('resultater').replaceChildren();
    medobsVelger.setSelected([]);
    el('medobs-sok').value = '';
    el('fra').value = '';
    el('til').value = '';
    el('avbryt').textContent = 'Avbryt';
    laas(false);
    if (!dialog.open) dialog.showModal();
    if (!enkelt) el('handling').focus();
    else el('avbryt').focus();
    if (!aktivitetLasting) aktivitetLasting = loadActivities().catch(() => null);
    const aktiviteter = await aktivitetLasting;
    if (nr !== visningsnr || !dialog.open) return;
    if (Array.isArray(aktiviteter) && aktiviteter.length) {
      el('aktivitet').replaceChildren();
      for (const a of aktiviteter) {
        const option = document.createElement('option');
        option.value = a.value;
        option.textContent = activityDisplayName(a.label);
        el('aktivitet').append(option);
      }
      harAktiviteter = true;
    } else {
      aktivitetLasting = null;
      el('status').textContent = 'Kunne ikke hente aktivitetsvalgene. Lukk og prøv igjen.';
    }
    if (!opptatt) tegnValg();
  }

  async function lastMedobs() {
    if (medobsKlar || medobsHenter) return;
    const f = maal()[0];
    if (!f) return;
    const nr = visningsnr;
    medobsHenter = true;
    el('status').textContent = 'Kontrollerer medobservatørvalgene hos AO …';
    async function hent() {
      return fetch('/api/ao-coobserver-setup', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...hentTokens(), sightingId: f.sightingId, ...(gruppe ? { expectedGroup: gruppe } : {}) }),
      }).then((r) => r.json());
    }
    let svar;
    try {
      svar = await hent();
      if (svar.needsLogin && await loggInnMedLagretLegitimasjon('needs-login')) svar = await hent();
    } catch { svar = { ok: false }; }
    if (nr !== visningsnr || !dialog.open) return;
    medobsHenter = false;
    medobsKlar = svar.ok === true;
    el('status').textContent = medobsKlar ? '' : svar.error || 'Kunne ikke kontrollere medobservatørvalgene. Lukk og prøv igjen.';
    tegnValg();
  }

  el('handling').addEventListener('change', () => {
    tegnValg();
    if (el('handling').value === 'medobs') lastMedobs();
  });
  el('lukk').addEventListener('click', lukk);
  el('avbryt').addEventListener('click', lukk);
  dialog.addEventListener('cancel', (e) => { e.preventDefault(); lukk(); });
  dialog.addEventListener('keydown', (e) => {
    if (opptatt && e.key === 'Tab') { e.preventDefault(); dialog.focus(); }
  });
  window.addEventListener('beforeunload', (e) => { if (opptatt) { e.preventDefault(); e.returnValue = ''; } });

  el('utfor').addEventListener('click', async () => {
    if (opptatt || ferdig) return;
    const handling = el('handling').value;
    const funn = maal();
    if (!funn.length) return;
    if (funn.some((f) => uavklarte.has(String(f.sightingId)))) {
      el('status').textContent = 'Et tidligere resultat er uavklart. Kontroller de aktuelle funnene hos AO og last siden på nytt før du fortsetter.';
      return;
    }
    let endringer = {};
    if (handling === 'tid') {
      const fra = el('fra').value;
      const til = el('til').value;
      if (!/^\d{2}:\d{2}$/.test(fra) || !/^\d{2}:\d{2}$/.test(til) || til < fra) {
        el('status').textContent = 'Fyll ut fra- og til-tid. Til-tid må være lik eller etter fra-tid på samme dato.';
        el('fra').focus();
        return;
      }
      endringer = { time_from: fra, time_to: til };
    } else if (handling === 'medobs') {
      if (!medobsKlar) return;
      if (el('medobs-sok').value.trim()) {
        el('status').textContent = 'Velg et treff i AO-søket eller legg til personen før du lagrer.';
        el('medobs-sok').focus();
        return;
      }
      const valgte = medobsVelger.getSelected();
      if (valgte.some((person) => typeof person !== 'object' || !person.alias?.trim())) {
        el('status').textContent = 'Alle valgte personer må ha et AO-alias. Finn dem via AO-søket før du lagrer.';
        return;
      }
      endringer = { coobserver_aliases: valgte.map((person) => person.alias.trim()) };
      const liste = valgte.length ? valgte.map((person) => `${person.name} (${person.alias})`).join('\n')
        : 'Ingen medobservatører. Dagens medobservatører fjernes, og du beholdes.';
      if (!confirm(`Erstatt medobservatørene på ${funn.length} egne funn?\n${el('tittel').textContent}\n\n${liste}\n\nDu beholdes som observatør.`)) return;
    } else if (handling === 'aktivitet') {
      if (!harAktiviteter) return;
      endringer = { activity_id: el('aktivitet').value,
        activity_navn: activityBokmalName(el('aktivitet').selectedOptions[0].textContent) };
    }
    if (['fjern', 'slett'].includes(handling)
        && !confirm(`${el('utfor').textContent}?\n${el('tittel').textContent}\n${el('omfang').textContent}\n\n${el('advarsel').textContent}`)) return;
    const tokens = { ...hentTokens() };
    laas(true);
    let bekreftede = 0;
    let stoppet = false;
    for (const [i, f] of funn.entries()) {
      el('status').textContent = `Behandler ${i + 1} av ${funn.length}: ${f.taxonName} …`;
      el('status').className = 'modal-status jobber';
      let svar;
      try {
        const path = handling === 'slett' ? '/api/ao-delete-sighting'
          : handling === 'fjern' ? '/api/ao-remove-me' : '/api/ao-sighting-save';
        svar = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...tokens, sightingId: f.sightingId,
            ...(gruppe ? { expectedGroup: gruppe } : {}),
            ...(['aktivitet', 'tid', 'medobs'].includes(handling) ? { endringer } : {}) }),
        }).then((r) => r.json());
      } catch {
        svar = { ok: false, uncertain: true, error: 'Mistet kontakten. Endringen kan ha blitt utført hos AO.' };
      }
      const bekreftet = svar.ok === true && (['slett', 'fjern'].includes(handling)
        ? svar.verified === true : svar.bekreftet === true);
      const rad = document.createElement('li');
      if (bekreftet) {
        bekreftede++;
        rad.textContent = `✓ ${f.quantity} ${f.taxonName}: bekreftet`;
        if (['fjern', 'slett'].includes(handling)) onFjernet(f.sightingId);
        else onEndring(f.sightingId, endringer, svar.ao);
      } else {
        stoppet = true;
        if (svar.uncertain || svar.ok === true) uavklarte.add(String(f.sightingId));
        rad.textContent = `⚠ ${f.quantity} ${f.taxonName}: ${svar.error
          || (svar.avvik || []).join('; ') || 'AO bekreftet ikke resultatet. Kontroller funnet hos AO.'}`;
      }
      el('resultater').append(rad);
      if (stoppet) break;
    }
    ferdig = true;
    laas(false);
    el('handling').disabled = true;
    el('status').className = 'modal-status';
    el('status').textContent = stoppet
      ? `Stoppet. ${bekreftede} av ${funn.length} funn er bekreftet. Resten er ikke behandlet videre. Kontroller resultatet hos AO.`
      : `Ferdig. ${bekreftede} av ${funn.length} funn er bekreftet hos Artsobservasjoner.`;
    el('avbryt').textContent = 'Ferdig';
    el('avbryt').focus();
  });

  return {
    aapneGruppe: (funn, info, knapp) => aapne(funn, info, knapp),
    slettFunn: (funn, info, knapp) => aapne([funn], info, knapp, true),
    erOpptatt: () => opptatt,
  };
}
