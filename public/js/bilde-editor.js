/**
 * Enkel bilderedigering før opplasting til Artsobservasjoner: beskjæring,
 * eksponering og opplysning av mørke partier.
 *
 * Bevisst smalt omfang. Dette er ikke et redigeringsprogram — det er de grepene
 * som faktisk trengs når et fuglebilde skal fra kamera til AO: kutt vekk det som
 * ikke er fuglen, løft et bilde som ble for mørkt, og hent fram fuglen når den
 * står mørk mot en lys himmel. Alt annet gjør man i Lightroom før man kommer hit.
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

// Luft rundt utsnittet når visningen zoomer inn på det, som andel av utsnittets
// egen størrelse. Uten luft ville rammen ligge klistret til lerretets kant, og
// man kunne bare krympe utsnittet videre — aldri dra det ut igjen.
const ZOOM_MARGIN = 0.12;

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

// Hvor mye de mørkeste partiene kan løftes på full slider. 1,2 = inntil 2,2x,
// altså litt over ett blenderstrinn — nok til å hente fram en fugl i motlys,
// uten at bildet blir det grå og flate et høyere tak gir.
const MAKS_SKYGGELOFT = 1.2;

/**
 * Regn om et skyggetrinn (0..100) til hvor kraftig løftet skal være.
 *
 * Bare oppover: dette er «lys opp det mørke», ikke en tonekurve i begge
 * retninger. Skal noe gjøres mørkere, er eksponeringen det riktige grepet.
 */
export function skyggestyrke(trinn) {
  const t = Math.max(0, Math.min(100, Number(trinn) || 0));
  return (t / 100) * MAKS_SKYGGELOFT;
}

/**
 * Hvor stor del av løftet en piksel med denne luminansen (0..1) skal få.
 *
 * `(1 - L)³` gir en maske som er nær 1 i de mørkeste partiene og praktisk talt
 * 0 i høylysene: ved L = 0,8 er den 0,008. Det er hele poenget — himmelen bak
 * fuglen skal ikke brenne ut av at fuglen lysnes.
 */
export function skyggemaske(luminans) {
  const u = 1 - Math.max(0, Math.min(1, Number(luminans) || 0));
  return u * u * u;
}

/**
 * Hvilken del av bildet skal lerretet vise når det er zoomet inn på utsnittet?
 *
 * Utsnittet pluss litt luft, klemt innenfor bildet. Når utsnittet er hele bildet,
 * blir svaret hele bildet — altså nøyaktig oversikten man startet med.
 */
