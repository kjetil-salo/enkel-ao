import { describe, it, expect } from 'vitest';
import {
  searchSpecies,
  calculateSpeciesScore,
  deriveSubspeciesNynorskName,
  translateDedicatedSubspeciesToNynorsk,
  MATCH_SCORES,
} from '../../public/js/species-matcher.js';
import { speciesDisplayName } from '../../public/js/storage.js';

/**
 * Testdatasett med norske fugleartar (både nynorsk, bokmål, vitskapleg namn og antallFunn).
 */
const sampleSpeciesList = [
  {
    id: 1,
    nameNno: 'stare',
    nameNob: 'stær',
    latinName: 'Sturnus vulgaris',
    antallFunn: 420000,
  },
  {
    id: 2,
    nameNno: 'storrsongar',
    nameNob: 'starrsanger',
    latinName: 'Helopsaltes certhiola',
    antallFunn: 25,
  },
  {
    id: 3,
    nameNno: 'rosenstare',
    nameNob: 'rosenstær',
    latinName: 'Pastor roseus',
    antallFunn: 450,
  },
  {
    id: 4,
    nameNno: 'raudstrupe',
    nameNob: 'rødstrupe',
    latinName: 'Erithacus rubecula',
    antallFunn: 380000,
  },
  {
    id: 5,
    nameNno: 'raudstrupesnipe',
    nameNob: 'rødstrupesnipe',
    latinName: 'Calidris ruficollis',
    antallFunn: 15,
  },
  {
    id: 6,
    nameNno: 'raudhalsgås',
    nameNob: 'rødhalsgås',
    latinName: 'Branta ruficollis',
    antallFunn: 310,
  },
  {
    id: 7,
    nameNno: 'raudstilk',
    nameNob: 'rødstilk',
    latinName: 'Tringa totanus',
    antallFunn: 290000,
  },
  {
    id: 8,
    nameNno: 'raudnebbterne',
    nameNob: 'rødnebbterne',
    latinName: 'Sterna paradisaea',
    antallFunn: 210000,
  },
  {
    id: 9,
    nameNno: 'isabellavarslar',
    nameNob: 'isabellavarsler',
    latinName: 'Lanius isabellinus',
    antallFunn: 12,
  },
  {
    id: 10,
    nameNno: 'svartraudstjert',
    nameNob: 'svartrødstjert',
    latinName: 'Phoenicurus ochruros',
    antallFunn: 14000,
  },
];

