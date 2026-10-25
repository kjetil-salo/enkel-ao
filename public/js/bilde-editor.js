/**
 * Enkel bilderedigering før opplasting til Artsobservasjoner: beskjæring og
 * eksponering.
 *
 * Bevisst smalt omfang. Dette er ikke et redigeringsprogram — det er de to
 * grepene som faktisk trengs når et fuglebilde skal fra kamera til AO: kutt vekk
 * det som ikke er fuglen, og løft et bilde som ble for mørkt. Alt annet gjør man
 * i Lightroom før man kommer hit.
 *
 * Ingen biblioteker. Alt tegnes på en `<canvas>`, og beskjæringsrammen tegnes på
 * samme lerret i stedet for som DOM-elementer — det gir samme oppførsel med mus
 * og finger uten to sett med hendelser å holde i synk.
 */

// Lerretets maksimale visningsstørrelse i CSS-piksler. Selve eksporten skjer i
// full oppløsning uavhengig av dette.
const MAKS_VIS = 560;

// Samme grense som resten av appen bruker, og samme som AO skalerer til selv.
const MAKS_EKSPORT = 1600;

const HANDTAK = 11;        // treffradius for hjørnehåndtakene, i CSS-piksler
const MIN_UTSNITT = 24;    // minste tillatte beskjæring, i bildepiksler

/**
 * Regn om et eksponeringstrinn (-100..100) til en multiplikator.
 *
 * Fotografisk, ikke lineært: 100 = ett blenderstrinn opp (dobbelt så lyst),
 * -100 = ett ned. Et lineært påslag ville føltes dødt i midten og brent ut i
 * enden.
 */
export function eksponeringsfaktor(trinn) {
  const t = Math.max(-100, Math.min(100, Number(trinn) || 0));
  return Math.pow(2, t / 100);
}

/** Klem et utsnitt innenfor bildets kanter, og hindre at det blir for lite. */
export function klemUtsnitt(utsnitt, bildeBredde, bildeHoyde) {
  const b = Math.max(MIN_UTSNITT, Math.min(utsnitt.b, bildeBredde));
  const h = Math.max(MIN_UTSNITT, Math.min(utsnitt.h, bildeHoyde));
  return {
    x: Math.max(0, Math.min(utsnitt.x, bildeBredde - b)),
    y: Math.max(0, Math.min(utsnitt.y, bildeHoyde - h)),
    b,
    h,
  };
}

/** Anvend eksponering på rå pikseldata, på stedet. */
export function anvendEksponering(data, trinn) {
  const faktor = eksponeringsfaktor(trinn);
  if (faktor === 1) return data;
  for (let i = 0; i < data.length; i += 4) {
    data[i] = Math.min(255, data[i] * faktor);
    data[i + 1] = Math.min(255, data[i + 1] * faktor);
    data[i + 2] = Math.min(255, data[i + 2] * faktor);
  }
  return data;
}

/**
 * Hvor stort skal bildet vises, og hvilken skala gir det?
 * Skalaen brukes til å regne om mellom skjerm- og bildekoordinater.
 */
export function visningsmaal(bildeBredde, bildeHoyde, maks = MAKS_VIS) {
  const skala = Math.min(1, maks / Math.max(bildeBredde, bildeHoyde));
  return {
    bredde: Math.max(1, Math.round(bildeBredde * skala)),
    hoyde: Math.max(1, Math.round(bildeHoyde * skala)),
    skala,
  };
}

/**
 * Koble en editor til et lerret.
 *
 * @param {HTMLCanvasElement} canvas
 * @returns {{settBilde, settEksponering, tilbakestill, harBilde, hentResultat}}
 */
