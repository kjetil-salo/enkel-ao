/**
 * Felles hjelpefunksjoner for frontend-moduler.
 */

/**
 * Formater Date til lokal ISO-lignende streng (YYYY-MM-DDTHH:MM:SS)
 * som bevarer lokal tid ved parsing.
 */
export function toLocalISOString(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mi = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}`;
}

/**
 * Beregn avstand mellom to punkter (haversine-formel).
 * @param {number} lat1 - Latitude punkt 1
 * @param {number} lon1 - Longitude punkt 1
 * @param {number} lat2 - Latitude punkt 2
 * @param {number} lon2 - Longitude punkt 2
 * @returns {number|null} - Avstand i meter, eller null hvis ugyldig
 */
export function haversine(lat1, lon1, lat2, lon2) {
  if (lat1 == null || lon1 == null || lat2 == null || lon2 == null) return null;
  const R = 6371e3;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}
