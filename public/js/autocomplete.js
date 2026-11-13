/**
 * Autocomplete-modul for stedsnavn i etterregistreringsmodus
 */

import { getNetworkMode, getAllOfflineLocations } from './offline-db.js';
import { haversine } from './utils.js';
// Versjonert import: hard avhengighet til en navngitt eksport.
import { loggInnMedLagretLegitimasjon } from './api.js?v=v1.60.18';

// Serveren kan ikke lenger fornye en sesjon på brukernavn alene — passordet er
// bundet til logintokenet (v1.60.18), og rader lagret før bindingen er fjernet.
// Sier serveren «utløpt», logger vi inn med den lagrede legitimasjonen: det
// fornyer både sesjonen OG bindingen, så neste tastetrykk søker i alle
// AO-lokaliteter igjen. Uten dette måtte brukeren selv finne innloggingssiden.
let reinnloggingPagar = false;

function fornyInnloggingEnGang() {
  if (reinnloggingPagar) return;
  reinnloggingPagar = true;
  // Flagget nullstilles igjen uansett utfall. Et kort nettbrudd skal ikke låse
  // resten av sidens levetid i utlogget tilstand — det var nettopp det
  // fornyelsen finnes for å unngå.
  loggInnMedLagretLegitimasjon()
    .catch(() => false)
    .finally(() => { reinnloggingPagar = false; });
}

function isMineResult(result) {
  return result?.isMine === true || result?.ColorString === '#ffff00';
}

/**
 * Søk i lokalt lagrede offline-lokaliteter i IndexedDB og konverter til autocomplete-format.
 * @param {string} term
 * @param {{ lat?: number, lon?: number }|null} pos
 * @returns {Promise<Array>}
 */
async function searchOfflineAutocomplete(term, pos = null) {
  const q = String(term || '').trim().toLowerCase();
  if (q.length < 2) return [];
  const allOffline = await getAllOfflineLocations().catch(() => []);
  const matches = allOffline
    .filter((site) => site && typeof site.name === 'string' && site.name.toLowerCase().includes(q))
    .map((site) => {
      const lat = parseFloat(site.lat);
      const lon = parseFloat(site.lon);
      const dist =
        pos && typeof pos.lat === 'number' && typeof pos.lon === 'number' && !isNaN(lat) && !isNaN(lon)
          ? haversine(pos.lat, pos.lon, lat, lon)
          : null;
      return {
        id: site.id ?? null,
        value: site.name,
        presentationvalue: site.name,
        subvalue: site.municipality || (site.raw && site.raw.municipalityName) || '',
        isMine: Boolean(site.isMine),
        isPrivate: Boolean(site.isPrivate || (site.raw && site.raw.isPrivate)),
        isSuper: Boolean(site.isSuper),
        _distance: dist,
      };
    });
  return sortLocationAutocompleteResults(matches).slice(0, 30);
}

/**
 * Sorter lokasjonstreff slik at brukerens egne private lokasjoner prioriteres.
 */
export function sortLocationAutocompleteResults(results) {
  return [...(results || [])].sort((a, b) => {
    if ((isMineResult(a) ? 1 : 0) !== (isMineResult(b) ? 1 : 0)) return (isMineResult(b) ? 1 : 0) - (isMineResult(a) ? 1 : 0);
    if ((a.isSuper ? 1 : 0) !== (b.isSuper ? 1 : 0)) return (b.isSuper ? 1 : 0) - (a.isSuper ? 1 : 0);
    if ((a.isPrivate ? 1 : 0) !== (b.isPrivate ? 1 : 0)) return (a.isPrivate ? 1 : 0) - (b.isPrivate ? 1 : 0);
    if (a._distance != null && b._distance != null) return a._distance - b._distance;
    return 0;
  });
}

/**
 * Initialiser autocomplete på stedsnavn-felt
 * KUN aktivt i etterregistreringsmodus
 * @param {HTMLInputElement} placeInput - Stedsnavn input-felt
 * @param {Function} onSelect - Callback når bruker velger lokalitet (name, id)
 */
