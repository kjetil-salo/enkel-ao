import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Map & Service Worker offline resilience for Leaflet', () => {
  const mapHtmlPath = path.resolve(__dirname, '../../public/map.html');
  const mapJsPath = path.resolve(__dirname, '../../public/js/map.js');
  const swJsPath = path.resolve(__dirname, '../../public/sw.js');

  const mapHtml = fs.readFileSync(mapHtmlPath, 'utf-8');
  const mapJs = fs.readFileSync(mapJsPath, 'utf-8');
  const swJs = fs.readFileSync(swJsPath, 'utf-8');

  it('1. sw.js forhåndslaster Leaflet og MarkerCluster i STATIC_ASSETS', () => {
    expect(swJs).toContain("'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'");
    expect(swJs).toContain("'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'");
    expect(swJs).toContain("'https://unpkg.com/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js'");
    expect(swJs).toContain("'https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css'");
  });

  it('2. sw.js har nettverksfallback i handleExternalAssetFetch i offline-modus', () => {
    expect(swJs).toContain('handleExternalAssetFetch');
    // Skal forsøke fetch dersom cachen mangler ressursen
    expect(swJs).toMatch(/handleExternalAssetFetch[\s\S]*?mode === 'offline'[\s\S]*?fetch\(request\)/);
  });

  it('3. map.html har inline fallback til cdnjs hvis unpkg feiler', () => {
    expect(mapHtml).toContain("typeof L === 'undefined'");
    expect(mapHtml).toContain('cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js');
    expect(mapHtml).toContain('cdnjs.cloudflare.com/ajax/libs/leaflet.markercluster/1.5.3/leaflet.markercluster.js');
  });

  it('4. map.js har guard mot manglende L i initMap og startMapUI', () => {
    expect(mapJs).toContain("typeof L === 'undefined'");
    expect(mapJs).toContain('function startMapUI()');
    expect(mapJs).toContain('Kunne ikke laste kartet');
  });
});
