/**
 * Push-varsler: logikken bak /varsler.html.
 *
 * Appen ber ALDRI om tillatelse av seg selv. Det skjer bare når brukeren slår
 * bryteren på, fordi nettleseren krever et brukertrykk og fordi et uoppfordret
 * spørsmål om varsler som regel gir et varig nei.
 *
 * Serveren lagrer bare abonnementet. Selve utsendingen gjøres for hånd, se
 * src/push_varsel.py og docs/push-varsler.md.
 */

/**
 * VAPID-nøkkelen kommer som base64url. `pushManager.subscribe` vil ha bytes.
 * @param {string} b64url
 * @returns {Uint8Array}
 */
/**
 * Varseltypene brukeren kan velge. Rekkefølgen er visningsrekkefølgen.
 * En ny type legges til her OG i KJENTE_EMNER i src/push_varsel.py.
 */
export const VARSELTYPER = [
  {
    id: 'nyheter',
    tittel: '📰 Nyheter i appen',
    tekst: 'Et varsel når det kommer noe nytt i Enkel-AO. Sjelden — bare ved større nyheter.',
  },
];

const EMNER_NOKKEL = 'pushEmner_v1';

/** Emnene brukeren har valgt på denne enheten (bare kjente). */
export function lesValgteEmner() {
  try {
    const lagret = JSON.parse(localStorage.getItem(EMNER_NOKKEL) || '[]');
    const kjente = VARSELTYPER.map((v) => v.id);
    return Array.isArray(lagret) ? kjente.filter((id) => lagret.includes(id)) : [];
  } catch {
    return [];
  }
}

function lagreValgteEmner(emner) {
  if (emner.length) localStorage.setItem(EMNER_NOKKEL, JSON.stringify(emner));
  else localStorage.removeItem(EMNER_NOKKEL);
}

export function base64UrlTilBytes(b64url) {
  const b64 = (b64url + '='.repeat((4 - (b64url.length % 4)) % 4))
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const rå = atob(b64);
  const ut = new Uint8Array(rå.length);
  for (let i = 0; i < rå.length; i++) ut[i] = rå.charCodeAt(i);
  return ut;
}

/** Kjører appen som installert hjemskjerm-app? På iPhone er det et krav for push. */
function erInstallert() {
  return window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
}

function erIos() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

/**
 * Hva enheten kan. `grunn` er en tekst til brukeren når svaret er nei.
 * @returns {{stottet: boolean, grunn?: string}}
 */
export function pushStotte() {
  const harApi = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  if (harApi) return { stottet: true };
  if (erIos() && !erInstallert()) {
    return {
      stottet: false,
      grunn: 'På iPhone må appen ligge på hjemskjermen før den kan sende varsler: '
        + 'trykk Del → «Legg til på Hjem-skjerm», og åpne appen derfra.',
    };
  }
  return { stottet: false, grunn: 'Denne nettleseren støtter ikke varsler.' };
}

async function hentAbonnement() {
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

async function sendTilServer(sti, body) {
  const resp = await fetch(sti, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(`Serveren svarte ${resp.status}`);
}

/**
 * Emnene som faktisk er aktive på denne enheten: tomt hvis tillatelse eller
 * abonnement mangler, selv om noe står lagret lokalt.
 */
export async function aktiveEmner() {
  if (!pushStotte().stottet || Notification.permission !== 'granted') return [];
  if (!(await hentAbonnement())) return [];
  const valgt = lesValgteEmner();
  // Abonnement uten lagret valg (f.eks. tømt localStorage): nyheter er standard.
  return valgt.length ? valgt : ['nyheter'];
}

/**
 * Sett hvilke emner denne enheten skal ha varsel om. Tom liste slår push helt
 * av. Må kalles direkte fra et brukertrykk når den kan slå på.
 * @param {string[]} emner
 */
export async function settEmner(emner) {
  if (emner.length === 0) {
    await slaAv();
    lagreValgteEmner([]);
    return;
  }
  await slaPa(emner);
  lagreValgteEmner(emner);
}

async function slaPa(emner) {
  const tillatelse = await Notification.requestPermission();
  if (tillatelse !== 'granted') {
    throw new Error(tillatelse === 'denied'
      ? 'Varsler er blokkert for denne siden. Du kan tillate dem i nettleserens innstillinger.'
      : 'Du svarte ikke på spørsmålet om varsler.');
  }
  const resp = await fetch('/api/push-public-key');
  const { publicKey } = resp.ok ? await resp.json() : {};
  if (!publicKey) throw new Error('Varsler er ikke satt opp på serveren ennå.');

  const reg = await navigator.serviceWorker.ready;
  let abonnement = await reg.pushManager.getSubscription();
  if (!abonnement) {
    abonnement = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlTilBytes(publicKey),
    });
  }
  await sendTilServer('/api/push-subscribe', { subscription: abonnement.toJSON(), emner });
}

async function slaAv() {
  const abonnement = await hentAbonnement();
  if (!abonnement) return;
  const { endpoint } = abonnement;
  await abonnement.unsubscribe();
  // Feiler dette, svarer push-tjenesten 410 neste gang, og abonnementet ryddes da.
  try { await sendTilServer('/api/push-unsubscribe', { endpoint }); } catch { /* se over */ }
}

/**
 * Meld et eksisterende abonnement inn på nytt. Idempotent på serveren, og
 * dekker at serverens database er tømt eller at nettleseren har rullert nøklene.
 */
export async function fornyHosServer() {
  try {
    if (Notification.permission !== 'granted') return;
    const abonnement = await hentAbonnement();
    const emner = lesValgteEmner().length ? lesValgteEmner() : ['nyheter']; // som aktiveEmner()
    if (abonnement) {
      await sendTilServer('/api/push-subscribe', { subscription: abonnement.toJSON(), emner });
    }
  } catch {
    // Stille: en mislykket fornyelse skal ikke synes på innstillingssiden.
  }
}
