/**
 * UI-modul for generelle UI-funksjoner
 */

/**
 * Flash en knapp med suksessmelding
 * @param {HTMLElement} button - Knappen som skal flashe
 * @param {string} successLabel - Teksten som skal vises
 */
export function flashButton(button, successLabel) {
  if (!button) return;
  
  const labelSpan = button.querySelector('span:last-child');
  if (!labelSpan) return;
  
  const originalText = labelSpan.textContent;
  button.classList.add('btn-success');
  labelSpan.textContent = successLabel;
  
  setTimeout(() => {
    labelSpan.textContent = originalText;
    button.classList.remove('btn-success');
  }, 1200);
}

/**
 * Vis toast-melding
 * @param {string} msg - Meldingen som skal vises
 */
export function showToast(msg) {
  let toast = document.getElementById('registered-toast');
  
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'registered-toast';
    toast.style.position = 'fixed';
    toast.style.top = '50%';
    toast.style.left = '50%';
    toast.style.transform = 'translate(-50%, -50%)';
    toast.style.background = 'rgba(34,34,34,0.97)';
    toast.style.color = '#fff';
    toast.style.fontSize = '1.2em';
    toast.style.padding = '12px 28px';
    toast.style.borderRadius = '12px';
    toast.style.boxShadow = '0 4px 24px rgba(0,0,0,0.18)';
    toast.style.border = '2px solid #3b82f6';
    toast.style.zIndex = '9999';
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.15s';
    document.body.appendChild(toast);
  }
  
  // Hvis meldingen er en feilmelding, vis kun meldingen
  if (typeof msg === 'string' && msg.startsWith('Du må')) {
    toast.textContent = msg;
  } else {
    toast.textContent = `${msg} registrert`;
  }
  
  toast.style.opacity = '1';
  
  setTimeout(() => {
    toast.style.opacity = '0';
  }, 1500);
}

/**
 * Sett status på søkefelt
 * @param {HTMLElement} statusDot - Status-prikk element
 * @param {HTMLElement} statusText - Status-tekst element
 * @param {string} mode - Modus: 'idle', 'loading', 'error'
 * @param {string} text - Teksten som skal vises
 */
export function setStatus(statusDot, statusText, mode, text) {
  statusText.textContent = text;
  
  if (mode === 'idle') {
    statusDot.style.background = '#22c55e';
    statusDot.style.boxShadow = '0 0 0 6px rgba(34, 197, 94, 0.16)';
  } else if (mode === 'loading') {
    statusDot.style.background = '#fbbf24';
    statusDot.style.boxShadow = '0 0 0 6px rgba(251, 191, 36, 0.24)';
  } else {
    statusDot.style.background = '#ef4444';
    statusDot.style.boxShadow = '0 0 0 6px rgba(239, 68, 68, 0.27)';
  }
}

/**
 * Sett lokasjonsstatus
 * @param {HTMLElement} locDot - Lokasjon-prikk element
 * @param {HTMLElement} locText - Lokasjon-tekst element
 * @param {string} mode - Modus: 'ok', 'error', 'idle', 'pending'
 * @param {string} text - Teksten som skal vises
 */
export function setLocationStatus(locDot, locText, mode, text) {
  if (locText) {
    locText.textContent = text;
    if (mode !== 'ok') {
      locText.removeAttribute('title');
    }
  }
  
  if (!locDot) return;
  
  if (mode === 'ok') {
    locDot.style.background = '#22c55e';
  } else if (mode === 'error') {
    locDot.style.background = '#ef4444';
  } else {
    locDot.style.background = '#6b7280';
  }
}

/**
 * Haversine-formel for å beregne avstand mellom to koordinater
 * @param {number} lat1 - Breddegrad 1
 * @param {number} lon1 - Lengdegrad 1
 * @param {number} lat2 - Breddegrad 2
 * @param {number} lon2 - Lengdegrad 2
 * @returns {number} - Avstand i meter
 */
export function haversine(lat1, lon1, lat2, lon2) {
  function toRad(x) {
    return x * Math.PI / 180;
  }
  
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  
  return R * c;
}
