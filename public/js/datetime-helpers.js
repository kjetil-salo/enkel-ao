/**
 * Dato/tid-hjelpefunksjoner delt mellom edit.html og redigerings-modalen.
 */

/** Hent YYYY-MM-DD fra ISO-streng */
export function isoToDate(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return '';
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/** Hent HH:MM fra ISO-streng — tom streng hvis 00:00 (indikerer at tid ikke er satt) */
export function isoToTime(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return '';
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  if (hh === '00' && mm === '00') return '';
  return `${hh}:${mm}`;
}

export function toLocalIso(d) {
  const yyyy = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const dy = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${yyyy}-${mo}-${dy}T${hh}:${mi}:${ss}`;
}

/** Oppdater dato og/eller tid i en ISO-streng, behold resten uendret */
export function updateDateTimeInIso(isoStr, dateStr, timeStr) {
  const d = isoStr ? new Date(isoStr) : new Date();
  if (isNaN(d.getTime())) return isoStr || toLocalIso(new Date());

  if (dateStr) {
    const [yyyy, mm, dd] = dateStr.split('-').map(Number);
    d.setFullYear(yyyy, mm - 1, dd);
  }

  if (timeStr) {
    const [hh, mm] = timeStr.split(':').map(Number);
    d.setHours(hh, mm, 0, 0);
  } else {
    d.setHours(0, 0, 0, 0);
  }

  return toLocalIso(d);
}
