import { describe, it, expect } from 'vitest';
import { haversine, setLocationStatus } from '../../public/js/ui.js';

describe('haversine', () => {
  it('should calculate distance between Oslo and Bergen correctly', () => {
    const osloLat = 59.9139;
    const osloLon = 10.7522;
    const bergenLat = 60.3913;
    const bergenLon = 5.3221;

    const distance = haversine(osloLat, osloLon, bergenLat, bergenLon);

    // Faktisk avstand Oslo-Bergen er ca 308 km
    expect(distance).toBeGreaterThan(300000); // > 300 km
    expect(distance).toBeLessThan(320000);    // < 320 km
  });

  it('should return 0 for identical coordinates', () => {
    const lat = 59.9139;
    const lon = 10.7522;

    const distance = haversine(lat, lon, lat, lon);

    expect(distance).toBe(0);
  });

  it('should calculate short distances accurately', () => {
    // To punkter ca 1 km fra hverandre
    const lat1 = 59.9139;
    const lon1 = 10.7522;
    const lat2 = 59.9229; // ca 1 km nord
    const lon2 = 10.7522;

    const distance = haversine(lat1, lon1, lat2, lon2);

    expect(distance).toBeGreaterThan(900);   // > 900 m
    expect(distance).toBeLessThan(1100);     // < 1100 m
  });

  it('should handle crossing the equator', () => {
    const distance = haversine(10, 0, -10, 0);

    expect(distance).toBeGreaterThan(2200000); // > 2200 km
    expect(distance).toBeLessThan(2300000);    // < 2300 km
  });

  it('should handle crossing the prime meridian', () => {
    const distance = haversine(0, 10, 0, -10);

    expect(distance).toBeGreaterThan(2200000); // > 2200 km
    expect(distance).toBeLessThan(2300000);    // < 2300 km
  });
});

// ─── setLocationStatus ──────────────────────────────────────────

describe('setLocationStatus', () => {
  function makeDom() {
    return { locDot: document.createElement('span'), locText: document.createElement('span') };
  }

  it('should add "pending" class to locDot for mode=pending', () => {
    const { locDot, locText } = makeDom();
    setLocationStatus(locDot, locText, 'pending', 'Henter lokasjon …');
    expect(locDot.classList.contains('pending')).toBe(true);
  });

  it('should remove "pending" class for mode=ok', () => {
    const { locDot, locText } = makeDom();
    locDot.classList.add('pending');
    setLocationStatus(locDot, locText, 'ok', 'Lokasjon hentet');
    expect(locDot.classList.contains('pending')).toBe(false);
  });

  it('should remove "pending" class for mode=error', () => {
    const { locDot, locText } = makeDom();
    locDot.classList.add('pending');
    setLocationStatus(locDot, locText, 'error', 'Kunne ikke hente lokasjon');
    expect(locDot.classList.contains('pending')).toBe(false);
  });

  it('should not throw when locDot is null', () => {
    const { locText } = makeDom();
    expect(() => setLocationStatus(null, locText, 'pending', 'Henter …')).not.toThrow();
  });
});
