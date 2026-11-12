# src

## Overview

Hele serversiden av Enkel-AO bortsett fra HTTP-rutingen, som ligger i
`../server.py`. 20 Python-moduler, ingen kode-underkataloger.

Pakken har fire lag:

1. **Broer mot Artsobservasjoner.no** — `api_handlers`, `ao_import_httpx`,
   `ao_sightings`, `ao_edit`, `ao_create_site`, `ao_import`, `species_sync`.
   AO har ikke noe offentlig skrive-API, så disse modulene skraper AOs egne
   HTML-skjemaer og poster dem tilbake slik en nettleser ville gjort. Det gjør
   dem følsomme for endringer hos AO, og det er grunnen til at så mange av
   invariantene under handler om å stoppe heller enn å gjette.
2. **SQLite-lagre** — `share_store`, `fellestur_store`, `feedback_store`,
   `sqlite_log`, `fellestur_peer` deler én databasefil via `DB_PATH`, med hver
   sine tabeller. `location_db` er den eneste med egen database.
3. **Serverrendret HTML** — `html_templates`.
4. **Drift og sidekanaler** — `stats_store`, `supabase_log`, `email_notify`,
   `adminsti`, `utils`.

To gjennomgående prinsipper er verdt å ha klart for seg før man endrer noe her:

- **Grasiøs degradering utover, fail-closed innover.** Mot brukeren svarer
  appen tom liste og HTTP 200 framfor en feil. Mot AO kaster koden heller enn å
  gjette når skjemaet ikke ser ut som forventet — en gjetning ville skrevet feil
  data inn i AOs database uten at noen fikk beskjed.
- **Hvitelisting før lagring.** Lagrene plukker eksplisitt ut feltene de vil ha,
  i stedet for å fjerne de de ikke vil ha. Et nytt observasjonsfelt kan dermed
  ikke lekke koordinater ut i en deling ved uhell.

## Interface

### Broer mot Artsobservasjoner

- `[api_handlers.py:handle_species_search]` — artssøk mot AOs
  `/Taxon/PickerSearch`; liste av dicts, kaster videre ved feil.
- `[api_handlers.py:handle_reverse_geocoding]` — reverse-geokoding mot
  Nominatim; stedsnavn eller `None`.
- `[api_handlers.py:handle_ao_sites_search]` — returnerer tuppelen
  `(sites, refreshed_auth_cookie|None, auth_failed)`.
- `[api_handlers.py:handle_ao_private_sites]` —
  `(sites, refreshed_auth_cookie|None)`.
- `[api_handlers.py:fetch_ao_autocomplete]` — dict med
  `results`/`refreshed_auth_cookie`, evt. `not_logged_in`/`auth_expired`.
- `[api_handlers.py:login_to_ao]` — `{authCookie, loginToken, userId}`;
  `ValueError` ved feil.
- `[api_handlers.py:get_ao_rarity]`, `[api_handlers.py:fetch_site_areas]`,
  `[api_handlers.py:check_taxon_rarity]` — sjeldenhetsvarsel; svarer `None` ved
  feil, kaster aldri.
- `[api_handlers.py:mask_token]` — reeksportert fra `[utils.py:mask_token]`;
  `server.py` importerer den herfra.
- `[ao_import_httpx.py:post_with_curl]` — hovedinngangen for publisering
  (CSV-import, polling, bilder, scoped/full publisering).
- `[ao_import_httpx.py:publish_all]` — `PublishAll` eller scoped `Publish`.
- `[ao_import_httpx.py:number_of_sightings_submitted]`,
  `[ao_import_httpx.py:number_of_sightings_importing]` — AOs fremdriftstellere;
  `int` eller `None`.
- `[ao_import_httpx.py:upload_photo_to_published_sighting]` — «berik hjemmefra»;
  `{ok, verified, imageId, imageCount}` eller `{ok: False, error}`.
- `[ao_import_httpx.py:upload_image]`, `[ao_import_httpx.py:sighting_images]`,
  `[ao_import_httpx.py:review_queue_rows]`,
  `[ao_import_httpx.py:fetch_csrf_tokens]` — lavnivåsteg.
- `[ao_sightings.py:fetch_my_sightings]` — `{sightings, total, truncated}`, evt.
  `needsLogin`.
- `[ao_sightings.py:fetch_raw_row]`, `[ao_sightings.py:normalize_row]`,
  `[ao_sightings.py:parse_search_form]`.
- `[ao_sightings.py:AoSessionExpired]` — delt unntak; `ao_edit` importerer samme
  klasse.
- `[ao_edit.py:aapne_for_redigering]`, `[ao_edit.py:lagre_og_publiser]`,
  `[ao_edit.py:avbryt]`, `[ao_edit.py:bekreft]` — den offentlige
  redigeringskjeden.
