/**
 * Observations-modul for håndtering av observasjoner og CSV-eksport
 */

import { defaultCoObservers, loadMedobs } from './storage.js';
import { showToast } from './ui.js';
import { toLocalISOString } from './utils.js';

/**
 * Vis modal for å sette fra/til-klokkeslett på alle obs i en gruppe
 */
function showTimeModal(groupItems, defaultFra, defaultTil, groupName, observations, obsListEl, buttons, saveState) {
  // Fjern evt. eksisterende modal
  const existing = document.getElementById('time-modal');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'time-modal';
  Object.assign(overlay.style, {
    position: 'fixed', inset: '0', zIndex: '1000',
    background: 'rgba(0,0,0,0.5)', display: 'flex',
    alignItems: 'center', justifyContent: 'center',
  });

  const box = document.createElement('div');
  Object.assign(box.style, {
    background: 'var(--card-bg, #1e293b)', borderRadius: '12px', padding: '20px',
    maxWidth: '340px', width: '90%', boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
  });

  box.innerHTML = `
    <h3 style="margin:0 0 4px 0;font-size:1.05em;">🕐 Sett klokkeslett</h3>
    <p style="margin:0 0 14px 0;font-size:0.8em;color:var(--muted);line-height:1.3;">${groupName} — ${groupItems.length} observasjon${groupItems.length !== 1 ? 'er' : ''}</p>
    <div style="display:flex;gap:12px;align-items:center;margin-bottom:16px;">
      <div style="flex:1;">
        <label style="font-size:0.8em;color:var(--muted);display:block;margin-bottom:4px;">Fra</label>
        <input type="time" id="time-modal-fra" value="${defaultFra}" style="width:100%;padding:8px;border-radius:8px;border:1px solid var(--border,rgba(148,163,184,0.25));background:var(--card-bg);color:var(--text);font-size:16px;box-sizing:border-box;" />
      </div>
      <div style="flex:1;">
        <label style="font-size:0.8em;color:var(--muted);display:block;margin-bottom:4px;">Til</label>
        <input type="time" id="time-modal-til" value="${defaultTil}" style="width:100%;padding:8px;border-radius:8px;border:1px solid var(--border,rgba(148,163,184,0.25));background:var(--card-bg);color:var(--text);font-size:16px;box-sizing:border-box;" />
      </div>
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end;">
      <button type="button" id="time-modal-cancel" style="padding:8px 16px;border:1px solid var(--border,rgba(148,163,184,0.25));border-radius:6px;background:transparent;color:var(--text);cursor:pointer;font-size:0.9em;">Avbryt</button>
      <button type="button" id="time-modal-apply" style="padding:8px 16px;border:none;border-radius:6px;background:var(--accent,#3b82f6);color:white;cursor:pointer;font-size:0.9em;font-weight:500;">Sett på alle</button>
    </div>
  `;

  overlay.appendChild(box);
  document.body.appendChild(overlay);

  const fraInput = document.getElementById('time-modal-fra');
  const tilInput = document.getElementById('time-modal-til');
  const cancelBtn = document.getElementById('time-modal-cancel');
  const applyBtn = document.getElementById('time-modal-apply');

  function close() { overlay.remove(); }

  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  cancelBtn.addEventListener('click', close);

  applyBtn.addEventListener('click', () => {
    const fraVal = fraInput.value;
    const tilVal = tilInput.value;

    if (!fraVal) { fraInput.focus(); return; }

    groupItems.forEach(obs => {
      // Bruk eksisterende dato fra obs, bare oppdater klokkeslett
      const baseDate = obs.timestamp ? new Date(obs.timestamp) : new Date();
      const [fraH, fraM] = fraVal.split(':').map(Number);
      const fraDate = new Date(baseDate);
      fraDate.setHours(fraH, fraM, 0, 0);
      obs.timestamp = toLocalISOString(fraDate);

      if (tilVal) {
        const [tilH, tilM] = tilVal.split(':').map(Number);
        const tilDate = new Date(baseDate);
        tilDate.setHours(tilH, tilM, 0, 0);
        obs.tilKlokkeslett = toLocalISOString(tilDate);
      }
    });

    saveState();
    renderObservations(observations, obsListEl, buttons, saveState);
    close();
    showToast(`Klokkeslett satt på ${groupItems.length} obs`);
  });

  fraInput.focus();
}

