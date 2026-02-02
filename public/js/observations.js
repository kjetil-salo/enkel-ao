/**
 * Observations-modul for håndtering av observasjoner og CSV-eksport
 */

import { defaultCoObservers, loadMedobs } from './storage.js';
import { showToast } from './ui.js';

/**
 * Formater Date til lokal ISO-lignende streng (YYYY-MM-DDTHH:MM:SS)
 * som bevarer lokal tid ved parsing
 */
function toLocalISOString(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mi = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}`;
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

  const tbody = document.createElement('tbody');

  groups.forEach((group) => {
    // Finn antall unike arter i denne gruppen
    const uniqueSpecies = new Set(
      group.items
        .map(obs => obs.species && obs.species.taxonName ? obs.species.taxonName.trim().toLowerCase() : null)
        .filter(Boolean)
    );
    const groupRow = document.createElement('tr');
    const groupCell = document.createElement('td');
    groupCell.colSpan = 5;
    groupCell.className = 'obs-group-title';
    groupCell.innerHTML = `${group.key} <span style="font-weight:normal;font-size:0.98em;color:#3b82f6;margin-left:8px;">• ${uniqueSpecies.size} art${uniqueSpecies.size === 1 ? '' : 'er'}</span>`;
    groupRow.appendChild(groupCell);
    tbody.appendChild(groupRow);

    group.items.forEach((obs, obsIndex) => {
      const tr = document.createElement('tr');
      
      // Alternerende bakgrunn
      if (obsIndex % 2 === 1) {
        tr.style.background = 'rgba(59,130,246,0.07)';
      }

      const artTd = document.createElement('td');
      artTd.textContent = obs.species && obs.species.taxonName ? obs.species.taxonName : '';
      tr.appendChild(artTd);

      const countTd = document.createElement('td');
      
      // Render count cell med pluss/minus knapper
      function renderCountCell() {
        countTd.innerHTML = '';
        countTd.style.display = 'flex';
        countTd.style.alignItems = 'center';

        // Detekter om vi har presis peker (mus/trackpad) vs touch
        const hasFineMouse = window.matchMedia('(pointer: fine) and (hover: hover)').matches;
        const isLargeScreen = window.innerWidth >= 768 && window.innerHeight >= 600;

        // Mindre knapper på desktop/laptop med mus - større på touch
        const btnSize = hasFineMouse ? '28px' : '44px';
        const btnFontSize = hasFineMouse ? '1em' : '1.5em';
        countTd.style.gap = hasFineMouse ? '3px' : '6px';

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
          border: '2px solid var(--accent, #3b82f6)',
          background: 'var(--accent-soft, rgba(59,130,246,0.2))',
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
          minWidth: '36px',
          textAlign: 'center',
          fontSize: '1.3em',
          fontWeight: '600',
          padding: '4px 8px',
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

        if (minus10Btn) countTd.appendChild(minus10Btn);
        countTd.appendChild(minusBtn);
        countTd.appendChild(span);
        countTd.appendChild(plusBtn);
        if (plus10Btn) countTd.appendChild(plus10Btn);
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
      activityTd.textContent = obs.activity || '';
      activityTd.style.fontSize = '0.85em';
      activityTd.style.color = '#9ca3af'; // Tonet ned, men WCAG AA-kompatibel
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
    const name = ((obs.species && obs.species.taxonName) || '').replace(/[;\t]/g, ',');
    const place = (obs.placeName || '').replace(/[;\t]/g, ',');
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
