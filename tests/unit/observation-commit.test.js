import { describe, it, expect, beforeEach, vi } from 'vitest';

// Node sin egen (eksperimentelle) globale localStorage kan skygge for jsdom
// sin i dette miljøet og mangler getItem/setItem — samme fell som i
// fellestur-sync.test.js. Stubber en enkel, fungerende erstatning.
const store = {};
vi.stubGlobal('localStorage', {
  getItem: vi.fn((key) => store[key] ?? null),
  setItem: vi.fn((key, value) => { store[key] = String(value); }),
  removeItem: vi.fn((key) => { delete store[key]; }),
});

const { commitObservation } = await import('../../public/js/observation-commit.js');

function lagInput(id, value = '') {
  const el = document.createElement('input');
  el.id = id;
  el.value = value;
  document.body.appendChild(el);
  return el;
}

function lagSelect(id, optionText, value = '') {
  const el = document.createElement('select');
  el.id = id;
  const opt = document.createElement('option');
  opt.text = optionText;
  opt.value = value;
  el.appendChild(opt);
  document.body.appendChild(el);
  return el;
}

function lagCheckbox(id) {
  const el = document.createElement('input');
  el.type = 'checkbox';
  el.id = id;
  document.body.appendChild(el);
  return el;
}

function lagTextarea(id, value = '') {
  const el = document.createElement('textarea');
  el.id = id;
  el.value = value;
  document.body.appendChild(el);
  return el;
}

function nyState() {
  return {
    observations: [],
    selectedSpecies: { taxonName: 'Tjeld' },
    currentPlaceName: '',
    currentPlaceId: null,
    currentPosition: null,
    etterregVisitKey: null,
    currentResults: [],
    activeIndex: -1,
  };
}

function nyDom() {
  return {
    placeInput: lagInput('place', 'Herdla fyr'),
    input: lagInput('search', 'Tjeld'),
    countInput: lagInput('count', '3'),
    activitySelect: lagSelect('activity', 'Stasjonær', 'Stasjonær'),
    activitySubmitBtn: document.createElement('button'),
    ageSelect: lagSelect('age', '', ''),
    genderSelect: lagSelect('gender', '', ''),
    countEstimatedCheckbox: lagCheckbox('count-estimated'),
    extraUncertain: lagCheckbox('extra-uncertain'),
    extraNotSpontaneous: lagCheckbox('extra-not-spontaneous'),
    extraInteresting: lagCheckbox('extra-interesting'),
    extraNotRefound: lagCheckbox('extra-not-refound'),
    extraNotFound: lagCheckbox('extra-not-found'),
    extraPrivateComment: lagTextarea('extra-private-comment'),
    extraComment: lagTextarea('extra-comment'),
    extraHideUntil: lagInput('extra-hide-until', ''),
    extraPhotoValue: lagInput('extra-photo-value', ''),
  };
}