- `[ao_edit.py:parse_edit_form]`, `[ao_edit.py:bygg_save_body]`,
  `[ao_edit.py:finn_option_id]`, `[ao_edit.py:ny_klient]`,
  `[ao_edit.py:aapne_skjema]`, `[ao_edit.py:lagre]`, `[ao_edit.py:ko_rader]`,
  `[ao_edit.py:temp_id_for]`, `[ao_edit.py:publiser]`,
  `[ao_edit.py:publiser_tilbake]`, `[ao_edit.py:funn_fra_rad]`.
- `[ao_edit.py:AoEditError]` — kastes når AOs skjema eller svar ikke er som
  forventet.
- `[ao_import.py:observations_to_csv]` — bygger AOs import-CSV; ren
  strengbygging.
- `[ao_create_site.py:create_ao_site]` —
  `{success, siteId, siteName, message, refreshedAuthCookie}`;
  `[ao_create_site.py:wgs84_to_web_mercator]`.
- `[species_sync.py:sync_species_data]`,
  `[species_sync.py:fetch_ao_species_counts]`,
  `[species_sync.py:fetch_artsdatabanken_names]`,
  `[species_sync.py:merge_species_counts_and_names]`,
  `[species_sync.py:parse_ao_species_list_html]`,
  `[species_sync.py:SPECIES_JSON_PATH]`.

### SQLite-lagre

- `[share_store.py:create_share]` —
  `{slug, deleteKey, expiresTs, photosDropped}` eller `None`;
  `[share_store.py:get_share]`, `[share_store.py:update_share]`,
  `[share_store.py:delete_share]`, `[share_store.py:sanitize_observations]`.
- `[fellestur_store.py:create_fellestur]` — `{kode, expiresTs}` eller `None`;
  `[fellestur_store.py:get_fellestur]`, `[fellestur_store.py:apply_sync]`,
  `[fellestur_store.py:update_fellestur]`,
  `[fellestur_store.py:ensure_external_fellestur]`,
  `[fellestur_store.py:sanitize_observasjon]`.
- `[fellestur_peer.py:apply_peer_batch]` — `(body, status)`;
  `[fellestur_peer.py:fan_out]` — tråd eller `None`;
  `[fellestur_peer.py:verify_inbound_token]`,
  `[fellestur_peer.py:get_own_secret]`, `[fellestur_peer.py:load_providers]`,
  `[fellestur_peer.py:skal_forwardes]`, `[fellestur_peer.py:obs_to_sighting]`,
  `[fellestur_peer.py:sighting_to_obs]`.
- `[feedback_store.py:create_feedback]` — saksnummer `AO-XXXXX` eller `None`;
  `[feedback_store.py:list_feedback]`, `[feedback_store.py:count_by_status]`,
  `[feedback_store.py:set_status]`.
- `[location_db.py:LocationDB]` med `[location_db.py:search_by_name]`,
  `[location_db.py:search_nearby]`, `[location_db.py:upsert_locations]`,
  `[location_db.py:count]`, `[location_db.py:get_cached_areas]`,
  `[location_db.py:set_areas]`.

### HTML, drift og hjelpere

- `[html_templates.py:generate_stats_page]`,
  `[html_templates.py:generate_feedback_admin_page]`,
  `[html_templates.py:generate_share_page]`,
  `[html_templates.py:generate_share_missing_page]`,
  `[html_templates.py:generate_error_page]`, `[html_templates.py:_js_streng]`.
- `[stats_store.py:log_view]`, `[stats_store.py:log_export]`,
  `[stats_store.py:get_stats]` (returnerer `(stats, kilde)`),
  `[stats_store.py:KJENTE_HENDELSER]`.
- `[sqlite_log.py:log_view]`, `[sqlite_log.py:log_export]`,
  `[sqlite_log.py:get_stats]` — primærbackend.
- `[supabase_log.py:log_view_to_supabase]`,
  `[supabase_log.py:log_export_to_supabase]`,
  `[supabase_log.py:get_stats_from_supabase]`,
  `[supabase_log.py:get_weekly_unique_users]` — valgfri backup.
- `[email_notify.py:send_feedback_notification]`,
  `[email_notify.py:is_configured]`.
- `[adminsti.py:hent_admin_sti]`, `[adminsti.py:sti_stemmer]`.
- `[utils.py:mask_token]`, `[utils.py:parse_user_agent]`.
- `[__init__.py:__all__]` reeksporterer kun seks navn:
  `handle_species_search`, `handle_reverse_geocoding`,
  `handle_ao_sites_search`, `generate_stats_page`, `generate_error_page`,
  `log_view_to_supabase`. Alt annet importeres direkte fra sin modul.

### Underkataloger

Ingen. `__pycache__` er generert og ignorert.

## Invariants

### Feilretning

