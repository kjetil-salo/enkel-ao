/**
 * Besøk er feltkonteksten på en lokalitet.
 * Samme lokalitet kan besøkes flere ganger samme dag.
 */

function normalizePlaceName(name) {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export function getPlaceKey(placeName, placeId = null) {
  if (placeId !== null && placeId !== undefined && String(placeId).trim() !== '') {
    return `id:${String(placeId).trim()}`;
  }
  const name = normalizePlaceName(placeName);
  return name ? `name:${name}` : 'name:uten-stedsnavn';
}

export function createVisitId(placeName, placeId = null, now = new Date()) {
  const safeTime = now instanceof Date && !isNaN(now.getTime()) ? now.getTime() : Date.now();
  const randomPart = Math.random().toString(36).slice(2, 8);
  return `visit:${getPlaceKey(placeName, placeId)}:${safeTime}:${randomPart}`;
}

export function getObservationPlaceKey(obs) {
  return getPlaceKey(obs?.placeName, obs?.placeId);
}

export function getObservationVisitKey(obs) {
  if (obs?.visitId) return obs.visitId;
  return `legacy:${getObservationPlaceKey(obs)}`;
}

export function findOpenVisitId(observations, placeName, placeId = null) {
  const placeKey = getPlaceKey(placeName, placeId);
  const newestByVisit = new Map();

  for (const obs of observations || []) {
    if (getObservationPlaceKey(obs) !== placeKey) continue;
    const visitKey = getObservationVisitKey(obs);
    if (!newestByVisit.has(visitKey)) {
      newestByVisit.set(visitKey, obs);
    }
  }

  for (const [visitKey, obs] of newestByVisit.entries()) {
    if (!obs.visitLocked) return visitKey;
  }

  return null;
}

export function resolveVisitIdForNewObservation(observations, placeName, placeId = null, now = new Date()) {
  return findOpenVisitId(observations, placeName, placeId) || createVisitId(placeName, placeId, now);
}

export function setVisitLocked(observations, visitKey, locked = true) {
  let count = 0;
  for (const obs of observations || []) {
    if (getObservationVisitKey(obs) !== visitKey) continue;
    obs.visitId = visitKey;
    obs.visitLocked = locked;
    count++;
  }
  return count;
}
