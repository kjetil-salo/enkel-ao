/**
 * Felles «beskjær og juster»-modal for bilder som velges inne i appen.
 *
 * Samme redigering som «Tidligere sendt» allerede har — beskjæring, eksponering,
 * opplysning av mørke partier og zoom til utsnittet — men som et lag over den
 * modalen man allerede står i. Bygger sin egen DOM én gang i stedet for å kreve
 * markup i hver side som bruker den: da er den tilgjengelig overalt der
 * `photo-picker.js` er, uten at to HTML-blokker må holdes i synk.
 *
 * `apneBildeRedigering(dataUrl)` gir en Promise som løses med den redigerte
 * data-URL-en, eller `null` hvis brukeren avbrøt.
 */

// Versjonert: `settZoom`/`vedVisningsendring` er nye i v1.59.9, og en cachet
// gammel bilde-editor.js ville gitt TypeError i det zoomknappen brukes.
import { lagBildeEditor } from './bilde-editor.js?v=v1.60.12';

// Samme kvalitet som photo-picker.js bruker på et nyvalgt bilde, så en tur innom
// redigeringen ikke er et skjult kvalitetstap for den som bare ville beskjære.
const JPEG_KVALITET = 0.85;

let lag = null;       // ytterste element, bygget én gang
let editor = null;
let apneLoser = null; // resolve-funksjonen til den åpne Promise-en

function bygg() {
  lag = document.createElement('div');
  lag.id = 'bilde-rediger-lag';
  lag.hidden = true;
  lag.innerHTML = `
    <div class="brl-kort" role="dialog" aria-modal="true" aria-label="Beskjær og juster bilde">
      <div class="brl-topp">
        <strong>Beskjær og juster</strong>
        <button type="button" class="brl-lukk" data-brl="avbryt" aria-label="Lukk">×</button>
      </div>
      <div class="brl-lerret"><canvas data-brl="lerret"></canvas></div>
      <p class="brl-hint">Dra i hjørnene for å beskjære, eller inni for å flytte utsnittet.
        Visningen zoomer inn på utsnittet når du slipper.</p>
      <div class="brl-skyv">
        <label for="brl-eksponering">Eksponering</label>
        <input type="range" id="brl-eksponering" data-brl="eksponering"
               min="-100" max="100" value="0" step="5" />
        <output data-brl="eksponering-verdi" for="brl-eksponering">0</output>
        <label for="brl-skygger">Mørke partier</label>
        <input type="range" id="brl-skygger" data-brl="skygger"
               min="0" max="100" value="0" step="5" />
        <output data-brl="skygger-verdi" for="brl-skygger">0</output>
      </div>
      <div class="brl-verktoy">
        <button type="button" class="btn-ghost" data-brl="zoom" hidden>⤢ Vis hele bildet</button>
        <button type="button" class="btn-ghost" data-brl="nullstill">↺ Tilbakestill</button>
      </div>
      <div class="brl-bunn">
        <button type="button" class="btn-ghost" data-brl="avbryt">Avbryt</button>
        <button type="button" class="brl-primar" data-brl="bruk">Bruk bildet</button>
      </div>
    </div>`;
  document.body.appendChild(lag);

  const el = (navn) => lag.querySelector(`[data-brl="${navn}"]`);
  const lerret = el('lerret');
  const eksp = el('eksponering');
  const ekspVerdi = el('eksponering-verdi');
  const skyg = el('skygger');
  const skygVerdi = el('skygger-verdi');
  const zoomKnapp = el('zoom');

  editor = lagBildeEditor(lerret);

  // Knappen speiler editorens egen tilstand, så de to ikke kan komme ut av takt
  // når editoren zoomer av seg selv etter et dra.
  editor.vedVisningsendring(({ zoomet, kanZoome }) => {
    zoomKnapp.hidden = !kanZoome;
    zoomKnapp.textContent = zoomet ? '⤢ Vis hele bildet' : '🔍 Zoom til utsnitt';
    zoomKnapp.dataset.zoomet = zoomet ? '1' : '';
  });

  zoomKnapp.addEventListener('click', () => editor.settZoom(!zoomKnapp.dataset.zoomet));

  eksp.addEventListener('input', () => {
    ekspVerdi.textContent = eksp.value;
    editor.settEksponering(eksp.value);
  });
  skyg.addEventListener('input', () => {
    skygVerdi.textContent = skyg.value;
    editor.settSkygger(skyg.value);
  });

  el('nullstill').addEventListener('click', () => {
    editor.tilbakestill();
    nullstillSkyv();
  });

  lag.querySelectorAll('[data-brl="avbryt"]').forEach((b) => {
    b.addEventListener('click', () => lukk(null));
  });
  el('bruk').addEventListener('click', () => {
    lukk(editor.harBilde() ? editor.hentResultat(JPEG_KVALITET) : null);
  });

  // Klikk på bakgrunnen lukker, men ikke klikk inne i kortet.
  lag.addEventListener('click', (e) => { if (e.target === lag) lukk(null); });

  // Escape håndteres her og stoppes, slik at modalen UNDER (registrering eller
  // redigering) ikke lukkes samtidig og tar med seg skjemaet brukeren står i.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !lag.hidden) {
      e.stopPropagation();
      e.preventDefault();
      lukk(null);
    }
  }, true);

  lag.__brl = { eksp, ekspVerdi, skyg, skygVerdi };
}

function nullstillSkyv() {
  const { eksp, ekspVerdi, skyg, skygVerdi } = lag.__brl;
  eksp.value = 0;
  ekspVerdi.textContent = '0';
  skyg.value = 0;
  skygVerdi.textContent = '0';
}

function lukk(resultat) {
  if (!lag || lag.hidden) return;
  lag.hidden = true;
  const loser = apneLoser;
  apneLoser = null;
  if (loser) loser(resultat);
}

/**
 * Åpne redigeringen på et bilde. Løses med ny data-URL, eller `null` ved avbrudd.
 */
export async function apneBildeRedigering(dataUrl) {
  if (!dataUrl) return null;
  if (!lag) bygg();

  // En åpen redigering som ikke er avsluttet skal ikke bli hengende som en
  // Promise ingen løser — avbryt den før en ny tar over.
  lukk(null);

  try {
    await editor.settBilde(dataUrl);
  } catch (e) {
    console.warn('Kunne ikke åpne bildet for redigering', e);
    return null;
  }

  nullstillSkyv();
  lag.hidden = false;
  return new Promise((resolve) => { apneLoser = resolve; });
}