- `[api_handlers.py:handle_species_search]` og
  `[api_handlers.py:handle_reverse_geocoding]` kaster videre — `../server.py`,
  ikke denne modulen, eier konvensjonen om tom liste og HTTP 200.
- `[api_handlers.py:handle_ao_sites_search]` kaster KUN hvis AO feiler OG det
  ikke finnes lokale treff å falle tilbake på.
  `[ao_sightings.py:fetch_my_sightings]` og
  `[ao_create_site.py:create_ao_site]` degraderer alltid.
- `[ao_sightings.py:_override]` er fail-closed: kaster `KeyError` hvis et
  påkrevd felt mangler i AOs skjema. Ellers ville en AO-endring gitt feil
  filtrerte funn uten noen feilmelding.
- `[ao_edit.py:bygg_save_body]` krever alle navn i
  `[ao_edit.py:PAAKREVDE_FELT]`, ellers `AoEditError` — heller stoppe enn å
  blanke ut et felt i AOs database.
- `[utils.py:parse_user_agent]` kaster aldri: tom input, manglende
  `user_agents`-pakke og parse-feil gir alle `'unknown'`.

### Sesjon og legitimasjon

- `[ao_edit.py:ny_klient]` og `[ao_sightings.py:fetch_my_sightings]` MÅ sette
  cookies på httpx-KLIENTEN, ikke per request: AO svarer 302, og httpx bygger
  Cookie-headeren på nytt fra klientens jar ved redirect. Per-request-cookies
  gir en uinnlogget side uten feilmelding.
- `[ao_sightings.py:_looks_logged_in]` avgjør sesjonsutløp på strengen `LogOff`
  i HTML-en; AO svarer HTTP 200 med anonym side ved utløp.
  `[ao_sightings.py:_create_stored_search]` sjekker dette FØR skjema-funn, slik
  at utløp ikke feilrapporteres som «ingen funn».
- `[api_handlers.py:_load_credentials]` nøkler på brukernavn i små bokstaver,
  bevisst ikke AOs ustabile `user_id`. `[api_handlers.py:_full_relogin]` krever
  derfor `username`.
- `[api_handlers.py:_load_credentials]` utleverer det lagrede passordet KUN til
  en klient som viser fram et logintoken den selv fikk fra en innlogging med
  nettopp dette passordet. Tokenet lagres som SHA-256 via
  `[api_handlers.py:_token_hash]` og sammenlignes med `hmac.compare_digest`.
  Uten den bindingen kunne hvem som helst som kjente et brukernavn fått
  serveren til å logge inn med det lagrede passordet og sende den ferske
  sesjonscookien tilbake — altså en AO-sesjon for en annen bruker.
- `[api_handlers.py:_save_credentials]` holder maks
  `[api_handlers.py:_MAX_TOKENS_PER_USER]` (25) bundne token-hasher per bruker,
  nyeste sist, og unngår å skrive fila på nytt når samme token og passord
  lagres om igjen. `[api_handlers.py:login_to_ao]` tar `bind_token` nettopp slik
  at serverens egen relogin ikke spiser en tokenplass.
- `[api_handlers.py:_full_relogin]` og `[api_handlers.py:fetch_ao_autocomplete]`
  tar `client_ip` utelukkende for å få den med i `[AUTH-RELOGIN-*]`-loggen —
  relogin-linjene er det tydeligste sporet etter et misbruksforsøk.
- `[api_handlers.py:_sliding_expiration]` er ratebegrenset til ett kall per
  `[api_handlers.py:_AO_COOKIE_REFRESH_INTERVAL]` (300 s) per cache-nøkkel, og
  må sjekke `/LogOn`-redirect FØR en endret `.ASPXAUTHNO` tolkes som fornyelse.
- `[api_handlers.py:_refresh_with_logintoken]` sender KUN logintoken-cookiene,
  bevisst ingen `.ASPXAUTHNO` (det kortslutter AOs husk-meg-revival), og må
  treffe `/LogOn?ReturnUrl=%2fUser%2fMyPages`, ikke bare `/`.
- `[api_handlers.py:_fetch_private_site_ids]` og
  `[ao_create_site.py:create_ao_site]` tolker svar som starter med `<!DOCTYPE`
  eller `<html` som utløpt innlogging i stedet for å JSON-parse.

### Publisering til AO

- `[ao_import_httpx.py:post_with_curl]` har en bevisst FAIL-SAFE-RETNING:
  `needs_scoped_publish` settes når kø-telleren er ulik `0` — altså også ved
  `None`. Kun en BEKREFTET `0` slår av scoped publisering. Å gjette «tom» ville
  falt tilbake til buggen der hele køen ble publisert.
- `[ao_import_httpx.py:post_with_curl]` setter `_importMarker` kun ved bilde
  ELLER når scoped faktisk trengs — flertallet av sendinger får aldri en markør.
