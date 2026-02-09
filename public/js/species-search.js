/**
 * Artssøk-modul for søk, resultatvisning og artsvalg
 */

import { searchSpecies } from './api.js';
import { searchOfflineSpecies } from './species_offline.js';

export function updateSubtaxaCheckboxState() {
  const forceOffline = localStorage.getItem('forceOfflineSpecies') === '1';
  const subtaxaCheckbox = document.getElementById('include-subtaxa');
  const subtaxaWarning = document.getElementById('subtaxa-offline-warning');
  if (subtaxaCheckbox && subtaxaWarning) {
    if (forceOffline) {
      subtaxaCheckbox.checked = false;
      subtaxaCheckbox.disabled = true;
      subtaxaWarning.style.display = 'inline';
    } else {
      subtaxaCheckbox.disabled = false;
      subtaxaWarning.style.display = 'none';
    }
  }
}

export function renderResults(state, dom) {
  dom.resultsEl.innerHTML = '';

  if (!state.currentResults.length) {
    dom.resultCount.textContent = '0 treff';
    return;
  }

  state.currentResults.forEach((item, index) => {
    const div = document.createElement('div');
    div.className = 'result-item';
    div.setAttribute('role', 'option');
    if (index === state.activeIndex) {
      div.setAttribute('aria-selected', 'true');
    }

    const row = document.createElement('div');
    row.className = 'result-name-row';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'result-name';
    nameSpan.textContent = item.taxonName || item.norwegian || '(ukjent navn)';
    row.appendChild(nameSpan);

    if (item.scientificName || item.latin) {
      const sciSpan = document.createElement('span');
      sciSpan.className = 'result-sci';
      sciSpan.textContent = item.scientificName || item.latin;
      row.appendChild(sciSpan);
    }

    div.appendChild(row);

    div.tabIndex = 0;
    div.addEventListener('click', () => {
      chooseItem(index, state, dom, state._callbacks);
    });
    div.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        chooseItem(index, state, dom, state._callbacks);
      }
    });

    dom.resultsEl.appendChild(div);
  });

  dom.resultCount.textContent = `${state.currentResults.length} treff`;
}

export function chooseItem(index, state, dom, callbacks) {
  const item = state.currentResults[index];
  if (!item) return;

  if (state.debounceTimer) {
    clearTimeout(state.debounceTimer);
    state.debounceTimer = null;
  }

  state.selectedSpecies = item;

  dom.input.value = item.taxonName;
  dom.input.classList.add('species-selected');

  state.currentResults = [];
  dom.resultsEl.innerHTML = '';
  dom.resultsEl.style.display = 'none';

  setTimeout(() => {
    dom.resultsEl.style.display = '';
  }, 200);

  dom.countInput.disabled = false;
  dom.countInput.value = '1';
  dom.countInput.focus();
  dom.countInput.classList.remove('focus-flash');
  void dom.countInput.offsetWidth;
  dom.countInput.classList.add('focus-flash');

  dom.countInput.addEventListener('keydown', function handler(e) {
    if ((e.key === 'Enter' || e.key === 'Tab') && dom.countInput.value.trim()) {
      setTimeout(() => {
        dom.activitySelect.classList.remove('focus-flash');
        void dom.activitySelect.offsetWidth;
        dom.activitySelect.classList.add('focus-flash');
      }, 0);
      dom.countInput.removeEventListener('keydown', handler);
    }
  });

  if (dom.activitySelect) {
    dom.activitySelect.disabled = false;
  }
  if (dom.activitySubmitBtn) {
    dom.activitySubmitBtn.disabled = false;
  }

  dom.ageSelect.disabled = false;
  dom.genderSelect.disabled = false;

  callbacks.updateSectionStates();
}

