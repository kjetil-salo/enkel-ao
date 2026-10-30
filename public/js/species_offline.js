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
} from './species-matcher.js?v=v1.59.2';

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

let offlineSpecies = null;
let latinToNynorskIndex = null;
let speciesMetaIndex = null;

export async function loadOfflineSpecies() {
  if (offlineSpecies) return offlineSpecies;
  const resp = await fetch('/data/norske_arter.json');
  offlineSpecies = await resp.json();
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
