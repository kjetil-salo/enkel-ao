/**
 * Generell nyhetsplash for Enkel-AO.
 *
 * Slik legger du til en nyhet: legg en ny post ØVERST i NEWS_FEED med en unik id.
 * En bruker ser kun nyheter som er nyere enn sist hen trykket «Skjønner». Kommer
 * en bruker tilbake etter flere oppdateringer, vises alle de nye samlet (opptil
 * MAX_VISIBLE).
 *
 * VIKTIG: Ikke fjern eller endre id-en på gamle poster — id-en brukes som
 * «lest-grense». Nye poster legges bare til på toppen.
 */

import { loadObservations } from './storage.js';

const COOKIE_NAME = 'enkelAoNewsRead';
const STORAGE_KEY = 'enkelAoNewsRead';

// Maks antall nyheter som vises samtidig. Hindrer en vegg av tekst for brukere
// som har vært borte over mange oppdateringer. Nyeste vises først.
const MAX_VISIBLE = 4;

// Kronologisk feed — NYESTE ØVERST. Hver post: { id, title, body }.
const NEWS_FEED = [
  {
    id: 'activity-abbreviations-v1',
    title: 'Kortnavn på hurtigknapper',
    body: 'Aktivitets-hurtigknappene kan nå vise et kort navn (maks 5 tegn) i stedet for fullt navn, så flere knapper får plass på skjermen. Sett ditt eget kortnavn i innstillinger, eller trykk «Foreslå forkortelser».',
  },
  {
    id: 'visit-locks-v1',
    title: 'Besøk på samme lokalitet',
    body: 'Observasjonslista grupperer nå på besøk. Lås et besøk når du er ferdig, så starter appen et nytt besøk hvis du kommer tilbake til samme lokalitet senere.',
  },
  {
    id: 'visit-locks-legend-v1',
    title: 'Hengelås i lista',
    body: 'Grønn åpen lås betyr aktivt besøk. Rød lukket lås betyr avsluttet besøk.',
  },
];

function getCookieValue(name) {
  const prefix = `${encodeURIComponent(name)}=`;
  return document.cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix))
    ?.slice(prefix.length) || '';
}

/**
 * Id-en for den nyeste nyheten brukeren har kvittert ut. Tom streng = har aldri
 * lukket splashen. Cookie er hovedkilden, localStorage er fallback.
 */
function getLastReadId() {
  const cookieValue = decodeURIComponent(getCookieValue(COOKIE_NAME));
  if (cookieValue) return cookieValue;

  try {
    return window.localStorage?.getItem(STORAGE_KEY) || '';
  } catch (e) {
    return '';
  }
}

/**
 * Nyheter som er nyere enn sist leste, nyeste først, begrenset til MAX_VISIBLE.
 * Ukjent/manglende lest-grense = vis alt (capped).
 */
function unreadItems() {
  const lastId = getLastReadId();
  const idx = lastId ? NEWS_FEED.findIndex((item) => item.id === lastId) : -1;
  const unread = idx === -1 ? NEWS_FEED : NEWS_FEED.slice(0, idx);
  return unread.slice(0, MAX_VISIBLE);
}

export function hasReadNews(newsId = NEWS_FEED[0]?.id) {
  return getLastReadId() === newsId;
}

export function markNewsRead(newsId = NEWS_FEED[0]?.id) {
  const maxAge = 60 * 60 * 24 * 365;
  document.cookie = `${encodeURIComponent(COOKIE_NAME)}=${encodeURIComponent(newsId)}; Max-Age=${maxAge}; Path=/; SameSite=Lax`;

  try {
    window.localStorage?.setItem(STORAGE_KEY, newsId);
  } catch (e) {
    // Cookie er hovedkilden. localStorage er bare fallback.
  }
}

function createNewsSplash(items) {
  const overlay = document.createElement('div');
  overlay.className = 'news-splash';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'news-splash-title');

  const panel = document.createElement('div');
  panel.className = 'news-splash-panel';

  const title = document.createElement('h2');
  title.id = 'news-splash-title';
  title.textContent = 'Nytt i Enkel-AO';

  const list = document.createElement('div');
  list.className = 'news-splash-list';

  items.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'news-splash-item';

    const itemTitle = document.createElement('strong');
    itemTitle.textContent = item.title;

    const body = document.createElement('p');
    body.textContent = item.body;

    row.appendChild(itemTitle);
    row.appendChild(body);
    list.appendChild(row);
  });

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'news-splash-button';
  button.textContent = 'Skjønner';
  button.addEventListener('click', () => {
    markNewsRead();
    overlay.remove();
  });

  panel.appendChild(title);
  panel.appendChild(list);
  panel.appendChild(button);
  overlay.appendChild(panel);

  return { overlay, button };
}

/**
 * Helt ny bruker = ingen registrerte observasjoner ennå.
 * Nyhetsplashen (funksjonsnyheter) er støy for en som aldri har brukt appen —
 * la den heller dukke opp senere når brukeren faktisk har observasjoner og
 * forstår konteksten. Markeres derfor IKKE som lest her.
 */
function isFirstTimer() {
  try {
    return loadObservations().length === 0;
  } catch (e) {
    return false;
  }
}

export function initNewsSplash() {
  if (isFirstTimer()) return;
  if (document.querySelector('.news-splash')) return;

  const items = unreadItems();
  if (items.length === 0) return;

  const { overlay, button } = createNewsSplash(items);
  document.body.appendChild(overlay);
  button.focus({ preventScroll: true });
}
