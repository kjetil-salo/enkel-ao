/**
 * Manuelt styrt nyhetsplash for Enkel-AO.
 *
 * Slik publiseres en nyhet:
 * 1. Sett enabled: true.
 * 2. Sett en ny, unik id.
 * 3. Skriv punktene i items.
 *
 * Et punkt kan ha `image: { src, alt }` og `link: { href, text }`. Begge er
 * valgfrie. Bildefilen må også inn i STATIC_ASSETS i sw.js.
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
  id: 'oktober-2026-bilder-nar-du-kommer-hjem-v1',
  items: [
    {
      title: '📷 Legg på bildene når du kommer hjem',
      body: 'Du har alltid kunnet ta med bilde når du registrerer i felt. Men ofte er det '
        + 'først hjemme de gode bildene finnes — på kameraet, ikke på mobilen. Nå kan du '
        + 'legge dem på i etterkant, på funn som for lengst er sendt til Artsobservasjoner. '
        + 'Du finner dem under «Tidligere sendt».',
      image: {
        src: '/img/nyhet-bilder-hjemme.jpg',
        alt: 'En fuglekikker registrerer på mobilen ute i kystlandskap, og sitter senere '
          + 'hjemme og overfører bilder fra kameraet til en laptop.',
      },
    },
    {
      title: '🔭 Lista er den samme på alle enhetene dine',
      body: 'Funnene hentes fra Artsobservasjoner, ikke fra telefonen. Det du registrerte ute, '
        + 'finner du igjen på PC-en hjemme — og det overlever at du bytter telefon. '
        + 'Fellesturer er med også: du kan legge bilder på alt du er med på, ikke bare '
        + 'det du selv har rapportert.',
    },
    {
      title: '✂️ Beskjær og lysne før du sender',
      body: 'Dra i hjørnene for å kutte vekk alt som ikke er fuglen, og dra i skalaen hvis '
        + 'bildet ble for mørkt. Du kan velge fil, lime inn, eller dra bildet rett inn fra '
        + 'Finder. Inntil 10 bilder per funn.',
    },
    {
      title: '📣 Si gjerne fra hva du synes',
      body: 'Dette er en app jeg lager på fritida, og tilbakemeldingene fra dere styrer hva '
        + 'som blir bedre. Stort og smått — bruk «Gi tilbakemelding» nederst i appen, eller '
        + 'send en e-post:',
      link: { href: 'mailto:k@vikebo.com', text: 'k@vikebo.com' },
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

    // Valgfritt bilde, øverst i punktet. Ligger i `public/` og refereres med en
    // rot-relativ sti. Husk å legge filen i STATIC_ASSETS i sw.js — ellers er
    // nyheten uten bilde for den som åpner appen uten nett.
    //
    // Bruk SVG der det går: et strekbilde blir skarpt på alle skjermer og veier
    // en brøkdel av en PNG. PNG fungerer like fint her om motivet krever det
    // (skjermbilde, foto) — <img> bryr seg ikke om formatet.
    if (item.image && item.image.src) {
      const img = document.createElement('img');
      img.className = 'news-splash-item-image';
      img.src = item.image.src;
      img.alt = item.image.alt || '';
      // Ikke la et manglende bilde etterlate et tomt hull i panelet.
      img.addEventListener('error', () => img.remove());
      row.appendChild(img);
    }

    const itemTitle = document.createElement('strong');
    itemTitle.textContent = item.title;

    const body = document.createElement('p');
    body.textContent = item.body;

    row.appendChild(itemTitle);
    row.appendChild(body);

    // Valgfri lenke per punkt. body settes bevisst med textContent (aldri
    // innerHTML), så en e-postadresse i brødteksten ville blitt en død streng
    // brukeren måtte skrive av for hånd. Dette gir et ekte <a> uten å åpne
    // for HTML i selve teksten.
    if (item.link && item.link.href && item.link.text) {
      const link = document.createElement('a');
      link.className = 'news-splash-item-link';
      link.href = item.link.href;
      link.textContent = item.link.text;
      row.appendChild(link);
    }

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