- `[ao_import_httpx.py:_resolve_temp_ids_for_publish]` holder umatchede
  observasjoner UTENFOR `temp_ids`; de publiseres ikke, siden en gjettet ID
  kunne dratt med andres ventende funn.
- `[ao_import_httpx.py:post_with_curl]` kaller ikke `publish_all` i det hele
  tatt hvis scoped trengs men ingen temp-ID-er kunne løses.
- `[ao_import_httpx.py:publish_all]` kaster `ValueError` ved nøyaktig `0`
  ventende; `None` (ukjent) behandles ikke som null.
- `[ao_import_httpx.py:_poll_importing_done]` krever TO påfølgende
  klar-målinger før konklusjon, for ikke å publisere før AO er ferdig med å
  skrive radene.
- `[ao_import_httpx.py:_find_row_for_marker]` matcher markøren som DELSTRENG av
  `PrivateCommentLong`. `[ao_import.py:observations_to_csv]` legger den derfor
  TIL brukerens kommentar i stedet for å overskrive den.
- `[ao_import_httpx.py:upload_photo_to_published_sighting]` teller bildelista
  FØR og ETTER, og erklærer suksess kun ved økt antall. Ukjent førtelling gir
  `verified: False`, ikke feil. `[ao_import_httpx.py:MAX_IMAGES_PER_SIGHTING]`
  er 10, og lisens tvinges til `'10'` utenfor
  `[ao_import_httpx.py:MEDIA_LICENSES]`.
- `[ao_import_httpx.py:upload_image]` regner HTTP < 400 som bevis på at AO tok
  imot, uavhengig av om kroppen er gyldig JSON — AO svarer av og til HTML.
- `[ao_import.py:observations_to_csv]` har en POSISJONELL kolonnekontrakt:
  17 + 10 medobservatør + 27 ekstrakolonner, tab-separert, rader med `\r\n`.
  AO krever CRLF og matcher på posisjon, ikke navn. Klokkeslett utelates når
  time og minutt begge er 0 (= ikke oppgitt, ikke midnatt).

### Redigering av publiserte funn

- `[ao_edit.py:aapne_skjema]` gjør funnet UPUBLISERT hos AO som bieffekt av bare
  å bli åpnet. Alle kodeveier, også feilveiene, må ende i `lagre_og_publiser`
  eller `avbryt`/`publiser_tilbake` — ellers er funnet usynlig for andre.
- `[ao_edit.py:lagre]` regner KUN 301/302/303 som suksess. HTTP 200 betyr
  valideringsfeil og at ingenting ble lagret.
- `[ao_edit.py:bygg_save_body]` utelater `[ao_edit.py:UTELAT_FELT]` og
  `[ao_edit.py:UTELAT_PREFIKS]` (AOs JS deaktiverer dem klientside), sender
  `Taxon` nøyaktig én gang (to ganger gir `'4397,4397'` og stille avvisning), og
  `Activity` er bevisst UTELATT fra `[ao_edit.py:SELECT_DEFAULTS]` — en default
  på 0 ville slettet aktiviteten.
- `[ao_edit.py:publiser]` bruker alltid scoped publisering, aldri `PublishAll`.
  CSRF må skrapes fra `GET /ReviewSighting`, siden `/PublishSighting` ikke har
  noen GET-rute.
- `[ao_edit.py:bekreft]` svarer `{bekreftet: None}` = «vet ikke» etter
  `[ao_edit.py:BEKREFT_FORSOK]` forsøk — bevisst IKKE `False`, siden AOs
  søkeindeks kan henge etter en vellykket publisering.

### Mine funn

- `[ao_sightings.py:_nullstill_arvede_kriterier]` nullstiller arvede
  søkekriterier til `[ao_sightings.py:_NEUTRALE_KRITERIER]` kun for felt som
  ALLEREDE finnes i skjemaet, nøklet på siste punkt-segment (AO bruker flere
  prefikser for samme kriterium), og kjører FØR våre egne kriterier settes.
  AOs søkeskjema er brukerens SISTE søk, ikke et blankt skjema.
- `[ao_sightings.py:_er_jeg_med]` avgjør eierskap primært på AOs egen
  `class='iscurrentuser'`. Uten alias slippes radene gjennom ufiltrert — dette
  er kun et sekundært sikkerhetsnett, AOs `MyObservedSightings` er
  primærforsvaret. `[ao_sightings.py:normalize_row]` setter `isReporter` strengt
  på `alias == ReporterUserAlias`.
- `[ao_sightings.py:fetch_my_sightings]` klemmer `days` til `[1, 60]` og `limit`
  til `[1, 500]`. Pagineringen stopper på «færre rader enn bedt om», siden AO
  selv kan kappe `size`.

### Personvern og lagring

