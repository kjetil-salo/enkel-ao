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

vi.mock('../../public/js/celebrate.js', () => ({ celebrateRareFind: vi.fn() }));

const { commitObservation, renderActivityPills, setupPillsDragToScroll } = await import('../../public/js/observation-commit.js');
const { celebrateRareFind } = await import('../../public/js/celebrate.js');

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
    countUnknownCheckbox: lagCheckbox('count-unknown'),
    extraUncertain: lagCheckbox('extra-uncertain'),
    extraNotSpontaneous: lagCheckbox('extra-not-spontaneous'),
    extraInteresting: lagCheckbox('extra-interesting'),
    extraNotRefound: lagCheckbox('extra-not-refound'),
    extraNotFound: lagCheckbox('extra-not-found'),
    extraSecondhand: lagCheckbox('extra-secondhand'),
    extraPrivateComment: lagTextarea('extra-private-comment'),
    extraComment: lagTextarea('extra-comment'),
    extraHideUntil: lagInput('extra-hide-until', ''),
    extraPhotoValue: lagInput('extra-photo-value', ''),
    rarityWarning: (() => { const el = document.createElement('div'); el.id = 'rarity-warning'; document.body.appendChild(el); return el; })(),
    rarityWarningHeader: (() => { const el = document.createElement('div'); el.id = 'rarity-warning-header'; document.body.appendChild(el); return el; })(),
    rarityWarningBody: (() => { const el = document.createElement('div'); el.id = 'rarity-warning-body'; document.body.appendChild(el); return el; })(),
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
  celebrateRareFind.mockClear();
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

