import { describe, it, expect, beforeEach } from 'vitest';
import { initCoObserverPicker } from '../../public/js/coobserver-picker.js';
import { saveLanguage, saveMedobs } from '../../public/js/storage.js';

describe('coobserver-picker språk', () => {
  let container, newNameInput, addBtn;

  beforeEach(() => {
    document.body.innerHTML = '';
    container = document.createElement('div');
    newNameInput = document.createElement('input');
    addBtn = document.createElement('button');
    document.body.appendChild(container);
    document.body.appendChild(newNameInput);
    document.body.appendChild(addBtn);
    saveMedobs([]);
  });

  it('viser "Ingen medobservatørar er lagde til – legg til under." når nynorsk er aktivt og ingen medobs finnes', () => {
    saveLanguage('nn');
    const picker = initCoObserverPicker({ container, newNameInput, addBtn });
    picker.setSelected([]);
    expect(container.textContent).toBe('Ingen medobservatørar er lagde til – legg til under.');
  });

  it('viser "Ingen medobservatører lagt til ennå — legg til under." når bokmål er aktivt', () => {
    saveLanguage('nb');
    const picker = initCoObserverPicker({ container, newNameInput, addBtn });
    picker.setSelected([]);
    expect(container.textContent).toBe('Ingen medobservatører lagt til ennå — legg til under.');
  });
});
