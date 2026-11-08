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
  id: 'november-2026-offline-kart-v1',
  items: [
    {
      title: '🗺️ Kartet virker nå uten dekning',
      body: 'Last ned kartet og lokalitetene for området du skal til mens du har nett — '
        + 'så har du dem med deg når dekningen forsvinner. Du finner det under '
        + '«📦 Offline-område» på kartsiden: dra opp området du skal gå i, og trykk last ned. '
        + 'Velgeren viser hvor mange megabyte det blir før du starter. Øverst i appen har du '
        + 'fått en bryter med tre stillinger — Online, Hybrid og Offline — der Hybrid henter '
        + 'fra nett når det går og fra det nedlastede når det ikke gjør det.',
      image: {
        src: '/img/nyhet-offline-kart.jpg',
        alt: 'Illustrasjon: fuglekikker med kikkert på en knaus over en kystlinje, '
          + 'med høydekurver tegnet i himmelen.',
      },
    },
    {
      title: '🙌 Dette er i all hovedsak Espen sin versjon',
      body: 'Espen Bore Hollund har bygget hele offline-delen, og det stopper ikke der: '
        + 'kartet åpner seg nå med en gang i stedet for å vente på GPS, du har fått en knapp '
        + 'for å sentrere på deg selv, appen hopper rett ned til artsfeltet når du har valgt '
        + 'sted, og du kan ha åtte aktivitetsknapper i stedet for seks — og dra dem i den '
        + 'rekkefølgen du vil under Innstillinger. I tillegg kommer en rekke mindre ting vi '
        + 'ikke lister opp her. Enkel-AO er åpen kildekode, og dette er akkurat slik det '
        + 'er ment å virke: koden ligger ute, og den som savner noe kan bygge det og sende '
        + 'det tilbake.',
      avatar: {
        src: '/img/espen.jpg',
        alt: 'Portrett av Espen Bore Hollund',
      },
    },
    {
      title: '👁️ Ryddigere kart der lokalitetene står tett',
      body: 'På steder som Lista lå markørene så tett at de dekket hele kartet. Nå samles de '
        + 'i bobler med et tall i, som deler seg etter hvert som du zoomer inn — kartet er '
        + 'lesbart med en gang du åpner det. Lokaliteter som er tegnet som områder vises '
        + 'dessuten uten nål, så du ser selve flaten.',
    },
    {
      title: '🪶 Fikk du den ikke artsbestemt?',
      body: 'Søker du «måke» får du gråmåke og fiskemåke øverst som før — men nederst i lista '
        + 'ligger nå også «ub. grå-/sildemåke» og «måkefamilien». Dem kan du sende inn når '
        + 'fuglen ikke lot seg bestemme sikkert. Det gjelder de fleste artsgruppene: ender, '
        + 'meiser, troster, ugler.',
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
      // Størrelsen settes OGSÅ inline, ikke bare i CSS. Stilarkene har ingen
      // `?v=`, så Cloudflare kan servere en gammel kopi i opptil fire timer etter
      // deploy (se «Versjonering» i CLAUDE.md). Uten regelen rendrer bildet i sin
      // naturlige bredde — 1440 px — og sprenger hele panelet. Det traff prod
      // 26.10.2026: feilfritt på mobil, ubrukelig på Mac.
      img.style.width = '100%';
      img.style.height = 'auto';
      img.style.display = 'block';
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

    // Et lite, rundt portrett ved siden av tittelen — for et punkt som handler
    // om en person. Bevisst atskilt fra `image`, som er full bredde: en
    // bidragsyter skal krediteres diskret, ikke fylle panelet.
    //
    // Stilene settes INLINE av samme grunn som for `image` over: stilarkene har
    // ingen `?v=`, så Cloudflare kan servere en gammel kopi i fire timer etter
    // deploy, og uten reglene ville portrettet rendret i full naturlig bredde.
    if (item.avatar && item.avatar.src) {
      const rad = document.createElement('div');
      rad.style.display = 'flex';
      rad.style.alignItems = 'center';
      rad.style.gap = '10px';
      rad.style.marginBottom = '6px';

      const portrett = document.createElement('img');
      portrett.className = 'news-splash-item-avatar';
      portrett.src = item.avatar.src;
      portrett.alt = item.avatar.alt || '';
      portrett.style.width = '44px';
      portrett.style.height = '44px';
      portrett.style.flexShrink = '0';
      portrett.style.borderRadius = '50%';
      portrett.style.objectFit = 'cover';
      portrett.style.display = 'block';
      // Et manglende portrett skal ikke etterlate et tomt hull ved siden av
      // tittelen — da rykker tittelen bare på plass der den ellers ville stått.
      portrett.addEventListener('error', () => portrett.remove());

      rad.appendChild(portrett);
      rad.appendChild(itemTitle);
      row.appendChild(rad);
    } else {
      row.appendChild(itemTitle);
    }
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

  // Rullehint. En lang nyhet skjuler både «Skjønner» og de nederste punktene,
  // og panelet gir ingen antydning om at det finnes mer. Hintet er `sticky` i
  // bunnen av selve rulleboksen, så det blir liggende mens man blar — og
  // forsvinner i det bunnen er nådd.
  //
  // Uttoningen gjør mesteparten av jobben: den sier «dette fortsetter» i et
  // øyekrok-blikk. Pilen gir i tillegg et trykkbart mål for den som vil videre
  // uten å dra.
  const hint = document.createElement('button');
  hint.type = 'button';
  hint.className = 'news-splash-scroll-hint';
  hint.setAttribute('aria-label', 'Bla ned for mer');
  // Tegnet chevron, ikke et Unicode-tegn: «⌄» rendrer spinkelt og ulikt på tvers
  // av plattformer, og ble nesten usynlig mot uttoningen.
  hint.innerHTML = '<span class="news-splash-scroll-knapp" aria-hidden="true">'
    + '<svg width="22" height="14" viewBox="0 0 22 14" fill="none">'
    + '<path d="M3 3 L11 11 L19 3" stroke="currentColor" stroke-width="3" '
    + 'stroke-linecap="round" stroke-linejoin="round"/></svg></span>'
    + '<span class="news-splash-scroll-tekst">Mer under</span>';
  hint.addEventListener('click', () => {
    panel.scrollBy({ top: panel.clientHeight * 0.8, behavior: 'smooth' });
  });
  panel.appendChild(hint);

  function oppdaterHint() {
    const igjen = panel.scrollHeight - panel.scrollTop - panel.clientHeight;
    // 8 px slingringsmonn: subpiksel-avrunding gjør at man sjelden lander på
    // nøyaktig null, og uten monnet blir hintet stående etter siste piksel.
    hint.classList.toggle('skjult', igjen <= 8);
  }

  panel.addEventListener('scroll', oppdaterHint, { passive: true });
  // Bildet endrer panelets høyde når det lastes — da må hintet vurderes på nytt.
  panel.querySelectorAll('img').forEach((img) => {
    img.addEventListener('load', oppdaterHint);
  });
  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(oppdaterHint).observe(panel);
  }
  requestAnimationFrame(oppdaterHint);

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
