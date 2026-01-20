/**
 * Storage-modul for localStorage-håndtering
 */

const STORAGE_KEY = 'fugleobservasjoner_v1';
const MEDOBS_KEY = 'medobs_list_v1';

/**
 * Last medobservatører fra localStorage
 * @returns {Array} - Liste med medobservatører
 */
export function loadMedobs() {
  try {
    const raw = JSON.parse(window.localStorage.getItem(MEDOBS_KEY) || 'null');
    if (!raw) return [];
    
    // Håndter gammelt format (array av strings)
    if (Array.isArray(raw) && raw.length && typeof raw[0] === 'string') {
      return raw.slice(0, 10).map((n) => ({ name: n, active: true }));
    }
    
    return Array.isArray(raw) ? raw : [];
  } catch (e) {
    console.warn('Kunne ikke laste medobservatører', e);
    return [];
  }
}

/**
 * Lagre medobservatører til localStorage
 * @param {Array} list - Liste med medobservatører
 */
export function saveMedobs(list) {
  try {
    window.localStorage.setItem(MEDOBS_KEY, JSON.stringify(list));
  } catch (e) {
    console.warn('Kunne ikke lagre medobservatører', e);
  }
}

/**
 * Hent standard medobservatører for nye observasjoner
 * @returns {Array<string>} - Array med 10 medobservatør-navn (tomme strenger hvis ingen)
 */
export function defaultCoObservers() {
  const l = loadMedobs();
  const active = (l || []).filter((it) => it && it.name && it.active).map((it) => it.name);
  const res = Array(10).fill('');
  for (let i = 0; i < Math.min(10, active.length); i++) {
    res[i] = active[i];
  }
  return res;
}

/**
 * Lagre observasjoner til localStorage
 * @param {Array} observations - Liste med observasjoner
 */
export function saveObservations(observations) {
  if (!window.localStorage) return;
  
  try {
    const payload = {
      version: 1,
      observations,
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch (e) {
    console.warn('Kunne ikke lagre til localStorage', e);
  }
}

/**
 * Last observasjoner fra localStorage
 * @returns {Array} - Liste med observasjoner
 */
export function loadObservations() {
  if (!window.localStorage) return [];
  
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    
    const payload = JSON.parse(raw);
    if (!payload || !Array.isArray(payload.observations)) return [];
    
    return payload.observations;
  } catch (e) {
    console.warn('Kunne ikke lese fra localStorage', e);
    return [];
  }
}
