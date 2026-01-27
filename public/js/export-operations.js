/**
 * Eksport-modul for CSV-eksport, kopiering og sletting av observasjoner
 */

import { toCsv } from './observations.js';
import { flashButton } from './ui.js';

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
  } catch (e) {
    console.warn('Kunne ikke kopiere CSV til utklippstavlen', e);
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