describe('calculateSpeciesScore – Poengmodell (Match Score)', () => {
  it('gir 1000 poeng for eksakt match på visningsspråk', () => {
    const stare = sampleSpeciesList[0];
    expect(calculateSpeciesScore('stare', stare, 'nn')).toBe(MATCH_SCORES.EXACT_PRIMARY); // 1000
    expect(calculateSpeciesScore('stær', stare, 'nb')).toBe(MATCH_SCORES.EXACT_PRIMARY); // 1000
  });

  it('gir 900 poeng for eksakt match på alternativt språk', () => {
    const starrsanger = sampleSpeciesList[1];
    // Appen står på nynorsk ('nn'), brukaren skriv bokmålsnamnet 'starrsanger'
    expect(calculateSpeciesScore('starrsanger', starrsanger, 'nn')).toBe(MATCH_SCORES.EXACT_ALT); // 900
    // Appen står på bokmål ('nb'), brukaren skriv nynorsknamnet 'stare'
    expect(calculateSpeciesScore('stare', sampleSpeciesList[0], 'nb')).toBe(MATCH_SCORES.EXACT_ALT); // 900
  });

  it('gir 800 poeng for prefiks-match på visningsspråk', () => {
    const stare = sampleSpeciesList[0];
    expect(calculateSpeciesScore('star', stare, 'nn')).toBe(MATCH_SCORES.PREFIX_PRIMARY); // 800
  });

  it('gir 600 poeng for prefiks-match på alternativt språk', () => {
    const starrsanger = sampleSpeciesList[1];
    expect(calculateSpeciesScore('star', starrsanger, 'nn')).toBe(MATCH_SCORES.PREFIX_ALT); // 600
  });

  it('gir 400 poeng for ordgrense-/delord-match på visningsspråk', () => {
    const raudstilk = sampleSpeciesList[6];
    expect(calculateSpeciesScore('stilk', raudstilk, 'nn')).toBe(MATCH_SCORES.WORD_BOUNDARY_PRIMARY); // 400
  });

  it('gir 200 poeng for ordgrense-/delord-match på alternativt språk', () => {
    const rosenstare = sampleSpeciesList[2]; // nameNno: 'rosenstare', nameNob: 'rosenstær'
    // Når visningsspråk er bokmål ('nb'), treff 'stare' som delord i alternativt språk ('rosenstare')
    expect(calculateSpeciesScore('stare', rosenstare, 'nb')).toBe(MATCH_SCORES.WORD_BOUNDARY_ALT); // 200
  });

  it('gir 0 poeng for urelaterte artar (som isabellavarsler ved søk på "raud")', () => {
    const isabellavarsler = sampleSpeciesList[8];
    expect(calculateSpeciesScore('raud', isabellavarsler, 'nn')).toBe(MATCH_SCORES.NO_MATCH); // 0
    expect(calculateSpeciesScore('raud', isabellavarsler, 'nb')).toBe(MATCH_SCORES.NO_MATCH); // 0
  });

  it('støttar søk på vitskapleg namn (latinName) med lågare poeng enn norske namn', () => {
    const stare = sampleSpeciesList[0];
    expect(calculateSpeciesScore('sturnus', stare, 'nn')).toBe(MATCH_SCORES.LATIN_PREFIX); // 150
    expect(calculateSpeciesScore('vulgaris', stare, 'nn')).toBe(MATCH_SCORES.LATIN_PREFIX); // 150
  });
});

describe('searchSpecies – Krav frå Steg 1', () => {
  it('Krav 1: Søk på "star" gir "stare" øvst (ikkje "starrsanger")', () => {
    const results = searchSpecies('star', sampleSpeciesList, 'nn');
    expect(results.length).toBeGreaterThanOrEqual(2);
    expect(results[0].nameNno).toBe('stare');
    // starrsanger (600p) skal liggje bak stare (800p), og føre rosenstare (400p)
    const names = results.map((s) => s.nameNno);
    expect(names).toEqual(['stare', 'storrsongar', 'rosenstare']);
  });

  it('Krav 2: Søk på "raudstrupe" gir "raudstrupe" som #1 (framfor "raudstrupesnipe")', () => {
    // Selv om raudstrupesnipe ligg før eller etter i rålista, skal eksakt match (1000p) alltid vinne over prefiks (800p)
    const reversedList = [...sampleSpeciesList].reverse();
    const resultsNno = searchSpecies('raudstrupe', reversedList, 'nn');
    expect(resultsNno[0].nameNno).toBe('raudstrupe');
    expect(resultsNno[1].nameNno).toBe('raudstrupesnipe');

    // Også når brukaren har bokmål som visningsspråk og søkjer på nynorsk 'raudstrupe' (900p vs 600p)
    const resultsNob = searchSpecies('raudstrupe', reversedList, 'nb');
    expect(resultsNob[0].nameNno).toBe('raudstrupe');
  });

  it('Krav 3: Søk på "raud" sorterer vanlege artar øvst (via antallFunn) og gir 0 treff på "isabellavarsler"', () => {
    const results = searchSpecies('raud', sampleSpeciesList, 'nn');
    const names = results.map((s) => s.nameNno);

    // isabellavarsler skal ALDRI vere med i resultatlista
    expect(names).not.toContain('isabellavarslar');
    expect(results.some((s) => s.nameNob === 'isabellavarsler')).toBe(false);

    // Alle 800-poengs prefiks-treff (raudstrupe: 380k, raudstilk: 290k, raudnebbterne: 210k, raudhalsgås: 310, raudstrupesnipe: 15)
    // skal sorterast etter antallFunn synkande, og delord-treff (svartraudstjert: 400p) til slutt
    expect(names).toEqual([
      'raudstrupe',
      'raudstilk',
      'raudnebbterne',
      'raudhalsgås',
      'raudstrupesnipe',
      'svartraudstjert',
    ]);
  });

  it('Tie-breaker: Fell tilbake på norsk alfabetisk sortering når antallFunn manglar eller er lik', () => {
    const listWithoutFunn = [
      { id: 1, nameNno: 'raudstrupesnipe', nameNob: 'rødstrupesnipe', latinName: 'Calidris ruficollis' },
      { id: 2, nameNno: 'raudhalsgås', nameNob: 'rødhalsgås', latinName: 'Branta ruficollis' },
      { id: 3, nameNno: 'raudstilk', nameNob: 'rødstilk', latinName: 'Tringa totanus' },
      { id: 4, nameNno: 'raudnebbterne', nameNob: 'rødnebbterne', latinName: 'Sterna paradisaea' },
    ];

    const results = searchSpecies('raud', listWithoutFunn, 'nn');
    expect(results.map((s) => s.nameNno)).toEqual([
      'raudhalsgås',
      'raudnebbterne',
      'raudstilk',
      'raudstrupesnipe',
    ]);
  });
});