/**
 * Render observasjoner i tabellvisning
 * @param {Array} observations - Liste med observasjoner
 * @param {HTMLElement} obsListEl - Container-element
 * @param {Object} buttons - Objekt med knapper som skal aktiveres
 * @param {Function} saveState - Callback for å lagre state
 */
export function renderObservations(observations, obsListEl, buttons, saveState) {
  obsListEl.innerHTML = '';

  if (!observations.length) {
    const item = document.createElement('div');
    item.className = 'obs-empty-msg';
    item.textContent = 'Ingen observasjoner registrert ennå.';
    obsListEl.appendChild(item);
    return;
  }

  // Grupper observasjoner etter stedsnavn
  const groups = [];
  const indexByKey = new Map();
  
  observations.forEach((obs) => {
    const key = (obs.placeName && obs.placeName.trim()) || 'Uten stedsnavn';
    let idx = indexByKey.get(key);
    
    if (idx === undefined) {
      idx = groups.length;
      indexByKey.set(key, idx);
      groups.push({ key, items: [] });
    }
    
    groups[idx].items.push(obs);
  });
  
  // Sorter obs alfabetisk på art innenfor hver gruppe
  groups.forEach(group => {
    group.items.sort((a, b) => {
      const an = (a.species && a.species.taxonName) ? a.species.taxonName.toLowerCase() : '';
      const bn = (b.species && b.species.taxonName) ? b.species.taxonName.toLowerCase() : '';
      return an.localeCompare(bn, 'nb');
    });
  });

  const table = document.createElement('table');
  table.className = 'obs-table';

  // På smal skjerm: colgroup definerer kolonnebredder for table-layout:fixed.
  // Nødvendig fordi første rad er en gruppe-header med colSpan=5, som ellers
  // hindrer fixed layout i å beregne korrekte bredder.
  if (window.innerWidth <= 480) {
    const colgroup = document.createElement('colgroup');
    ['23%', '38%', '20%', '0%', '19%'].forEach(w => {
      const col = document.createElement('col');
      col.style.width = w;
      colgroup.appendChild(col);
    });
    table.appendChild(colgroup);
  }

  const tbody = document.createElement('tbody');

  groups.forEach((group) => {
    // Finn antall unike arter i denne gruppen
    const uniqueSpecies = new Set(
      group.items
        .map(obs => obs.species && obs.species.taxonName ? obs.species.taxonName.trim().toLowerCase() : null)
        .filter(Boolean)
    );
    // Finn tidligste og seneste klokkeslett i gruppen
    // TODO: Vis også dato ved stedsnavnet når obs spenner over flere dager
    let earliestMs = Infinity;
    let latestMs = -Infinity;
    group.items.forEach(obs => {
      if (obs.timestamp) {
        const t = new Date(obs.timestamp).getTime();
        if (!isNaN(t)) {
          if (t < earliestMs) earliestMs = t;
          if (t > latestMs) latestMs = t;
        }
      }
      // tilKlokkeslett er alltid >= timestamp for samme obs
      const til = obs.tilKlokkeslett || obs.timestamp;
      if (til) {
        const t = new Date(til).getTime();
        if (!isNaN(t) && t > latestMs) latestMs = t;
      }
    });

    const fmt = d => {
      const hh = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      return `${hh}:${mm}`;
    };

    let timeSpanHtml = '';
    if (earliestMs < Infinity && latestMs > -Infinity) {
      const fra = fmt(new Date(earliestMs));
      const til = fmt(new Date(latestMs));
      timeSpanHtml = fra === til
        ? ` <span style="font-weight:normal;font-size:0.85em;color:var(--muted);margin-left:6px;">${fra}</span>`
        : ` <span style="font-weight:normal;font-size:0.85em;color:var(--muted);margin-left:6px;">${fra}–${til}</span>`;
    }

    const groupRow = document.createElement('tr');
    const groupCell = document.createElement('td');
    groupCell.colSpan = 5;
    groupCell.className = 'obs-group-title';
    groupCell.innerHTML = `${group.key}${timeSpanHtml} <span style="font-weight:normal;font-size:0.98em;color:#3b82f6;margin-left:8px;">• ${uniqueSpecies.size} art${uniqueSpecies.size === 1 ? '' : 'er'}</span>`;

    // Klokkeikon for å sette tid på alle obs i gruppen
    const clockBtn = document.createElement('button');
    clockBtn.type = 'button';
    clockBtn.textContent = '🕐';
    clockBtn.title = 'Sett klokkeslett for alle observasjoner på dette stedet';
    Object.assign(clockBtn.style, {
      background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.9em',
      marginLeft: '6px', padding: '2px 4px', verticalAlign: 'middle', opacity: '0.7',
    });
    clockBtn.addEventListener('mouseenter', () => { clockBtn.style.opacity = '1'; });
    clockBtn.addEventListener('mouseleave', () => { clockBtn.style.opacity = '0.7'; });

    const defaultFra = earliestMs < Infinity ? fmt(new Date(earliestMs)) : '';
    const defaultTil = latestMs > -Infinity ? fmt(new Date(latestMs)) : '';
    const groupItems = group.items;

    clockBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      showTimeModal(groupItems, defaultFra, defaultTil, group.key, observations, obsListEl, buttons, saveState);
    });
    groupCell.appendChild(clockBtn);

    groupRow.appendChild(groupCell);
    tbody.appendChild(groupRow);

    group.items.forEach((obs, obsIndex) => {
      const tr = document.createElement('tr');
      
      // Alternerende bakgrunn (settes på td-er for full bredde)
      const altBg = obsIndex % 2 === 1 ? 'rgba(100,116,139,0.08)' : null;

      const artTd = document.createElement('td');
      artTd.textContent = obs.species && obs.species.taxonName ? obs.species.taxonName : '';
      tr.appendChild(artTd);

      const countTd = document.createElement('td');
      
      // Render count cell med pluss/minus knapper
      function renderCountCell() {
        countTd.innerHTML = '';
        // Wrapper-div brukes i stedet for direkte flex på td —
        // display:flex på <td> overstyrer table-layout:fixed sine bredder
        const countWrap = document.createElement('div');
        countWrap.style.display = 'flex';
        countWrap.style.alignItems = 'center';

        // Detekter om vi har presis peker (mus/trackpad) vs touch
        const hasFineMouse = window.matchMedia('(pointer: fine) and (hover: hover)').matches;
        const isLargeScreen = window.innerWidth >= 768 && window.innerHeight >= 600;
        const isNarrow = !hasFineMouse && window.innerWidth <= 420;

        // Mindre knapper på desktop/laptop med mus - noe mindre på smal mobil for å unngå overflow
        const btnSize = hasFineMouse ? '28px' : isNarrow ? '36px' : '44px';
        const btnFontSize = hasFineMouse ? '1em' : '1.4em';
        countWrap.style.gap = hasFineMouse ? '3px' : isNarrow ? '4px' : '6px';

        const btnStyle = {
          width: btnSize,
          height: btnSize,
          minWidth: btnSize,
          minHeight: btnSize,
          maxWidth: btnSize,
          maxHeight: btnSize,
          flexShrink: '0',
          fontSize: btnFontSize,
          fontWeight: '600',
          borderRadius: '50%',
          border: '2px solid rgba(100,116,139,0.45)',
          background: 'rgba(100,116,139,0.12)',
          color: 'var(--text, #e5e7eb)',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          userSelect: 'none',
          WebkitTapHighlightColor: 'transparent',
          touchAction: 'manipulation',
          boxSizing: 'border-box',
        };

        const btnStyleWithDisplay = { ...btnStyle, display: 'flex' };

        // Minus 10-knapp (kun på stor skjerm)
        let minus10Btn = null;
        if (isLargeScreen) {
          minus10Btn = document.createElement('button');
          minus10Btn.type = 'button';
          minus10Btn.textContent = '«';
          minus10Btn.title = '−10';
          minus10Btn.className = 'count-btn';
          Object.assign(minus10Btn.style, btnStyleWithDisplay);
          minus10Btn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (obs.count > 10) {
              obs.count -= 10;
            } else {
              obs.count = 1;
            }
            obs.tilKlokkeslett = toLocalISOString(new Date());
            saveState();
            renderObservations(observations, obsListEl, buttons, saveState);
          });
        }

        // Minus-knapp
        const minusBtn = document.createElement('button');
        minusBtn.type = 'button';
        minusBtn.textContent = '−';
        minusBtn.title = '−1';
        minusBtn.className = 'count-btn';
        Object.assign(minusBtn.style, btnStyleWithDisplay);
        minusBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (obs.count > 1) {
            obs.count--;
            obs.tilKlokkeslett = toLocalISOString(new Date());
            saveState();
            renderObservations(observations, obsListEl, buttons, saveState);
          }
        });

        // Tallet
        const span = document.createElement('span');
        span.textContent = obs.count != null ? String(obs.count) : '';
        Object.assign(span.style, {
          cursor: 'pointer',
          minWidth: isNarrow ? '24px' : '36px',
          textAlign: 'center',
          fontSize: '1.3em',
          fontWeight: '600',
          padding: isNarrow ? '4px 4px' : '4px 8px',
        });
        span.title = 'Klikk for å endre antall';
        span.addEventListener('click', () => {
          showInput();
        });

        // Pluss-knapp
        const plusBtn = document.createElement('button');
        plusBtn.type = 'button';
        plusBtn.textContent = '+';
        plusBtn.title = '+1';
        plusBtn.className = 'count-btn';
        Object.assign(plusBtn.style, btnStyleWithDisplay);
        plusBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          obs.count++;
          obs.tilKlokkeslett = toLocalISOString(new Date());
          saveState();
          renderObservations(observations, obsListEl, buttons, saveState);
        });

        // Pluss 10-knapp (kun på stor skjerm)
        let plus10Btn = null;
        if (isLargeScreen) {
          plus10Btn = document.createElement('button');
          plus10Btn.type = 'button';
          plus10Btn.textContent = '»';
          plus10Btn.title = '+10';
          plus10Btn.className = 'count-btn';
          Object.assign(plus10Btn.style, btnStyleWithDisplay);
          plus10Btn.addEventListener('click', (e) => {
            e.stopPropagation();
            obs.count += 10;
            obs.tilKlokkeslett = toLocalISOString(new Date());
            saveState();
            renderObservations(observations, obsListEl, buttons, saveState);
          });
        }

        if (minus10Btn) countWrap.appendChild(minus10Btn);
        countWrap.appendChild(minusBtn);
        countWrap.appendChild(span);
        countWrap.appendChild(plusBtn);
        if (plus10Btn) countWrap.appendChild(plus10Btn);
        countTd.appendChild(countWrap);
      }
      
      function showInput() {
        countTd.innerHTML = '';
        const input = document.createElement('input');
        input.type = 'number';
        input.min = '1';
        input.value = obs.count != null ? String(obs.count) : '';
        Object.assign(input.style, {
          width: '48px',
          fontSize: '0.98em',
          padding: '2px 4px',
          margin: '0',
          textAlign: 'center',
        });
        
        function save() {
          const val = input.value.trim();
          const num = parseInt(val, 10);
          if (!val || isNaN(num) || num <= 0) {
            renderCountCell();
            return;
          }
          obs.count = num;
          obs.tilKlokkeslett = toLocalISOString(new Date());
          saveState();
          renderObservations(observations, obsListEl, buttons, saveState);
        }
        
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            save();
          } else if (e.key === 'Escape') {
            renderCountCell();
          }
        });
        input.addEventListener('blur', save);
        countTd.appendChild(input);
        input.focus();
        input.select();
      }
      
      renderCountCell();
      tr.appendChild(countTd);

      const activityTd = document.createElement('td');
      const activitySpan = document.createElement('span');
      activitySpan.className = 'obs-activity-text';
      activitySpan.textContent = obs.activity || '';
      activitySpan.style.fontSize = '0.85em';
      activitySpan.style.color = '#b0b8c1';
      activityTd.appendChild(activitySpan);
      tr.appendChild(activityTd);

      const detailsTd = document.createElement('td');
      const details = [];
      if (obs.age) details.push(obs.age);
      if (obs.gender) details.push(obs.gender);
      detailsTd.textContent = details.join(', ');
      detailsTd.style.fontSize = '0.85em';
      detailsTd.style.color = 'var(--muted)';
      tr.appendChild(detailsTd);

      const actionTd = document.createElement('td');
      actionTd.className = 'action-td';
      actionTd.style.textAlign = 'center';

      // Edit-knapp
      const globalIndex = observations.indexOf(obs);
      const editBtn = document.createElement('button');
      editBtn.className = 'edit-obs-btn';
      editBtn.textContent = '✏️';
      editBtn.title = 'Rediger observasjon';
      editBtn.addEventListener('click', () => {
        if (globalIndex === -1) return;
        window.location.href = `/public/edit.html?id=${encodeURIComponent(globalIndex)}`;
      });
      actionTd.appendChild(editBtn);

      // Delete-knapp
      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'delete-obs-btn';
      deleteBtn.textContent = '🗑️';
      deleteBtn.title = 'Slett observasjon';
      deleteBtn.style.marginLeft = '6px';
      deleteBtn.addEventListener('click', () => {
        if (globalIndex === -1) return;

        // Lagre slettet observasjon og posisjon for undo
        const deletedObs = observations[globalIndex];
        const deletedIndex = globalIndex;
        const speciesName = deletedObs.species?.taxonName || 'Observasjon';

        // Fjern fra array
        observations.splice(globalIndex, 1);
        renderObservations(observations, obsListEl, buttons, saveState);
        saveState();

        // Vis toast med undo-mulighet
        showToast(`Slettet ${speciesName}`, {
          duration: 5000,
          onUndo: () => {
            // Sett tilbake observasjonen på samme posisjon
            observations.splice(deletedIndex, 0, deletedObs);
            renderObservations(observations, obsListEl, buttons, saveState);
            saveState();
            showToast(`${speciesName} gjenopprettet`);
          }
        });
      });
      actionTd.appendChild(deleteBtn);
      tr.appendChild(actionTd);

      if (altBg) {
        tr.querySelectorAll('td').forEach(td => td.style.background = altBg);
      }
      tbody.appendChild(tr);
    });
  });

  table.appendChild(tbody);
  obsListEl.appendChild(table);

  // Aktiver knapper
  if (buttons.exportBtn) buttons.exportBtn.disabled = false;
  if (buttons.copyBtn) buttons.copyBtn.disabled = false;
  if (buttons.copyOpenBtn) buttons.copyOpenBtn.disabled = false;
  if (buttons.clearBtn) buttons.clearBtn.disabled = false;
  if (buttons.aoDirectBtn) buttons.aoDirectBtn.disabled = false;
}

