/**
 * Éngangs førstegangs-hint for helt nye brukere.
 * Peker på ① Lokasjon og forklarer at man alltid starter der.
 *
 * Vises KUN når:
 *  - brukeren aldri har registrert en observasjon, og
 *  - hinten ikke er lukket tidligere.
 * Sekvenseres etter news-splashen slik at det aldri er to overlays samtidig.
 */

import { loadObservations } from './storage.js';
import { t } from './i18n.js?v=v1.60.20';

export const HINT_ID = 'start-with-location-v1';
const COOKIE_NAME = 'enkelAoHintRead';
export const STORAGE_KEY = 'enkelAoHintRead';

function getCookieValue(name) {
  const prefix = `${encodeURIComponent(name)}=`;
  return document.cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix))
    ?.slice(prefix.length) || '';
}

function hasSeenHint() {
  if (decodeURIComponent(getCookieValue(COOKIE_NAME)) === HINT_ID) return true;
  try {
    return window.localStorage?.getItem(STORAGE_KEY) === HINT_ID;
  } catch (e) {
    return false;
  }
}

function markHintSeen() {
  const maxAge = 60 * 60 * 24 * 365;
  document.cookie = `${encodeURIComponent(COOKIE_NAME)}=${encodeURIComponent(HINT_ID)}; Max-Age=${maxAge}; Path=/; SameSite=Lax`;
  try {
    window.localStorage?.setItem(STORAGE_KEY, HINT_ID);
  } catch (e) {
    // Cookie er hovedkilden. localStorage er bare fallback.
  }
}

function isFirstTimer() {
  try {
    return loadObservations().length === 0;
  } catch (e) {
    return false;
  }
}

/**
 * Sann kun når hintet faktisk kommer til å vises akkurat nå — dvs. samme
 * betingelse som initFirstRunHint() selv sjekker. Brukes av main.js til å
 * avgjøre om nyhetssplashen skal vente, uten å duplisere logikken. Kun
 * isFirstTimer() alene ville holdt nyheter tilbake på ubestemt tid for en
 * bruker som allerede har lukket hintet, men fortsatt ikke har registrert noe.
 */
export function shouldShowHint() {
  return !hasSeenHint() && isFirstTimer();
}

function showHint() {
  const section = document.querySelector('.section-lokasjon');
  const card = section?.closest('.card');
  if (!section || !card || card.querySelector('.coachmark-dim')) return;

  // Sørg for at ① Lokasjon er synlig før vi løfter den frem.
  window.scrollTo({ top: 0, behavior: 'auto' });

  // Kortet blir positioneringskontekst for dim-overlay og boble.
  card.classList.add('coachmark-open');

  // Dim-overlay dekker hele kortet; ① Lokasjon løftes over den.
  const dim = document.createElement('div');
  dim.className = 'coachmark-dim';
  section.classList.add('coachmark-spot');

  // Forklaringsboble som peker opp mot ① Lokasjon.
  const bubble = document.createElement('div');
  bubble.className = 'coachmark-bubble';
  bubble.setAttribute('role', 'dialog');
  bubble.setAttribute('aria-modal', 'true');
  bubble.setAttribute('aria-label', t('first_run.aria_label'));

  const title = document.createElement('strong');
  title.className = 'coachmark-title';
  title.textContent = t('first_run.title');

  const body = document.createElement('p');
  body.className = 'coachmark-body';
  body.textContent = t('first_run.body');

  const more = document.createElement('p');
  more.className = 'coachmark-body';
  more.style.marginTop = '6px';
  const moreLink = document.createElement('a');
  moreLink.href = 'help.html';
  moreLink.textContent = t('first_run.read_more');
  moreLink.style.color = '#3b82f6';
  more.appendChild(moreLink);

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'coachmark-button';
  button.textContent = t('first_run.dismiss');

  bubble.appendChild(title);
  bubble.appendChild(body);
  bubble.appendChild(more);
  bubble.appendChild(button);

  function position() {
    const sr = section.getBoundingClientRect();
    const cr = card.getBoundingClientRect();
    const legend = section.querySelector('legend');
    const lr = legend ? legend.getBoundingClientRect() : null;

    // Mål faktisk containing block for position:absolute (inset: 0) inne i <fieldset>.
    // Nettlesere (Chromium vs Firefox vs WebKit) plasserer top:0 ulikt under/ved <legend>.
    const probe = document.createElement('span');
    probe.style.cssText =
      'position:absolute;inset:0;pointer-events:none;visibility:hidden;z-index:-1;';
    section.appendChild(probe);
    const pr = probe.getBoundingClientRect();
    probe.remove();

    if (pr.width > 0 || pr.height > 0) {
      const targetTop = (lr && lr.height > 0 ? Math.min(sr.top, lr.top) : sr.top) - 4;
      const targetBottom = sr.bottom + 2;
      const spotTop = Math.round(targetTop - pr.top);
      const spotBottom = Math.round(pr.bottom - targetBottom);
      section.style.setProperty('--coachmark-spot-top', `${spotTop}px`);
      section.style.setProperty('--coachmark-spot-bottom', `${spotBottom}px`);
    } else if (lr) {
      // Fallback for testmiljø uten layout-motor (JSDOM)
      const legendHeight = lr.height || 0;
      if (legendHeight > 0) {
        const spotTop = -Math.round(legendHeight + 6);
        section.style.setProperty('--coachmark-spot-top', `${spotTop}px`);
      }
    }

    const borderLeft = card.clientLeft || 0;
    const borderTop = card.clientTop || 0;
    const width = Math.min(360, sr.width);
    bubble.style.width = `${width}px`;
    bubble.style.left = `${sr.left - cr.left - borderLeft}px`;
    bubble.style.top = `${sr.bottom - cr.top - borderTop + 8}px`;
  }

  let resizeObserver = null;
  if (typeof window.ResizeObserver === 'function') {
    resizeObserver = new window.ResizeObserver(() => {
      position();
    });
    resizeObserver.observe(card);
    resizeObserver.observe(section);
  }

  function dismiss() {
    markHintSeen();
    if (resizeObserver) {
      resizeObserver.disconnect();
      resizeObserver = null;
    }
    section.classList.remove('coachmark-spot');
    section.style.removeProperty('--coachmark-spot-top');
    section.style.removeProperty('--coachmark-spot-bottom');
    card.classList.remove('coachmark-open');
    dim.remove();
    bubble.remove();
    window.removeEventListener('resize', position);
    window.removeEventListener('scroll', position, true);
    window.removeEventListener('load', position);
  }

  button.addEventListener('click', dismiss);
  dim.addEventListener('click', dismiss);
  // Naturlig fullføring: når brukeren faktisk oppdaterer lokasjon, er jobben gjort.
  document.getElementById('loc-btn')?.addEventListener('click', dismiss, { once: true });
  window.addEventListener('resize', position);
  window.addEventListener('scroll', position, true);
  window.addEventListener('load', position);

  card.appendChild(dim);
  card.appendChild(bubble);
  position();
  if (typeof window.requestAnimationFrame === 'function') {
    window.requestAnimationFrame(position);
  }
  button.focus({ preventScroll: true });
}

export function initFirstRunHint() {
  if (hasSeenHint() || !isFirstTimer()) return;

  // Vent til news-splashen er lukket før hinten vises (unngå dobbel overlay).
  const splash = document.querySelector('.news-splash');
  if (!splash) {
    showHint();
    return;
  }

  const observer = new MutationObserver(() => {
    if (!document.querySelector('.news-splash')) {
      observer.disconnect();
      showHint();
    }
  });
  observer.observe(document.body, { childList: true });
}
