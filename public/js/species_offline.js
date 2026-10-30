// Offline fallback for norske fuglearter
// Generert fra Norgeslisten (kun art/underart, ikke grupper)

import {
  searchSpecies,
  calculateSpeciesScore,
  MATCH_SCORES,
  isNynorskLanguage,
  deriveSubspeciesNynorskName,
  deriveSubspeciesBokmalName,
  extractSubspeciesEpithet,
  isSubspeciesItem,
  isGenericSubspeciesName,
  translateDedicatedSubspeciesToNynorsk,
  isHybridItem,
} from './species-matcher.js?v=v1.58.5';

export {
  searchSpecies,
  calculateSpeciesScore,
  MATCH_SCORES,
  isNynorskLanguage,
  deriveSubspeciesNynorskName,
  deriveSubspeciesBokmalName,
  extractSubspeciesEpithet,
  isSubspeciesItem,
  isGenericSubspeciesName,
  translateDedicatedSubspeciesToNynorsk,
  isHybridItem,
};

export const SPECIES_SYNC_STORAGE_KEY = 'enkel_ao_species_sync_v1';
export const SPECIES_SYNC_META_KEY = 'enkel_ao_species_sync_meta_v1';
export const DEFAULT_AO_STORED_SEARCH_URL =
  'https://www.artsobservasjoner.no/ViewSighting/ViewSpeciesList?storedSearchCriterias=17138105#';

/**
 * Initiell offline-seed (fallback) med startverdiar for antallFunn og artsnamn
 * på både nynorsk og bokmål, inkludert raudstrupetrast / rødstrupetrost.
 * Brukast dersom norske_arter.json ikkje kan hentast eller manglar artar/antallFunn.
 */