describe('Steg 2 – Integrasjon med offline-databasen (norske_arter.json) og antallFunn', () => {
  it('har antallFunn og raudstrupetrast/rødstrupetrost i norske_arter.json og sorterer vanlege artar øvst på "raud"', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const filePath = path.resolve(process.cwd(), 'public/data/norske_arter.json');
    const realSpeciesList = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

    // Verifiser at rødstrupetrost / raudstrupetrast finst i offline-databasen
    const ruficollis = realSpeciesList.find((s) => s.latin === 'Turdus ruficollis');
    expect(ruficollis).toBeTruthy();
    expect(ruficollis.nameNno).toBe('raudstrupetrast');
    expect(ruficollis.nameNob).toBe('rødstrupetrost');
    expect(typeof ruficollis.antallFunn).toBe('number');

    // Søk på "raud" i full offline-database skal gje vanlege artar øvst og aldri treffe isabellavarsler
    const results = searchSpecies('raud', realSpeciesList, 'nn');
    expect(results.length).toBeGreaterThan(5);
    expect(results.some((s) => s.norwegian === 'isabellavarsler')).toBe(false);

    // Dei 5 øvste treffa på "raud" har alle 800p (prefiks på nynorsk) og skal liggje i synkande rekkefølgje etter antallFunn
    const top5 = results.slice(0, 5);
    for (let i = 1; i < top5.length; i++) {
      expect(top5[i - 1].antallFunn).toBeGreaterThanOrEqual(top5[i].antallFunn);
    }

    // Raudstilk og raudnebbterne skal liggje langt føre sjeldne artar som raudhalsgås, raudstrupesnipe og raudstrupetrast
    const namesNno = results.map((s) => s.nameNno || s.nynorsk);
    const idxRaudstrupe = namesNno.indexOf('raudstrupe');
    const idxRaudstilk = namesNno.indexOf('raudstilk');
    const idxRaudnebbterne = namesNno.indexOf('raudnebbterne');
    const idxRaudhalsgas = namesNno.indexOf('raudhalsgås');
    const idxRaudstrupesnipe = namesNno.indexOf('raudstrupesnipe');
    const idxRaudstrupetrast = namesNno.indexOf('raudstrupetrast');

    expect(idxRaudstrupe).toBe(0);
    expect(idxRaudstilk).toBeGreaterThan(0);
    expect(idxRaudstilk).toBeLessThan(idxRaudhalsgas);
    expect(idxRaudnebbterne).toBeLessThan(idxRaudhalsgas);
    expect(idxRaudhalsgas).toBeLessThan(idxRaudstrupesnipe);
    expect(idxRaudstrupesnipe).toBeLessThan(idxRaudstrupetrast);
  });
});