- `[share_store.py:sanitize_observations]` er en HVITELISTE: kun `taxonName`,
  `count`, `activity`, `age`, `gender`, `placeName`, `timestamp`,
  `tilKlokkeslett`, `comment`, `photo`. `position` (koordinater) er aldri med,
  og observasjoner med sann `hideUntil` droppes i sin helhet.
- `[fellestur_store.py:sanitize_observasjon]` følger samme prinsipp, men
  utelater BÅDE `position` og `photo`, i tillegg til klientfeltene
  `obsId`/`sentTs`. Returnerer `None` uten gyldig artsnavn.
- `[share_store.py:_clean_photo]` godtar kun prefikset
  `data:image/jpeg;base64,`. Et for stort eller ugyldig bilde droppes STILLE og
  feller aldri hele delingen. Tre atskilte grenser —
  `[share_store.py:MAX_PHOTO_BYTES]` (220 kB),
  `[share_store.py:MAX_TOTAL_PHOTO_BYTES]` (2,5 MB),
  `[share_store.py:MAX_PHOTOS_PER_SHARE]` (20) — uavhengige av tekstbudsjettet
  som `[share_store.py:_text_payload_size_ok]` måler med bildefeltet strippet ut.
- `[share_store.py:_purge_expired]` og `[fellestur_store.py:_purge_expired]`
  håndhever levetid uten cron, men KUN ved skriving. `get_share`/`get_fellestur`
  sjekker `expires_ts` direkte og svarer `None` uten å slette.
- `[share_store.py:update_share]` rører bevisst ikke `expires_ts` — en
  oppdatering forlenger aldri levetiden. `update`/`delete` krever eksakt treff
  på BÅDE `slug` og `delete_key`.
- `[share_store.py:_SLUG_ALPHABET]` (12 tegn) og
  `[feedback_store.py:_CASE_ALPHABET]` bruker samme entydige alfabet uten
  0/O/1/I/L. `[fellestur_store.py:_KODE_ALPHABET]` er 5 rene sifre, bevisst
  identisk med peer-kontraktens kodeformat.
- `[feedback_store.py:DB_PATH]`, `[sqlite_log.py:DB_PATH]`,
  `[share_store.py:DB_PATH]`, `[fellestur_store.py:DB_PATH]` og
  `[fellestur_peer.py:DB_PATH]` peker alle på SAMME fil (`/data/stats.db`) med
  hver sine tabeller. `[location_db.py:LocationDB]` er den eneste i egen
  database.

### Fellestur og føderasjon

- `[fellestur_store.py:apply_sync]` beholder opprinnelig
  `registrert_av`/`created_ts` ved upsert, hopper stille over ugyldige rader, og
  fyrer `on_event(type, obs_id, obs)` KUN for faktisk anvendte endringer
  (`obs=None` ved sletting), uten å påvirke lagring eller returverdi.
- `[fellestur_store.py:update_fellestur]` lar alle med koden endre turen.
  `avsluttet_av` er et varselflagg, IKKE en skrivelås —
  `[fellestur_store.py:apply_sync]` bryr seg aldri om feltet.
- `[fellestur_peer.py:verify_inbound_token]` sammenligner med
  `hmac.compare_digest`, aldri `==`.
- `[fellestur_peer.py:apply_peer_batch]` validerer HELE batchen før noe
  anvendes: første ugyldige event avbryter alt med 400, og over
  `[fellestur_peer.py:MAX_EVENTS_PER_BATCH]` (50) svares 413.
- `[fellestur_peer.py:_is_seen]`/`[fellestur_peer.py:_mark_seen]` gir idempotens
  på mottatte event-ID-er (`INSERT OR IGNORE`, primærnøkkel), ryddet etter
  `[fellestur_peer.py:SEEN_TTL_SEC]` (7 dager) — uavhengig av fellesturens TTL.
- `[fellestur_peer.py:_apply_count_delta]` anvender innkommende `count` som
  DELTA med gulv 1: `max(1, lokal + delta)`. Utgående events fra oss er aldri
  type `count`, kun `add`/`update`/`delete`.
- `[fellestur_peer.py:skal_forwardes]` returnerer alltid `True` i v1 —
  videresending er automatisk, ikke opt-in. Dette er det ENESTE
  beslutningspunktet; skal det bli betinget, endres kun denne funksjonen.

### Lokalitetsdatabasen

- `[location_db.py:search_by_name]` filtrerer alltid bort private
  (`WHERE is_private = 0`) og overhenter 5× `limit` ved `lat`/`lon` for
  avstandssortering.
- `[location_db.py:search_nearby]` bruker bbox først, deretter eksakt haversine.
- `[location_db.py:upsert_locations]` er idempotent med `COALESCE`, slik at en
  innkommende `NULL` ikke overskriver en kjent verdi.
