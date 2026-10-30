/**
 * Søke- og sorteringsalgoritme for artsnamn (Bokmål / Nynorsk / Vitskapleg namn).
 *
 * Implementerer poengmodell (Match Score) og frekvensbasert tie-breaker (antallFunn)
 * med alfabetisk fallback.
 */

/**
 * Datastruktur for ein art (Species) i søke- og sorteringsalgoritmen.
 * Støttar både kanoniske felt (id, nameNno, nameNob, latinName, antallFunn)
 * og eksisterande felt i appen (taxonId, nynorsk, taxonName/norwegian, scientificName/latin).
 *
 * @typedef {Object} Species
 * @property {string|number} [id] - Unik identifikator for arten (t.d. taxonId)
 * @property {string|null} [nameNno] - Artsnamn på nynorsk
 * @property {string|null} [nameNob] - Artsnamn på bokmål
 * @property {string|null} [latinName] - Vitskapleg (latinsk) namn
 * @property {number} [antallFunn] - Antall rapporterte funn i Noreg (valfritt; brukast som tie-breaker)
 * @property {string|number} [taxonId] - Eksisterande ID-felt fra AO
 * @property {string} [taxonName] - Eksisterande bokmålsfelt i appen (alias for nameNob)
 * @property {string} [norwegian] - Eksisterande bokmålsfelt i norske_arter.json (alias for nameNob)
 * @property {string|null} [nynorsk] - Eksisterande nynorskfelt i appen (alias for nameNno)
 * @property {string} [scientificName] - Eksisterande latinsk felt i appen (alias for latinName)
 * @property {string} [scientificNameHtml] - Eksisterande HTML-formatert latinsk felt fra AO
 * @property {string} [latin] - Eksisterande latinsk felt i norske_arter.json (alias for latinName)
 */

/**
 * Poengkonstantar for Match Score-hierarkiet.
 */
export const MATCH_SCORES = Object.freeze({
  EXACT_PRIMARY: 1000,
  EXACT_ALT: 900,
  PREFIX_PRIMARY: 800,
  PREFIX_ALT: 600,
  WORD_BOUNDARY_PRIMARY: 400,
  WORD_BOUNDARY_ALT: 200,
  LATIN_PREFIX: 150,
  LATIN_SUBSTRING: 100,
  NO_MATCH: 0,
});

/**
 * Avgjør om valt språk er nynorsk.
 * Støttar 'nn', 'nno', 'nynorsk' eller boolean true.
 *
 * @param {string|boolean} [userLanguage]
 * @returns {boolean}
 */
export function isNynorskLanguage(userLanguage) {
  if (typeof userLanguage === 'boolean') return userLanguage;
  if (userLanguage === undefined || userLanguage === null || userLanguage === '') {
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        const stored = window.localStorage.getItem('nynorsk_artsnavn_v1');
        if (stored === '1') return true;
        if (stored === '0') return false;
      } catch {
        // Ignorer feil ved tilgang til localStorage
      }
    }
    return true;
  }
  const normalized = String(userLanguage).trim().toLowerCase();
  return normalized === 'nn' || normalized === 'nno' || normalized === 'nynorsk';
}

/**
 * Rens og normaliser ein namnestreng (fjern HTML-taggar, 'nan' og ekstra mellomrom).
 *
 * @param {unknown} value
 * @returns {string}
 */
function normalizeName(value) {
  if (!value || typeof value !== 'string') return '';
  const cleaned = value.replace(/<[^>]+>/g, '').trim();
  if (!cleaned || cleaned.toLowerCase() === 'nan') return '';
  return cleaned;
}

/**
 * Hent nynorsknamn frå eit Species-objekt.
 *
 * @param {Species} species
 * @returns {string}
 */
export function getSpeciesNameNno(species) {
  if (!species || typeof species !== 'object') return '';
  const existing = normalizeName(species.nameNno ?? species.nynorsk ?? '');
  if (existing) return existing;
  const nob = normalizeName(species.nameNob ?? species.taxonName ?? species.norwegian ?? '');
  if (nob) {
    const trans = translateDedicatedSubspeciesToNynorsk(nob);
    if (trans && trans.toLowerCase() !== nob.toLowerCase()) {
      return trans;
    }
  }
  return '';
}