export const INITIAL_SPECIES_SEED = Object.freeze([
  {
    id: 4588,
    taxonId: 4588,
    norwegian: 'kjøttmeis',
    nameNob: 'kjøttmeis',
    nynorsk: 'kjøtmeis',
    nameNno: 'kjøtmeis',
    latin: 'Parus major',
    latinName: 'Parus major',
    antallFunn: 493658,
    subspecies: [],
  },
  {
    id: 4587,
    taxonId: 4587,
    norwegian: 'blåmeis',
    nameNob: 'blåmeis',
    nynorsk: 'blåmeis',
    nameNno: 'blåmeis',
    latin: 'Cyanistes caeruleus',
    latinName: 'Cyanistes caeruleus',
    antallFunn: 444335,
    subspecies: [],
  },
  {
    id: 4507,
    taxonId: 4507,
    norwegian: 'rødstrupe',
    nameNob: 'rødstrupe',
    nynorsk: 'raudstrupe',
    nameNno: 'raudstrupe',
    latin: 'Erithacus rubecula',
    latinName: 'Erithacus rubecula',
    antallFunn: 428362,
    subspecies: [],
  },
  {
    id: 4426,
    taxonId: 4426,
    norwegian: 'stær',
    nameNob: 'stær',
    nynorsk: 'stare',
    nameNno: 'stare',
    latin: 'Sturnus vulgaris',
    latinName: 'Sturnus vulgaris',
    antallFunn: 391865,
    subspecies: [],
  },
  {
    id: 4547,
    taxonId: 4547,
    norwegian: 'rødvingetrost',
    nameNob: 'rødvingetrost',
    nynorsk: 'raudvengtrast',
    nameNno: 'raudvengtrast',
    latin: 'Turdus iliacus',
    latinName: 'Turdus iliacus',
    antallFunn: 283133,
    subspecies: [
      {
        id: 4548,
        taxonId: 4548,
        parentId: 4547,
        isSub: true,
        norwegian: 'rødvingetrost, underarten coburni',
        nameNob: 'rødvingetrost, underarten coburni',
        nynorsk: 'raudvengtrast, underarten coburni',
        nameNno: 'raudvengtrast, underarten coburni',
        latin: 'T. i. coburni',
        latinName: 'Turdus iliacus coburni',
        antallFunn: 0,
      },
      {
        id: 4549,
        taxonId: 4549,
        parentId: 4547,
        isSub: true,
        norwegian: 'nan',
        nameNob: 'rødvingetrost, underarten iliacus',
        nynorsk: 'raudvengtrast, underarten iliacus',
        nameNno: 'raudvengtrast, underarten iliacus',
        latin: 'T. i. iliacus',
        latinName: 'Turdus iliacus iliacus',
        antallFunn: 0,
      },
    ],
  },
  {
    id: 3799,
    taxonId: 3799,
    norwegian: 'rødstilk',
    nameNob: 'rødstilk',
    nynorsk: 'raudstilk',
    nameNno: 'raudstilk',
    latin: 'Tringa totanus',
    latinName: 'Tringa totanus',
    antallFunn: 213847,
    subspecies: [],
  },
  {
    id: 4516,
    taxonId: 4516,
    norwegian: 'rødstjert',
    nameNob: 'rødstjert',
    nynorsk: 'raudstjert',
    nameNno: 'raudstjert',
    latin: 'Phoenicurus phoenicurus',
    latinName: 'Phoenicurus phoenicurus',
    antallFunn: 112677,
    subspecies: [],
  },
  {
    id: 3840,
    taxonId: 3840,
    norwegian: 'rødnebbterne',
    nameNob: 'rødnebbterne',
    nynorsk: 'raudnebbterne',
    nameNno: 'raudnebbterne',
    latin: 'Sterna paradisaea',
    latinName: 'Sterna paradisaea',
    antallFunn: 45756,
    subspecies: [],
  },
  {
    id: 4515,
    taxonId: 4515,
    norwegian: 'svartrødstjert',
    nameNob: 'svartrødstjert',
    nynorsk: 'svartraudstjert',
    nameNno: 'svartraudstjert',
    latin: 'Phoenicurus ochruros',
    latinName: 'Phoenicurus ochruros',
    antallFunn: 5834,
    subspecies: [],
  },
  {
    id: 4422,
    taxonId: 4422,
    norwegian: 'rosenstær',
    nameNob: 'rosenstær',
    nynorsk: 'rosenstare',
    nameNno: 'rosenstare',
    latin: 'Pastor roseus',
    latinName: 'Pastor roseus',
    antallFunn: 664,
    subspecies: [],
  },
  {
    id: 3500,
    taxonId: 3500,
    norwegian: 'rødhalsgås',
    nameNob: 'rødhalsgås',
    nynorsk: 'raudhalsgås',
    nameNno: 'raudhalsgås',
    latin: 'Branta ruficollis',
    latinName: 'Branta ruficollis',
    antallFunn: 57,
    subspecies: [],
  },
  {
    id: 4447,
    taxonId: 4447,
    norwegian: 'starrsanger',
    nameNob: 'starrsanger',
    nynorsk: 'storrsongar',
    nameNno: 'storrsongar',
    latin: 'Helopsaltes certhiola',
    latinName: 'Helopsaltes certhiola',
    antallFunn: 29,
    subspecies: [],
  },
  {
    id: 4301,
    taxonId: 4301,
    norwegian: 'isabellavarsler',
    nameNob: 'isabellavarsler',
    nynorsk: 'isabellavarslar',
    nameNno: 'isabellavarslar',
    latin: 'Lanius isabellinus',
    latinName: 'Lanius isabellinus',
    antallFunn: 7,
    subspecies: [],
  },
  {
    id: 3750,
    taxonId: 3750,
    norwegian: 'rødstrupesnipe',
    nameNob: 'rødstrupesnipe',
    nynorsk: 'raudstrupesnipe',
    nameNno: 'raudstrupesnipe',
    latin: 'Calidris ruficollis',
    latinName: 'Calidris ruficollis',
    antallFunn: 6,
    subspecies: [],
  },
  {
    id: 4560,
    taxonId: 4560,
    norwegian: 'rødstrupetrost',
    nameNob: 'rødstrupetrost',
    nynorsk: 'raudstrupetrast',
    nameNno: 'raudstrupetrast',
    latin: 'Turdus ruficollis',
    latinName: 'Turdus ruficollis',
    antallFunn: 0,
    subspecies: [],
  },
  {
    id: 186469,
    taxonId: 186469,
    norwegian: 'østgulerle',
    nameNob: 'østgulerle',
    nynorsk: 'austgulerle',
    nameNno: 'austgulerle',
    latin: 'Motacilla tschutschensis',
    latinName: 'Motacilla tschutschensis',
    antallFunn: 75,
    subspecies: [
      {
        id: 186470,
        taxonId: 186470,
        parentId: 186469,
        isSub: true,
        norwegian: 'nan',
        nameNob: 'østgulerle, underarten plexa/tschutschensis',
        nynorsk: 'austgulerle, underarten plexa/tschutschensis',
        nameNno: 'austgulerle, underarten plexa/tschutschensis',
        latin: 'M. t. plexa/tschutschensis',
        latinName: 'Motacilla tschutschensis plexa/tschutschensis',
        antallFunn: 0,
      },
    ],
  },
]);

