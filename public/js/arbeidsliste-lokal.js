// Den innhentede lista har egen nøkkel slik at en eldre fane kan lagre sin
// lokale liste uten å overskrive kopien. Én fane av gangen kan redigere kopien.
const LAGER = 'arbeidsliste_innhentet_v1';
let aktiv = null;

export function lesInnhentetListe() {
  const raw = localStorage.getItem(LAGER);
  if (raw === null) return null;
  try {
    const liste = JSON.parse(raw);
    if (Array.isArray(liste?.observations) && typeof liste.eier === 'string'
        && typeof liste.kopiId === 'string' && Number.isFinite(liste.lagretTs)) return liste;
  } catch {
    // Behold uleselig innhold i lagringen.
  }
  throw new Error('Den innhentede lista kan ikke leses. Lokale data er beholdt.');
}

export function aktivInnhentetListe() {
  return aktiv?.metadata || null;
}

export function lukkInnhentetListe() {
  const forrige = aktiv;
  aktiv = null;
  forrige?.slipp();
}

export function apneInnhentetListe(klargjor) {
  if (!navigator.locks?.request) {
    return Promise.reject(new Error('Denne nettleseren kan bare forhåndsvise lista. Prøv en oppdatert nettleser for å hente den inn.'));
  }
  return new Promise((resolve, reject) => {
    navigator.locks.request(LAGER, { ifAvailable: true }, async (las) => {
      if (!las) throw new Error('Den innhentede lista er åpen i en annen fane. Lukk den fanen og prøv igjen.');
      const liste = klargjor();
      if (!liste) throw new Error('Finner ingen innhentet liste på denne enheten.');
      let slipp;
      const vent = new Promise((ferdig) => { slipp = ferdig; });
      const { eier, kopiId, lagretTs } = liste;
      aktiv = { metadata: { eier, kopiId, lagretTs }, slipp };
      resolve();
      await vent;
    }).catch(reject);
  });
}

export function lagreInnhentetKopi(metadata, observations, eier) {
  if (lesInnhentetListe()) throw new Error('Det ligger allerede en innhentet liste på denne enheten.');
  const liste = { eier, kopiId: metadata.id, lagretTs: metadata.lagretTs, observations };
  localStorage.setItem(LAGER, JSON.stringify(liste));
  return liste;
}

export function lagreEndringerIInnhentetListe(observations) {
  const metadata = aktivInnhentetListe();
  if (!metadata) throw new Error('Åpne den innhentede lista før du endrer den.');
  if (observations.length) {
    localStorage.setItem(LAGER, JSON.stringify({ ...metadata, observations }));
  } else {
    localStorage.removeItem(LAGER);
    lukkInnhentetListe();
  }
}
