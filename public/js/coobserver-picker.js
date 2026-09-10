/**
 * Medobservatør-velger for ÉN observasjon: avkrysningsliste fra medobs-lista
 * («storage.js» sin master-liste) pluss autocomplete-søk mot AOs observatørregister
 * for å legge til noen som ikke står der fra før. Delt mellom registrerings-modalen
 * og redigerings-modalen — samme oppførsel begge steder.
 *
 * Skiller seg fra medobs-modalen i index.html (som styrer master-lista og hvem som
 * er «aktiv som standard») — denne velger bare hvem som gjelder for ÉN observasjon.
 */
import { loadMedobs, saveMedobs } from './storage.js';

const MEDOBS_MAX = 10;

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/**
 * @param {object} els - { container, newNameInput, addBtn }
 * @returns {{ setSelected: (names: string[]) => void, getSelected: () => string[] }}
 */
export function initCoObserverPicker(els) {
  const { container, newNameInput, addBtn } = els;
  const selected = new Set();

  function render() {
    const master = loadMedobs().map((it) => it.name).filter(Boolean);
    // Ta med navn valgt på denne observasjonen selv om de ikke lenger står i medobs-lista
    const allNames = Array.from(new Set([...master, ...selected]));
    container.innerHTML = '';
    if (allNames.length === 0) {
      container.innerHTML = '<div style="color:var(--muted);font-size:0.9em;">Ingen medobservatører lagt til ennå — legg til under.</div>';
      return;
    }
    allNames.forEach((name) => {
      const label = document.createElement('label');
      label.style.cssText = 'display:flex;align-items:center;gap:8px;font-weight:normal;margin:0;color:var(--text);';
      label.innerHTML = `<input type="checkbox" style="width:18px;height:18px;" ${selected.has(name) ? 'checked' : ''} /> <span>${escapeHtml(name)}</span>`;
      const cb = label.querySelector('input');
      cb.addEventListener('change', () => {
        if (cb.checked) {
          if (selected.size >= MEDOBS_MAX) {
            cb.checked = false;
            alert(`Maks ${MEDOBS_MAX} medobservatører per observasjon.`);
            return;
          }
          selected.add(name);
        } else {
          selected.delete(name);
        }
      });
      container.appendChild(label);
    });
  }

  function addCoObserver(rawName) {
    const name = rawName.trim();
    if (!name) return;
    if (!selected.has(name) && selected.size >= MEDOBS_MAX) {
      alert(`Maks ${MEDOBS_MAX} medobservatører per observasjon.`);
      return;
    }
    selected.add(name);
    // Legg navnet til i medobs-lista også, slik at det ligger klart neste gang
    const master = loadMedobs();
    if (!master.some((it) => it.name === name)) {
      master.push({ name, active: false });
      saveMedobs(master);
    }
    render();
  }

  addBtn.addEventListener('click', () => {
    addCoObserver(newNameInput.value);
    newNameInput.value = '';
  });

  // Autocomplete mot AO sitt observatørregister — nyttig når personen ikke
  // står i medobs-lista fra før (samme AO-endepunkt som medobs.html/edit.html).
  let acDebounce = null;
  let acActiveIndex = -1;

  function getAoTokens() {
    try { return JSON.parse(localStorage.getItem('ao_tokens') || '{}'); }
    catch { return {}; }
  }

  async function searchObservers(query) {
    const tokens = getAoTokens();
    if (!tokens.loginToken || !tokens.authCookie) return [];
    try {
      const resp = await fetch('/api/ao-search-observers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ search: query, loginToken: tokens.loginToken, authCookie: tokens.authCookie }),
      });
      if (!resp.ok) return [];
      return await resp.json();
    } catch { return []; }
  }

  function setupAutocomplete(inp) {
    const parent = inp.parentElement;
    const wrap = document.createElement('div');
    wrap.className = 'medobs-ac-wrap';
    parent.insertBefore(wrap, inp);
    wrap.appendChild(inp);

    const dropdown = document.createElement('div');
    dropdown.className = 'medobs-ac-list';
    wrap.appendChild(dropdown);

    function hideDropdown() {
      dropdown.classList.remove('show');
      dropdown.innerHTML = '';
      acActiveIndex = -1;
    }

    function selectItem(name) {
      addCoObserver(name);
      inp.value = '';
      hideDropdown();
    }

    inp.addEventListener('input', () => {
      const query = inp.value.trim();
      if (query.length < 3) { hideDropdown(); return; }

      clearTimeout(acDebounce);
      acDebounce = setTimeout(async () => {
        dropdown.innerHTML = '<div class="medobs-ac-spinner">Søker…</div>';
        dropdown.classList.add('show');
        acActiveIndex = -1;

        const results = await searchObservers(query);
        dropdown.innerHTML = '';
        if (results.length === 0) {
          dropdown.innerHTML = '<div class="medobs-ac-spinner">Ingen treff</div>';
          return;
        }
        results.sort((a, b) => (b.isCoObserver ? 1 : 0) - (a.isCoObserver ? 1 : 0));
        results.forEach((user) => {
          const item = document.createElement('div');
          item.className = 'medobs-ac-item';
          let html = '';
          if (user.isCoObserver) html += '<span class="ac-fav">★</span>';
          html += escapeHtml(user.name);
          if (user.city) html += `<span class="ac-city">${escapeHtml(user.city)}</span>`;
          item.innerHTML = html;
          item.addEventListener('mousedown', (e) => { e.preventDefault(); selectItem(user.name); });
          dropdown.appendChild(item);
        });
      }, 400);
    });

    inp.addEventListener('keydown', (e) => {
      const items = dropdown.querySelectorAll('.medobs-ac-item');
      if (e.key === 'Enter' && acActiveIndex < 0) {
        e.preventDefault();
        addCoObserver(inp.value);
        inp.value = '';
        hideDropdown();
        return;
      }
      if (!items.length) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        acActiveIndex = Math.min(acActiveIndex + 1, items.length - 1);
        items.forEach((it, i) => it.classList.toggle('active', i === acActiveIndex));
        items[acActiveIndex]?.scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        acActiveIndex = Math.max(acActiveIndex - 1, 0);
        items.forEach((it, i) => it.classList.toggle('active', i === acActiveIndex));
        items[acActiveIndex]?.scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter' && acActiveIndex >= 0) {
        e.preventDefault();
        const el = items[acActiveIndex].cloneNode(true);
        el.querySelector('.ac-city')?.remove();
        el.querySelector('.ac-fav')?.remove();
        selectItem(el.textContent.trim());
      } else if (e.key === 'Escape') {
        hideDropdown();
      }
    });

    inp.addEventListener('blur', () => { setTimeout(hideDropdown, 200); });
  }

  setupAutocomplete(newNameInput);

  return {
    setSelected(names) {
      selected.clear();
      (names || []).filter(Boolean).forEach((n) => selected.add(n));
      render();
    },
    getSelected() {
      return Array.from(selected);
    },
  };
}