describe('Underartar med nynorsk og relasjonskobling via parentId', () => {
  const turdusWithSubspecies = [
    {
      id: 4547,
      taxonId: '4547',
      nameNno: 'raudvengtrast',
      nynorsk: 'raudvengtrast',
      nameNob: 'rødvingetrost',
      taxonName: 'rødvingetrost',
      latinName: 'Turdus iliacus',
      scientificName: 'Turdus iliacus',
      antallFunn: 310000,
    },
    {
      id: 4548,
      taxonId: '4548',
      parentId: 4547,
      isSub: true,
      // Simuler at underart manglar dedikert nynorsk-felt på førehand (som fra AO PickerSearch)
      nameNob: 'rødvingetrost, underarten coburni',
      taxonName: 'rødvingetrost, underarten coburni',
      latinName: 'Turdus iliacus coburni',
      scientificName: 'Turdus iliacus subsp. coburni',
      antallFunn: 310000,
    },
    {
      id: 4549,
      taxonId: '4549',
      parentId: 4547,
      isSub: true,
      // Simuler eldre bokmålsform 'rødvingetrost, nominat-rødvingetrost'
      nameNob: 'rødvingetrost, nominat-rødvingetrost',
      taxonName: 'rødvingetrost, underarten iliacus',
      latinName: 'Turdus iliacus iliacus',
      scientificName: 'Turdus iliacus subsp. iliacus',
      antallFunn: 310000,
    },
  ];

  it('Problem 1: Søk på nynorsk artsnamn ("raudvengtrast") hentar alle underartar via parentId og viser dei på nynorsk', () => {
    const results = searchSpecies('raudvengtrast', turdusWithSubspecies, 'nn');
    expect(results).toHaveLength(3);

    // Hovudart øvst, deretter underartane gruppert rett under
    expect(results[0].id).toBe(4547);
    expect(speciesDisplayName(results[0], 'nn')).toBe('raudvengtrast');

    const subDisplayNames = results.slice(1).map((s) => speciesDisplayName(s, 'nn'));
    expect(subDisplayNames).toEqual([
      'raudvengtrast, underarten coburni',
      'raudvengtrast, underarten iliacus',
    ]);
  });

  it('Problem 2: Søk på bokmålsnamn ("rødvingetrost") når appen står på nynorsk viser underartar med nynorske namn', () => {
    const results = searchSpecies('rødvingetrost', turdusWithSubspecies, 'nn');
    expect(results).toHaveLength(3);

    expect(speciesDisplayName(results[0], 'nn')).toBe('raudvengtrast');
    expect(speciesDisplayName(results[1], 'nn')).toBe('raudvengtrast, underarten coburni');
    expect(speciesDisplayName(results[2], 'nn')).toBe('raudvengtrast, underarten iliacus');

    // Samstundes skal taxonName halde fram med å vere bokmål for innsending til AO
    expect(results[1].taxonName).toBe('rødvingetrost, underarten coburni');
    expect(results[2].taxonName).toBe('rødvingetrost, underarten iliacus');
  });

  it('brukar alltid formatet "[artsnamn på nynorsk], underarten [underartsnamn]" for generiske underartar og aldri "nominat-..."', () => {
    const parent = {
      id: 4547,
      nameNno: 'raudvengtrast',
      nameNob: 'rødvingetrost',
      latinName: 'Turdus iliacus',
    };
    const subNominat = {
      parentId: 4547,
      isSub: true,
      norwegian: 'rødvingetrost, nominat-rødvingetrost',
      latin: 'Turdus iliacus iliacus',
    };
    const derived = deriveSubspeciesNynorskName(subNominat, parent);
    expect(derived).toBe('raudvengtrast, underarten iliacus');
    expect(derived).not.toContain('nominat');
  });

  it('tek vare på dedikerte underartsnamn (svartryggerle, såerle) og omset bokmålsord (sørlig gulerle -> sørleg gulerle)', () => {
    const linerle = {
      id: 4332,
      nameNno: 'linerle',
      nameNob: 'linerle',
      latinName: 'Motacilla alba',
    };
    const gulerle = {
      id: 4340,
      nameNno: 'gulerle',
      nameNob: 'gulerle',
      latinName: 'Motacilla flava',
    };

    const svartryggerle = {
      id: 4335,
      parentId: 4332,
      isSub: true,
      taxonName: 'svartryggerle',
      latinName: 'Motacilla alba yarrellii',
    };
    const hybrid = {
      id: 1100902,
      isSub: false,
      taxonName: 'svartryggerle x linerle',
      latinName: 'Motacilla a. yarellii x M. a. alba',
    };
    const saerle = {
      id: 4344,
      parentId: 4340,
      isSub: true,
      taxonName: 'såerle',
      latinName: 'Motacilla flava thunbergi',
    };
    const sorligGulerle = {
      id: 4342,
      parentId: 4340,
      isSub: true,
      taxonName: 'sørlig gulerle',
      latinName: 'Motacilla flava flava',
    };

    expect(deriveSubspeciesNynorskName(svartryggerle, linerle)).toBe('svartryggerle');
    expect(deriveSubspeciesNynorskName(saerle, gulerle)).toBe('såerle');
    expect(deriveSubspeciesNynorskName(sorligGulerle, gulerle)).toBe('sørleg gulerle');

    // Søk på "svartry" skal vise "svartryggerle" som #1 føre hybriden "svartryggerle x linerle",
    // og ALDRI "linerle, underarten yarrellii"
    const resSvartry = searchSpecies('svartry', [hybrid, svartryggerle], 'nn');
    expect(resSvartry.map((s) => speciesDisplayName(s, 'nn'))).toEqual([
      'svartryggerle',
      'svartryggerle x linerle',
    ]);

    // Søk på "sørlig gulerle" eller "sørleg gulerle" skal vise "sørleg gulerle" på nynorsk
    const resSorlig = searchSpecies('sørlig gulerle', [sorligGulerle], 'nn');
    expect(speciesDisplayName(resSorlig[0], 'nn')).toBe('sørleg gulerle');
    const resSorleg = searchSpecies('sørleg gulerle', [sorligGulerle], 'nn');
    expect(speciesDisplayName(resSorleg[0], 'nn')).toBe('sørleg gulerle');
  });

  it('omset spesialtilfella østgulerle -> austgulerle, østempid -> austempid og ub- gul-/østgulerle -> ub- gul-/austgulerle', () => {
    // 1. Enhetstestar for omsetjingsfunksjonen
    expect(translateDedicatedSubspeciesToNynorsk('østgulerle')).toBe('austgulerle');
    expect(translateDedicatedSubspeciesToNynorsk('Østgulerle')).toBe('Austgulerle');
    expect(translateDedicatedSubspeciesToNynorsk('østempid')).toBe('austempid');
    expect(translateDedicatedSubspeciesToNynorsk('Østempid')).toBe('Austempid');
    expect(translateDedicatedSubspeciesToNynorsk('ub- gul-/østgulerle')).toBe('ub- gul-/austgulerle');
    expect(translateDedicatedSubspeciesToNynorsk('Ub- gul-/østgulerle')).toBe('Ub- gul-/austgulerle');
    expect(translateDedicatedSubspeciesToNynorsk('ub-gul-/østgulerle')).toBe('ub- gul-/austgulerle');
    expect(translateDedicatedSubspeciesToNynorsk('gul-/østgulerle')).toBe('gul-/austgulerle');
    expect(translateDedicatedSubspeciesToNynorsk('østgulerle, underarten plexa/tschutschensis')).toBe(
      'austgulerle, underarten plexa/tschutschensis'
    );

    // 2. Visningsnamn via speciesDisplayName
    expect(speciesDisplayName({ taxonName: 'østgulerle' }, 'nn')).toBe('austgulerle');
    expect(speciesDisplayName({ taxonName: 'østempid' }, 'nn')).toBe('austempid');
    expect(speciesDisplayName({ taxonName: 'ub- gul-/østgulerle' }, 'nn')).toBe('ub- gul-/austgulerle');
    // Bokmål skal framleis vise bokmålsnamnet
    expect(speciesDisplayName({ taxonName: 'østgulerle' }, 'nb')).toBe('østgulerle');
    expect(speciesDisplayName({ taxonName: 'østempid' }, 'nb')).toBe('østempid');
    expect(speciesDisplayName({ taxonName: 'ub- gul-/østgulerle' }, 'nb')).toBe('ub- gul-/østgulerle');

    // 3. Søk i Nynorsk-modus
    const ostgulerle = {
      id: 186469,
      nameNob: 'østgulerle',
      nameNno: 'austgulerle',
      latinName: 'Motacilla tschutschensis',
    };
    const ostgulerleSub = {
      id: 186470,
      parentId: 186469,
      isSub: true,
      nameNob: 'østgulerle, underarten plexa/tschutschensis',
      nameNno: 'austgulerle, underarten plexa/tschutschensis',
      latinName: 'Motacilla tschutschensis plexa/tschutschensis',
    };
    const ostempid = {
      id: 9991,
      taxonName: 'østempid',
      latinName: 'Empidonax virescens',
    };
    const ubGulerle = {
      id: 9992,
      taxonName: 'ub- gul-/østgulerle',
      latinName: 'Motacilla flava / tschutschensis',
    };

    // Søk på "austgulerle" og "østgulerle" i nn-modus skal begge gje "austgulerle" og underarten
    const resAustgul = searchSpecies('austgulerle', [ostgulerle, ostgulerleSub], 'nn');
    expect(resAustgul.map((s) => speciesDisplayName(s, 'nn'))).toEqual([
      'austgulerle',
      'austgulerle, underarten plexa/tschutschensis',
    ]);

    const resOstgul = searchSpecies('østgulerle', [ostgulerle, ostgulerleSub], 'nn');
    expect(resOstgul.map((s) => speciesDisplayName(s, 'nn'))).toEqual([
      'austgulerle',
      'austgulerle, underarten plexa/tschutschensis',
    ]);

    // Søk på "austempid" og "østempid" skal finne østempid og vise som "austempid" i nn-modus
    const resAustemp = searchSpecies('austempid', [ostempid], 'nn');
    expect(resAustemp.length).toBe(1);
    expect(speciesDisplayName(resAustemp[0], 'nn')).toBe('austempid');

    const resOstemp = searchSpecies('østempid', [ostempid], 'nn');
    expect(resOstemp.length).toBe(1);
    expect(speciesDisplayName(resOstemp[0], 'nn')).toBe('austempid');

    // Søk på "ub- gul-/austgulerle" og "ub- gul-/østgulerle"
    const resUbAust = searchSpecies('ub- gul-/austgulerle', [ubGulerle], 'nn');
    expect(resUbAust.length).toBe(1);
    expect(speciesDisplayName(resUbAust[0], 'nn')).toBe('ub- gul-/austgulerle');

    const resUbOst = searchSpecies('ub- gul-/østgulerle', [ubGulerle], 'nn');
    expect(resUbOst.length).toBe(1);
    expect(speciesDisplayName(resUbOst[0], 'nn')).toBe('ub- gul-/austgulerle');
  });
});