function nyeCallbacks() {
  return {
    doRenderObservations: () => {},
    saveState: () => {},
    renderResults: () => {},
    updateSectionStates: () => {},
  };
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('commitObservation — «antall er estimert»-boks', () => {
  it('legger til kommentaren "Estimert antal" når boksen er hukket av', () => {
    const state = nyState();
    const dom = nyDom();
    dom.countEstimatedCheckbox.checked = true;

    commitObservation(state, dom, nyeCallbacks());

    expect(state.observations).toHaveLength(1);
    expect(state.observations[0].comment).toBe('Estimert antal');
  });

  it('setter ingen kommentar når boksen ikke er hukket av', () => {
    const state = nyState();
    const dom = nyDom();
    dom.countEstimatedCheckbox.checked = false;

    commitObservation(state, dom, nyeCallbacks());

    expect(state.observations).toHaveLength(1);
    expect(state.observations[0].comment).toBeUndefined();
  });

  it('huker av boksen ned igjen etter registrering (ett-gangs per observasjon)', () => {
    const state = nyState();
    const dom = nyDom();
    dom.countEstimatedCheckbox.checked = true;

    commitObservation(state, dom, nyeCallbacks());

    expect(dom.countEstimatedCheckbox.checked).toBe(false);
  });
});

describe('commitObservation — «flere felt»-modal', () => {
  it('tar med huket-av felt og privat kommentar i observasjonen', () => {
    const state = nyState();
    const dom = nyDom();
    dom.extraUncertain.checked = true;
    dom.extraNotSpontaneous.checked = true;
    dom.extraInteresting.checked = true;
    dom.extraNotRefound.checked = true;
    dom.extraNotFound.checked = true;
    dom.extraPrivateComment.value = '  Sett sammen med Kari  ';

    commitObservation(state, dom, nyeCallbacks());

    expect(state.observations).toHaveLength(1);
    const obs = state.observations[0];
    expect(obs.uncertain).toBe(true);
    expect(obs.notSpontaneous).toBe(true);
    expect(obs.interesting).toBe(true);
    expect(obs.notRefound).toBe(true);
    expect(obs.notFound).toBe(true);
    expect(obs.privateComment).toBe('Sett sammen med Kari');
  });

  it('tar med bildet fra modalens skjulte speil-felt', () => {
    const state = nyState();
    const dom = nyDom();
    dom.extraPhotoValue.value = 'data:image/jpeg;base64,ABC123';

    commitObservation(state, dom, nyeCallbacks());

    expect(state.observations[0].photo).toBe('data:image/jpeg;base64,ABC123');
  });

  it('tar med offentlig kommentar og skjul-til-dato fra modalen', () => {
    const state = nyState();
    const dom = nyDom();
    dom.extraComment.value = '  Fint vær, god sikt  ';
    dom.extraHideUntil.value = '2026-10-01';

    commitObservation(state, dom, nyeCallbacks());

    const obs = state.observations[0];
    expect(obs.comment).toBe('Fint vær, god sikt');
    expect(obs.hideUntil).toBe('2026-10-01');
  });

  it('kombinerer offentlig kommentar med «Estimert antal» når begge er satt', () => {
    const state = nyState();
    const dom = nyDom();
    dom.extraComment.value = 'Fint vær';
    dom.countEstimatedCheckbox.checked = true;

    commitObservation(state, dom, nyeCallbacks());

    expect(state.observations[0].comment).toBe('Fint vær. Estimert antal');
  });

  it('setter ingen av feltene når ingenting er huket av/utfylt', () => {
    const state = nyState();
    const dom = nyDom();

    commitObservation(state, dom, nyeCallbacks());

    const obs = state.observations[0];
    expect(obs.uncertain).toBeUndefined();
    expect(obs.notSpontaneous).toBeUndefined();
    expect(obs.interesting).toBeUndefined();
    expect(obs.notRefound).toBeUndefined();
    expect(obs.notFound).toBeUndefined();
    expect(obs.privateComment).toBeUndefined();
  });

  it('nullstiller alle feltene etter registrering (gjelder kun én observasjon)', () => {
    const state = nyState();
    const dom = nyDom();
    dom.extraUncertain.checked = true;
    dom.extraPrivateComment.value = 'Noe midlertidig';
    dom.extraComment.value = 'Fint vær';
    dom.extraHideUntil.value = '2026-10-01';

    commitObservation(state, dom, nyeCallbacks());

    expect(dom.extraUncertain.checked).toBe(false);
    expect(dom.extraNotSpontaneous.checked).toBe(false);
    expect(dom.extraInteresting.checked).toBe(false);
    expect(dom.extraNotRefound.checked).toBe(false);
    expect(dom.extraNotFound.checked).toBe(false);
    expect(dom.extraPrivateComment.value).toBe('');
    expect(dom.extraComment.value).toBe('');
    expect(dom.extraHideUntil.value).toBe('');
  });

  it('varsler modalens badge-oppdatering via obs:extra-felt-nullstilt-eventet', () => {
    const state = nyState();
    const dom = nyDom();
    const lytter = vi.fn();
    document.addEventListener('obs:extra-felt-nullstilt', lytter);

    commitObservation(state, dom, nyeCallbacks());

    expect(lytter).toHaveBeenCalledTimes(1);
    document.removeEventListener('obs:extra-felt-nullstilt', lytter);
  });
});
