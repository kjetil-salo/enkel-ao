import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Map features: default OSM, dynamic attribution, zoom 18, and GPS recenter button', () => {
  const mapHtmlPath = path.resolve(__dirname, '../../public/map.html');
  const mapJsPath = path.resolve(__dirname, '../../public/js/map.js');

  const mapHtml = fs.readFileSync(mapHtmlPath, 'utf-8');
  const mapJs = fs.readFileSync(mapJsPath, 'utf-8');

  it('1. har satt OpenStreetMap (OSM) som standard aktivt basislag', () => {
    // osmLayer skal legges til map som default i stedet for kartverketTopoLayer
    expect(mapJs).toContain('osmLayer.addTo(map);');
    // OpenStreetMap skal være listet i L.control.layers
    expect(mapJs).toContain("'OpenStreetMap': osmLayer");
  });

  it('2. har dynamisk attribusjon og fjerner Kartverket fra OSM-laget', () => {
    // osmLayer skal kun ha OpenStreetMap-attribusjon, IKKE Kartverket
    const osmLayerDef = mapJs.match(/const osmLayer = createCachedTileLayer\([\s\S]*?\);/);
    expect(osmLayerDef).not.toBeNull();
    expect(osmLayerDef[0]).toContain('OpenStreetMap');
    expect(osmLayerDef[0]).not.toContain('Kartverket');

    // map.html skal skjule map-corner-attribution som standard
    expect(mapHtml).toContain('id="map-corner-attribution" style="display:none;"');

    // map.js skal oppdatere attribusjonen ved bytte av lag
    expect(mapJs).toContain("map.on('baselayerchange'");
    expect(mapJs).toContain('updateMapAttribution');
  });

  it('3. har satt geolocation zoom level til 18 (nest mest innzoomede nivå / 30m målestokk)', () => {
    expect(mapJs).toContain('const GEOLOCATION_ZOOM_LEVEL = 18;');
    expect(mapJs).toContain('map.setView([lat, lon], GEOLOCATION_ZOOM_LEVEL');
  });

  it('4. har flytende GPS-resentreringsknapp i HTML og tilhørende logikk i JS', () => {
    // Knappen skal finnes i HTML
    expect(mapHtml).toContain('id="gps-recenter-btn"');
    expect(mapHtml).toContain('class="gps-recenter-btn"');

    // CSS-styling skal være definert
    expect(mapHtml).toContain('.gps-recenter-btn {');

    // JS skal ha recenterToGps og koble til knappen
    expect(mapJs).toContain('function recenterToGps()');
    expect(mapJs).toContain("document.getElementById('gps-recenter-btn')");
    expect(mapJs).toContain("gpsRecenterBtn.addEventListener('click'");
  });
});
