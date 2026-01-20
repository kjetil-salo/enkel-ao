/**
 * Observations-modul for håndtering av observasjoner og CSV-eksport
 */

import { defaultCoObservers, loadMedobs } from './storage.js';

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

  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  ['Art', 'Antall', 'Aktivitet', 'Detaljer', ''].forEach((label) => {
    const th = document.createElement('th');
    th.textContent = label;
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');

  groups.forEach((group) => {
    const groupRow = document.createElement('tr');
    const groupCell = document.createElement('td');
    groupCell.colSpan = 5;
    groupCell.className = 'obs-group-title';
    groupCell.textContent = group.key;
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
        countTd.style.gap = '4px';

        // Minus-knapp
        const minusBtn = document.createElement('button');
        minusBtn.type = 'button';
        minusBtn.textContent = '−';
        minusBtn.title = 'Reduser antall';
        Object.assign(minusBtn.style, {
          width: '22px',
          height: '22px',
          fontSize: '1em',
          borderRadius: '50%',
          border: '1px solid #888',
          background: 'rgba(34,34,34,0.7)',
          color: '#bbb',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          userSelect: 'none',
        });
        minusBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (obs.count > 1) {
            obs.count--;
            saveState();
            renderObservations(observations, obsListEl, buttons, saveState);
          }
        });

        // Tallet
        const span = document.createElement('span');
        span.textContent = obs.count != null ? String(obs.count) : '';
        Object.assign(span.style, {
          cursor: 'pointer',
          minWidth: '28px',
          textAlign: 'center',
          fontSize: '1.1em',
        });
        span.title = 'Klikk for å endre antall';
        span.addEventListener('click', () => {
          showInput();
        });

        // Pluss-knapp
        const plusBtn = document.createElement('button');
        plusBtn.type = 'button';
        plusBtn.textContent = '+';
        plusBtn.title = 'Øk antall';
        Object.assign(plusBtn.style, {
          width: '22px',
          height: '22px',
          fontSize: '1em',
          borderRadius: '50%',
          border: '1px solid #888',
          background: 'rgba(34,34,34,0.7)',
          color: '#bbb',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          userSelect: 'none',
        });
        plusBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          obs.count++;
          saveState();
          renderObservations(observations, obsListEl, buttons, saveState);
        });

        countTd.appendChild(minusBtn);
        countTd.appendChild(span);
        countTd.appendChild(plusBtn);
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
        observations.splice(globalIndex, 1);
        renderObservations(observations, obsListEl, buttons, saveState);
        saveState();
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

        // Tidspunkt – format HH:MM
        const hh = String(d.getHours()).padStart(2, '0');
        const mi = String(d.getMinutes()).padStart(2, '0');
        timeStr = `${hh}:${mi}`;
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
    cols[9] = timeStr;
    cols[10] = count;
    cols[11] = age;
    cols[12] = gender;
    cols[13] = activity;
    cols[14] = comment;
    
    // Medobservatører (10 kolonner)
    if (Array.isArray(obs.coObservers)) {
      for (let i = 0; i < 10; i++) {
        const v = obs.coObservers[i] || '';
        cols[17 + i] = String(v).replace(/[;\t]/g, ',');
      }
    } else {
      const defaults = loadMedobs();
      for (let i = 0; i < 10; i++) {
        cols[17 + i] = defaults[i] || '';
      }
    }

    lines.push(cols.join(SEP));
  }
  
  return lines.join('\n');
}
