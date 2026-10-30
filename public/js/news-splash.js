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
  id: 'oktober-2026-raskere-artssok-v1',
  items: [
    {
      title: '🔝 De vanligste artene øverst',
      body: 'Før lå treffene alfabetisk. Søkte du på «grå», fikk du gråflankefluesnapper og '
        + 'gråhodealbatross — to arter med tre norske funn til sammen — over gråmåke og '
        + 'gråtrost. Nå kommer de vanligste artene først, og de aller sjeldneste havner '
        + 'nederst, der de er vanskeligere å treffe ved et uhell.',
    },
    {
      title: '⚡ Artssøket svarer med en gang',
      body: 'Søket går nå i artslista som allerede ligger på telefonen din, i stedet for å '
        + 'spørre Artsobservasjoner for hvert tastetrykk. Det svarer momentant — og det '
        + 'virker i tunnelen, på fjellet og andre steder uten dekning. Finner vi ikke '
        + 'arten lokalt, spør vi Artsobservasjoner som før.',
    },
    {
      // Denne ene saken står på nynorsk med vilje - den handler om nynorsk.
      // Resten av appen, og resten av disse punktene, er bokmål som før.
      title: '🪶 Underartar på nynorsk',
      body: 'Har du nynorske artsnamn påslått, viser appen no òg underartane på nynorsk — '
        + 'ikkje berre hovudarten. Manglar underarten eit eige nynorsknamn, set vi det '
        + 'saman sjølve: raudvengtrast, underarten iliacus. Og søkjer du på raudvengtrast, '
        + 'får du endeleg underartane med på kjøpet. Det som blir sendt til '
        + 'Artsobservasjoner er framleis bokmål, som før.',
    },
    {
      title: '🤝 Flere på laget',
      body: 'Denne versjonen ble til sammen med Espen Bore Hollund, som sendte inn både '
        + 'nynorsk-arbeidet og ideen om at de vanligste artene skal ligge øverst i søket. '
        + 'Han oppdaget også at «Tøm liste» ikke så ut til å virke. Takk! Appen blir bedre '
        + 'av at andre enn meg ser på den — så si gjerne fra hva du synes, stort og smått. '
        + 'Bruk «Gi tilbakemelding» nederst i appen, eller send en e-post:',
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
