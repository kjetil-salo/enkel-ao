export const OVERFORING_API = '/api/arbeidsliste-overforing';
const SESJON = 'arbeidsliste_sesjon_v1';
const KONTOBYTTE = 'arbeidsliste_kontobytte_v1';
export const KONTOKONTEKST_ENDRET = 'arbeidsliste:kontokontekst-endret';

export function kontoKontekst() {
  return {
    brukernavn: localStorage.getItem('ao_username') || '',
    versjon: localStorage.getItem(KONTOBYTTE),
  };
}

export function sammeKontoKontekst(forrige) {
  const na = kontoKontekst();
  return forrige.brukernavn === na.brukernavn && forrige.versjon === na.versjon;
}

export function lesOverforingssesjon() {
  try {
    const data = JSON.parse(localStorage.getItem(SESJON) || 'null');
    if (!data?.token || !data.konto || data.utloperTs * 1000 <= Date.now()) return null;
    return sammeKontoKontekst(data.konto) ? data : null;
  } catch {
    return null;
  }
}

export function lagreOverforingssesjon(sesjon, konto) {
  if (!sammeKontoKontekst(konto)) {
    trekkTilbakeSesjon(sesjon.token);
    return false;
  }
  const gammel = lesOverforingssesjon();
  localStorage.setItem(SESJON, JSON.stringify({ ...sesjon, konto }));
  if (gammel?.token && gammel.token !== sesjon.token) trekkTilbakeSesjon(gammel.token);
  return true;
}

function trekkTilbakeSesjon(token) {
  if (!token) return;
  fetch(OVERFORING_API + '/logg-ut', {
    method: 'POST', headers: { Authorization: `Bearer ${token}` }, keepalive: true,
  }).catch(() => {});
}

export function fjernOverforingssesjon() {
  try {
    const sesjon = JSON.parse(localStorage.getItem(SESJON) || 'null');
    localStorage.removeItem(SESJON);
    localStorage.setItem(KONTOBYTTE, `${Date.now()}-${Math.random()}`);
    trekkTilbakeSesjon(sesjon?.token);
  } catch {
    // Utlogging i AO skal også fungere når lokal lagring feiler.
  }
  window.dispatchEvent(new Event(KONTOKONTEKST_ENDRET));
}

export function erOverforingskontoendring(event) {
  return [null, SESJON, KONTOBYTTE, 'ao_username', 'ao_password'].includes(event.key);
}
