/**
 * Synkroniseringsteneste (SpeciesSyncService) for artsnamn (Bokmål/Nynorsk)
 * og registreringstal (antallFunn) frå Artsobservasjonar og Artsdatabanken.
 *
 * Re-eksporterer funksjonaliteten frå species_offline.js slik at tenesta
 * kan importerast direkte som eigen modul eller via species_offline.js.
 */

export {
  SpeciesSyncService,
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
  SPECIES_SYNC_STORAGE_KEY,
  SPECIES_SYNC_META_KEY,
} from './species_offline.js';
