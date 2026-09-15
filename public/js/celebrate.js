/**
 * Sjelden-fugl-feiring: fyrverkeri på hele skjermen når en registrert
 * observasjon har en aktiv sjeldenhetsvarsel-boks (obs.rarityWarning).
 *
 * Bevisst stort — det skjer sjelden nok (langt fra hver registrering) til at
 * det tåler å ta plass, i motsetning til f.eks. den vanlige registrerings-
 * toasten som må være diskré fordi den vises på hver eneste art.
 */

const EMOJI = ['🎉', '✨', '🎆', '⭐', '💫'];
const PIECE_COUNT = 50;
const CLEANUP_MS = 3000;

function prefersReducedMotion() {
  try {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (e) {
    return false;
  }
}

function spawnConfetti() {
  const overlay = document.createElement('div');
  overlay.className = 'rarity-celebration';
  overlay.setAttribute('aria-hidden', 'true');

  for (let i = 0; i < PIECE_COUNT; i++) {
    const piece = document.createElement('span');
    piece.className = 'rarity-celebration-piece';
    piece.textContent = EMOJI[Math.floor(Math.random() * EMOJI.length)];
    piece.style.left = `${Math.random() * 100}vw`;
    piece.style.fontSize = `${14 + Math.random() * 20}px`;
    piece.style.setProperty('--rarity-delay', `${Math.random() * 0.5}s`);
    piece.style.setProperty('--rarity-duration', `${1.8 + Math.random() * 1.2}s`);
    piece.style.setProperty('--rarity-drift', `${Math.random() * 200 - 100}px`);
    piece.style.setProperty('--rarity-spin', `${Math.round(Math.random() * 720 - 360)}deg`);
    overlay.appendChild(piece);
  }

  document.body.appendChild(overlay);
  setTimeout(() => overlay.remove(), CLEANUP_MS);
}

function spawnBanner(speciesName) {
  const banner = document.createElement('div');
  banner.className = 'rarity-celebration-banner';
  banner.setAttribute('aria-hidden', 'true');
  banner.textContent = speciesName ? `🎉 Sjeldent funn: ${speciesName}!` : '🎉 Sjeldent funn!';
  document.body.appendChild(banner);
  setTimeout(() => banner.remove(), CLEANUP_MS);
}

/**
 * Vis fyrverkeri for en sjelden observasjon. Ikke-blokkerende
 * (pointer-events: none) — brukeren kan fortsette å registrere med én gang.
 */
export function celebrateRareFind(speciesName) {
  if (prefersReducedMotion()) {
    // Behold selve informasjonen (banner), men uten bevegelse.
    spawnBanner(speciesName);
    return;
  }
  spawnConfetti();
  spawnBanner(speciesName);
}