- `[location_db.py:set_areas]` gjør KUN `UPDATE` på en rad som finnes fra før,
  aldri `INSERT`. En helt ny AO-lokalitet hoppes stille over, så navnesøket ikke
  forurenses av en fantom-rad. `[location_db.py:AREAS_CACHE_TTL_DAYS]` er 30.
- `[api_handlers.py:_compute_bbox]` dimensjonerer boksen slik at den omskriver
  haversine-sirkelen `[location_db.py:search_nearby]` bruker.
  `[api_handlers.py:_fetch_private_site_ids]` korrigerer i tillegg med
  Mercator-skalaen `1/cos(lat)`.

### HTML-generering

- `[html_templates.py:generate_stats_page]` escaper IP-er, user-agents og
  enhets-/OS-/nettleser-navn med `html.escape` (`src/html_templates.py:49-62`) —
  disse kommer fra request-headere klienten skriver selv, og koden sier det
  eksplisitt i en kommentar. `[html_templates.py:generate_share_page]` og
  `[html_templates.py:generate_feedback_admin_page]` escaper tilsvarende.
- `[html_templates.py:_js_streng]` er egen escaper for verdier som havner inne i
  en `<script>`-blokk, der tegnreferanser IKKE dekodes: `html.escape` gjorde
  fnutter om til `&#x27;` og ga `SyntaxError`, slik at statusnedtrekket på
  tilbakemeldings-admin stille sluttet å virke (funnet 09.11.2026). Bruker
  `json.dumps` og bryter opp `</` slik at verdien ikke kan lukke
  script-elementet. En ny verdi i en script-blokk skal gå gjennom denne, ikke
  gjennom `html.escape`.
- `[html_templates.py:_FEEDBACK_STATUS_LABEL]`,
  `[html_templates.py:_FEEDBACK_STATUS_COLOR]` og
  `[html_templates.py:_FEEDBACK_TYPE_LABEL]` er lukkede sett. En ny status
  krever endring på alle tre, pluss `[feedback_store.py:VALID_STATUSES]`.

### Tilbakemelding, statistikk og varsling

- `[feedback_store.py:create_feedback]` TRUNKERER i stedet for å avvise, avviser
  kun tom melding, og tvinger ukjent type til `'annet'` mot
  `[feedback_store.py:VALID_TYPES]`. `[feedback_store.py:set_status]` avviser
  derimot status utenfor `[feedback_store.py:VALID_STATUSES]`.
- `[stats_store.py:get_stats]` velger «rikeste kilde»: Supabase kun hvis dens
  total strengt overstiger SQLites. Dermed leser Pi fra SQLite og Fly fra
  Supabase uten miljøspesifikk konfigurasjon. `log_view`/`log_export`
  dobbeltskriver, men returnerer kun SQLite-resultatet.
- `[supabase_log.py:supabase]` konstrueres kun hvis URL og KEY er satt OG pakken
  kunne importeres. Alle funksjoner sjekker `if not supabase` — appen er fullt
  funksjonell uten Supabase.
- `[email_notify.py:send_feedback_notification]` har streng providerprioritet
  SMTP → `RESEND_API_KEY` → `SMTP2GO_API_KEY`, er en stille no-op uten
  `FEEDBACK_NOTIFY_TO`, setter `Reply-To` kun når melderen oppga e-post, gjør
  nøyaktig ett nytt forsøk med 1,5 s pause, og kaster aldri.
- `[adminsti.py:sti_stemmer]` bruker `secrets.compare_digest` (konstant tid),
  bevisst ikke `==`, som avbryter ved første ulike tegn og gjør
  tegn-for-tegn-gjetting via svartid mulig.
- `[adminsti.py:hent_admin_sti]` har oppslagsrekkefølgen `ADMIN_STI` →
  `[adminsti.py:STI_FIL]` → nygenerert verdi persistert med `0o600`. `STI_FIL`
  MÅ ligge i docker-volumet (`/data`), ellers forsvinner hemmeligheten ved hver
  rebuild. Selve HTTP-statusen for feil sti settes i `../server.py`, ikke her.

### Artsliste og lokalitetsopprettelse

- `[species_sync.py:merge_species_counts_and_names]` har fast matchingsrekkefølge
  (latin hovedart → norsk hovedart → norsk hva som helst). ADB-navn anvendes FØR
  AOs ID og antall, og overskriver `nameNob` bare når verdien er sann og ikke
  `'nan'`. `[species_sync.py:RODSTRUPETROST_SEED]` tvinges inn hvis ingen rad
  matcher.
- `[ao_create_site.py:create_ao_site]` må kalle
  `[ao_create_site.py:_update_site_accuracy]` etterpå, fordi `/Map/SaveSite`
  ignorerer `Accuracy`. `[ao_create_site.py:wgs84_to_web_mercator]` bruker
  sfærisk EPSG:3857 avrundet til heltall.
