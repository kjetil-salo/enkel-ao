/**
 * Fellestur-klient — enhetens kunnskap om hvilken fellestur (om noen) som
 * er aktiv på denne enheten.
 *
 * Ingen kontoer: en aktiv fellestur er bare en kode lagret lokalt. Andre
 * moduler (storage.js, fellestur-sync.js, fellestur.js) bruker disse
 * funksjonene i stedet for å lese localStorage direkte. Selve synkingen
 * mot serveren ligger i fellestur-sync.js.
 */

const AKTIV_KEY = 'aktivFellestur_v1';
const MITT_NAVN_KEY = 'fellesturMittNavn_v1';

/** @returns {{kode: string, navn: string} | null} */
export function hentAktivFellestur() {
  try {
    const raw = localStorage.getItem(AKTIV_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    return data && data.kode ? data : null;
  } catch (_) {
    return null;
  }
}

export function settAktivFellestur(fellestur) {
  localStorage.setItem(AKTIV_KEY, JSON.stringify({ kode: fellestur.kode, navn: fellestur.navn || '' }));
}

export function forlatFellestur() {
  localStorage.removeItem(AKTIV_KEY);
}

export function hentMittNavn() {
  return localStorage.getItem(MITT_NAVN_KEY) || '';
}

export function settMittNavn(navn) {
  localStorage.setItem(MITT_NAVN_KEY, (navn || '').trim());
}
