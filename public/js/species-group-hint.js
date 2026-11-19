/**
 * Éngangs-onboarding som lyser opp artsgruppe-knappen (🦉/🦌) i headeren
 * og forteller at det nå er mulig å rapportere pattedyr i tillegg til fugl.
 *
 * Vises én gang per nettleser/bruker (cookie + localStorage), og venter hvis
 * en annen modal/onboarding (nyhetssplash eller «Start her»-coachmark) allerede er åpen.
 */

import { t } from './i18n.js?v=v1.60.30';

export const HINT_ID = 'pattedyr-artsgruppe-v1';
const COOKIE_NAME = 'enkelAoSpeciesGroupHintRead';
export const STORAGE_KEY = 'enkelAoSpeciesGroupHintRead';

function getCookieValue(name) {
  const prefix = `${encodeURIComponent(name)}=`;
  return document.cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix))
    ?.slice(prefix.length) || '';
}

export function hasSeenSpeciesGroupHint() {
  if (decodeURIComponent(getCookieValue(COOKIE_NAME)) === HINT_ID) return true;
  try {
    return window.localStorage?.getItem(STORAGE_KEY) === HINT_ID;
  } catch (e) {
    return false;
  }
}

export function markSpeciesGroupHintSeen() {
  const maxAge = 60 * 60 * 24 * 365;
  document.cookie = `${encodeURIComponent(COOKIE_NAME)}=${encodeURIComponent(HINT_ID)}; Max-Age=${maxAge}; Path=/; SameSite=Lax`;
  try {
    window.localStorage?.setItem(STORAGE_KEY, HINT_ID);
  } catch (e) {
    // Cookie er hovedkilden. localStorage er bare fallback.
  }
}

export function shouldShowSpeciesGroupHint() {
  return !hasSeenSpeciesGroupHint();
}

function isBlockingOverlayOpen() {
  return Boolean(document.querySelector('.news-splash, .coachmark-dim'));
}

function showHint() {
  const trigger = document.getElementById('species-group-trigger');
  if (!trigger || document.querySelector('.species-group-hint-dim')) return;

  try {
    window.scrollTo({ top: 0, behavior: 'auto' });
  } catch (e) {
    // JSDOM implementerer ikke scrollTo som standard.
  }

  document.body.classList.add('species-group-hint-active');
  trigger.classList.add('species-group-spot');

  const dim = document.createElement('div');
  dim.className = 'species-group-hint-dim';

  const bubble = document.createElement('div');
  bubble.className = 'species-group-hint-bubble';
  bubble.setAttribute('role', 'dialog');
  bubble.setAttribute('aria-modal', 'true');
  bubble.setAttribute('aria-label', t('species_group_hint.aria'));

  const body = document.createElement('p');
  body.className = 'coachmark-body species-group-hint-body';
  body.textContent = t('species_group_hint.body');

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'coachmark-button species-group-hint-button';
  button.textContent = t('species_group_hint.cta');

  bubble.appendChild(body);
  bubble.appendChild(button);

  function position() {
    const tr = trigger.getBoundingClientRect();
    const vw = window.innerWidth || document.documentElement?.clientWidth || 375;
    const width = Math.min(300, Math.max(220, vw - 24));
    const triggerCenterX = tr.left + tr.width / 2;
    const left = Math.round(Math.max(12, Math.min(triggerCenterX - width / 2, vw - width - 12)));
    const top = Math.round(tr.bottom + 12);
    const arrowLeft = Math.round(Math.max(16, Math.min(triggerCenterX - left - 7, width - 30)));

    bubble.style.width = `${width}px`;
    bubble.style.left = `${left}px`;
    bubble.style.top = `${top}px`;
    bubble.style.setProperty('--species-hint-arrow-left', `${arrowLeft}px`);
  }

  let resizeObserver = null;
  if (typeof window.ResizeObserver === 'function') {
    resizeObserver = new window.ResizeObserver(() => {
      position();
    });
    if (document.documentElement) resizeObserver.observe(document.documentElement);
    resizeObserver.observe(trigger);
  }

  let dismissed = false;
  function dismiss({ toggleGroup = false } = {}) {
    if (dismissed) return;
    dismissed = true;
    markSpeciesGroupHintSeen();
    if (resizeObserver) {
      resizeObserver.disconnect();
      resizeObserver = null;
    }
    document.body.classList.remove('species-group-hint-active');
    trigger.classList.remove('species-group-spot');
    dim.remove();
    bubble.remove();
    trigger.removeEventListener('click', onTriggerClick);
    document.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('resize', position);
    window.removeEventListener('scroll', position, true);
    window.removeEventListener('load', position);

    if (toggleGroup) {
      trigger.click();
      trigger.focus?.({ preventScroll: true });
    }
  }

  function onTriggerClick() {
    dismiss({ toggleGroup: false });
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') {
      dismiss({ toggleGroup: false });
    }
  }

  button.addEventListener('click', () => dismiss({ toggleGroup: true }));
  dim.addEventListener('click', () => dismiss({ toggleGroup: false }));
  trigger.addEventListener('click', onTriggerClick, { once: true });
  document.addEventListener('keydown', onKeyDown);
  window.addEventListener('resize', position);
  window.addEventListener('scroll', position, true);
  window.addEventListener('load', position);

  document.body.appendChild(dim);
  document.body.appendChild(bubble);
  position();
  if (typeof window.requestAnimationFrame === 'function') {
    window.requestAnimationFrame(position);
  }
  button.focus({ preventScroll: true });
}

export function initSpeciesGroupHint() {
  if (hasSeenSpeciesGroupHint() || document.querySelector('.species-group-hint-dim')) return;
  const trigger = document.getElementById('species-group-trigger');
  if (!trigger) return;

  if (!isBlockingOverlayOpen()) {
    showHint();
    return;
  }

  const observer = new MutationObserver(() => {
    if (!isBlockingOverlayOpen()) {
      observer.disconnect();
      if (!hasSeenSpeciesGroupHint()) {
        showHint();
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}
