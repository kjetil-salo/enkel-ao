/**
 * Eksport-modul for CSV-eksport, kopiering og sletting av observasjoner
 */

import { toCsv } from './observations.js';
import { flashButton } from './ui.js';

function _statusColor(type) {
  const light = document.body.classList.contains('theme-light');
  const colors = {
    info:    light ? '#2563eb' : '#93c5fd',
    success: light ? '#16a34a' : '#86efac',
    error:   light ? '#dc2626' : '#fca5a5',
  };
  return colors[type];
}

export function handleExport(observations, dom) {
  const csv = toCsv(observations);
  if (!csv) return;

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'fugleobservasjoner.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  flashButton(dom.exportBtn, 'Lastet ned!');
}

async function copyToClipboard(csv) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    await navigator.clipboard.writeText(csv);
  } else {
    const ta = document.createElement('textarea');
    ta.value = csv;
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try {
      document.execCommand('copy');
    } finally {
      document.body.removeChild(ta);
    }
  }
}

export async function handleCopy(observations, dom) {
  const csv = toCsv(observations);
  if (!csv) return;

  try {
    await copyToClipboard(csv);
    flashButton(dom.copyBtn, 'Kopiert!');
  } catch (e) {
    console.warn('Kunne ikke kopiere CSV til utklippstavlen', e);
  }
}

export async function handleCopyAndOpen(observations, dom) {
  const csv = toCsv(observations);
  if (!csv) return;

  try {
    await copyToClipboard(csv);
    window.open('https://www.artsobservasjoner.no/ImportSighting', '_blank');
    flashButton(dom.copyOpenBtn, 'Åpnet!');
    fetch('/api/log-export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'copy_open' }) }).catch(() => {});
  } catch (e) {
    console.warn('Kunne ikke kopiere CSV til utklippstavlen', e);
  }
}

export async function handleDirectSend(observations, dom, callbacks) {
  if (!observations.length) return;

  const username = localStorage.getItem('ao_username');
  const password = localStorage.getItem('ao_password');
  if (!username || !password) return;

  dom.aoDirectBtn.disabled = true;
  dom.aoDirectStatus.style.display = 'block';
  dom.aoDirectStatus.style.cssText = `display:block;margin-top:8px;padding:10px;border-radius:8px;font-size:0.9rem;background:rgba(59,130,246,0.1);border:1px solid rgba(59,130,246,0.3);color:${_statusColor('info')};`;
  dom.aoDirectStatus.textContent = '⏳ Logger inn på AO...';

  try {
    const loginResp = await fetch('/api/ao-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const loginResult = await loginResp.json();
    if (!loginResp.ok || !loginResult.success) {
      throw new Error(loginResult.error || 'Innlogging feilet');
    }

    const tokens = JSON.parse(localStorage.getItem('ao_tokens') || '{}');
    tokens.loginToken = loginResult.loginToken;
    tokens.authCookie = loginResult.authCookie;
    tokens.userId = tokens.mapUserId || loginResult.userId;
    localStorage.setItem('ao_tokens', JSON.stringify(tokens));

    dom.aoDirectStatus.textContent = '⏳ Sender observasjoner...';

    const importResp = await fetch('/api/ao-import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        observations,
        loginToken: tokens.loginToken,
        authCookie: tokens.authCookie,
        areaId: localStorage.getItem('ao_area') ? JSON.parse(localStorage.getItem('ao_area')).id : '',
      }),
    });
    const importResult = await importResp.json();

    if (importResp.ok && importResult.success) {
      if (importResult.refreshedAuthCookie) {
        const t = JSON.parse(localStorage.getItem('ao_tokens') || '{}');
        t.authCookie = importResult.refreshedAuthCookie;
        localStorage.setItem('ao_tokens', JSON.stringify(t));
      }
      dom.aoDirectStatus.style.cssText = `display:block;margin-top:8px;padding:10px;border-radius:8px;font-size:0.9rem;background:rgba(34,197,94,0.1);border:1px solid rgba(34,197,94,0.3);color:${_statusColor('success')};`;
      dom.aoDirectStatus.textContent = `✅ ${importResult.count} observasjon${importResult.count !== 1 ? 'er' : ''} sendt til AO!`;
      fetch('/api/log-export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'direct' }) }).catch(() => {});

      setTimeout(() => {
        if (confirm('Sending vellykket! Vil du tømme observasjonslisten?')) {
          observations.splice(0, observations.length);
          callbacks.doRenderObservations();
          callbacks.saveState();
          dom.aoDirectStatus.style.display = 'none';
        }
      }, 1500);
    } else {
      throw new Error(importResult.error || 'Import feilet');
    }
  } catch (error) {
    dom.aoDirectStatus.style.cssText = `display:block;margin-top:8px;padding:10px;border-radius:8px;font-size:0.9rem;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);color:${_statusColor('error')};`;
    dom.aoDirectStatus.textContent = `❌ ${error.message}`;
    dom.aoDirectBtn.disabled = false;
  }
}

export function handleClear(observations, dom, callbacks) {
  if (!observations.length) return;
  const ok = window.confirm('Slette alle observasjoner i listen?');
  if (!ok) return;
  observations.splice(0, observations.length);
  callbacks.doRenderObservations();
  callbacks.saveState();
}