- `[api_handlers.py:_oslo_midnight_utc_iso]` konverterer dato til norsk lokal
  midnatt uttrykt som UTC-ISO, verifisert mot AOs eget skjemaformat.

## Side Effects

### Utgående kall til Artsobservasjoner

- `[api_handlers.py:handle_species_search]` `GET /Taxon/PickerSearch`;
  `[api_handlers.py:fetch_ao_autocomplete]`
  `GET /Map/FindSitesByNameForAutocomplete`; `[api_handlers.py:login_to_ao]`
  `GET`+`POST /LogOn`; `[api_handlers.py:_sliding_expiration]` og
  `[api_handlers.py:_is_cookie_expired]` `GET /User/MyPages`;
  `[api_handlers.py:handle_ao_private_sites]` `POST /Site/BindUserSitesGrid`;
  `[api_handlers.py:_fetch_private_site_ids]` `POST /Map/GetSitesGeoJson`;
  `[api_handlers.py:_fetch_public_sites]` `GET /core/Sites/ByBoundingBox`.
- `[api_handlers.py:fetch_site_areas]` `POST /SubmitSighting/GetSite`;
  `[api_handlers.py:check_taxon_rarity]`
  `POST /SubmitSighting/ValidateTaxonAndArea`.
- `[ao_import_httpx.py:fetch_csrf_tokens]` `GET /ImportSighting`;
  `[ao_import_httpx.py:post_with_curl]` `POST /ImportSighting/ParseObservations`;
  `[ao_import_httpx.py:number_of_sightings_importing]`
  `POST /ImportSighting/NumberOfSightingsImporting`;
  `[ao_import_httpx.py:number_of_sightings_submitted]`
  `POST /ReviewSighting/NumberOfSightingsSubmitted` (begge med kropp `null`);
  `[ao_import_httpx.py:review_queue_rows]`
  `POST /ReviewSighting/BindReviewSightingsGrid`.
- `[ao_import_httpx.py:publish_all]` `GET /ReviewSighting` +
  `POST /PublishSighting/PublishAll` eller `/PublishSighting/Publish`;
  `[ao_import_httpx.py:upload_image]` `POST /Media/UploadImageAction`
  (multipart); `[ao_import_httpx.py:sighting_images]`
  `POST /Media/EditableImagesForSightingId/`.
- `[ao_sightings.py:_create_stored_search]` `GET /ViewSighting/SearchSighting` +
  `POST /ViewSighting/ViewSightingAsTable`;
  `[ao_sightings.py:_fetch_grid_page]` `POST /ViewSighting/BindSightingsGrid`.
- `[ao_edit.py:aapne_skjema]` `GET /Edit/<id>` — GJØR FUNNET UPUBLISERT;
  `[ao_edit.py:lagre]` `POST /ReviewSighting/Save`; `[ao_edit.py:ko_rader]`
  `POST /ReviewSighting/BindReviewSightingsGrid`; `[ao_edit.py:publiser]`
  `GET /ReviewSighting` + `POST /PublishSighting/Publish`.
- `[ao_create_site.py:create_ao_site]` `POST /Map/SaveSite`;
  `[ao_create_site.py:_update_site_accuracy]` `POST /Map/AddSiteInfo`;
  `[species_sync.py:fetch_ao_species_counts]`
  `GET /ViewSighting/SearchSighting` + `POST /ViewSighting/ViewSpeciesList`.

### Andre eksterne tjenester

- `[api_handlers.py:handle_reverse_geocoding]` `GET` mot Nominatim;
  `[species_sync.py:fetch_artsdatabanken_names]` `GET`
  `[species_sync.py:ARTSKART_TAXON_API]`.
- `[fellestur_peer.py:_send_with_retry]` `POST {provider.url}/{kode}/events` med
  Bearer-token, timeout 10 s, nye forsøk etter (2, 10, 60) s, ingen retry ved
  400/401/404/413.
- `[email_notify.py:_send_smtp]` SMTP/STARTTLS mot `SMTP_HOST:SMTP_PORT`;
  `[email_notify.py:_send_resend]` `POST https://api.resend.com/emails`;
  `[email_notify.py:_send_smtp2go]`
  `POST https://api.smtp2go.com/v3/email/send`.
- `[supabase_log.py:log_view_to_supabase]`,
  `[supabase_log.py:log_export_to_supabase]`,
  `[supabase_log.py:get_stats_from_supabase]` — Supabase-tabellene `stats` og
  `exports`, samt RPC `get_stats`.

### Databaseskriving

