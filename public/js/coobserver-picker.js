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
import { attachAoObserverAutocomplete } from './ao-observer-autocomplete.js';

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
  // står i medobs-lista fra før. Delt med fellestur.js, se ao-observer-autocomplete.js.
  attachAoObserverAutocomplete(newNameInput, addCoObserver);

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
