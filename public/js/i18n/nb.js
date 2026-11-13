/**
 * Bokmål er master-språket: dette er fallback-dictionary når en nøkkel
 * mangler i et annet språk, se i18n.js sin t(). Nøklene her er derfor den
 * autoritative listen over hvilke strenger appen faktisk bruker.
 */
export default {
  'settings.language.label': 'Språk',
  'settings.language.nb': 'Bokmål',
  'settings.language.nn': 'Nynorsk',

  'ui.toast.undo': 'Angre',
  'ui.location.time_prefix': 'kl',

  'coobserver.empty': 'Ingen medobservatører lagt til ennå — legg til under.',
  'coobserver.max_alert': 'Maks {max} medobservatører per observasjon.',

  'export.clear.confirm': 'Slette alle observasjoner i listen?',
  'export.clear.toast': 'Slettet alle observasjoner',

  'fellestur.unconfirmed.title': '⚠️ Ekstern tur er ikke bekreftet',
  'fellestur.unconfirmed.body': 'Vi har ikke mottatt hendelser fra Feltlogg på kode {kode}. Turen kan finnes der uten funn, eller koden kan være feil eller ikke i bruk. Kontroller koden med den som startet turen.',
  'fellestur.found_external': 'Fant en ekstern tur – vi har mottatt hendelser fra Feltlogg eller en annen tilkoblet app.',
  'fellestur.found_locally': 'Fant turen i Enkel-AO.',
  'fellestur.found_locally.also_external': 'Vi har også mottatt hendelser fra Feltlogg eller en annen tilkoblet app.',
  'fellestur.logged_in_as': 'Innlogget på AO som {navn} — dette navnet brukes på det du registrerer.',
  'fellestur.name_label': 'Ditt navn (valgfritt, vises kun til de andre i gruppa)',
  'fellestur.name_placeholder': 'F.eks. Kjetil',
  'fellestur.not_logged_in_hint': 'Ikke innlogget på AO på denne enheten — du kan likevel registrere funn i fellesturen, men den som til slutt henter inn og sender til AO må være innlogget (⚙️ Innstillinger).',
  'fellestur.copy_link_button': '🔗 Kopier delbar lenke',
  'fellestur.copy_link_prompt': 'Kopier lenken manuelt:',
  'fellestur.register_on_main': '➕ Registrer på hovedsiden',
  'fellestur.register_on_main.desc': 'Alt du registrerer på hovedsiden mens denne fellesturen er aktiv (se bjelken øverst der), havner automatisk i loggen under — hele det vanlige skjemaet med artsøk og stedssøk virker som normalt.',
  'fellestur.coobservers_label': 'Medobservatører (krediteres når turen sendes til AO)',
  'fellestur.coobservers_add_placeholder': 'Legg til navn…',
  'fellestur.finished_hint': '<strong>Ferdig med turen?</strong> Bruk knappen under — den henter alle oppføringene i loggen inn i din lokale liste, klar til å sendes til AO fra hovedsiden.',
  'fellestur.send_and_finish_button': '📤 Send inn listen og avslutt fellestur',
  'fellestur.leave_button': 'Forlat uten å sende inn',
  'fellestur.update_now_button': '🔄 Oppdater nå',
  'fellestur.no_coobservers': 'Ingen satt ennå',
};
