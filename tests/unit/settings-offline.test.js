import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Settings offline mode protection for force-update-btn', () => {
  const settingsHtmlPath = path.resolve(__dirname, '../../public/settings.html');
  const settingsHtml = fs.readFileSync(settingsHtmlPath, 'utf-8');

  it('har modal-elementet #offline-update-modal med riktig tekst og knapper', () => {
    expect(settingsHtml).toContain('id="offline-update-modal"');
    expect(settingsHtml).toContain('Du er offline! Kan ikke hente nyeste versjon.');
    expect(settingsHtml).toContain('id="offline-update-close-btn"');
  });

  it('deaktiverer Hent nyeste versjon i offline-modus', () => {
    expect(settingsHtml).toContain('function isAppOffline()');
    expect(settingsHtml).toContain('function updateForceUpdateBtnState()');
    expect(settingsHtml).toContain("forceUpdateBtn.setAttribute('aria-disabled', 'true');");
    expect(settingsHtml).toContain("cursor = 'not-allowed'");
  });

  it('viser modalen når knappen klikkes i offline-modus og stopper oppdatering', () => {
    expect(settingsHtml).toContain('if (isAppOffline())');
    expect(settingsHtml).toContain('openOfflineUpdateModal()');
  });

  it('har ikke utilsiktet script-oppsplitting som bryter modul-scope for fjernOverforingssesjon', () => {
    expect(settingsHtml).toContain("import { fjernOverforingssesjon } from './js/arbeidsliste-sesjon.js';");
    expect(settingsHtml).not.toMatch(/<\/script>\s*<script>\s*\/\/\s*Tema/);
  });
});