/**
 * Hent bokmålsnamn frå eit Species-objekt.
 *
 * @param {Species} species
 * @returns {string}
 */
export function getSpeciesNameNob(species) {
  if (!species || typeof species !== 'object') return '';
  return normalizeName(species.nameNob ?? species.taxonName ?? species.norwegian ?? '');
}

/**
 * Hent vitskapleg (latinsk) namn frå eit Species-objekt.
 *
 * @param {Species} species
 * @returns {string}
 */
export function getSpeciesLatinName(species) {
  if (!species || typeof species !== 'object') return '';
  return normalizeName(
    species.latinName ?? species.scientificName ?? species.scientificNameHtml ?? species.latin ?? ''
  );
}

/**
 * Trekk ut underartsepitetet (siste ledd i vitskapleg namn eller etter "underarten"/"ssp.")
 * for ein underart, t.d. "iliacus" frå "Turdus iliacus iliacus", "T. i. iliacus"
 * eller "rødvingetrost, underarten iliacus".
 *
 * @param {Species|string} speciesOrText
 * @returns {string}
 */
export function extractSubspeciesEpithet(speciesOrText) {
  if (!speciesOrText) return '';

  if (typeof speciesOrText === 'string') {
    const cleaned = normalizeName(speciesOrText);
    const underartMatch = cleaned.match(/,\s*underarten\s+([a-zæøå\-/]+)/i);
    if (underartMatch) return underartMatch[1].toLowerCase();
    const sspMatch = cleaned.match(/\b(?:subsp|ssp)\.?\s+([a-z\-/]+)/i);
    if (sspMatch) return sspMatch[1].toLowerCase();
    const words = cleaned
      .replace(/\b(?:subsp|ssp)\.?\b/gi, ' ')
      .trim()
      .split(/\s+/)
      .map((w) => w.replace(/^\.+|\.+$/g, ''))
      .filter(Boolean);
    if (words.length >= 3) {
      return words[words.length - 1].toLowerCase();
    }
    return '';
  }

  const latin = getSpeciesLatinName(speciesOrText);
  if (latin) {
    const sspMatch = latin.match(/\b(?:subsp|ssp)\.?\s+([a-z\-/]+)/i);
    if (sspMatch) return sspMatch[1].toLowerCase();
    const words = latin
      .replace(/\b(?:subsp|ssp)\.?\b/gi, ' ')
      .trim()
      .split(/\s+/)
      .map((w) => w.replace(/^\.+|\.+$/g, ''))
      .filter(Boolean);
    if (words.length >= 3) {
      return words[words.length - 1].toLowerCase();
    }
  }

  const nob = getSpeciesNameNob(speciesOrText);
  if (nob) {
    const underartMatch = nob.match(/,\s*underarten\s+([a-zæøå\-/]+)/i);
    if (underartMatch) return underartMatch[1].toLowerCase();
    const sspMatch = nob.match(/\b(?:subsp|ssp)\.?\s+([a-z\-/]+)/i);
    if (sspMatch) return sspMatch[1].toLowerCase();
  }

  return '';
}

/**
 * Sjekk om eit underartsnamn er generisk (ikkje eit dedikert særnamn som "svartryggerle" eller "såerle").
 * Eit underartsnamn er generisk dersom det:
 * - manglar eller er "nan"
 * - er identisk med hovudarten sitt namn
 * - inneheld ", underarten ", "ssp.", "subsp." eller "nominat-"
 *
 * @param {string} subNob
 * @param {string} [parentNob]
 * @returns {boolean}
 */
export function isGenericSubspeciesName(subNob, parentNob = '') {
  const s = normalizeName(subNob).toLowerCase();
  if (!s) return true;
  const p = normalizeName(parentNob).toLowerCase();
  if (p && s === p) return true;
  if (
    /,\s*underarten\s+/i.test(s) ||
    /\b(?:subsp|ssp)\.?\s+/i.test(s) ||
    /\bnominat[\-\s]/i.test(s)
  ) {
    return true;
  }
  return false;
}

