/**
 * Delt autocomplete-dropdown mot AOs observatørregister (/api/ao-search-observers).
 * Brukt både av medobservatør-velgeren for én observasjon (coobserver-picker.js,
 * registrerings-/redigerings-modalen) og av fellesturens medobservatør-liste
 * (fellestur.js) — samme oppførsel alle steder: debounce, ★ for kjente
 * medobservatører, by, piltast-/Enter-navigasjon.
 *
 * Stille uten treff når brukeren ikke er innlogget mot AO (mangler ao_tokens
 * i localStorage) — navnet kan uansett skrives inn manuelt, autocomplete er
 * bare en snarvei.
 *
 * Forutsetter CSS-klassene .medobs-ac-wrap/.medobs-ac-list/.medobs-ac-item/
 * .medobs-ac-spinner/.ac-fav/.ac-city (se index.html for definisjonen).
 */

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function getAoTokens() {
  try { return JSON.parse(localStorage.getItem('ao_tokens') || '{}'); }
  catch { return {}; }
}

async function searchObservers(query) {
  const tokens = getAoTokens();
  if (!tokens.loginToken || !tokens.authCookie) return [];
  try {
    const resp = await fetch('/api/ao-search-observers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ search: query, loginToken: tokens.loginToken, authCookie: tokens.authCookie }),
    });
    if (!resp.ok) return [];
    return await resp.json();
  } catch { return []; }
}

/**
 * @param {HTMLInputElement} inp - tekstfeltet søket skal kobles til
 * @param {(name: string) => void} onSelect - kalt med valgt (eller fritt skrevet, ved Enter) navn
 */
export function attachAoObserverAutocomplete(inp, onSelect) {
  const parent = inp.parentElement;
  const wrap = document.createElement('div');
  wrap.className = 'medobs-ac-wrap';
  parent.insertBefore(wrap, inp);
  wrap.appendChild(inp);

  const dropdown = document.createElement('div');
  dropdown.className = 'medobs-ac-list';
  wrap.appendChild(dropdown);

  let acDebounce = null;
  let acActiveIndex = -1;

  function hideDropdown() {
    dropdown.classList.remove('show');
    dropdown.innerHTML = '';
    acActiveIndex = -1;
  }

  function selectItem(name) {
    onSelect(name);
    inp.value = '';
    hideDropdown();
  }

  inp.addEventListener('input', () => {
    const query = inp.value.trim();
    if (query.length < 3) { hideDropdown(); return; }

    clearTimeout(acDebounce);
    acDebounce = setTimeout(async () => {
      dropdown.innerHTML = '<div class="medobs-ac-spinner">Søker…</div>';
      dropdown.classList.add('show');
      acActiveIndex = -1;

      const results = await searchObservers(query);
      dropdown.innerHTML = '';
      if (results.length === 0) {
        dropdown.innerHTML = '<div class="medobs-ac-spinner">Ingen treff</div>';
        return;
      }
      results.sort((a, b) => (b.isCoObserver ? 1 : 0) - (a.isCoObserver ? 1 : 0));
      results.forEach((user) => {
        const item = document.createElement('div');
        item.className = 'medobs-ac-item';
        let html = '';
        if (user.isCoObserver) html += '<span class="ac-fav">★</span>';
        html += escapeHtml(user.name);
        if (user.city) html += `<span class="ac-city">${escapeHtml(user.city)}</span>`;
        item.innerHTML = html;
        item.addEventListener('mousedown', (e) => { e.preventDefault(); selectItem(user.name); });
        dropdown.appendChild(item);
      });
    }, 400);
  });

  inp.addEventListener('keydown', (e) => {
    const items = dropdown.querySelectorAll('.medobs-ac-item');
    if (e.key === 'Enter' && acActiveIndex < 0) {
      e.preventDefault();
      onSelect(inp.value);
      inp.value = '';
      hideDropdown();
      return;
    }
    if (!items.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      acActiveIndex = Math.min(acActiveIndex + 1, items.length - 1);
      items.forEach((it, i) => it.classList.toggle('active', i === acActiveIndex));
      items[acActiveIndex]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      acActiveIndex = Math.max(acActiveIndex - 1, 0);
      items.forEach((it, i) => it.classList.toggle('active', i === acActiveIndex));
      items[acActiveIndex]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter' && acActiveIndex >= 0) {
      e.preventDefault();
      const el = items[acActiveIndex].cloneNode(true);
      el.querySelector('.ac-city')?.remove();
      el.querySelector('.ac-fav')?.remove();
      selectItem(el.textContent.trim());
    } else if (e.key === 'Escape') {
      hideDropdown();
    }
  });

  inp.addEventListener('blur', () => { setTimeout(hideDropdown, 200); });
}