- Tabeller: `[sqlite_log.py:init_db]` `stats` + `exports`;
  `[feedback_store.py:init_db]` `feedback`; `[share_store.py:init_db]` `shares`
  (+ `ALTER TABLE` for `email`); `[fellestur_store.py:init_db]` `fellesturer`
  (`ALTER TABLE` for `avsluttet_av`/`avsluttet_ts`/`opprinnelse`/
  `ekstern_bekreftet`) + `fellestur_obs` (droppes og bygges om hvis `obs_id`
  mangler); `[fellestur_peer.py:init_db]` `fellestur_peer_seen`;
  `[location_db.py:LocationDB]` `locations` i egen fil.
- `[share_store.py:get_share]` SKRIVER ved lesing:
  `UPDATE shares SET views = views + 1`.
- Alle fem `init_db` kjøres VED IMPORT, i `try`/`except` som kun logger advarsel.
- `[location_db.py:LocationDB]` åpner ny tilkobling per operasjon med
  `PRAGMA journal_mode=WAL` og `busy_timeout=5000`, slik at endringer fra andre
  containere som deler fila blir synlige. Kjører DDL og migrering i `__init__`.

### Filsystem

- `[api_handlers.py:_save_credentials]` skriver og
  `[api_handlers.py:_load_credentials]` leser
  `[api_handlers.py:_CREDENTIALS_PATH]`.
  `[api_handlers.py:_migrate_credentials_file]` leser og skriver den om, og
  KALLES VED IMPORT.
- `[fellestur_peer.py:get_own_secret]` leser eller genererer
  `[fellestur_peer.py:SECRET_PATH]` (`token_urlsafe(32)`, `chmod 0o600`);
  `[fellestur_peer.py:load_providers]` leser
  `[fellestur_peer.py:PROVIDERS_PATH]`.
- `[adminsti.py:hent_admin_sti]` leser og skriver `[adminsti.py:STI_FIL]` med
  `0o600`.
- `[species_sync.py:sync_species_data]` leser og skriver
  `[species_sync.py:SPECIES_JSON_PATH]`.

### Tråder, låser og tid

- `[api_handlers.py:_sliding_expiration]` muterer global
  `[api_handlers.py:_ao_cookie_refresh_cache]` under
  `[api_handlers.py:_cache_lock]`.
- `[sqlite_log.py:_lock]`, `[feedback_store.py:_lock]`,
  `[share_store.py:_lock]`, `[fellestur_store.py:_lock]` og
  `[adminsti.py:_laas]` serialiserer skriving.
  `[fellestur_peer.py:fan_out]` starter en daemon-tråd.
- `[ao_import_httpx.py:post_with_curl]` MUTERER inn-lista `observations` ved å
  legge `_importMarker` på hvert dict, sover 0/5/10 s mellom
  publiseringsforsøk, og kaller `progress_cb` med fasene
  `importing`/`publishing`/`uploading-images` (SSE-fremdriften).
- `[ao_edit.py:bekreft]` sover `[ao_edit.py:BEKREFT_PAUSE_S]` mellom forsøk;
  `[email_notify.py:send_feedback_notification]` sover 1,5 s før sitt ene nye
  forsøk; `[ao_import_httpx.py:_poll_importing_done]` og
  `[ao_import_httpx.py:upload_photo_to_published_sighting]` sover mellom
  pollinger.
- `[ao_edit.py:lagre_og_publiser]` kaller `[ao_edit.py:publiser_tilbake]` som
  gjenopprettingstiltak ved ethvert unntak, før det opprinnelige unntaket kastes
  videre.

### Miljøvariabler og øvrig

- `DB_PATH` (fem moduler), `CREDENTIALS_PATH`, `AO_URL`, `AO_AUTH_COOKIE`,
  `AO_LOGIN_TOKEN`, `MY_AO_SITE_IDS`, `ADMIN_STI`, `ADMIN_STI_FIL`,
  `FELLESTUR_PEER_SECRET_PATH`, `FELLESTUR_PEER_PROVIDERS_PATH`,
  `SUPABASE_URL`/`SUPABASE_KEY` (lest ved import), `FEEDBACK_NOTIFY_TO`,
  `FEEDBACK_NOTIFY_FROM`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`,
  `RESEND_API_KEY`, `SMTP2GO_API_KEY`.
- `[species_sync.py]` setter loggnivå `WARNING` på loggerne `httpx` og
  `httpcore` ved import.
- `[html_templates.py:generate_stats_page]` og
  `[html_templates.py:generate_feedback_admin_page]` gjør ingen I/O selv.
  HTML-en de returnerer laster Chart.js fra CDN og kaller
  `/api/feedback-status` — nettleserens nettverkskall, ikke serverens.
- `[ao_import.py:observations_to_csv]` og `[utils.py:mask_token]` er rene
  funksjoner uten nettverk, fil-I/O eller utskrift.

## Verification

- Run: `python3 -m pytest` (fra repo-roten; `pytest.ini` setter
  `testpaths = tests`)
