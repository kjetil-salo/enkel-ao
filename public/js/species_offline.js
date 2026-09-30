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
    // Søk i hovedart. Nynorsk-feltet søkes alltid, uavhengig av
    // visningsinnstillingen - en bruker som har slått på nynorsk skal kunne
    // FINNE arten ved å skrive det nynorske navnet, ikke bare se det.
    const n = art.norwegian && art.norwegian !== 'nan' ? art.norwegian.toLowerCase() : '';
    const nn = art.nynorsk ? art.nynorsk.toLowerCase() : '';
    const l = art.latin ? art.latin.toLowerCase() : '';
    let match = n.startsWith(q) || n.includes(q) || nn.startsWith(q) || nn.includes(q) || l.startsWith(q) || l.includes(q);
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
        const snn = sub.nynorsk ? sub.nynorsk.toLowerCase() : '';
        const sl = sub.latin ? sub.latin.toLowerCase() : '';
        let subMatch = sn.startsWith(q) || sn.includes(q) || snn.startsWith(q) || snn.includes(q) || sl.startsWith(q) || sl.includes(q);
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

  // Sorter: norsk (bokmål ELLER nynorsk) starter med > latin starter med >
  // norsk inneholder > latin inneholder. Nynorsk telles med i "norsk" her -
  // et eksakt nynorsk-prefikstreff (f.eks. "raudstrupe") skal ikke rangeres
  // dårligere enn et bokmål-prefikstreff bare fordi taxonName er bokmål.
  filtered.sort((a, b) => {
    const aName = a.taxonName.toLowerCase();
    const bName = b.taxonName.toLowerCase();
    const aNn = (a.nynorsk || '').toLowerCase();
    const bNn = (b.nynorsk || '').toLowerCase();
    const aLatin = (a.scientificName || '').toLowerCase();
    const bLatin = (b.scientificName || '').toLowerCase();

    const aStartsNorsk = aName.startsWith(q) || aNn.startsWith(q);
    const bStartsNorsk = bName.startsWith(q) || bNn.startsWith(q);
    if (aStartsNorsk && !bStartsNorsk) return -1;
    if (!aStartsNorsk && bStartsNorsk) return 1;

    const aStartsLatin = aLatin.startsWith(q);
    const bStartsLatin = bLatin.startsWith(q);
    if (aStartsLatin && !bStartsLatin) return -1;
    if (!aStartsLatin && bStartsLatin) return 1;

    const aContainsNorsk = aName.includes(q) || aNn.includes(q);
    const bContainsNorsk = bName.includes(q) || bNn.includes(q);
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

/**
 * Finn bokmålsnavn for arter der SØKETERMEN matcher et nynorsk navn (prefiks
 * eller delstreng). AOs eget søk forstår ikke nynorsk-termer i det hele tatt
 * (Kjetil: "søker jeg på raudstrupe får jeg null resultat") - denne brukes
 * til å oversette en nynorsk søketerm til bokmål FØR søket sendes til AO,
 * slik at man finner arten uansett hvilket målform man skriver i. Returnerer
 * unike bokmålsnavn (kan i prinsippet være flere ved tvetydig prefiks).
 * @param {string} term
 * @returns {Promise<string[]>}
 */
export async function findBokmalByNynorskTerm(term) {
  const q = (term || '').trim().toLowerCase();
  if (q.length < 2) return [];
  const list = await loadOfflineSpecies();
  const matches = new Set();
  for (const art of list) {
    const nn = art.nynorsk ? art.nynorsk.toLowerCase() : '';
    if (nn && (nn.startsWith(q) || nn.includes(q)) && art.norwegian && art.norwegian !== 'nan') {
      matches.add(art.norwegian);
    }
    if (Array.isArray(art.subspecies)) {
      for (const sub of art.subspecies) {
        const snn = sub.nynorsk ? sub.nynorsk.toLowerCase() : '';
        if (snn && (snn.startsWith(q) || snn.includes(q))) {
          const name = (sub.norwegian && sub.norwegian !== 'nan') ? sub.norwegian : art.norwegian;
          if (name && name !== 'nan') matches.add(name);
        }
      }
    }
  }
  return [...matches];
}
