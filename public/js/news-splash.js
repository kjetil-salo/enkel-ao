/**
 * Éngangs nyhetsplash for viktige UX-endringer.
 * Bytt NEWS_ID når samme bruker skal se en ny melding.
 */

const NEWS_ID = 'visit-locks-v1';
const COOKIE_NAME = 'enkelAoNewsRead';
const STORAGE_KEY = 'enkelAoNewsRead';

const NEWS_ITEMS = [
  {
    title: 'Besøk på samme lokalitet',
    body: 'Observasjonslista grupperer nå på besøk. Lås et besøk når du er ferdig, så starter appen et nytt besøk hvis du kommer tilbake til samme lokalitet senere.',
  },
  {
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

export function hasReadNews(newsId = NEWS_ID) {
  const cookieValue = decodeURIComponent(getCookieValue(COOKIE_NAME));
  if (cookieValue === newsId) return true;

  try {
    return window.localStorage?.getItem(STORAGE_KEY) === newsId;
  } catch (e) {
    return false;
  }
}

export function markNewsRead(newsId = NEWS_ID) {
  const maxAge = 60 * 60 * 24 * 365;
  document.cookie = `${encodeURIComponent(COOKIE_NAME)}=${encodeURIComponent(newsId)}; Max-Age=${maxAge}; Path=/; SameSite=Lax`;

  try {
    window.localStorage?.setItem(STORAGE_KEY, newsId);
  } catch (e) {
    // Cookie er hovedkilden. localStorage er bare fallback.
  }
}

function createNewsSplash() {
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

  NEWS_ITEMS.forEach((item) => {
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

export function initNewsSplash() {
  if (hasReadNews()) return;
  if (document.querySelector('.news-splash')) return;

  const { overlay, button } = createNewsSplash();
  document.body.appendChild(overlay);
  button.focus({ preventScroll: true });
}
