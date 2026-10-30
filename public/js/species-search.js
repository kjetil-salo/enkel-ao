/**
 * Artssøk-modul for søk, resultatvisning og artsvalg
 */

import { searchSpecies as fetchAoSpecies } from './api.js';
import {
  searchOfflineSpecies,
  getNynorskByLatin,
  getSpeciesMeta,
  findBokmalByNynorskTerm,
  searchSpecies,
} from './species_offline.js?v=v1.59.0';
import { speciesDisplayName, loadNynorskArtsnavn } from './storage.js?v=v1.59.0';

export { searchSpecies };

export function updateSubtaxaCheckboxState() {
  const subtaxaCheckbox = document.getElementById('include-subtaxa');
  const subtaxaWarning = document.getElementById('subtaxa-offline-warning');
  if (subtaxaCheckbox) {
    subtaxaCheckbox.disabled = false;
  }
  if (subtaxaWarning) {
    subtaxaWarning.style.display = 'none';
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
    nameSpan.textContent = speciesDisplayName(item) || item.norwegian || '(ukjent navn)';
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

  // Viser displayName (nynorsk hvis valgt), men item.taxonName forblir
  // uendret bokmål - det er DET som faktisk havner i state.selectedSpecies
  // og til slutt sendes til AO, uavhengig av hva som står i feltet her.
  dom.input.value = speciesDisplayName(item);
  dom.input.classList.add('species-selected');

  state.currentResults = [];
  dom.resultsEl.innerHTML = '';
  dom.resultsEl.style.display = 'none';

  setTimeout(() => {
    dom.resultsEl.style.display = '';
  }, 200);

  dom.countInput.disabled = false;
  dom.countInput.value = '1';
  dom.countInput.dataset.isDefault = '1';
  dom.countInput.focus();
  dom.countInput.classList.remove('focus-flash');
  void dom.countInput.offsetWidth;
  dom.countInput.classList.add('focus-flash');

  // Første siffer erstatter default-verdien
  dom.countInput.addEventListener('keydown', function defaultHandler(e) {
    if (dom.countInput.dataset.isDefault && e.key >= '0' && e.key <= '9') {
      dom.countInput.value = '';
      delete dom.countInput.dataset.isDefault;
      dom.countInput.removeEventListener('keydown', defaultHandler);
    } else if (e.key === 'Enter' || e.key === 'Tab' || e.key === 'Backspace') {
      delete dom.countInput.dataset.isDefault;
      dom.countInput.removeEventListener('keydown', defaultHandler);
    }
  });

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

/**
 * Berik rå søkeresultat frå Artsobservasjonar med nynorsknamn, antallFunn og
 * relasjonskobling (parentId / isSub) for underartar.
 *
 * @param {Array<object>} data
 * @returns {Promise<Array<object>>}
 */
export async function enrichAoSpeciesResults(data) {
  if (!Array.isArray(data) || data.length === 0) return [];

  // Indekser hovudartar i AO-svaret på vitskapleg binom (t.d. "turdus iliacus" -> "4547")
  const aoParentIdByBinomial = new Map();
  for (const item of data) {
    const rawText = item.scientificNameHtml || item.scientificName || item.latin || '';
    const isHybrid = /\s+x\s+/i.test(rawText) || /\s+x\s+/i.test(item.taxonName || '');
    if (isHybrid) continue;

    const cleanLat = rawText
      .replace(/<[^>]+>/g, '')
      .replace(/\b(?:subsp|ssp)\.?\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
    const words = cleanLat.split(/\s+/).filter(Boolean);
    const isSubInAo =
      /\b(?:subsp|ssp)\b/i.test(rawText) ||
      /,\s*underarten\s+/i.test(item.taxonName || '') ||
      words.length >= 3;
    if (!isSubInAo && words.length === 2 && (item.taxonId ?? item.id) !== undefined) {
      aoParentIdByBinomial.set(`${words[0]} ${words[1]}`, item.taxonId ?? item.id);
    }
  }

  return Promise.all(
    data.map(async (item) => {
      const rawSci = item.scientificNameHtml || item.scientificName || item.latin || '';
      const latin = rawSci
        .replace(/<[^>]+>/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      const isHybrid = /\s+x\s+/i.test(latin) || /\s+x\s+/i.test(item.taxonName || '');
      const cleanLatinWords = latin
        .replace(/\b(?:subsp|ssp)\.?\b/gi, ' ')
        .trim()
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean);

      const meta = await getSpeciesMeta(latin, item.taxonName);
      const isSub =
        !isHybrid &&
        Boolean(
          item.isSub ||
            meta.isSub ||
            /\b(?:subsp|ssp)\b/i.test(rawSci) ||
            /,\s*underarten\s+/i.test(item.taxonName || '') ||
            cleanLatinWords.length >= 3
        );

      const nynorsk = meta.nameNno || meta.nynorsk || (latin ? await getNynorskByLatin(latin) : null);
      const enrichedItem = {
        ...item,
        id: item.id ?? item.taxonId ?? meta.id,
        taxonId: item.taxonId ?? item.id ?? meta.taxonId,
        isSub,
        nynorsk,
        nameNno: nynorsk,
        nameNob: item.nameNob || item.taxonName || meta.nameNob,
      };

      if (isSub) {
        const binomialKey =
          cleanLatinWords.length >= 2 ? `${cleanLatinWords[0]} ${cleanLatinWords[1]}` : '';
        const parentId =
          item.parentId ??
          meta.parentId ??
          (binomialKey ? aoParentIdByBinomial.get(binomialKey) : undefined);
        if (parentId !== undefined && parentId !== null) {
          enrichedItem.parentId = parentId;
        }
      }

      if (typeof meta.antallFunn === 'number') {
        enrichedItem.antallFunn = meta.antallFunn;
      }

      return enrichedItem;
    })
  );
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
  const includeSubtaxa = Boolean(document.getElementById('include-subtaxa')?.checked);
  const userLanguage = loadNynorskArtsnavn() ? 'nn' : 'nb';

  if (forceOffline) {
    const offline = await searchOfflineSpecies(q, includeSubtaxa, userLanguage);
    state.currentResults = offline.map((s) => ({
      ...s,
      taxonName: s.taxonName,
      nynorsk: s.nynorsk,
      nameNno: s.nameNno ?? s.nynorsk,
      nameNob: s.nameNob ?? s.taxonName,
      scientificName: s.scientificName,
      antallFunn: s.antallFunn,
      source: 'offline',
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
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
    ]);
  }

  try {
    let data = await withTimeout(fetchAoSpecies(q, includeSubtaxa), 10000);

    // AO sitt eget søk har ikke nynorsk-synonymer på underarter (f.eks. gir søk på
    // "raudveng" bare hovedarten rødvingetrost fra AO, uten underartene coburni og
    // iliacus). Vi oversetter derfor nynorske søketermer til bokmål og henter også
    // når includeSubtaxa er aktivert og søketermen ikke er del av bokmålsnavnet.
    try {
      const nynorskMatches = await findBokmalByNynorskTerm(q);
      const existingNames = new Set(data.map((d) => (d.taxonName || '').toLowerCase()));
      const qLower = q.toLowerCase();
      const extraTerms = nynorskMatches.filter((name) => {
        const nameLower = name.toLowerCase();
        if (!existingNames.has(nameLower)) return true;
        return includeSubtaxa && !nameLower.includes(qLower);
      });
      if (extraTerms.length) {
        const extraResultsArrays = await Promise.all(
          extraTerms.map((name) => fetchAoSpecies(name, includeSubtaxa).catch(() => []))
        );
        const seenIds = new Set(data.map((d) => String(d.taxonId ?? d.id)));
        for (const extra of extraResultsArrays.flat()) {
          const extraKey = String(extra.taxonId ?? extra.id);
          if (!seenIds.has(extraKey)) {
            data.push(extra);
            seenIds.add(extraKey);
          }
        }
      }
    } catch (e) {
      console.warn('Nynorsk-oversettelse av søketerm feilet, fortsetter uten:', e);
    }

    const enriched = await enrichAoSpeciesResults(data);

    state.currentResults = searchSpecies(q, enriched, userLanguage);
    state.activeIndex = state.currentResults.length ? 0 : -1;
    renderResults(state, dom);

    if (!state.currentResults.length) {
      dom.emptyMsgEl.style.display = 'block';
      dom.emptyMsgEl.textContent = 'Ingen treff fra Artsobservasjoner.';
    }

    callbacks.updateStatus('idle', 'Klar for søk');
  } catch (err) {
    const serverNede = err instanceof TypeError;
    console.warn(
      serverNede
        ? 'Server utilgjengelig, bruker offline fallback:'
        : 'AO-søk feilet, prøver offline fallback:',
      err
    );
    const offline = await searchOfflineSpecies(q, includeSubtaxa, userLanguage);
    state.currentResults = offline.map((s) => ({
      ...s,
      taxonName: s.taxonName,
      nynorsk: s.nynorsk,
      nameNno: s.nameNno ?? s.nynorsk,
      nameNob: s.nameNob ?? s.taxonName,
      scientificName: s.scientificName,
      source: 'offline',
    }));
    state.activeIndex = state.currentResults.length ? 0 : -1;
    renderResults(state, dom);

    const settingsLenke =
      '<a href="/settings.html" style="color:#3b82f6;text-decoration:underline;">⚙️ Innstillinger</a>';
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