export function lagBildeEditor(canvas) {
  const ctx = canvas.getContext('2d');

  let bilde = null;          // HTMLImageElement
  let utsnitt = null;        // {x, y, b, h} i BILDEkoordinater
  let eksponering = 0;
  let vis = { bredde: 0, hoyde: 0, skala: 1 };

  // Pågående dra-operasjon: hvilket håndtak, og hvor utsnittet sto da den startet
  let drar = null;

  function tilBilde(punkt) {
    const rekt = canvas.getBoundingClientRect();
    return {
      x: (punkt.clientX - rekt.left) / vis.skala,
      y: (punkt.clientY - rekt.top) / vis.skala,
    };
  }

  function hjornene() {
    const { x, y, b, h } = utsnitt;
    return {
      nv: { x, y },
      no: { x: x + b, y },
      sv: { x, y: y + h },
      so: { x: x + b, y: y + h },
    };
  }

  function finnHandtak(p) {
    const terskel = HANDTAK / vis.skala;
    for (const [navn, hj] of Object.entries(hjornene())) {
      if (Math.abs(p.x - hj.x) <= terskel && Math.abs(p.y - hj.y) <= terskel) return navn;
    }
    const { x, y, b, h } = utsnitt;
    if (p.x >= x && p.x <= x + b && p.y >= y && p.y <= y + h) return 'flytt';
    return null;
  }

  function tegn() {
    if (!bilde) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bilde, 0, 0, vis.bredde, vis.hoyde);

    // Eksponeringen vises live. Billig nok på visningsstørrelse, og gir et ærlig
    // bilde av hva eksporten faktisk blir — i motsetning til et CSS-filter, som
    // ikke nødvendigvis regner likt som pikselløkka under.
    if (eksponering !== 0) {
      const d = ctx.getImageData(0, 0, vis.bredde, vis.hoyde);
      anvendEksponering(d.data, eksponering);
      ctx.putImageData(d, 0, 0);
    }

    const s = vis.skala;
    const x = utsnitt.x * s;
    const y = utsnitt.y * s;
    const b = utsnitt.b * s;
    const h = utsnitt.h * s;

    // Demp alt utenfor utsnittet
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.beginPath();
    ctx.rect(0, 0, vis.bredde, vis.hoyde);
    ctx.rect(x, y, b, h);
    ctx.fill('evenodd');
    ctx.restore();

    // Ramme og tredjedelslinjer
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, b, h);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(x + (b * i) / 3, y);
      ctx.lineTo(x + (b * i) / 3, y + h);
      ctx.moveTo(x, y + (h * i) / 3);
      ctx.lineTo(x + b, y + (h * i) / 3);
      ctx.stroke();
    }

    // Hjørnehåndtak
    ctx.fillStyle = '#fff';
    for (const hj of Object.values(hjornene())) {
      ctx.fillRect(hj.x * s - 5, hj.y * s - 5, 10, 10);
    }
    ctx.restore();
  }

  function startDra(e) {
    if (!bilde) return;
    const p = tilBilde(e);
    const h = finnHandtak(p);
    if (!h) return;
    drar = { handtak: h, start: p, utsnittVedStart: { ...utsnitt } };
    // Pekerfangst er en bekvemmelighet, ikke en forutsetning: den holder draget
    // levende hvis fingeren sklir utenfor lerretet. Den kaster for pekere
    // nettleseren ikke anser som aktive, og det skal ikke velte beskjæringen.
    try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* uviktig */ }
    e.preventDefault();
  }

  function underDra(e) {
    if (!bilde) return;

    if (!drar) {
      // Vis hva som vil skje før man trykker
      const h = finnHandtak(tilBilde(e));
      canvas.style.cursor = h === 'flytt' ? 'move'
        : h === 'nv' || h === 'so' ? 'nwse-resize'
        : h ? 'nesw-resize' : 'default';
      return;
    }

    const p = tilBilde(e);
    const dx = p.x - drar.start.x;
    const dy = p.y - drar.start.y;
    const u = drar.utsnittVedStart;

    if (drar.handtak === 'flytt') {
      utsnitt = klemUtsnitt({ ...u, x: u.x + dx, y: u.y + dy }, bilde.width, bilde.height);
    } else {
      // Regn ut de to motstående kantene, og la dem bytte plass fritt — da kan man
      // dra håndtaket forbi motsatt hjørne uten at utsnittet låser seg.
      let v = u.x;
      let o = u.x + u.b;
      let n = u.y;
      let s = u.y + u.h;
      if (drar.handtak.includes('v')) v = u.x + dx; else o = u.x + u.b + dx;
      if (drar.handtak.startsWith('n')) n = u.y + dy; else s = u.y + u.h + dy;
      utsnitt = klemUtsnitt({
        x: Math.min(v, o), y: Math.min(n, s),
        b: Math.abs(o - v), h: Math.abs(s - n),
      }, bilde.width, bilde.height);
    }
    tegn();
    e.preventDefault();
  }

  function sluttDra(e) {
    try {
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    } catch (_) { /* uviktig */ }
    drar = null;
  }

  canvas.addEventListener('pointerdown', startDra);
  canvas.addEventListener('pointermove', underDra);
  canvas.addEventListener('pointerup', sluttDra);
  canvas.addEventListener('pointercancel', sluttDra);

  return {
    harBilde: () => !!bilde,

    settBilde(dataUrl) {
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          bilde = img;
          vis = visningsmaal(img.width, img.height);
          canvas.width = vis.bredde;
          canvas.height = vis.hoyde;
          canvas.style.width = `${vis.bredde}px`;
          canvas.style.height = `${vis.hoyde}px`;
          utsnitt = { x: 0, y: 0, b: img.width, h: img.height };
          eksponering = 0;
          tegn();
          resolve({ bredde: img.width, hoyde: img.height });
        };
        img.onerror = () => reject(new Error('Kunne ikke lese bildet'));
        img.src = dataUrl;
      });
    },

    settEksponering(trinn) {
      eksponering = Number(trinn) || 0;
      tegn();
    },

    tilbakestill() {
      if (!bilde) return;
      utsnitt = { x: 0, y: 0, b: bilde.width, h: bilde.height };
      eksponering = 0;
      tegn();
    },

    /**
     * Beskjær, juster eksponering og skaler til AOs grense. Returnerer en data-URL.
     *
     * Eksporten regnes alltid fra originalen — ikke fra visningslerretet — så det
     * man laster opp er i full oppløsning, uavhengig av hvor stor modalen var.
     */
    hentResultat(kvalitet = 0.85) {
      if (!bilde) return null;

      const skala = Math.min(1, MAKS_EKSPORT / Math.max(utsnitt.b, utsnitt.h));
      const ut = document.createElement('canvas');
      ut.width = Math.max(1, Math.round(utsnitt.b * skala));
      ut.height = Math.max(1, Math.round(utsnitt.h * skala));

      const uctx = ut.getContext('2d');
      uctx.drawImage(bilde, utsnitt.x, utsnitt.y, utsnitt.b, utsnitt.h,
                     0, 0, ut.width, ut.height);

      if (eksponering !== 0) {
        const d = uctx.getImageData(0, 0, ut.width, ut.height);
        anvendEksponering(d.data, eksponering);
        uctx.putImageData(d, 0, 0);
      }

      return ut.toDataURL('image/jpeg', kvalitet);
    },

    /** Til visning: hvor mye er kuttet vekk? */
    hentUtsnitt: () => (utsnitt ? { ...utsnitt } : null),
  };
}