export function initAutocomplete(placeInput, onSelect, getPosition = null) {
  if (!placeInput) return;

  let debounceTimer = null;
  let currentResults = [];
  let activeIndex = -1;
  let requestSeq = 0;

  // Opprett dropdown for resultater
  const dropdown = document.createElement('div');
  dropdown.className = 'autocomplete-dropdown';
  dropdown.style.cssText = `
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    background: var(--card-bg);
    border: 1px solid var(--border);
    border-radius: 8px;
    max-height: 300px;
    overflow-y: auto;
    z-index: 1000;
    display: none;
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
  `;

  // Sett inn dropdown rett etter input-feltet
  placeInput.parentElement.style.position = 'relative';
  placeInput.parentElement.appendChild(dropdown);

  /**
   * Vis loading-indikator i dropdown
   */
  function showLoading() {
    dropdown.innerHTML = `
      <div style="
        padding: 16px;
        text-align: center;
        color: var(--muted);
        font-size: 0.9em;
      ">
        🔍 Søker etter lokaliteter...
      </div>
    `;
    dropdown.style.display = 'block';
  }

  /**
   * Hent autocomplete-resultater i henhold til aktiv nettverksmodus (online / hybrid / offline)
   */
  async function fetchAutocomplete(term, seq) {
    const isCurrent = () => seq === requestSeq;
    if (!term || term.length < 2) {
      dropdown.style.display = 'none';
      return;
    }

    const pos = getPosition && getPosition();
    const mode = getNetworkMode();

    // 1. Streng Offline-modus: Søk utelukkende i lokalt mellomlager (IndexedDB), ingen nettverkskall
    if (mode === 'offline') {
      const localResults = await searchOfflineAutocomplete(term, pos);
      if (!isCurrent()) return;
      currentResults = localResults;
      renderResults(localResults);
      return;
    }

    // Vis lokale treff straks, men suppler dem: et tekstsøk kan ha flere treff på nettet.
    let localResults = [];
    if (mode === 'hybrid') {
      localResults = await searchOfflineAutocomplete(term, pos);
      if (!isCurrent()) return;
      if (localResults.length > 0) {
        currentResults = localResults;
        renderResults(localResults);
      }
    }

    // Vis loading-indikator før nettverkskall
    if (localResults.length === 0) showLoading();

    try {
      // Sjekk om bruker er innlogget (for private lokaliteter)
      const tokens = JSON.parse(localStorage.getItem('ao_tokens') || '{}');
      const loginToken = tokens.loginToken || '';
      const authCookie = tokens.authCookie || '';
      const userId = tokens.userId || '';

      const headers = {};
      if (loginToken) headers['X-AO-Login-Token'] = loginToken;
      if (authCookie) headers['X-AO-Auth-Cookie'] = authCookie;
      if (userId) headers['X-AO-User-Id'] = userId;
      const savedUsername = localStorage.getItem('ao_username');
      if (savedUsername) headers['X-AO-Username'] = savedUsername;

      let url = `/api/ao-autocomplete?term=${encodeURIComponent(term)}`;
      if (pos && typeof pos.lat === 'number' && typeof pos.lon === 'number') {
        url += `&lat=${pos.lat}&lon=${pos.lon}`;
      }
      const response = await fetch(url, { headers });
      const data = await response.json();
      if (!isCurrent()) return;

      // Håndter auto-relogin: oppdater auth cookie hvis den ble fornyet
      if (data.refreshed_auth_cookie) {
        const tokens = JSON.parse(localStorage.getItem('ao_tokens') || '{}');
        tokens.authCookie = data.refreshed_auth_cookie;
        localStorage.setItem('ao_tokens', JSON.stringify(tokens));
        console.log('[AUTOCOMPLETE] Auth cookie fornyet automatisk');

        // Dispatch custom event for å notifisere ao-direct.html (samme tab)
        window.dispatchEvent(new CustomEvent('ao_tokens_updated', {
          detail: { source: 'autocomplete', tokens }
        }));
      }

      const merged = new Map([...localResults, ...(data.results || [])].map((result) => [
        result.id != null ? String(result.id) : result.value, result,
      ]));
      const results = sortLocationAutocompleteResults(Array.from(merged.values())).slice(0, 30);
      currentResults = results;

      // Vis resultater (kan være fra lokal DB selv uten innlogging)
      if (results.length > 0) {
        renderResults(results);
        // Vis hint om innlogging kan gi flere resultater
        if (data.auth_expired || data.not_logged_in) {
          if (data.auth_expired) fornyInnloggingEnGang();
          const hint = document.createElement('div');
          hint.style.cssText = 'padding: 8px 12px; font-size: 0.75em; color: var(--muted); border-top: 1px solid var(--border);';
          hint.innerHTML = '💡 <a href="/ao-direct.html" style="color: inherit; text-decoration: underline;">Logg inn</a> for flere lokaliteter';
          dropdown.appendChild(hint);
        }
      } else if (data.auth_expired || data.not_logged_in) {
        if (data.auth_expired) fornyInnloggingEnGang();
        dropdown.innerHTML = `
          <div style="
            padding: 12px 16px;
            color: var(--muted);
            font-size: 0.85em;
          ">
            Ingen treff. <a href="/ao-direct.html" style="color: inherit; text-decoration: underline;">Logg inn</a> for å søke i alle AO-lokaliteter.
          </div>
        `;
        dropdown.style.display = 'block';
      } else {
        renderResults(results);
      }
    } catch (error) {
      if (!isCurrent()) return;
      console.error('Autocomplete-feil:', error);
      currentResults = localResults;
      renderResults(localResults);
    }
  }

  /**
   * Vis resultater i dropdown med fargekoding
   */
  function renderResults(results) {
    dropdown.innerHTML = '';

    if (!results || results.length === 0) {
      dropdown.style.display = 'none';
      return;
    }

    results.forEach((result, index) => {
      const item = document.createElement('div');
      item.className = 'autocomplete-item';
      item.dataset.index = index;

      // Fargekoding
      const isMine = isMineResult(result);
      const isSuper = result.isSuper === true;
      const isPrivate = result.isPrivate === true;
      const bgColor = isMine ? 'rgba(255, 255, 0, 0.15)' : isSuper ? 'rgba(59,130,246,0.07)' : 'rgba(0, 102, 0, 0.1)';
      const borderColor = isMine ? '#ffff00' : isSuper ? 'var(--accent)' : '#006600';

      item.style.cssText = `
        padding: 10px 12px;
        cursor: pointer;
        border-left: 3px solid ${borderColor};
        background: ${bgColor};
        transition: background 0.2s;
      `;

      // Ikon + navn
      let icon = '';
      if (isMine) icon = '⭐ ';
      else if (isPrivate) icon = '👤 ';

      const mainText = document.createElement('div');
      mainText.textContent = icon + (result.presentationvalue || result.value);
      mainText.style.cssText = `
        font-size: 0.95em;
        font-weight: ${isSuper ? '700' : '400'};
        color: var(--text);
        margin-bottom: 2px;
      `;

      // Subtext: avstand (lokal DB) eller kommune (AO-søk)
      const subtextParts = [];
      if (result._distance != null) {
        subtextParts.push(result._distance < 1000
          ? `${Math.round(result._distance)} m`
          : `${(result._distance / 1000).toFixed(1)} km`);
      }
      if (result.subvalue && result.presentationvalue !== result.subvalue) {
        subtextParts.push(result.subvalue);
      }

      if (subtextParts.length > 0) {
        const subText = document.createElement('div');
        subText.textContent = subtextParts.join(' · ');
        subText.style.cssText = 'font-size: 0.75em; color: var(--muted);';
        item.appendChild(mainText);
        item.appendChild(subText);
      } else {
        item.appendChild(mainText);
      }

      // Mine lokaliteter-merke (AO-søk)
      if (isMine) {
        const badge = document.createElement('span');
        badge.textContent = '★ Min';
        badge.style.cssText = `
          font-size: 0.7em;
          color: #ff9900;
          margin-left: 8px;
          font-weight: bold;
        `;
        mainText.appendChild(badge);
      }

      // Hover-effekt
      item.addEventListener('mouseenter', () => {
        item.style.background = isMine ? 'rgba(255, 255, 0, 0.25)' : 'rgba(0, 102, 0, 0.2)';
        activeIndex = index;
        updateActiveItem();
      });

      item.addEventListener('mouseleave', () => {
        item.style.background = bgColor;
      });

      // Klikk-handler
      item.addEventListener('click', () => selectItem(index));

      dropdown.appendChild(item);
    });

    dropdown.style.display = 'block';
    activeIndex = -1;
  }

  /**
   * Oppdater visuell indikator for aktiv item
   */
  function updateActiveItem() {
    const items = dropdown.querySelectorAll('.autocomplete-item');
    items.forEach((item, index) => {
      if (index === activeIndex) {
        item.style.outline = '2px solid var(--accent)';
      } else {
        item.style.outline = 'none';
      }
    });
  }

  /**
   * Velg en lokalitet fra listen
   */
  function selectItem(index) {
    if (index < 0 || index >= currentResults.length) return;

    const selected = currentResults[index];
    const name = selected.value;
    const id = selected.id;

    invalidateResults();
    placeInput.value = name;

    // Callback til parent-komponent
    if (onSelect) {
      onSelect(name, id);
    }
  }

  /**
   * Event listeners
   */
  function invalidateResults() {
    requestSeq++;
    if (debounceTimer) clearTimeout(debounceTimer);
    dropdown.style.display = 'none';
    activeIndex = -1;
    currentResults = [];
  }

  placeInput.addEventListener('input', (e) => {
    const value = e.target.value.trim();

    invalidateResults();
    const seq = requestSeq;
    // Debounce for å unngå for mange requests

    debounceTimer = setTimeout(() => {
      fetchAutocomplete(value, seq);
    }, 300);
  });

  placeInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { invalidateResults(); return; }
    if (!currentResults.length) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeIndex = (activeIndex + 1) % currentResults.length;
      updateActiveItem();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeIndex = (activeIndex - 1 + currentResults.length) % currentResults.length;
      updateActiveItem();
    } else if (e.key === 'Enter') {
      if (activeIndex >= 0) {
        e.preventDefault();
        selectItem(activeIndex);
      }
    }
  });

  // Lukk dropdown ved klikk utenfor
  document.addEventListener('click', (e) => {
    if (!placeInput.contains(e.target) && !dropdown.contains(e.target)) {
      invalidateResults();
    }
  });

  // Cleanup-funksjon for å deaktivere autocomplete
  return () => {
    invalidateResults();
    if (dropdown && dropdown.parentElement) {
      dropdown.parentElement.removeChild(dropdown);
    }
  };
}