/**
 * Omset bokmålsord/ledd i eit dedikert underartsnamn til nynorsk (t.d. "sørlig gulerle" -> "sørleg gulerle",
 * "svartryggerle" -> "svartryggerle", "såerle" -> "såerle").
 *
 * @param {string} subNob
 * @param {string} [parentNob]
 * @param {string} [parentNno]
 * @returns {string}
 */
export function translateDedicatedSubspeciesToNynorsk(subNob, parentNob = '', parentNno = '') {
  let res = normalizeName(subNob);
  if (!res) return '';

  const pNob = normalizeName(parentNob);
  const pNno = normalizeName(parentNno);

  // Dersom underartsnamnet inneheld hovudarten sitt bokmålsnamn (og nynorsknamnet er ulikt), bytt det ut
  if (pNob && pNno && pNob.toLowerCase() !== pNno.toLowerCase()) {
    const escapedParent = pNob.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const parentRegex = new RegExp(escapedParent, 'gi');
    res = res.replace(parentRegex, (match) => {
      const isCap = match[0] === match[0].toUpperCase() && match[0] !== match[0].toLowerCase();
      return isCap ? pNno.charAt(0).toUpperCase() + pNno.slice(1) : pNno;
    });
  }

  // Eksplisitte spesialtilfelle der algoritmen feilar:
  // - østgulerle –> austgulerle
  // - østempid –> austempid
  // - ub- gul-/østgulerle –> ub- gul-/austgulerle
  // Merk: \b i standard JS regexp reknar ikkje 'ø' som ordteikn. Vi brukar difor
  // eksplisitte norske ordgrenser (^|[^\wæøåÆØÅ]).
  const specialReplacements = [
    [/(^|[^\wæøåÆØÅ])(ub-?\s*gul-\/østgulerle)(?=[^\wæøåÆØÅ]|$)/gi, 'ub- gul-/austgulerle'],
    [/(^|[^\wæøåÆØÅ])(gul-\/østgulerle)(?=[^\wæøåÆØÅ]|$)/gi, 'gul-/austgulerle'],
    [/(^|[^\wæøåÆØÅ])(østgulerle)(?=[^\wæøåÆØÅ]|$)/gi, 'austgulerle'],
    [/(^|[^\wæøåÆØÅ])(østempid)(?=[^\wæøåÆØÅ]|$)/gi, 'austempid'],
  ];

  for (const [regex, replacement] of specialReplacements) {
    res = res.replace(regex, (match, prefix, word) => {
      const isCap = word[0] === word[0].toUpperCase() && word[0] !== word[0].toLowerCase();
      const repl = isCap ? replacement.charAt(0).toUpperCase() + replacement.slice(1) : replacement;
      return prefix + repl;
    });
  }

  // Spesifikke bokmålsord/-ledd i dedikerte underartsnamn -> nynorsk
  const wordReplacements = [
    [/\bsørlig\b/gi, 'sørleg'],
    [/\bnordlig\b/gi, 'nordleg'],
    [/(^|[^\wæøåÆØÅ])(østlig)(?=[^\wæøåÆØÅ]|$)/gi, 'austleg'],
    [/\bvestlig\b/gi, 'vestleg'],
    [/\bsvarthodet\b/gi, 'svarthovuda'],
    [/\bsvartbuket\b/gi, 'svartbuka'],
    [/\bmørkbuket\b/gi, 'mørkbuka'],
    [/\blysbuket\b/gi, 'lysbuka'],
    [/\bmørkbrystet\b/gi, 'mørkbrysta'],
    [/svarthode/gi, 'svarthovud'],
    [/gråhode/gi, 'gråhovud'],
    [/brunhode/gi, 'brunhovud'],
    [/rød/gi, 'raud'],
    [/måke/gi, 'måse'],
    [/sanger/gi, 'songar'],
    [/varsler/gi, 'varslar'],
    [/trost/gi, 'trast'],
    [/spurv/gi, 'sporv'],
    [/\bbro-\//gi, 'bru-/'],
    [/gulnese-/gi, 'gulnase-'],
  ];

  for (const [regex, replacement] of wordReplacements) {
    res = res.replace(regex, (match, prefix, word) => {
      const hasGroup = typeof prefix === 'string';
      const targetWord = hasGroup && word !== undefined ? word : match;
      const isCap = targetWord[0] === targetWord[0].toUpperCase() && targetWord[0] !== targetWord[0].toLowerCase();
      const repl = isCap ? replacement.charAt(0).toUpperCase() + replacement.slice(1) : replacement;
      return hasGroup ? prefix + repl : repl;
    });
  }

  return res;
}

/**
 * Generer eller hent nynorsk visningsnamn for ein underart:
 * - Dersom underarten har eit dedikert namn (t.d. "svartryggerle", "såerle", "sørlig gulerle"),
 *   vert det dedikerte namnet teke vare på, med eventuelle bokmålsord omsette til nynorsk
 *   (t.d. "sørlig gulerle" -> "sørleg gulerle").
 * - Dersom underarten har eit generisk namn (t.d. "rødvingetrost, underarten coburni", "nan",
 *   "ssp." eller "nominat-..."), brukast alltid formatet: "[artsnamn på nynorsk], underarten [underartsnamn]".
 *
 * @param {Species} subspecies
 * @param {Species} [parentSpecies]
 * @returns {string}
 */
export function deriveSubspeciesNynorskName(subspecies, parentSpecies = null) {
  if (!subspecies || typeof subspecies !== 'object') return '';

  const parentNno = normalizeName(
    parentSpecies?.nameNno ??
      parentSpecies?.nynorsk ??
      subspecies.parentNameNno ??
      ''
  );
  const parentNob = normalizeName(
    parentSpecies?.nameNob ??
      parentSpecies?.taxonName ??
      parentSpecies?.norwegian ??
      subspecies.parentNameNob ??
      ''
  );

  // Bruk taxonName dersom tilgjengeleg (frå AO), elles norwegian/nameNob
  const primaryNob = normalizeName(
    subspecies.taxonName ?? subspecies.nameNob ?? subspecies.norwegian ?? ''
  );
  const existingNno = getSpeciesNameNno(subspecies);
  const epithet = extractSubspeciesEpithet(subspecies);

  // 1. Dersom underarten har eit dedikert særnamn (ikkje ", underarten ...", "ssp.", "nominat-..." eller "nan"):
  if (primaryNob && !isGenericSubspeciesName(primaryNob, parentNob)) {
    return translateDedicatedSubspeciesToNynorsk(primaryNob, parentNob, parentNno);
  }

  // 2. Dersom existingNno er eit dedikert særnamn (ikkje ", underarten ..." eller "nominat-...")
  //    og ikkje berre hovudarten sitt namn:
  if (
    existingNno &&
    !isGenericSubspeciesName(existingNno, parentNno || parentNob)
  ) {
    return translateDedicatedSubspeciesToNynorsk(existingNno, parentNob, parentNno);
  }

  // 3. Generisk underart -> "[artsnamn på nynorsk], underarten [underartsnamn]"
  const effectiveParentNno = parentNno || existingNno || parentNob;
  if (effectiveParentNno && epithet) {
    const baseParentNno = effectiveParentNno.split(',')[0].replace(/^nominat[\-\s]+/i, '').trim();
    return `${baseParentNno}, underarten ${epithet}`;
  }

  return existingNno || '';
}

/**
 * Generer eller hent bokmål visningsnamn for ein underart.
 *
 * @param {Species} subspecies
 * @param {Species} [parentSpecies]
 * @returns {string}
 */
export function deriveSubspeciesBokmalName(subspecies, parentSpecies = null) {
  if (!subspecies || typeof subspecies !== 'object') return '';

  const parentNob = normalizeName(
    parentSpecies?.nameNob ??
      parentSpecies?.taxonName ??
      parentSpecies?.norwegian ??
      subspecies.parentNameNob ??
      ''
  );
  const existingNob = getSpeciesNameNob(subspecies);
  const epithet = extractSubspeciesEpithet(subspecies);

  if (
    (!existingNob ||
      (parentNob && existingNob.toLowerCase() === parentNob.toLowerCase()) ||
      /\bnominat[\-\s]/i.test(existingNob)) &&
    parentNob &&
    epithet
  ) {
    return `${parentNob}, underarten ${epithet}`;
  }

  return existingNob || parentNob || '';
}

/**
 * Sjekk om eit Species-objekt representerer ein underart.
 *
 * @param {Species} species
 * @returns {boolean}
 */
export function isSubspeciesItem(species) {
  if (!species || typeof species !== 'object') return false;
  if (species.isSub === true) return true;
  if (species.parentId !== undefined && species.parentId !== null && species.parentId !== '') {
    return true;
  }
  return false;
}

/**
 * Sjekk om søkeordet treff på ei eksplisitt ordgrense (etter mellomrom, bindestrek eller skråstrek).
 *
 * @param {string} textLower
 * @param {string} queryLower
 * @returns {boolean}
 */
function hasExplicitWordBoundary(textLower, queryLower) {
  if (!textLower || !queryLower) return false;
  const parts = textLower.split(/[\s\-/(),.]+/);
  return parts.some((part) => part.startsWith(queryLower));
}

/**
 * Sjekk om søkeordet treff på ei ordgrense eller som delord i eit samansett artsnamn
 * (t.d. "stilk" i "raudstilk", "terne" i "raudnebbterne", eller "løvmeis" i "nordlig løvmeis").
 *
 * Merk: Eksakt match og prefiks-match vert sjekka før denne funksjonen.
 *
 * @param {string} nameLower
 * @param {string} queryLower
 * @returns {boolean}
 */
function matchesWordBoundaryOrCompound(nameLower, queryLower) {
  if (!nameLower || !queryLower) return false;
  if (hasExplicitWordBoundary(nameLower, queryLower)) return true;
  return nameLower.includes(queryLower);
}

/**
 * Berekn Match Score for ein enkelt art basert på søkeord og valt visningsspråk.
 *
 * Poengskala:
 * - 1000: Eksakt match på visningsspråk
 * -  900: Eksakt match på alternativt språk
 * -  800: Prefiks-match på visningsspråk (startar med query)
 * -  600: Prefiks-match på alternativt språk (startar med query)
 * -  400: Ordgrense-/delord-match på visningsspråk
 * -  200: Ordgrense-/delord-match på alternativt språk
 * -  150: Prefiks-/ordgrense-match på vitskapleg namn (latinName)
 * -  100: Delstreng-match på vitskapleg namn (latinName)
 * -    0: Ingen match (ekskluderast frå resultatlista)
 *
 * @param {string} query - Søketerm frå brukaren
 * @param {Species} species - Artsobjekt
 * @param {string|boolean} [userLanguage='nn'] - Valt visningsspråk ('nn'/'nno' eller 'nb'/'nob')
 * @returns {number} Match Score
 */
export function calculateSpeciesScore(query, species, userLanguage = 'nn') {
  const q = String(query || '').trim().toLowerCase();
  if (!q || !species || typeof species !== 'object') {
    return MATCH_SCORES.NO_MATCH;
  }

  const useNynorsk = isNynorskLanguage(userLanguage);
  const nameNno = getSpeciesNameNno(species).toLowerCase();
  const nameNob = getSpeciesNameNob(species).toLowerCase();
  const latinName = getSpeciesLatinName(species).toLowerCase();

  const primaryName = useNynorsk ? nameNno : nameNob;
  const altName = useNynorsk ? nameNob : nameNno;

  // 1. 1000 poeng – Eksakt match på visningsspråk
  if (primaryName && primaryName === q) {
    return MATCH_SCORES.EXACT_PRIMARY;
  }

  // 2. 900 poeng – Eksakt match på alternativt språk
  if (altName && altName === q) {
    return MATCH_SCORES.EXACT_ALT;
  }

  // 3. 800 poeng – Prefiks-match på visningsspråk
  if (primaryName && primaryName.startsWith(q)) {
    return MATCH_SCORES.PREFIX_PRIMARY;
  }

  // 4. 600 poeng – Prefiks-match på alternativt språk
  if (altName && altName.startsWith(q)) {
    return MATCH_SCORES.PREFIX_ALT;
  }

  // 5. 400 poeng – Ordgrense-match på visningsspråk
  if (primaryName && matchesWordBoundaryOrCompound(primaryName, q)) {
    return MATCH_SCORES.WORD_BOUNDARY_PRIMARY;
  }

  // 6. 200 poeng – Ordgrense-match på alternativt språk
  if (altName && matchesWordBoundaryOrCompound(altName, q)) {
    return MATCH_SCORES.WORD_BOUNDARY_ALT;
  }

  // 7. Vitskapleg namn (latinName) med lågare prioritet enn norske artsnamn
  if (latinName) {
    if (latinName === q || latinName.startsWith(q) || hasExplicitWordBoundary(latinName, q)) {
      return MATCH_SCORES.LATIN_PREFIX;
    }
    if (latinName.includes(q)) {
      return MATCH_SCORES.LATIN_SUBSTRING;
    }
  }

  // 8. 0 poeng – Ingen ordgrense-treff
  return MATCH_SCORES.NO_MATCH;
}

/**
 * Sjekk om eit Species-objekt representerer ein hybrid (t.d. "svartryggerle x linerle").
 *
 * @param {Species} species
 * @returns {boolean}
 */
export function isHybridItem(species) {
  if (!species || typeof species !== 'object') return false;
  const nob = getSpeciesNameNob(species);
  const latin = getSpeciesLatinName(species);
  return /\s+x\s+/i.test(nob) || /\s+x\s+/i.test(latin);
}

/**
 * Terskler for sjeldenhetsgruppene under. Tallene er antall rapporterte funn
 * i hele Norge, gjennom hele Artsobservasjoners levetid.
 */
export const VANLIG_GRENSE = 1000;
export const UVANLIG_GRENSE = 100;

/**
 * Plasser en art i en grov sjeldenhetsgruppe: 0 = vanlig, 1 = uvanlig, 2 = sjelden.
 *
 * Hvorfor grupper og ikke sortering på antallFunn direkte:
 *
 * 1. Problemet som skal løses er IKKE å rangere etter sjeldenhet - det er å
 *    hindre at en art med ett eneste norsk funn ligger øverst der man lett
 *    bommer. Søk på «grå» ga gråflankefluesnapper (2 funn) og gråhodealbatross
 *    (1 funn) over gråmåke (595 150) og gråtrost (417 766), fordi siste
 *    sorteringstrinn var alfabetisk. Innenfor en gruppe spiller rekkefølgen
 *    liten rolle - gråmåke eller gråtrost først er like plausibelt.
 *
 * 2. Gruppa er en grovsortering, ikke hele rangeringen: innenfor samme gruppe
 *    sorteres det videre på antallFunn, slik at den mest sannsynlige arten
 *    ligger øverst. Gruppa sikrer bare at en streiffugl aldri kan klatre dit,
 *    uansett hvor få funn de andre treffene har.
 *
 * 3. Grupper gjør at nasjonale tall holder regionalt. En art som er
 *    hverdagsfugl et sted i Norge har alltid et høyt nasjonalt tall - lappmeis
 *    (2 836), polarsvømmesnipe (3 939) og stellerand (4 085) ligger alle trygt
 *    i «vanlig». Artene under terskelen er sjeldne overalt (snøugle 180,
 *    kornspurv 170, dvergterne 184), ikke bare utenfor sin egen landsdel.
 *    Hadde vi sortert på tallet direkte, ville en finnmarking fått lappspurv
 *    langt nede bak sørlige hagefugler.
 *
 * Tersklene følger et reelt skille i dataene: 292 arter har under 100 funn,
 * 208 har over 10 000, og dalen mellom er tynn.
 *
 * Art uten antallFunn (f.eks. et AO-treff som ikke finnes i offline-lista)
 * regnes som vanlig. Å gjette «sjelden» ville skjult en art vi bare mangler
 * tall for.
 *
 * @param {Species} species
 * @returns {0|1|2}
 */
export function funntall(species) {
  return species && typeof species.antallFunn === 'number' && !Number.isNaN(species.antallFunn)
    ? species.antallFunn
    : null;
}

export function sjeldenhetsgruppe(species) {
  const funn = funntall(species);
  if (funn === null) return 0;
  if (funn >= VANLIG_GRENSE) return 0;
  if (funn >= UVANLIG_GRENSE) return 1;
  return 2;
}

function compareScoredEntries(a, b, useNynorsk) {
  // 1. Høgste Match Score vinn
  if (b.score !== a.score) {
    return b.score - a.score;
  }

  // 2. Reine artar/underartar skal alltid liggje føre hybridar ("... x ...") ved lik poengsum
  const aHybrid = isHybridItem(a.species);
  const bHybrid = isHybridItem(b.species);
  if (aHybrid !== bHybrid) {
    return aHybrid ? 1 : -1;
  }

  // 3a. Sjeldenhetsgruppe: supersjeldne arter skal aldri ligge øverst, uansett
  //     hvor mange funn de nest sjeldneste har. Se sjeldenhetsgruppe().
  const aGruppe = sjeldenhetsgruppe(a.species);
  const bGruppe = sjeldenhetsgruppe(b.species);
  if (aGruppe !== bGruppe) {
    return aGruppe - bGruppe;
  }

  // 3b. Innenfor samme gruppe: flest funn først, altså den arten brukeren
  //     mest sannsynlig mener. Trygt her, fordi gruppa over allerede har
  //     skilt ut streiffuglene - dette sammenligner bare arter som er
  //     omtrent like plausible å få øye på.
  const aFunn = funntall(a.species) ?? 0;
  const bFunn = funntall(b.species) ?? 0;
  if (bFunn !== aFunn) {
    return bFunn - aFunn;
  }

  // 4. Hvis begge er ikkje-hybrid, prioriter hovedart føre underart ved lik score
  const aSub = isSubspeciesItem(a.species);
  const bSub = isSubspeciesItem(b.species);
  if (aSub !== bSub) {
    return aSub ? 1 : -1;
  }

  // 5. Fallback: Alfabetisk sortering på visningsnamn (norsk)
  const aNno = getSpeciesNameNno(a.species);
  const aNob = getSpeciesNameNob(a.species);
  const bNno = getSpeciesNameNno(b.species);
  const bNob = getSpeciesNameNob(b.species);

  const aDisplay = (useNynorsk ? aNno || aNob : aNob || aNno) || getSpeciesLatinName(a.species);
  const bDisplay = (useNynorsk ? bNno || bNob : bNob || bNno) || getSpeciesLatinName(b.species);

  return aDisplay.toLowerCase().localeCompare(bDisplay.toLowerCase(), 'nb');
}

/**
 * Søk og ranger artar basert på poengmodellen (Match Score), relasjonskobling via parentId
 * for underartar, og tie-breaker (antallFunn -> alfabetisk).
 *
 * Når ein hovudart får treff (score > 0), vert alle underartar i speciesList som har
 * parentId lik hovudarten sin id / taxonId automatisk inkluderte og grupperte direkte
 * under hovudarten — uavhengig av om søket matcha nameNno, nameNob eller latinName.
 *
 * @param {string} query - Søketerm frå brukaren
 * @param {Array<Species>} speciesList - Liste med artar (og eventuelt underartar)
 * @param {string|boolean} [userLanguage='nn'] - Valt visningsspråk ('nn'/'nno' eller 'nb'/'nob')
 * @returns {Array<Species>} Filtrert og ferdig sortert liste med artar
 */
export function searchSpecies(query, speciesList, userLanguage = 'nn') {
  const q = String(query || '').trim().toLowerCase();
  if (!q || !Array.isArray(speciesList) || speciesList.length === 0) {
    return [];
  }

  const useNynorsk = isNynorskLanguage(userLanguage);

  // Indekser alle hovudartar på ID (id / taxonId) slik at underartar kan koblast via parentId
  const mainSpeciesById = new Map();
  const mainEntries = [];
  const subEntries = [];

  for (const item of speciesList) {
    if (!item || typeof item !== 'object') continue;
    if (isSubspeciesItem(item)) {
      subEntries.push(item);
    } else {
      mainEntries.push(item);
      const rawId = item.id ?? item.taxonId;
      if (rawId !== undefined && rawId !== null && rawId !== '') {
        mainSpeciesById.set(String(rawId), item);
      }
    }
  }

  // 1. Poengsett hovudartar
  const scoredTopLevel = [];
  const matchedParentIds = new Set();

  for (const mainSpecies of mainEntries) {
    if (!mainSpecies.nameNno && !mainSpecies.nynorsk) {
      const nob = getSpeciesNameNob(mainSpecies);
      if (nob) {
        const trans = translateDedicatedSubspeciesToNynorsk(nob);
        if (trans && trans.toLowerCase() !== nob.toLowerCase()) {
          mainSpecies.nameNno = trans;
          mainSpecies.nynorsk = trans;
        }
      }
    }

    const score = calculateSpeciesScore(q, mainSpecies, useNynorsk);
    if (score > MATCH_SCORES.NO_MATCH) {
      scoredTopLevel.push({ species: mainSpecies, score });
      const rawId = mainSpecies.id ?? mainSpecies.taxonId;
      if (rawId !== undefined && rawId !== null && rawId !== '') {
        matchedParentIds.add(String(rawId));
      }
    }
  }

  // 2. Handter underartar: koble til hovudart via parentId (eller poengsett direkte hvis hovudart ikkje traff)
  const linkedSubsByParentId = new Map();

  for (const sub of subEntries) {
    const parentKey =
      sub.parentId !== undefined && sub.parentId !== null && sub.parentId !== ''
        ? String(sub.parentId)
        : null;
    const parentObj = parentKey ? mainSpeciesById.get(parentKey) || null : null;

    // Sikre at underarten har nynorsk og bokmål visningsnamn
    const derivedNno = deriveSubspeciesNynorskName(sub, parentObj);
    const derivedNob = deriveSubspeciesBokmalName(sub, parentObj);
    if (derivedNno) {
      sub.nameNno = derivedNno;
      sub.nynorsk = derivedNno;
    }
    if (derivedNob && !sub.nameNob) {
      sub.nameNob = derivedNob;
    }

    const subScore = calculateSpeciesScore(q, sub, useNynorsk);

    if (parentKey && matchedParentIds.has(parentKey)) {
      if (!linkedSubsByParentId.has(parentKey)) {
        linkedSubsByParentId.set(parentKey, []);
      }
      linkedSubsByParentId.get(parentKey).push({ species: sub, score: subScore });
    } else if (subScore > MATCH_SCORES.NO_MATCH) {
      scoredTopLevel.push({ species: sub, score: subScore });
    }
  }

  // 3. Sorter toppnivå (hovudartar + frittståande underartar)
  scoredTopLevel.sort((a, b) => compareScoredEntries(a, b, useNynorsk));

  // 4. Bygg resultatliste med tilhøyrande underartar grupperte direkte under kvar sin hovudart
  const result = [];
  for (const entry of scoredTopLevel) {
    result.push(entry.species);

    if (!isSubspeciesItem(entry.species)) {
      const rawId = entry.species.id ?? entry.species.taxonId;
      const parentKey = rawId !== undefined && rawId !== null && rawId !== '' ? String(rawId) : null;
      if (parentKey && linkedSubsByParentId.has(parentKey)) {
        const subs = linkedSubsByParentId.get(parentKey);
        subs.sort((a, b) => compareScoredEntries(a, b, useNynorsk));
        for (const subEntry of subs) {
          result.push(subEntry.species);
        }
      }
    }
  }

  return result;
}

