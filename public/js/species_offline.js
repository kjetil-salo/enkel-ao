// Offline fallback for norske fuglearter
// Generert fra Norgeslisten (kun art/underart, ikke grupper)

let offlineSpecies = null;

export async function loadOfflineSpecies() {
  if (offlineSpecies) return offlineSpecies;
  const resp = await fetch('/data/norske_arter.json');
  offlineSpecies = await resp.json();
  return offlineSpecies;
}


/**
 * Søk i offline-listen (støtter hovedart/underart, følger online-logikk)
 * @param {string} term
 * @param {boolean} includeSubtaxa
 * @returns {Promise<Array<{taxonName:string,scientificName:string,source:string}>>}
 */
export async function searchOfflineSpecies(term, includeSubtaxa = false) {
  const list = await loadOfflineSpecies();
  const q = term.trim().toLowerCase();
  if (q.length < 2) return [];
  const results = [];
  for (const art of list) {
    // Søk i hovedart
    const n = art.norwegian && art.norwegian !== 'nan' ? art.norwegian.toLowerCase() : '';
    const l = art.latin ? art.latin.toLowerCase() : '';
    let match = n.startsWith(q) || n.includes(q) || l.startsWith(q) || l.includes(q);
    // Helper for subspecies name fallback
    function validNorwegian(subNorwegian, mainNorwegian) {
      if (subNorwegian && subNorwegian !== 'nan') return subNorwegian;
      if (mainNorwegian && mainNorwegian !== 'nan') return mainNorwegian;
      return '';
    }
    if (match) {
      // Alltid vis hovedart hvis den matcher
      results.push({
        taxonName: validNorwegian(art.norwegian, ''),
        // Kun kosmetisk hint i dropdownen - ALDRI det som lagres/sendes til AO.
        // Underarter mangler nynorsk-oppslag foreløpig (se tools/enrich_nynorsk.py),
        // derfor ingen foreldre-fallback her slik validNorwegian() har for bokmål.
        nynorsk: art.nynorsk || null,
        scientificName: art.latin,
        source: 'offline',
        isSub: false
      });
      // Hvis includeSubtaxa og arten har underarter, vis ALLE underarter i tillegg
      if (includeSubtaxa && Array.isArray(art.subspecies) && art.subspecies.length > 0) {
        for (const sub of art.subspecies) {
          results.push({
            taxonName: validNorwegian(sub.norwegian, art.norwegian),
            nynorsk: sub.nynorsk || null,
            scientificName: sub.latin,
            source: 'offline',
            isSub: true
          });
        }
      }
    } else if (includeSubtaxa && Array.isArray(art.subspecies)) {
      for (const sub of art.subspecies) {
        const sn = sub.norwegian && sub.norwegian !== 'nan' ? sub.norwegian.toLowerCase() : '';
        const sl = sub.latin ? sub.latin.toLowerCase() : '';
        let subMatch = sn.startsWith(q) || sn.includes(q) || sl.startsWith(q) || sl.includes(q);
        if (subMatch) {
          results.push({
            taxonName: validNorwegian(sub.norwegian, art.norwegian),
            nynorsk: sub.nynorsk || null,
            scientificName: sub.latin,
            source: 'offline',
            isSub: true
          });
        }
      }
    }
  }
  // Filtrer ut resultater uten navn
  const filtered = results.filter(r => r.taxonName && r.taxonName !== 'nan');

  // Sorter: norsk starter med > latin starter med > norsk inneholder > latin inneholder
  filtered.sort((a, b) => {
    const aName = a.taxonName.toLowerCase();
    const bName = b.taxonName.toLowerCase();
    const aLatin = (a.scientificName || '').toLowerCase();
    const bLatin = (b.scientificName || '').toLowerCase();

    const aStartsNorsk = aName.startsWith(q);
    const bStartsNorsk = bName.startsWith(q);
    if (aStartsNorsk && !bStartsNorsk) return -1;
    if (!aStartsNorsk && bStartsNorsk) return 1;

    const aStartsLatin = aLatin.startsWith(q);
    const bStartsLatin = bLatin.startsWith(q);
    if (aStartsLatin && !bStartsLatin) return -1;
    if (!aStartsLatin && bStartsLatin) return 1;

    const aContainsNorsk = aName.includes(q);
    const bContainsNorsk = bName.includes(q);
    if (aContainsNorsk && !bContainsNorsk) return -1;
    if (!aContainsNorsk && bContainsNorsk) return 1;

    return aName.localeCompare(bName, 'nb');
  });

  // Begrens til 15 treff for å unngå lang, støyete liste
  return filtered.slice(0, 15);
}

let latinToNynorskIndex = null;

async function buildLatinToNynorskIndex() {
  if (latinToNynorskIndex) return latinToNynorskIndex;
  const list = await loadOfflineSpecies();
  const index = new Map();
  for (const art of list) {
    if (art.latin && art.nynorsk) index.set(art.latin.toLowerCase(), art.nynorsk);
    if (Array.isArray(art.subspecies)) {
      for (const sub of art.subspecies) {
        if (sub.latin && sub.nynorsk) index.set(sub.latin.toLowerCase(), sub.nynorsk);
      }
    }
  }
  latinToNynorskIndex = index;
  return index;
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
  const index = await buildLatinToNynorskIndex();
  return index.get(latinName.trim().toLowerCase()) || null;
}