let offlineSpecies = null;
let latinToNynorskIndex = null;
let speciesMetaIndex = null;

function resetSpeciesCaches() {
  offlineSpecies = null;
  latinToNynorskIndex = null;
  speciesMetaIndex = null;
}

/**
 * Hent synkroniserte arts-overstyringar frå localStorage.
 * @returns {Record<string, {id?: number, taxonId?: number, nameNob?: string, nameNno?: string, latinName?: string, antallFunn?: number}>|null}
 */
export function getSpeciesSyncOverrides() {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  try {
    const raw = window.localStorage.getItem(SPECIES_SYNC_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Hent metadata for siste synkronisering av artsdata.
 * @returns {{timestamp?: number, updatedCount?: number, namesUpdated?: number, totalSpecies?: number, storedSearchUrl?: string}|null}
 */
export function getLastSpeciesSyncMeta() {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  try {
    const raw = window.localStorage.getItem(SPECIES_SYNC_META_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Lagre synkroniserte arts-overstyringar til localStorage og nullstill minne-cache.
 * @param {Record<string, object>} overrides
 * @param {object} [meta]
 */
export function saveSpeciesSyncOverrides(overrides, meta = {}) {
  if (typeof window === 'undefined' || !window.localStorage) return;
  if (!overrides || typeof overrides !== 'object') return;
  try {
    window.localStorage.setItem(SPECIES_SYNC_STORAGE_KEY, JSON.stringify(overrides));
    const syncMeta = {
      timestamp: meta.timestamp || Date.now(),
      updatedCount: meta.updatedCount ?? Object.keys(overrides).length,
      namesUpdated: meta.namesUpdated ?? 0,
      totalSpecies: meta.totalSpecies ?? Object.keys(overrides).length,
      storedSearchUrl: meta.storedSearchUrl || DEFAULT_AO_STORED_SEARCH_URL,
    };
    window.localStorage.setItem(SPECIES_SYNC_META_KEY, JSON.stringify(syncMeta));
    resetSpeciesCaches();
  } catch (e) {
    console.warn('Kunne ikkje lagre synkroniserte artsdata i localStorage:', e);
  }
}

/**
 * Tøm lokalt synkroniseringslager for artsdata.
 */
export function clearSpeciesSyncCache() {
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.removeItem(SPECIES_SYNC_STORAGE_KEY);
      window.localStorage.removeItem(SPECIES_SYNC_META_KEY);
    } catch {
      // Ignorer localStorage-feil
    }
  }
  resetSpeciesCaches();
}

/**
 * Flett inn lokale synkroniseringsdata (antallFunn, nynorsk/bokmål-namn og taxonId)
 * i ei artsliste.
 *
 * @param {Array<object>} speciesList
 * @param {Record<string, object>|null} overrides
 * @returns {Array<object>}
 */
export function applySpeciesSyncOverrides(speciesList, overrides) {
  if (!Array.isArray(speciesList)) return [];
  if (!overrides || typeof overrides !== 'object' || Object.keys(overrides).length === 0) {
    return speciesList;
  }

  const normalizeLatin = (s) =>
    String(s || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');

  const matchedKeys = new Set();

  const applyToEntry = (entry) => {
    const latinKey = normalizeLatin(entry.latin || entry.latinName);
    if (!latinKey) return entry;
    const ov = overrides[latinKey];
    if (!ov) return entry;
    matchedKeys.add(latinKey);

    const updated = { ...entry };
    if (typeof ov.antallFunn === 'number' && !Number.isNaN(ov.antallFunn)) {
      updated.antallFunn = ov.antallFunn;
    }
    if (ov.id !== undefined) {
      updated.id = ov.id;
      updated.taxonId = ov.taxonId ?? ov.id;
    }
    if (ov.nameNob) {
      updated.nameNob = ov.nameNob;
      if (!updated.norwegian || updated.norwegian === 'nan') {
        updated.norwegian = ov.nameNob;
      }
    }
    if (ov.nameNno) {
      updated.nameNno = ov.nameNno;
      updated.nynorsk = ov.nameNno;
    }
    if (ov.latinName && !updated.latinName) {
      updated.latinName = ov.latinName;
    }
    return updated;
  };

  const merged = speciesList.map((art) => {
    const updatedArt = applyToEntry(art);
    if (Array.isArray(updatedArt.subspecies) && updatedArt.subspecies.length > 0) {
      updatedArt.subspecies = updatedArt.subspecies.map((sub) => applyToEntry(sub));
    }
    return updatedArt;
  });

  // Legg til nye hovedartar frå overrides (t.d. rødstrupetrost / raudstrupetrast) dersom dei manglar i lista
  for (const [latinKey, ov] of Object.entries(overrides)) {
    if (matchedKeys.has(latinKey)) continue;
    // Kun hovedartar (2 ord i vitskapleg namn)
    const latinStr = ov.latinName || latinKey;
    if (latinStr.trim().split(/\s+/).length === 2 && ov.nameNob) {
      merged.push({
        id: ov.id ?? ov.taxonId,
        taxonId: ov.taxonId ?? ov.id,
        norwegian: ov.nameNob,
        nameNob: ov.nameNob,
        nynorsk: ov.nameNno || null,
        nameNno: ov.nameNno || null,
        latin: latinStr,
        latinName: latinStr,
        antallFunn: typeof ov.antallFunn === 'number' ? ov.antallFunn : 0,
        subspecies: [],
      });
    }
  }

  return merged;
}

export async function loadOfflineSpecies() {
  if (offlineSpecies) return offlineSpecies;
  let loaded = null;
  try {
    const resp = await fetch('/data/norske_arter.json');
    loaded = await resp.json();
  } catch {
    loaded = INITIAL_SPECIES_SEED.map((item) => ({ ...item }));
  }

  const overrides = getSpeciesSyncOverrides();
  offlineSpecies = overrides ? applySpeciesSyncOverrides(loaded, overrides) : loaded;
  return offlineSpecies;
}

function getDefaultUserLanguage(explicitLanguage) {
  if (explicitLanguage !== undefined && explicitLanguage !== null && explicitLanguage !== '') {
    return explicitLanguage;
  }
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      return window.localStorage.getItem('nynorsk_artsnavn_v1') === '1' ? 'nn' : 'nb';
    } catch {
      return 'nb';
    }
  }
  return 'nb';
}

function validNorwegian(subNorwegian, mainNorwegian) {
  if (subNorwegian && subNorwegian !== 'nan') return subNorwegian;
  if (mainNorwegian && mainNorwegian !== 'nan') return mainNorwegian;
  return '';
}

function buildCandidateEntry(item, fallbackNorwegian, isSub, parentArt = null) {
  const taxonName = validNorwegian(item.norwegian || item.nameNob, fallbackNorwegian);
  if (!taxonName) return null;

  const scientificName = item.latin || item.latinName || '';

  let nynorsk = item.nynorsk || item.nameNno || null;
  let nameNob = item.nameNob;
  let nameNno = item.nameNno;

  if (isSub) {
    const derivedNno = deriveSubspeciesNynorskName(item, parentArt);
    const derivedNob = deriveSubspeciesBokmalName(item, parentArt);
    if (derivedNno) {
      nynorsk = derivedNno;
      nameNno = derivedNno;
    }
    if (derivedNob && !nameNob) {
      nameNob = derivedNob;
    }
  } else if (!nameNno && (taxonName || nameNob)) {
    const trans = translateDedicatedSubspeciesToNynorsk(taxonName || nameNob);
    if (trans && trans.toLowerCase() !== (taxonName || nameNob).toLowerCase()) {
      nynorsk = trans;
      nameNno = trans;
    }
  }

  const entry = {
    taxonName,
    // Kun kosmetisk hint i dropdownen - ALDRI det som lagres/sendes til AO.
    nynorsk,
    scientificName,
    source: 'offline',
    isSub,
  };

  if (item.id !== undefined || item.taxonId !== undefined) {
    entry.id = item.id ?? item.taxonId;
    entry.taxonId = item.taxonId ?? item.id;
  } else if (!isSub) {
    entry.id = scientificName || taxonName;
  }

  if (isSub) {
    const parentId =
      item.parentId ??
      parentArt?.id ??
      parentArt?.taxonId ??
      parentArt?.latin ??
      parentArt?.latinName ??
      parentArt?.norwegian;
    if (parentId !== undefined && parentId !== null) {
      entry.parentId = parentId;
    }
  }

  if (nameNob !== undefined) {
    entry.nameNob = nameNob;
  }
  if (nameNno !== undefined) {
    entry.nameNno = nameNno;
  }
  if (item.latinName !== undefined) {
    entry.latinName = item.latinName;
  }
  if (typeof item.antallFunn === 'number' && !Number.isNaN(item.antallFunn)) {
    entry.antallFunn = item.antallFunn;
  }

  return entry;
}

/**
 * Søk i offline-listen (støtter hovedart/underart via parentId, bruker poengmodell og tie-breaker)
 * @param {string} term
 * @param {boolean} [includeSubtaxa=false]
 * @param {string|boolean} [userLanguage]
 * @returns {Promise<Array<{taxonName:string,nynorsk:string|null,scientificName:string,source:string,isSub:boolean,parentId?:number|string,nameNno?:string|null,nameNob?:string,antallFunn?:number}>>}
 */
export async function searchOfflineSpecies(term, includeSubtaxa = false, userLanguage = undefined) {
  const list = await loadOfflineSpecies();
  const q = (term || '').trim().toLowerCase();
  if (q.length < 2) return [];

  const activeLang = getDefaultUserLanguage(userLanguage);
  const candidates = [];

  for (const art of list) {
    const mainEntry = buildCandidateEntry(art, '', false, null);
    if (!mainEntry) continue;

    candidates.push(mainEntry);

    if (includeSubtaxa && Array.isArray(art.subspecies) && art.subspecies.length > 0) {
      for (const sub of art.subspecies) {
        const subEntry = buildCandidateEntry(sub, art.norwegian || art.nameNob, true, art);
        if (subEntry) {
          subEntry.parentId = sub.parentId ?? mainEntry.id ?? mainEntry.taxonId;
          candidates.push(subEntry);
        }
      }
    }
  }

  // Sorter, koble underartar via parentId og filtrer via felles poengmodell og tie-breaker
  const ranked = searchSpecies(q, candidates, activeLang);

  // Begrens til 15 treff for å unngå lang, støyete liste
  return ranked.slice(0, 15);
}

async function buildLatinToNynorskIndex() {
  if (latinToNynorskIndex) return latinToNynorskIndex;
  const list = await loadOfflineSpecies();
  const index = new Map();
  for (const art of list) {
    const latin = art.latin || art.latinName;
    const nn = art.nynorsk || art.nameNno;
    if (latin && nn) index.set(latin.toLowerCase(), nn);
    if (Array.isArray(art.subspecies)) {
      for (const sub of art.subspecies) {
        const subNn = deriveSubspeciesNynorskName(sub, art) || sub.nynorsk || sub.nameNno;
        if (!subNn) continue;
        if (sub.latin) index.set(sub.latin.toLowerCase(), subNn);
        if (sub.latinName) index.set(sub.latinName.toLowerCase(), subNn);
      }
    }
  }
  latinToNynorskIndex = index;
  return index;
}

async function buildSpeciesMetaIndex() {
  if (speciesMetaIndex) return speciesMetaIndex;
  const list = await loadOfflineSpecies();
  const byLatin = new Map();
  const byNob = new Map();
  const byId = new Map();

  for (const art of list) {
    const latin = art.latin || art.latinName;
    const nob = art.norwegian || art.nameNob;
    const artId = art.id ?? art.taxonId;
    let artNno = art.nynorsk || art.nameNno || null;
    if (!artNno && nob && nob !== 'nan') {
      const trans = translateDedicatedSubspeciesToNynorsk(nob);
      if (trans && trans.toLowerCase() !== nob.toLowerCase()) {
        artNno = trans;
      }
    }
    const meta = {
      id: artId,
      taxonId: art.taxonId ?? art.id,
      isSub: false,
      nameNob: nob && nob !== 'nan' ? nob : null,
      nameNno: artNno,
      nynorsk: artNno,
      latinName: art.latinName || art.latin || null,
      antallFunn: typeof art.antallFunn === 'number' ? art.antallFunn : undefined,
    };
    if (artId !== undefined && artId !== null) {
      byId.set(String(artId), meta);
    }
    if (latin) byLatin.set(latin.trim().toLowerCase(), meta);
    if (nob && nob !== 'nan') {
      byNob.set(nob.trim().toLowerCase(), meta);
    }
    if (Array.isArray(art.subspecies)) {
      for (const sub of art.subspecies) {
        const subLatin = sub.latin || sub.latinName;
        const subLatinFull = sub.latinName || sub.latin;
        const subNno = deriveSubspeciesNynorskName(sub, art) || sub.nynorsk || sub.nameNno || null;
        const subNob = deriveSubspeciesBokmalName(sub, art) || sub.nameNob || sub.norwegian || null;
        const subParentId = sub.parentId ?? artId;
        const subMeta = {
          id: sub.id ?? sub.taxonId,
          taxonId: sub.taxonId ?? sub.id,
          parentId: subParentId,
          isSub: true,
          nameNob: subNob && subNob !== 'nan' ? subNob : null,
          nameNno: subNno,
          nynorsk: subNno,
          latinName: subLatinFull || null,
          antallFunn: typeof sub.antallFunn === 'number' ? sub.antallFunn : undefined,
        };
        if (subLatin) byLatin.set(subLatin.trim().toLowerCase(), subMeta);
        if (subLatinFull) byLatin.set(subLatinFull.trim().toLowerCase(), subMeta);
        if (sub.norwegian && sub.norwegian !== 'nan') {
          byNob.set(sub.norwegian.trim().toLowerCase(), subMeta);
        }
        if (subNob && subNob !== 'nan') {
          byNob.set(subNob.trim().toLowerCase(), subMeta);
        }
      }
    }
  }

  speciesMetaIndex = { byLatin, byNob, byId };
  return speciesMetaIndex;
}

/**
 * Slå opp nynorsk artsnavn for et vitenskapelig navn (case-insensitiv eksakt
 * match). AOs eget søk har aldri nynorsk-data selv - denne brukes til å
 * berike de ONLINE søkeresultatene med samme nynorsk-data som offline-lista,
 * slik at nynorsk-innstillingen faktisk virker i vanlig søk (ikke bare når
 * "Tving offline arts-søk" også er slått på - se species-search.js).
 * @param {string} latinName
 * @returns {Promise<string|null>}
 */
export async function getNynorskByLatin(latinName) {
  if (!latinName) return null;
  const cleaned = latinName
    .replace(/<[^>]+>/g, '')
    .replace(/\b(?:subsp|ssp)\.?\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const index = await buildLatinToNynorskIndex();
  const direct = index.get(cleaned.toLowerCase());
  if (direct) return direct;

  // Hvis det er ein underart (3 ord, t.d. "Turdus iliacus iliacus"), utlei "[nynorsk], underarten [epitet]"
  const words = cleaned.split(/\s+/);
  if (words.length >= 3) {
    const parentBinomial = `${words[0]} ${words[1]}`.toLowerCase();
    const parentNno = index.get(parentBinomial);
    const epithet = words[words.length - 1].toLowerCase();
    if (parentNno && epithet) {
      return `${parentNno}, underarten ${epithet}`;
    }
  }
  return null;
}

/**
 * Hent lokal metadata (nynorsk, parentId, isSub og antallFunn) for ein art eller underart
 * basert på vitskapleg namn eller bokmålsnamn.
 * @param {string} [latinName]
 * @param {string} [norwegianName]
 * @returns {Promise<{id?: number, taxonId?: number, parentId?: number|string, isSub?: boolean, nameNob?: string|null, nameNno?: string|null, nynorsk: string|null, antallFunn?: number}>}
 */
export async function getSpeciesMeta(latinName, norwegianName) {
  const { byLatin, byNob, byId } = await buildSpeciesMetaIndex();
  const cleanLatin = (latinName || '')
    .replace(/<[^>]+>/g, '')
    .replace(/\b(?:subsp|ssp)\.?\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  const cleanNob = (norwegianName || '').trim().toLowerCase();

  const latinWords = cleanLatin.split(/\s+/).filter(Boolean);
  const parentLatinKey = latinWords.length >= 2 ? `${latinWords[0]} ${latinWords[1]}` : '';
  const parentNobKey = cleanNob.includes(', underarten')
    ? cleanNob.split(', underarten')[0].trim()
    : '';

  const resolveParentMeta = (hitParentId) =>
    (hitParentId !== undefined && hitParentId !== null && byId.get(String(hitParentId))) ||
    (parentLatinKey && byLatin.get(parentLatinKey)) ||
    (parentNobKey && byNob.get(parentNobKey)) ||
    null;

  let hit = null;
  if (cleanLatin) {
    hit = byLatin.get(cleanLatin) || null;
  }
  if (!hit && cleanNob) {
    hit = byNob.get(cleanNob) || null;
  }

  if (hit) {
    if (hit.isSub && norwegianName) {
      const parentMeta = resolveParentMeta(hit.parentId);
      const derivedNno = deriveSubspeciesNynorskName(
        {
          taxonName: norwegianName,
          nameNob: hit.nameNob,
          nameNno: hit.nameNno,
          latinName: latinName || hit.latinName,
        },
        parentMeta
      );
      if (derivedNno) {
        return {
          ...hit,
          nameNno: derivedNno,
          nynorsk: derivedNno,
        };
      }
    } else if (!hit.nameNno && (hit.nameNob || norwegianName)) {
      const trans = translateDedicatedSubspeciesToNynorsk(hit.nameNob || norwegianName);
      if (trans && trans.toLowerCase() !== (hit.nameNob || norwegianName).toLowerCase()) {
        return {
          ...hit,
          nameNno: trans,
          nynorsk: trans,
        };
      }
    }
    return hit;
  }

  // Fallback for underartar frå AO som ikkje ligg direkte i norske_arter.json
  const isSubFromInput =
    /\b(?:subsp|ssp)\b/i.test(latinName || '') ||
    /,\s*underarten\s+/i.test(norwegianName || '') ||
    (latinWords.length >= 3 && !/\s+x\s+/i.test(latinName || ''));

  if (isSubFromInput) {
    const parentMeta = resolveParentMeta(null);
    if (parentMeta) {
      const derivedNno = deriveSubspeciesNynorskName(
        {
          taxonName: norwegianName || '',
          nameNob: norwegianName || '',
          latinName: latinName || '',
        },
        parentMeta
      );
      const derivedNob = deriveSubspeciesBokmalName(
        {
          taxonName: norwegianName || '',
          nameNob: norwegianName || '',
          latinName: latinName || '',
        },
        parentMeta
      );
      return {
        id: undefined,
        taxonId: undefined,
        parentId: parentMeta.taxonId ?? parentMeta.id,
        isSub: true,
        nameNob: derivedNob || norwegianName || null,
        nameNno: derivedNno || null,
        nynorsk: derivedNno || null,
        antallFunn: undefined,
      };
    }
  }

  // Dersom det er eit dedikert underartsnamn eller hybrid som ikkje hadde treff i indeksen,
  // omset eventuelle bokmålsord (t.d. "sørlig" -> "sørleg")
  if (norwegianName) {
    const translated = translateDedicatedSubspeciesToNynorsk(norwegianName);
    if (translated && translated.toLowerCase() !== cleanNob) {
      return {
        nynorsk: translated,
        nameNno: translated,
        nameNob: norwegianName,
        antallFunn: undefined,
      };
    }
  }

  return { nynorsk: null, antallFunn: undefined };
}

/**
 * Finn bokmålsnavn for arter der SØKETERMEN matcher et nynorsk navn (prefiks
 * eller delstreng). AOs eget søk forstår ikke nynorsk-termer på underarter
 * (t.d. gir søk på "raudveng" kun hovedarten rødvingetrost, uten underarter) -
 * denne brukes til å oversette en nynorsk søketerm til bokmål FØR søket sendes
 * til AO, slik at man finner arten og underartene uansett målform man skriver i.
 * @param {string} term
 * @returns {Promise<string[]>}
 */
export async function findBokmalByNynorskTerm(term) {
  const q = (term || '').trim().toLowerCase();
  if (q.length < 2) return [];
  const list = await loadOfflineSpecies();
  const matches = new Set();
  for (const art of list) {
    const nn = (art.nynorsk || art.nameNno || '').toLowerCase();
    const nob = art.norwegian || art.nameNob;
    if (nn && (nn.startsWith(q) || nn.includes(q)) && nob && nob !== 'nan') {
      matches.add(nob);
    }
    if (Array.isArray(art.subspecies)) {
      for (const sub of art.subspecies) {
        const snn = (
          deriveSubspeciesNynorskName(sub, art) ||
          sub.nynorsk ||
          sub.nameNno ||
          ''
        ).toLowerCase();
        const snob = sub.norwegian || sub.nameNob;
        if (snn && (snn.startsWith(q) || snn.includes(q))) {
          if (snob && snob !== 'nan' && !isGenericSubspeciesName(snob, nob)) {
            matches.add(snob);
          }
          if (nob && nob !== 'nan') {
            matches.add(nob);
          }
        }
      }
    }
  }

  // Spesialtilfelle der nynorsksøk skal finne bokmålsekvivalentar frå AO
  const specialNnoToNob = [
    [/^austgulerle/i, 'østgulerle'],
    [/^austempid/i, 'østempid'],
    [/^ub-?\s*gul-\/austgulerle/i, 'ub- gul-/østgulerle'],
    [/^gul-\/austgulerle/i, 'gul-/østgulerle'],
  ];
  for (const [re, nobTarget] of specialNnoToNob) {
    if (re.test(q) || 'austgulerle'.startsWith(q) && nobTarget === 'østgulerle' || 'austempid'.startsWith(q) && nobTarget === 'østempid') {
      matches.add(nobTarget);
    }
  }

  return [...matches];
}

/**
 * Synkroniseringsteneste (SpeciesSyncService):
 * Hentar oppdaterte antallFunn frå Artsobservasjonar og offisielle artsnamn
 * (bokmål og nynorsk) frå Artsdatabanken via backend-endepunktet /api/species-sync,
 * og oppdaterer det lokale offline-lageret.
 *
 * @param {object} [options]
 * @param {string} [options.storedSearchUrl] - AO ViewSpeciesList URL (standard: storedSearchCriterias=17138105)
 * @param {boolean} [options.enrichMissingNynorsk=true] - Hent manglande nynorsknamn frå Artsdatabanken
 * @param {number} [options.maxNameLookups=20] - Maks antall oppslag mot Artsdatabanken per synk
 * @param {typeof fetch} [options.fetchFn] - Valgfri fetch-funksjon (for testing)
 * @returns {Promise<{success: boolean, updatedCount?: number, namesUpdated?: number, totalSpecies?: number, timestamp?: number, error?: string}>}
 */
export async function syncSpeciesData(options = {}) {
  const {
    storedSearchUrl = DEFAULT_AO_STORED_SEARCH_URL,
    enrichMissingNynorsk = true,
    maxNameLookups = 20,
    fetchFn = typeof fetch !== 'undefined' ? fetch : null,
  } = options;

  if (!fetchFn) {
    return { success: false, error: 'Fetch er ikkje tilgjengeleg i dette miljøet' };
  }

  try {
    const resp = await fetchFn('/api/species-sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        storedSearchUrl,
        enrichMissingNynorsk,
        maxNameLookups,
      }),
    });

    if (!resp || !resp.ok) {
      return {
        success: false,
        error: `Synkronisering feila (HTTP ${resp ? resp.status : 'ukjent'})`,
      };
    }

    const data = await resp.json();
    if (!data || !data.success || !data.overrides) {
      return {
        success: false,
        error: (data && data.error) || 'Ugyldig svar frå synkroniseringstenesta',
      };
    }

    const timestamp = Date.now();
    saveSpeciesSyncOverrides(data.overrides, {
      timestamp,
      updatedCount: data.updatedCount ?? 0,
      namesUpdated: data.namesUpdated ?? 0,
      totalSpecies: data.totalSpecies ?? Object.keys(data.overrides).length,
      storedSearchUrl,
    });

    return {
      success: true,
      updatedCount: data.updatedCount ?? 0,
      namesUpdated: data.namesUpdated ?? 0,
      totalSpecies: data.totalSpecies ?? Object.keys(data.overrides).length,
      timestamp,
      overrides: data.overrides,
    };
  } catch (err) {
    return {
      success: false,
      error: err && err.message ? err.message : String(err),
    };
  }
}

/**
 * Sjekk om automatisk bakgrunnssynkronisering bør køyrast (på nett, WiFi/ikkje-mobildata-sparemodus,
 * og minst 7 dagar sidan siste synk).
 *
 * @param {object} [options]
 * @param {number} [options.maxAgeMs] - Maks alder på siste synk i ms (standard: 7 døgn)
 * @returns {boolean}
 */
export function shouldAutoSyncSpecies(options = {}) {
  const maxAgeMs = options.maxAgeMs ?? 7 * 24 * 60 * 60 * 1000;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return false;
  }

  // Sjekk Network Information API dersom tilgjengeleg
  if (typeof navigator !== 'undefined' && navigator.connection) {
    const conn = navigator.connection;
    if (conn.saveData) return false;
    if (conn.type && conn.type !== 'wifi' && conn.type !== 'ethernet' && conn.type !== 'unknown') {
      return false;
    }
  }

  const meta = getLastSpeciesSyncMeta();
  if (!meta || !meta.timestamp) return true;
  return Date.now() - meta.timestamp >= maxAgeMs;
}

/**
 * Køyr bakgrunnssynkronisering av artsdata dersom eininga er på WiFi/nett og
 * data ikkje nylig er synkroniserte.
 *
 * @param {object} [options]
 * @returns {Promise<{skipped?: boolean, success?: boolean}>}
 */
export async function autoSyncSpeciesIfEligible(options = {}) {
  if (!shouldAutoSyncSpecies(options)) {
    return { skipped: true };
  }
  return syncSpeciesData(options);
}

export const SpeciesSyncService = Object.freeze({
  syncSpeciesData,
  autoSyncSpeciesIfEligible,
  shouldAutoSyncSpecies,
  getLastSpeciesSyncMeta,
  getSpeciesSyncOverrides,
  saveSpeciesSyncOverrides,
  clearSpeciesSyncCache,
  applySpeciesSyncOverrides,
  INITIAL_SPECIES_SEED,
  DEFAULT_AO_STORED_SEARCH_URL,
});

