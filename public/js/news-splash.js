/**
 * Manuelt styrt nyhetsplash for Enkel-AO.
 *
 * Slik publiseres en nyhet:
 * 1. Sett enabled: true.
 * 2. Sett en ny, unik id.
 * 3. Skriv punktene i items.
 *
 * Versjonsbump og changelog gir aldri splash alene. Den vises bare når denne
 * konfigen bevisst endres.
 */

const COOKIE_NAME = 'enkelAoNewsRead';
export const STORAGE_KEY = 'enkelAoNewsRead';

// Maks antall punkter som vises samtidig. Hindrer en vegg av tekst.
const MAX_VISIBLE = 4;

export const CURRENT_NEWS_SPLASH = {
  enabled: true,
  id: 'september-2026-sjeldenhetsvarsel-v1',
  items: [
    {
      title: '⚠️ Varsel ved sjeldne funn',
      body: 'Skjemaet forteller deg nå med en gang hvis arten er uvanlig på stedet du har valgt – rett fra Artsobservasjoner sin egen vurdering. Nyttig på flere måter: du oppdager fort om du har trykket feil i artslista, du får vite hvis du faktisk har gjort et sjeldent funn, og reiser du fra en landsdel til en annen ser du raskt om noe du tar for gitt hjemme faktisk er uvanlig akkurat der du er.',
    },
    {
      title: 'Krever nett og innlogging',
      body: 'Varselet virker kun når artssøket går mot ekte Artsobservasjoner. Bruker du offline-artslista (eget valg, eller automatisk fallback uten nett), får du ingen advarsel – samme som om du ikke er innlogget.',
    },
  ],
};

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

function activeNewsItems() {
  if (!CURRENT_NEWS_SPLASH.enabled) return [];
  if (!CURRENT_NEWS_SPLASH.id) return [];
  if (!Array.isArray(CURRENT_NEWS_SPLASH.items)) return [];
  if (getLastReadId() === CURRENT_NEWS_SPLASH.id) return [];
  return CURRENT_NEWS_SPLASH.items.slice(0, MAX_VISIBLE);
}

export function hasReadNews(newsId = CURRENT_NEWS_SPLASH.id) {
  return getLastReadId() === newsId;
}

export function markNewsRead(newsId = CURRENT_NEWS_SPLASH.id) {
  if (!newsId) return;

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
    markNewsRead(CURRENT_NEWS_SPLASH.id);
    overlay.remove();
  });

  const changelog = document.createElement('a');
  changelog.className = 'news-splash-link';
  changelog.href = '/changelog.html';
  changelog.textContent = 'Se endringslogg';

  panel.appendChild(title);
  panel.appendChild(list);
  panel.appendChild(button);
  panel.appendChild(changelog);
  overlay.appendChild(panel);

  return { overlay, button };
}

export function initNewsSplash() {
  if (document.querySelector('.news-splash')) return;

  const items = activeNewsItems();
  if (items.length === 0) return;

  const { overlay, button } = createNewsSplash(items);
  document.body.appendChild(overlay);
  button.focus({ preventScroll: true });
}
