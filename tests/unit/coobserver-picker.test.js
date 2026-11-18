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

  it('varsler brukerens valg og tillegg uten å varsle ved forhåndsutfylling', () => {
    let endringer = 0;
    const picker = initCoObserverPicker({ container, newNameInput, addBtn }, () => { endringer++; });
    saveMedobs([{ name: 'Anne', alias: 'anne', active: false }]);
    picker.setSelected([]);
    expect(endringer).toBe(0);
    container.querySelector('input').click();
    expect(picker.getSelected()).toEqual([{ name: 'Anne', alias: 'anne' }]);
    expect(endringer).toBe(1);
    newNameInput.value = 'Per';
    addBtn.click();
    expect(endringer).toBe(2);
    expect(picker.getSelected()).toHaveLength(2);
  });
});
