/**
 * Skjematilstand-modul for progressiv aktivering av felter
 */

import { checkRarity } from './rarity.js';
import { t } from './i18n.js?v=v1.60.30';
import { activityBokmalName, genderDisplayName, genderBokmalName } from './storage.js?v=v1.60.30';

export function isValidPairCount(count, { unknownCount = false } = {}) {
  if (unknownCount) return false;
  if (count == null || count === '') return false;
  let num;
  if (typeof count === 'number') {
    num = count;
  } else {
    const trimmed = String(count).trim();
    if (!/^\d+$/.test(trimmed)) return false;
    num = parseInt(trimmed, 10);
  }
  return Number.isInteger(num) && num >= 2 && num % 2 === 0;
}

export function syncPairGenderOption(genderSelect, countValue, { unknownCount = false, hintEl = null } = {}) {
  if (!genderSelect) return { allowed: false, cleared: false };
  const allowed = isValidPairCount(countValue, { unknownCount });
  const pairOpt = Array.from(genderSelect.options || []).find(
    (opt) => genderBokmalName(opt.value) === 'I par'
  );

  if (pairOpt) {
    pairOpt.disabled = !allowed;
    pairOpt.textContent = allowed
      ? genderDisplayName('I par')
      : t('index.common.gender_i_par_requires_even');
  }

  genderSelect.title = allowed ? '' : t('index.gender.pair_requires_even_hint');

  let cleared = false;
  if (!allowed && genderBokmalName(genderSelect.value) === 'I par') {
    genderSelect.value = '';
    cleared = true;
    if (hintEl) {
      hintEl.textContent = t('index.gender.pair_cleared_odd');
      hintEl.style.display = 'block';
    }
  } else if (allowed && hintEl) {
    hintEl.textContent = '';
    hintEl.style.display = 'none';
  }

  return { allowed, cleared };
}

export function updateSectionStates(state, dom) {
  const hasLocation = !!(dom.placeInput && dom.placeInput.value.trim());
  // «Ukjent antall» (sticky avkrysning, se observation-commit.js) gjør antall-feltet
  // irrelevant — det skal da IKKE blokkere aktivitet/✓ selv om det står tomt.
  const unknownCount = !!(dom.countUnknownCheckbox && dom.countUnknownCheckbox.checked);
  const countOk = unknownCount || !!(dom.countInput && dom.countInput.value.trim());

  if (dom.sectionObservasjon) {
    dom.sectionObservasjon.classList.toggle('dimmed', !hasLocation);
    dom.input.disabled = !hasLocation;
    // Selvforklarende låst tilstand: feltet forteller hva som mangler.
    const readyPlaceholder = String(state.selectedSpeciesGroup || '8') === '11'
      ? t('index.search_placeholder_mammals')
      : t('index.search_placeholder');
    dom.input.placeholder = hasLocation ? readyPlaceholder : t('index.search_placeholder_locked');
    dom.countInput.disabled = !hasLocation || !state.selectedSpecies || unknownCount;
    dom.activitySelect.disabled = !hasLocation || !state.selectedSpecies || !countOk;
    dom.activitySubmitBtn.disabled = dom.activitySelect.disabled;
    if (!hasLocation) {
      dom.input.value = '';
      dom.input.classList.remove('species-selected');
      dom.countInput.value = '';
      state.selectedSpecies = null;
      dom.ageSelect.disabled = true;
      dom.genderSelect.disabled = true;
      if (dom.unitSelect) dom.unitSelect.disabled = true;
      if (dom.discoveryMethodSelect) dom.discoveryMethodSelect.disabled = true;
    }
  }
  const hasCount = hasLocation && !!state.selectedSpecies && countOk;
  if (dom.sectionAktivitet) {
    dom.sectionAktivitet.classList.toggle('dimmed', !hasCount);
    const wasDisabled = dom.activitySelect.disabled;
    dom.activitySelect.disabled = !hasCount;
    dom.activitySubmitBtn.disabled = !hasCount;

    // Pre-select sist valgt aktivitet når feltet aktiveres (sammenlign på kanonisk bokmål)
    if (wasDisabled && !dom.activitySelect.disabled) {
      const lastActivity = localStorage.getItem('lastActivity');
      if (lastActivity && dom.activitySelect) {
        const targetNb = activityBokmalName(lastActivity.trim());
        for (let i = 0; i < dom.activitySelect.options.length; i++) {
          const opt = dom.activitySelect.options[i];
          const optNb = (opt.dataset && opt.dataset.canonicalLabel)
            || activityBokmalName((opt.text || '').trim());
          if (optNb === targetNb) {
            dom.activitySelect.selectedIndex = i;
            break;
          }
        }
      }
    }
  }
  dom.ageSelect.disabled = !hasLocation || !state.selectedSpecies;
  dom.genderSelect.disabled = !hasLocation || !state.selectedSpecies;
  if (dom.unitSelect) dom.unitSelect.disabled = !hasLocation || !state.selectedSpecies;
  if (dom.discoveryMethodSelect) dom.discoveryMethodSelect.disabled = !hasLocation || !state.selectedSpecies;

  if (!hasLocation || !state.selectedSpecies) {
    if (dom.genderPairHint) {
      dom.genderPairHint.textContent = '';
      dom.genderPairHint.style.display = 'none';
    }
  }
  syncPairGenderOption(
    dom.genderSelect,
    dom.countInput ? dom.countInput.value : '',
    { unknownCount, hintEl: dom.genderPairHint }
  );

  updateFieldHighlights(dom, state.selectedSpecies, hasCount);
  checkRarity(state, dom);
}

export function updateFieldHighlights(dom, selectedSpecies, hasCount) {
  dom.countInput.classList.remove('field-highlight');
  dom.activitySelect.classList.remove('field-highlight');
  dom.activitySubmitBtn.classList.remove('field-highlight');

  if (selectedSpecies && !hasCount) {
    dom.countInput.classList.add('field-highlight');
  } else if (hasCount) {
    dom.activitySelect.classList.add('field-highlight');
    // Fjernet highlight fra V-knappen - den skal være konsekvent grønn
  }
}

export function pulseSearchFieldAndFocus(state, dom) {
  if (state.searchPulseTimeout) {
    clearTimeout(state.searchPulseTimeout);
    state.searchPulseTimeout = null;
  }

  dom.input.classList.remove('field-highlight');
  dom.input.style.removeProperty('animation');

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      dom.input.classList.add('field-highlight');
    });
  });

  dom.input.focus({ preventScroll: true });

  state.searchPulseTimeout = setTimeout(() => {
    dom.input.classList.remove('field-highlight');
    state.searchPulseTimeout = null;
  }, 2500);
}
