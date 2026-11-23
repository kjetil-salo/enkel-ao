/**
 * Prosjektvelger for AO-prosjekter — brukt i «✎ Flere felt» (ny registrering) og
 * «✎ Rediger observasjon». Søker via `/api/ao-projects`, som speiler AOs egen
 * prosjektvelger på importsiden (se src/ao_projects.py og docs/ao-prosjekt.md).
 *
 * Et funn bærer `obs.project = {id, name}`. AO knytter prosjekt per import, ikke per
 * rad, så serveren importerer én gruppe per prosjekt før alt publiseres samlet.
 *
 * **Prosjektet huskes til neste funn** (`aoProject_v1`): man registrerer typisk en
 * hel tur eller en hel dag i samme prosjekt. Det står til man fjerner det med ✕.
 */

const LAGRET_NOKKEL = 'aoProject_v1';
const SOK_FORSINKELSE_MS = 300;

/** Gyldig prosjekt, eller null. Kun et rent tall-id fra AO godtas. */
export function normaliserProsjekt(p) {
  if (!p || typeof p !== 'object') return null;
  const id = String(p.id ?? '').trim();
  const name = String(p.name ?? '').trim();
  if (!/^\d+$/.test(id) || !name) return null;
  return { id, name };
}

/** Prosjektet som skal gjelde for neste registrering, eller null. */
export function lagretProsjekt() {
  try {
    return normaliserProsjekt(JSON.parse(localStorage.getItem(LAGRET_NOKKEL) || 'null'));
  } catch {
    return null;
  }
}

export function lagreProsjekt(p) {
  const gyldig = normaliserProsjekt(p);
  try {
    if (gyldig) localStorage.setItem(LAGRET_NOKKEL, JSON.stringify(gyldig));
    else localStorage.removeItem(LAGRET_NOKKEL);
  } catch {
    // full kvote — valget gjelder da bare denne økta
  }
  document.dispatchEvent(new CustomEvent('obs:prosjekt-endret', { detail: gyldig }));
}

async function hentProsjekter(sok, provdInnlogging = false) {
  let tokens = {};
  try {
    tokens = JSON.parse(localStorage.getItem('ao_tokens') || '{}');
  } catch {
    tokens = {};
  }
  if (!tokens.loginToken || !tokens.authCookie) return { projects: [], needsLogin: true };
  try {
    const resp = await fetch('/api/ao-projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ loginToken: tokens.loginToken, authCookie: tokens.authCookie, search: sok }),
    });
    // F.eks. 503 i offline-modus: det er «fikk ikke spurt», ikke «ingen prosjekter»
    if (!resp.ok) return { projects: [], feil: true };
    const svar = await resp.json();
    // Utløpt AO-sesjon: logg inn på nytt med lagret brukernavn/passord og prøv én
    // gang til, samme mønster som «Tidligere sendt». Hentes dynamisk for å holde
    // denne modulen fri for api.js sine avhengigheter.
    if (svar && svar.needsLogin && !provdInnlogging) {
      const { loggInnMedLagretLegitimasjon } = await import('./api.js');
      if (await loggInnMedLagretLegitimasjon('prosjektsok')) return hentProsjekter(sok, true);
    }
    return svar;
  } catch {
    return { projects: [], feil: true };
  }
}

/**
 * @param {{input: HTMLInputElement, list: HTMLElement, clearBtn: HTMLElement,
 *          onChange?: (p: {id, name}|null) => void}} els
 * @returns {{getValue: () => ({id, name}|null), setValue: (p) => void}}
 */
export function initProjectPicker({ input, list, clearBtn, onChange }) {
  let valgt = null;
  let timer = null;
  let sekvens = 0;

  function visValgt() {
    input.value = valgt ? valgt.name : '';
    clearBtn.hidden = !valgt;
    input.classList.toggle('prosjekt-valgt', !!valgt);
  }

  function lukkListe() {
    list.hidden = true;
    list.innerHTML = '';
  }

  function melding(tekst) {
    list.innerHTML = '';
    const li = document.createElement('li');
    li.className = 'prosjekt-melding';
    li.textContent = tekst;
    list.appendChild(li);
    list.hidden = false;
  }

  function velg(p) {
    valgt = normaliserProsjekt(p);
    visValgt();
    lukkListe();
    if (onChange) onChange(valgt);
  }

  async function sok() {
    const tekst = input.value.trim();
    const min = ++sekvens;
    melding('Søker …');
    const svar = await hentProsjekter(tekst);
    if (min !== sekvens) return; // et nyere søk er underveis
    const prosjekter = (svar && svar.projects) || [];
    if (!prosjekter.length) {
      if (svar && svar.needsLogin) melding('Logg inn på AO for å søke i prosjekter');
      else if (svar && svar.feil) melding('Fikk ikke kontakt med AO');
      else melding(tekst ? 'Ingen prosjekter funnet' : 'Du har ingen egne prosjekter — skriv for å søke');
      return;
    }
    list.innerHTML = '';
    prosjekter.forEach((p) => {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'prosjekt-treff';
      btn.textContent = (p.mine ? '👤 ' : '') + p.name;
      // mousedown, ikke click: blur på input-feltet lukker ellers lista før klikket lander
      btn.addEventListener('mousedown', (e) => { e.preventDefault(); velg(p); });
      btn.addEventListener('click', () => velg(p));
      li.appendChild(btn);
      list.appendChild(li);
    });
    list.hidden = false;
  }

  input.addEventListener('focus', () => {
    if (!valgt) sok();
  });
  input.addEventListener('input', () => {
    // Å skrive i feltet betyr å lete etter et annet prosjekt — det gamle valget
    // gjelder ikke lenger før et nytt er valgt fra lista.
    if (valgt) {
      valgt = null;
      clearBtn.hidden = true;
      input.classList.remove('prosjekt-valgt');
      if (onChange) onChange(null);
    }
    clearTimeout(timer);
    timer = setTimeout(sok, SOK_FORSINKELSE_MS);
  });
  input.addEventListener('blur', () => {
    setTimeout(() => {
      lukkListe();
      // Fritekst som ikke ble valgt fra lista er ikke et prosjekt
      if (!valgt) input.value = '';
    }, 150);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !list.hidden) {
      e.stopPropagation(); // ikke lukk hele modalen
      lukkListe();
    }
  });
  clearBtn.addEventListener('click', () => velg(null));

  visValgt();
  return {
    getValue: () => valgt,
    setValue: (p) => { valgt = normaliserProsjekt(p); visValgt(); lukkListe(); },
  };
}