export function zoomOmrade(utsnitt, bildeBredde, bildeHoyde, margin = ZOOM_MARGIN) {
  const mx = utsnitt.b * margin;
  const my = utsnitt.h * margin;

  let b = Math.min(bildeBredde, utsnitt.b + 2 * mx);
  let h = Math.min(bildeHoyde, utsnitt.h + 2 * my);
  // Skyv inn fra kanten i stedet for å kutte luften: står utsnittet helt i
  // bildekanten, legges all luften på den siden det er plass.
  const x = Math.max(0, Math.min(utsnitt.x - mx, bildeBredde - b));
  const y = Math.max(0, Math.min(utsnitt.y - my, bildeHoyde - h));

  return { x, y, b, h };
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

/**
 * Anvend eksponering og skyggeløft på rå pikseldata, på stedet.
 *
 * Begge i SAMME gjennomløp. Dels fordi det er halve kostnaden på en slider som
 * kjører live, dels fordi rekkefølgen da er låst ett sted: eksponeringen virker
 * globalt først, og skyggeløftet jobber på resultatet — samme rekkefølge som
 * brukeren ser sliderne i.
 *
 * Løftet er multiplikativt per kanal med samme faktor, så forholdet mellom R, G
 * og B står urørt og fargene vrir seg ikke når skyggene lysnes. Bieffekten er at
 * en helt svart piksel forblir svart; det er med vilje, for et løftet svartpunkt
 * er nettopp det som får et bilde til å se gråvasket ut.
 */
export function anvendJusteringer(data, { eksponering = 0, skygger = 0 } = {}) {
  const faktor = eksponeringsfaktor(eksponering);
  const styrke = skyggestyrke(skygger);
  if (faktor === 1 && styrke === 0) return data;

  for (let i = 0; i < data.length; i += 4) {
    let r = data[i] * faktor;
    let g = data[i + 1] * faktor;
    let b = data[i + 2] * faktor;

    if (styrke > 0) {
      // Rec. 601-luminans. Grovere enn en ekte lysmåling, men det er øyets
      // vekting av kanalene som avgjør hva som OPPLEVES mørkt — og det er det
      // masken skal treffe.
      const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      const gain = 1 + styrke * skyggemaske(lum);
      r *= gain;
      g *= gain;
      b *= gain;
    }

    data[i] = r > 255 ? 255 : r;
    data[i + 1] = g > 255 ? 255 : g;
    data[i + 2] = b > 255 ? 255 : b;
  }
  return data;
}

/**
 * Bare eksponering. Beholdt som eget navn fordi det er den enkle operasjonen
 * testene og eventuelle andre kallere kjenner.
 */
export function anvendEksponering(data, trinn) {
  return anvendJusteringer(data, { eksponering: trinn });
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
 * @returns {{settBilde, settEksponering, settSkygger, settZoom, tilbakestill, harBilde, hentResultat}}
 */
export function lagBildeEditor(canvas) {
  const ctx = canvas.getContext('2d');

  let bilde = null;          // HTMLImageElement
  let utsnitt = null;        // {x, y, b, h} i BILDEkoordinater
  let eksponering = 0;
  let skygger = 0;
  let vis = { bredde: 0, hoyde: 0, skala: 1 };

  // Hvilken del av BILDET lerretet viser. Hele bildet i oversikt, utsnittet med
  // litt luft når det er zoomet inn.
  let visOmr = { x: 0, y: 0, b: 0, h: 0 };

  // Zoomer visningen automatisk inn på utsnittet når et dra slippes? Slås av når
  // brukeren selv ber om å se hele bildet — da skal ikke neste lille justering
  // dra henne rett inn i zoom igjen.
  let autoZoom = true;

  // Pågående dra-operasjon: hvilket håndtak, og hvor utsnittet sto da den startet
  let drar = null;

  /**
   * Hvor mange bildepiksler er én CSS-piksel på skjermen?
   *
   * To ledd: lerretets egen zoom (`vis.skala`), og at CSS kan ha krympet
   * lerretet (`max-width: 100%` på en smal telefon). Uten det andre leddet glir
   * fingeren og beskjæringsrammen fra hverandre nettopp der appen brukes mest.
   */
  function bildePerCss(rekt) {
    const cssTilCanvas = rekt.width > 0 ? canvas.width / rekt.width : 1;
    return cssTilCanvas / vis.skala;
  }

  function tilBilde(punkt) {
    const rekt = canvas.getBoundingClientRect();
    const f = bildePerCss(rekt);
    return {
      x: visOmr.x + (punkt.clientX - rekt.left) * f,
      y: visOmr.y + (punkt.clientY - rekt.top) * f,
    };
  }

  /**
   * Sett hvilken del av bildet som vises, og still lerretet etter det.
   *
   * Lerretets form følger visningsområdet, så et stående utsnitt gir et stående
   * lerret. Høyden settes IKKE i piksler — `height: auto` i CSS lar nettleseren
   * holde formen også når `max-width` krymper bredden på en smal skjerm.
   */
  function settVisning(omr) {
    visOmr = omr;
    vis = visningsmaal(omr.b, omr.h);
    canvas.width = vis.bredde;
    canvas.height = vis.hoyde;
    canvas.style.width = `${vis.bredde}px`;
    canvas.style.height = 'auto';
  }

  function heleBildet() {
    return { x: 0, y: 0, b: bilde.width, h: bilde.height };
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

  function finnHandtak(p, rekt) {
    const terskel = HANDTAK * bildePerCss(rekt);
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
    ctx.drawImage(bilde, visOmr.x, visOmr.y, visOmr.b, visOmr.h,
                  0, 0, vis.bredde, vis.hoyde);

    // Justeringene vises live, med SAMME pikselløkke som eksporten bruker.
    // Billig nok på visningsstørrelse, og da lyver ikke forhåndsvisningen om hva
    // som faktisk lastes opp — i motsetning til et CSS-filter, som ikke
    // nødvendigvis regner likt som løkka under.
    if (eksponering !== 0 || skygger !== 0) {
      const d = ctx.getImageData(0, 0, vis.bredde, vis.hoyde);
      anvendJusteringer(d.data, { eksponering, skygger });
      ctx.putImageData(d, 0, 0);
    }

    const s = vis.skala;
    const x = (utsnitt.x - visOmr.x) * s;
    const y = (utsnitt.y - visOmr.y) * s;
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

    // Hjørnehåndtak. Tegnes i lerretspiksler, men skal være like store på
    // skjermen uansett om CSS har krympet lerretet — derfor omregningen.
    const rekt = canvas.getBoundingClientRect();
    const k = rekt.width > 0 ? canvas.width / rekt.width : 1;
    ctx.fillStyle = '#fff';
    for (const hj of Object.values(hjornene())) {
      ctx.fillRect((hj.x - visOmr.x) * s - 5 * k, (hj.y - visOmr.y) * s - 5 * k, 10 * k, 10 * k);
    }
    ctx.restore();
  }

  function startDra(e) {
    if (!bilde) return;
    const p = tilBilde(e);
    const h = finnHandtak(p, canvas.getBoundingClientRect());
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
      const h = finnHandtak(tilBilde(e), canvas.getBoundingClientRect());
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

    const dro = !!drar;
    drar = null;

    // Først NÅ zoomes det inn — aldri underveis. Endret skala midt i et dra ville
    // flyttet bildet under fingeren mens den står stille.
    if (!dro) return;
    if (autoZoom) {
      settVisning(zoomOmrade(utsnitt, bilde.width, bilde.height));
      tegn();
    }
    // Varsles også når autoZoom er av: utsnittet kan nettopp ha blitt mindre enn
    // bildet, og da er det først nå det finnes noe å zoome til.
    varsleVisning();
  }

  // Lar kalleren styre en zoom-knapp uten å spørre editoren om tilstanden sin
  // hele tiden: `zoomet` sier hva visningen gjør nå, `kanZoome` om det i det hele
  // tatt er beskåret noe å zoome inn på.
  let paVisningsendring = null;
  function varsleVisning() {
    if (!paVisningsendring || !bilde) return;
    try {
      paVisningsendring({
        zoomet: visOmr.b < bilde.width || visOmr.h < bilde.height,
        kanZoome: utsnitt.b < bilde.width || utsnitt.h < bilde.height,
      });
    } catch (_) { /* en lytterfeil skal ikke velte editoren */ }
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
          utsnitt = { x: 0, y: 0, b: img.width, h: img.height };
          eksponering = 0;
          skygger = 0;
          autoZoom = true;
          settVisning(heleBildet());
          tegn();
          varsleVisning();
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

    settSkygger(trinn) {
      skygger = Number(trinn) || 0;
      tegn();
    },

    /**
     * Zoom visningen inn på utsnittet, eller ut til hele bildet.
     *
     * Et eksplisitt «vis hele bildet» slår også av den automatiske zoomen etter
     * dra — ellers ville neste lille justering kastet brukeren rett inn igjen.
     */
    settZoom(zoomInn) {
      if (!bilde) return;
      autoZoom = !!zoomInn;
      settVisning(zoomInn ? zoomOmrade(utsnitt, bilde.width, bilde.height) : heleBildet());
      tegn();
      varsleVisning();
    },

    /** Kalles med `{zoomet, kanZoome}` hver gang visningen eller utsnittet endres. */
    vedVisningsendring(fn) {
      paVisningsendring = fn;
      if (bilde) varsleVisning();
    },

    tilbakestill() {
      if (!bilde) return;
      utsnitt = { x: 0, y: 0, b: bilde.width, h: bilde.height };
      eksponering = 0;
      skygger = 0;
      autoZoom = true;
      settVisning(heleBildet());
      tegn();
      varsleVisning();
    },

    /**
     * Beskjær, juster lys og skaler til AOs grense. Returnerer en data-URL.
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

      if (eksponering !== 0 || skygger !== 0) {
        const d = uctx.getImageData(0, 0, ut.width, ut.height);
        anvendJusteringer(d.data, { eksponering, skygger });
        uctx.putImageData(d, 0, 0);
      }

      return ut.toDataURL('image/jpeg', kvalitet);
    },

    /** Til visning: hvor mye er kuttet vekk? */
    hentUtsnitt: () => (utsnitt ? { ...utsnitt } : null),
  };
}