describe('commitObservation — ukjent antall og uoppgitt aktivitet', () => {
  it('avviser fortsatt tomt antall når «ukjent antall»-boksen ikke er huket av', () => {
    const state = nyState();
    const dom = nyDom();
    dom.countInput.value = '';
    dom.countUnknownCheckbox.checked = false;

    commitObservation(state, dom, nyeCallbacks());

    expect(state.observations).toHaveLength(0);
  });

  it('lagrer count: null når «ukjent antall»-boksen er huket av, selv med tomt antallsfelt', () => {
    const state = nyState();
    const dom = nyDom();
    dom.countInput.value = '';
    dom.countUnknownCheckbox.checked = true;

    commitObservation(state, dom, nyeCallbacks());

    expect(state.observations).toHaveLength(1);
    expect(state.observations[0].count).toBeNull();
  });

  it('holder «ukjent antall»-boksen huket av etter registrering (sticky, i motsetning til «ca»)', () => {
    const state = nyState();
    const dom = nyDom();
    dom.countInput.value = '';
    dom.countUnknownCheckbox.checked = true;

    commitObservation(state, dom, nyeCallbacks());

    expect(dom.countUnknownCheckbox.checked).toBe(true);
  });

  it('lagrer activity: "" når «Ikke oppgitt» (value="") er valgt, uten å avvise registreringen', () => {
    const state = nyState();
    const dom = nyDom();
    dom.activitySelect = lagSelect('activity', 'Ikke oppgitt', '');

    commitObservation(state, dom, nyeCallbacks());

    expect(state.observations).toHaveLength(1);
    expect(state.observations[0].activity).toBe('');
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
    dom.extraSecondhand.checked = true;
    dom.extraPrivateComment.value = '  Sett sammen med Kari  ';

    commitObservation(state, dom, nyeCallbacks());

    expect(state.observations).toHaveLength(1);
    const obs = state.observations[0];
    expect(obs.uncertain).toBe(true);
    expect(obs.notSpontaneous).toBe(true);
    expect(obs.interesting).toBe(true);
    expect(obs.notRefound).toBe(true);
    expect(obs.notFound).toBe(true);
    expect(obs.secondhand).toBe(true);
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
    expect(obs.secondhand).toBeUndefined();
    expect(obs.privateComment).toBeUndefined();
  });

  it('nullstiller alle feltene etter registrering (gjelder kun én observasjon)', () => {
    const state = nyState();
    const dom = nyDom();
    dom.extraUncertain.checked = true;
    dom.extraSecondhand.checked = true;
    dom.extraPrivateComment.value = 'Noe midlertidig';
    dom.extraComment.value = 'Fint vær';
    dom.extraHideUntil.value = '2026-10-01';

    commitObservation(state, dom, nyeCallbacks());

    expect(dom.extraUncertain.checked).toBe(false);
    expect(dom.extraNotSpontaneous.checked).toBe(false);
    expect(dom.extraInteresting.checked).toBe(false);
    expect(dom.extraNotRefound.checked).toBe(false);
    expect(dom.extraNotFound.checked).toBe(false);
    expect(dom.extraSecondhand.checked).toBe(false);
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

describe('commitObservation — sjeldenhetsvarsel-feiring', () => {
  it('fanger boksens innhold på obs og trigger feiring når varselet er synlig', () => {
    const state = nyState();
    const dom = nyDom();
    dom.rarityWarning.style.display = '';
    dom.rarityWarningHeader.textContent = 'Forekomst: Ekstremt sjelden';
    dom.rarityWarningBody.textContent = 'Observasjonen er veldig interessant!';

    commitObservation(state, dom, nyeCallbacks());

    expect(state.observations[0].rarityWarning).toEqual({
      header: 'Forekomst: Ekstremt sjelden',
      body: 'Observasjonen er veldig interessant!',
    });
    expect(celebrateRareFind).toHaveBeenCalledTimes(1);
    expect(celebrateRareFind).toHaveBeenCalledWith('Tjeld');
  });

  it('trigger ikke feiring når boksen er skjult', () => {
    const state = nyState();
    const dom = nyDom();
    dom.rarityWarning.style.display = 'none';
    dom.rarityWarningHeader.textContent = 'Skal ikke plukkes opp';

    commitObservation(state, dom, nyeCallbacks());

    expect(state.observations[0].rarityWarning).toBeUndefined();
    expect(celebrateRareFind).not.toHaveBeenCalled();
  });

  it('trigger ikke feiring for en vanlig registrering uten varsel', () => {
    const state = nyState();
    const dom = nyDom();

    commitObservation(state, dom, nyeCallbacks());

    expect(state.observations[0].rarityWarning).toBeUndefined();
    expect(celebrateRareFind).not.toHaveBeenCalled();
  });

  it('viser ikke den vanlige registrerings-toasten ved sjeldent funn (krasjet visuelt med bannerert)', () => {
    const state = nyState();
    const dom = nyDom();
    dom.rarityWarning.style.display = '';
    dom.rarityWarningHeader.textContent = 'Forekomst: Ekstremt sjelden';

    commitObservation(state, dom, nyeCallbacks());

    const toast = document.getElementById('registered-toast');
    expect(toast).toBeNull();
  });

  it('viser den vanlige registrerings-toasten for en vanlig registrering', () => {
    const state = nyState();
    const dom = nyDom();

    commitObservation(state, dom, nyeCallbacks());

    const toast = document.getElementById('registered-toast');
    expect(toast).not.toBeNull();
    expect(toast.textContent).toContain('registrert');
  });
});

describe('renderActivityPills & drag-to-scroll', () => {
  it('setter opp drag-to-scroll og rendrer pills uten å krasje', () => {
    const container = document.createElement('div');
    container.id = 'activity-pills';
    document.body.appendChild(container);

    const select = document.createElement('select');
    select.id = 'activity';
    const opt = document.createElement('option');
    opt.value = '23';
    opt.text = 'Stasjonær';
    select.appendChild(opt);
    document.body.appendChild(select);

    const commitFn = vi.fn();
    const dom = { activityPillsEl: container, activitySelect: select };

    renderActivityPills(dom, commitFn);

    expect(container.dataset.dragScrollInit).toBe('true');
    expect(container.children.length).toBeGreaterThan(0);
  });

  it('ignorerer klikk dersom brukeren nettopp dro linjen for å scrolle', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const select = document.createElement('select');
    const opt = document.createElement('option');
    opt.value = '23';
    opt.text = 'Stasjonær';
    select.appendChild(opt);
    document.body.appendChild(select);

    const commitFn = vi.fn();
    const dom = { activityPillsEl: container, activitySelect: select };

    renderActivityPills(dom, commitFn);

    const firstPill = container.querySelector('.activity-pill');
    expect(firstPill).not.toBeNull();

    // Simuler at linjen er i dragging-tilstand
    container.dataset.isDragging = 'true';
    firstPill.click();
    expect(commitFn).not.toHaveBeenCalled();

    // Nullstill dragging
    container.dataset.isDragging = 'false';
    firstPill.click();
    expect(commitFn).toHaveBeenCalledTimes(1);
  });

  it('fanger ikke opp nedoverscrolling med hjul/touchpad, men lar det passere til siden', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const select = document.createElement('select');
    const opt = document.createElement('option');
    opt.value = '23';
    opt.text = 'Stasjonær';
    select.appendChild(opt);
    document.body.appendChild(select);

    const commitFn = vi.fn();
    const dom = { activityPillsEl: container, activitySelect: select };

    renderActivityPills(dom, commitFn);

    // Simuler at container har overflytende innhold
    Object.defineProperty(container, 'scrollWidth', { value: 600, configurable: true });
    Object.defineProperty(container, 'clientWidth', { value: 300, configurable: true });
    container.scrollLeft = 0;

    const wheelEvent = new Event('wheel', { bubbles: true, cancelable: true });
    wheelEvent.deltaX = 0;
    wheelEvent.deltaY = 80;

    container.dispatchEvent(wheelEvent);

    // Skal IKKE ha endret scrollLeft og skal IKKE ha forhindret default (nedoverscrolling)
    expect(container.scrollLeft).toBe(0);
    expect(wheelEvent.defaultPrevented).toBe(false);
  });

  it('matcher «Ikke oppgitt»-pillen (value="") på verdi, selv når <option>-teksten står på et annet språk enn den lagrede pill-labelen', () => {
    // Regresjonstest: p.value er en tom streng for «Ikke oppgitt», og en
    // tidligere `p.value && ...`-sjekk hoppet derfor alltid over
    // verdi-matchingen for nettopp denne pillen og falt tilbake til
    // tekst-sammenligning - som brøt sammen ved språkbytte (se
    // docs/ukjent-antall-og-uoppgitt-aktivitet.md).
    localStorage.setItem('activityPills_v1', JSON.stringify({
      version: 1,
      pills: [{ label: 'Ikke oppgitt', value: '' }],
    }));

    const container = document.createElement('div');
    document.body.appendChild(container);

    const select = document.createElement('select');
    const stasjonaer = document.createElement('option');
    stasjonaer.value = '23';
    stasjonaer.text = 'Stasjonær';
    select.appendChild(stasjonaer);
    const ikkeOppgitt = document.createElement('option');
    ikkeOppgitt.value = '';
    ikkeOppgitt.text = 'Ikkje oppgjeve'; // nynorsk, mens pillens label er lagret på bokmål
    select.appendChild(ikkeOppgitt);
    document.body.appendChild(select);

    const commitFn = vi.fn();
    const dom = { activityPillsEl: container, activitySelect: select };

    renderActivityPills(dom, commitFn);

    const pill = container.querySelector('.activity-pill');
    expect(pill).not.toBeNull();
    pill.click();

    expect(select.selectedIndex).toBe(1);
    expect(commitFn).toHaveBeenCalledTimes(1);

    localStorage.removeItem('activityPills_v1');
  });
});
