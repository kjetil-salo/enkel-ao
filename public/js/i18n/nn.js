/**
 * Nynorsk. Manglende nøkkel her faller tilbake til nb.js (se i18n.js sin t()) -
 * en ufullstendig oversettelse skal aldri gi en tom streng i grensesnittet.
 */
export default {
  'settings.language.label': 'Språk',
  'settings.language.nb': 'Bokmål',
  'settings.language.nn': 'Nynorsk',

  'ui.toast.undo': 'Angra',
  'ui.location.time_prefix': 'kl.',

  'coobserver.empty': 'Ingen medobservatørar er lagde til – legg til under.',
  'coobserver.max_alert': 'Maks {max} medobservatørar per observasjon.',

  'export.clear.confirm': 'Sletta alle observasjonar i lista?',
  'export.clear.toast': 'Sletta alle observasjonar',

  'fellestur.unconfirmed.title': '⚠️ Ekstern tur er ikkje stadfesta',
  'fellestur.unconfirmed.body': 'Vi har ikkje motteke hendingar frå Feltlogg på kode {kode}. Turen kan finnast der utan funn, eller koden kan vera feil eller ikkje i bruk. Kontroller koden med den som starta turen.',
  'fellestur.found_external': 'Fann ein ekstern tur – vi har motteke hendingar frå Feltlogg eller ein annan tilkopla app.',
  'fellestur.found_locally': 'Fann turen i Enkel-AO.',
  'fellestur.found_locally.also_external': 'Vi har òg motteke hendingar frå Feltlogg eller ein annan tilkopla app.',
  'fellestur.logged_in_as': 'Innlogga på AO som {navn} – dette namnet blir brukt på det du registrerer.',
  'fellestur.name_label': 'Ditt namn (valfritt, blir berre vist til dei andre i gruppa)',
  'fellestur.name_placeholder': 'T.d. Kjetil',
  'fellestur.not_logged_in_hint': 'Ikkje innlogga på AO på denne eininga – du kan likevel registrera funn i fellesturen, men den som til slutt hentar inn og sender til AO må vera innlogga (⚙️ Innstillingar).',
  'fellestur.copy_link_button': '🔗 Kopier delbar lenkje',
  'fellestur.copy_link_prompt': 'Kopier lenkja manuelt:',
  'fellestur.register_on_main': '➕ Registrer på hovudsida',
  'fellestur.register_on_main.desc': 'Alt du registrerer på hovudsida medan denne fellesturen er aktiv (sjå bjelken øvst der), hamnar automatisk i loggen under – heile det vanlege skjemaet med artssøk og lokalitetssøk fungerer som normalt.',
  'fellestur.coobservers_label': 'Medobservatørar (blir krediterte når turen blir sendt til AO)',
  'fellestur.coobservers_add_placeholder': 'Legg til namn…',
  'fellestur.finished_hint': '<strong>Ferdig med turen?</strong> Bruk knappen under – den hentar alle oppføringane i loggen inn i di lokale liste, klar til å sendast til AO fra hovudsida.',
  'fellestur.send_and_finish_button': '📤 Send inn lista og avslutt fellestur',
  'fellestur.leave_button': 'Forlat utan å senda inn',
  'fellestur.update_now_button': '🔄 Oppdater no',
  'fellestur.no_coobservers': 'Ingen lagt til enno',
};
