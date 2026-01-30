/**
 * Storage-modul for localStorage-håndtering
 */

const STORAGE_KEY = 'fugleobservasjoner_v1';
const MEDOBS_KEY = 'medobs_list_v1';
const AO_SIZE_KEY = 'ao_search_radius_v1';
const ACTIVITY_PILLS_KEY = 'activityPills_v1';

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

/**
 * Lagre søkeradius til localStorage
 * @param {number} radius - Radius i meter
 */
export function saveAoSearchRadius(radius) {
  if (!window.localStorage) return;

  try {
    window.localStorage.setItem(AO_SIZE_KEY, String(radius));
  } catch (e) {
    console.warn('Kunne ikke lagre søkeradius', e);
  }
}

/**
 * Last søkeradius fra localStorage
 * @returns {number} - Radius i meter (default 1000)
 */
export function loadAoSearchRadius() {
  if (!window.localStorage) return 1000;

  try {
    const raw = window.localStorage.getItem(AO_SIZE_KEY);
    if (!raw) return 1000;

    const radius = parseFloat(raw);
    if (isNaN(radius) || radius < 100 || radius > 3000) return 1000;

    return radius;
  } catch (e) {
    console.warn('Kunne ikke lese søkeradius', e);
    return 1000;
  }
}

/**
 * Lagre konfigurasjon av aktivitetspills
 * @param {Array<{label: string, value: string}>} pills - Array av pill-objekter
 */
export function saveActivityPills(pills) {
  try {
    const config = {
      version: 1,
      pills: pills.slice(0, 6) // max 6
    };
    localStorage.setItem(ACTIVITY_PILLS_KEY, JSON.stringify(config));
  } catch (e) {
    console.warn('Kunne ikke lagre aktivitetspills', e);
  }
}

/**
 * Last konfigurasjon av aktivitetspills
 * @returns {Array<{label: string, value: string}>}
 */
export function loadActivityPills() {
  try {
    const raw = localStorage.getItem(ACTIVITY_PILLS_KEY);
    if (raw) {
      const config = JSON.parse(raw);
      if (config.version === 1 && Array.isArray(config.pills)) {
        return config.pills;
      }
    }
  } catch (e) {
    console.warn('Kunne ikke laste aktivitetspills', e);
  }

  // Migrer fra gammelt system
  return migrateFromOldPillCount();
}

/**
 * Migrer fra gammelt activityPillCount til nytt system
 * @returns {Array<{label: string, value: string}>}
 */
function migrateFromOldPillCount() {
  const oldCount = localStorage.getItem('activityPillCount');

  // Standard pills (matching observation-commit.js hardkoded array)
  const defaultPills = [
    { label: 'Stasjonær', value: '23' },
    { label: 'Rastende', value: '22' },
    { label: 'Overflygende', value: '24' },
    { label: 'Næringssøkende', value: '25' },
    { label: 'Trekkende', value: '32' },
    { label: 'Sang/spill', value: '52' }
  ];

  if (oldCount) {
    const count = parseInt(oldCount, 10);
    if (count >= 1 && count <= 6) {
      return defaultPills.slice(0, count);
    }
  }

  // Default for helt nye brukere: 4 første
  return defaultPills.slice(0, 4);
}
