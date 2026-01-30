/**
 * Skjematilstand-modul for progressiv aktivering av felter
 */

export function updateSectionStates(state, dom) {
  const hasLocation = !!(dom.placeInput && dom.placeInput.value.trim());
  if (dom.sectionObservasjon) {
    dom.sectionObservasjon.classList.toggle('dimmed', !hasLocation);
    dom.input.disabled = !hasLocation;
    dom.countInput.disabled = !hasLocation || !state.selectedSpecies;
    dom.activitySelect.disabled = !hasLocation || !state.selectedSpecies || !dom.countInput.value.trim();
    dom.activitySubmitBtn.disabled = dom.activitySelect.disabled;
    if (!hasLocation) {
      dom.input.value = '';
      dom.input.classList.remove('species-selected');
      dom.countInput.value = '';
      state.selectedSpecies = null;
      dom.ageSelect.disabled = true;
      dom.genderSelect.disabled = true;
    }
  }
  const hasCount = !!(dom.countInput && dom.countInput.value.trim() && !dom.countInput.disabled);
  if (dom.sectionAktivitet) {
    dom.sectionAktivitet.classList.toggle('dimmed', !hasCount);
    const wasDisabled = dom.activitySelect.disabled;
    dom.activitySelect.disabled = !hasCount;
    dom.activitySubmitBtn.disabled = !hasCount;

    // Pre-select sist valgt aktivitet når feltet aktiveres
    if (wasDisabled && !dom.activitySelect.disabled) {
      const lastActivity = localStorage.getItem('lastActivity');
      if (lastActivity && dom.activitySelect) {
        for (let i = 0; i < dom.activitySelect.options.length; i++) {
          if (dom.activitySelect.options[i].text === lastActivity) {
            dom.activitySelect.selectedIndex = i;
            break;
          }
        }
      }
    }
  }
  dom.ageSelect.disabled = !hasLocation || !state.selectedSpecies;
  dom.genderSelect.disabled = !hasLocation || !state.selectedSpecies;

  updateFieldHighlights(dom, state.selectedSpecies, hasCount);
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