/**
 * Konverter observasjoner til CSV-format for Artsobservasjoner
 * @param {Array} observations - Liste med observasjoner
 * @returns {string} - CSV-streng
 */
export function toCsv(observations) {
  if (!observations.length) return '';
  
  const SEP = '\t';
  const header = [
    'Artsnavn',
    'Lokalitetsnavn',
    'Superlokalitet',
    'Nord',
    'Øst',
    'Nøyaktighet',
    'Fra dato',
    'Til dato',
    'Fra klokkeslett',
    'Til klokkeslett',
    'Antall',
    'Alder',
    'Kjønn',
    'Aktivitet',
    'Kommentar (synlig for alle)',
    'Privat kommentar (kun synlig for deg selv)',
    'Skjul funn til dato',
    'Medobservatør',
    'Medobservatør',
    'Medobservatør',
    'Medobservatør',
    'Medobservatør',
    'Medobservatør',
    'Medobservatør',
    'Medobservatør',
    'Medobservatør',
    'Medobservatør',
    'Bestemmelsesmetode',
    'Natursystem',
    'Beskriv natursystem',
    'Livsmedium',
    'Beskriv livsmedium',
    'Art som livsmedium',
    'Beskriv art som livsmedium',
    'Dybde min',
    'Dybde maks',
    'Høyde min',
    'Høyde maks',
    'Andrehånds',
    'Usikker artsbestemming',
    'Ikke spontan',
    'Interessant observasjon',
    'Ikke gjenfunnet',
    'Ikke funnet',
    'Offentlig samling',
    'Privat samling',
    'Referansenummer i samling',
    'Beskrivelse artsbestemming',
    'Bestemt av',
    'Bestemt av (fritekst)',
    'Bestemmelsesår',
    'Bekreftet av',
    'Bekreftet av (fritekst)',
    'Bekreftelsesår',
  ];

  const lines = [header.join(SEP)];

  for (const obs of observations) {
    // Kråke: AO har slått sammen kråke og svartkråke – begge heter nå "kråke" i navnebasen.
    // Bruk latinsk navn for å unngå tvetydighet ved import. Fjern HTML-tags fra scientificNameHtml.
    // TODO: Fjern dette unntaket når AO har fikset navnekonflikten (~juli 2026).
    const taxonName = (obs.species && obs.species.taxonName) || '';
    const useLatin = taxonName.toLowerCase() === 'kråke' && obs.species && obs.species.scientificNameHtml;
    const resolvedName = useLatin
      ? obs.species.scientificNameHtml.replace(/<[^>]+>/g, '').trim()
      : taxonName;
    const name = resolvedName.replace(/[;\t]/g, ',');
    // Bruk lokalitets-ID hvis tilgjengelig, ellers navn (unngår tvetydighet ved import)
    const place = (obs.placeId || obs.placeName || '').toString().replace(/[;\t]/g, ',');
    const count = obs.count != null ? String(obs.count) : '';
    const activity = (obs.activity || '').replace(/[;\t]/g, ',');
    const age = (obs.age || '').replace(/[;\t]/g, ',');
    const gender = (obs.gender || '').replace(/[;\t]/g, ',');
    const comment = (obs.comment || '').replace(/[;\t]/g, ',');

    // Dato (Fra/til = samme dag) – format DD.MM.YYYY
    let dateStr = '';
    let timeStr = '';
    
    if (obs.timestamp) {
      const d = new Date(obs.timestamp);
      if (!isNaN(d.getTime())) {
        const dd = String(d.getDate()).padStart(2, '0');
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const yyyy = d.getFullYear();
        dateStr = `${dd}.${mm}.${yyyy}`;

        // Tidspunkt – format HH:MM (unntatt hvis 00:00, som betyr tid ikke er satt)
        const hh = String(d.getHours()).padStart(2, '0');
        const mi = String(d.getMinutes()).padStart(2, '0');
        if (hh !== '00' || mi !== '00') {
          timeStr = `${hh}:${mi}`;
        }
      }
    }
    // Til klokkeslett (periode)
    let tilTimeStr = '';
    if (obs.tilKlokkeslett) {
      const t = new Date(obs.tilKlokkeslett);
      if (!isNaN(t.getTime())) {
        const hh = String(t.getHours()).padStart(2, '0');
        const mi = String(t.getMinutes()).padStart(2, '0');
        tilTimeStr = `${hh}:${mi}`;
      }
    }
    
    if (!dateStr) {
      const d = new Date();
      const dd = String(d.getDate()).padStart(2, '0');
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const yyyy = d.getFullYear();
      dateStr = `${dd}.${mm}.${yyyy}`;
    }

    const cols = new Array(54).fill('');
    cols[0] = name;
    cols[1] = place;
    cols[6] = dateStr;
    cols[7] = dateStr;
    cols[8] = timeStr;
    // Kolonne 9: Bruk tilTimeStr hvis det finnes, ellers samme som fra-tid
    cols[9] = tilTimeStr ? tilTimeStr : timeStr;
    cols[10] = count;
    cols[11] = age;
    cols[12] = gender;
    cols[13] = activity;
    cols[14] = comment;

    // Skjul funn til dato (kolonne 16, index 16) — konverter YYYY-MM-DD → DD.MM.YYYY
    if (obs.hideUntil) {
      const parts = obs.hideUntil.split('-');
      if (parts.length === 3) {
        cols[16] = `${parts[2]}.${parts[1]}.${parts[0]}`;
      }
    }

    // Medobservatører (10 kolonner)
    if (Array.isArray(obs.coObservers)) {
      for (let i = 0; i < 10; i++) {
        let v = obs.coObservers[i];
        // Hvis objekt, hent .name, ellers bruk som streng
        if (v && typeof v === 'object') {
          v = v.name || '';
        }
        if (!v || v === 'undefined' || v === null) v = '';
        cols[17 + i] = String(v).replace(/[;\t]/g, ',');
      }
    } else {
      // Fyll med tomme strenger hvis ingen coObservers
      for (let i = 0; i < 10; i++) {
        cols[17 + i] = '';
      }
    }

    lines.push(cols.join(SEP));
  }
  
  return lines.join('\n');
}
