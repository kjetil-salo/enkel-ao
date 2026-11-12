import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { haversine, setLocationStatus, showToast, DEFAULT_TOAST_DURATION_MS, MODE_SPLASH_DURATION_MS } from '../../public/js/ui.js';

describe('splash / toast varighet ved modusendring', () => {
  it('viser splash-vindu ved endring av modus dobbelt så lenge som standard toast', () => {
    expect(DEFAULT_TOAST_DURATION_MS).toBe(1500);
    expect(MODE_SPLASH_DURATION_MS).toBe(DEFAULT_TOAST_DURATION_MS * 2);
    expect(MODE_SPLASH_DURATION_MS).toBe(3000);
  });
});

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

describe('showToast slettemelding og nynorsk', () => {
  afterEach(() => {
    const toast = document.getElementById('registered-toast');
    if (toast) toast.remove();
    delete window.__isNynorsk;
  });

  it('gjenkjenner "Sletta <art>" som sletting og setter oransje/gul ramme uten "registrert"-suffix', () => {
    showToast('Sletta Gråmåse');
    const toast = document.getElementById('registered-toast');
    expect(toast).not.toBeNull();
    expect(toast.textContent).toBe('Sletta Gråmåse');
    expect(toast.style.borderColor).toBe('rgb(245, 158, 11)'); // #f59e0b
  });

  it('gjenkjenner "Slettet <art>" som sletting og setter oransje/gul ramme', () => {
    showToast('Slettet Gråmåke');
    const toast = document.getElementById('registered-toast');
    expect(toast).not.toBeNull();
    expect(toast.textContent).toBe('Slettet Gråmåke');
    expect(toast.style.borderColor).toBe('rgb(245, 158, 11)');
  });

  it('viser "Angra" på undo-knappen når nynorsk er aktivt', () => {
    window.__isNynorsk = () => true;
    showToast('Sletta Svartbak', { onUndo: () => {} });
    const toast = document.getElementById('registered-toast');
    const undoBtn = toast.querySelector('button');
    expect(undoBtn).not.toBeNull();
    expect(undoBtn.textContent).toBe('Angra');
  });

  it('viser "Angre" på undo-knappen på bokmål', () => {
    window.__isNynorsk = () => false;
    showToast('Slettet Svartbak', { onUndo: () => {} });
    const toast = document.getElementById('registered-toast');
    const undoBtn = toast.querySelector('button');
    expect(undoBtn).not.toBeNull();
    expect(undoBtn.textContent).toBe('Angre');
  });
});