export async function fetchResults(term, state, dom, callbacks) {
  updateSubtaxaCheckboxState();
  const q = term.trim();

  if (q.length < 2) {
    state.currentResults = [];
    state.activeIndex = -1;
    renderResults(state, dom);
    dom.emptyMsgEl.style.display = q.length ? 'block' : 'none';
    if (!q.length) dom.emptyMsgEl.textContent = 'Ingen treff ennå. Skriv minst 2 tegn.';
    else dom.emptyMsgEl.textContent = 'Skriv litt mer for å få treff.';
    return;
  }

  callbacks.updateStatus('loading', 'Søker i Artsobservasjoner …');
  dom.emptyMsgEl.style.display = 'none';

  const forceOffline = localStorage.getItem('forceOfflineSpecies') === '1';
  const subtaxaCheckbox = document.getElementById('include-subtaxa');
  const subtaxaWarning = document.getElementById('subtaxa-offline-warning');
  if (forceOffline) {
    if (subtaxaCheckbox) {
      subtaxaCheckbox.checked = false;
      subtaxaCheckbox.disabled = true;
    }
    if (subtaxaWarning) {
      subtaxaWarning.style.display = 'inline';
    }
  } else {
    if (subtaxaCheckbox) {
      subtaxaCheckbox.disabled = false;
    }
    if (subtaxaWarning) {
      subtaxaWarning.style.display = 'none';
    }
  }
  if (forceOffline) {
    const includeSubtaxa = document.getElementById('include-subtaxa')?.checked;
    const offline = await searchOfflineSpecies(q, includeSubtaxa);
    state.currentResults = offline.map(s => ({
      taxonName: s.taxonName,
      scientificName: s.scientificName,
      source: 'offline'
    }));
    state.activeIndex = state.currentResults.length ? 0 : -1;
    renderResults(state, dom);
    dom.emptyMsgEl.style.display = state.currentResults.length ? 'none' : 'block';
    dom.emptyMsgEl.textContent = state.currentResults.length
      ? 'Viser offline artsliste (innstilling: kun offline)'
      : 'Ingen treff i offline-listen.';
    callbacks.updateStatus('idle', 'Klar for søk (offline)');
    return;
  }

  function withTimeout(promise, ms) {
    return Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))
    ]);
  }

  let aoTimedOut = false;
  try {
    let includeSubtaxa = false;
    const cb = document.getElementById('include-subtaxa');
    if (cb && cb.checked) includeSubtaxa = true;
    const data = await withTimeout(searchSpecies(q, includeSubtaxa), 10000);

    state.currentResults = data;
    state.activeIndex = state.currentResults.length ? 0 : -1;
    renderResults(state, dom);

    if (!state.currentResults.length) {
      dom.emptyMsgEl.style.display = 'block';
      dom.emptyMsgEl.textContent = 'Ingen treff fra Artsobservasjoner.';
    }

    callbacks.updateStatus('idle', 'Klar for søk');
  } catch (err) {
    aoTimedOut = err && err.message === 'timeout';
    // TypeError = nettverksfeil (vår server er nede), Error('HTTP ...') = server svarte men AO feilet
    const serverNede = err instanceof TypeError;
    console.warn(serverNede ? 'Server utilgjengelig, bruker offline fallback:' : 'AO-søk feilet, prøver offline fallback:', err);
    const offline = await searchOfflineSpecies(q);
    state.currentResults = offline.map(s => ({
      taxonName: s.taxonName,
      scientificName: s.scientificName,
      source: 'offline'
    }));
    state.activeIndex = state.currentResults.length ? 0 : -1;
    renderResults(state, dom);
    // Deaktiver underarter (lokal liste støtter det ikke pålitelig)
    const subtaxaCheckbox = document.getElementById('include-subtaxa');
    const subtaxaWarning = document.getElementById('subtaxa-offline-warning');
    if (subtaxaCheckbox) { subtaxaCheckbox.checked = false; subtaxaCheckbox.disabled = true; }
    if (subtaxaWarning) { subtaxaWarning.style.display = 'inline'; }

    const settingsLenke = '<a href="/settings.html" style="color:#3b82f6;text-decoration:underline;">⚙️ Innstillinger</a>';
    let årsak;
    if (serverNede) {
      årsak = 'Ingen kontakt med server';
    } else if (!navigator.onLine) {
      årsak = 'Du er offline';
    } else {
      årsak = 'AO svarer ikke';
    }
    const statusHtml = årsak + ' — bruker lokal artsliste — ' + settingsLenke;
    callbacks.updateStatus('error', årsak, statusHtml);
    if (!state.currentResults.length) {
      dom.emptyMsgEl.style.display = 'block';
      dom.emptyMsgEl.textContent = 'Ingen treff i lokal artsliste.';
    }
  }
}
