/**
 * Bilde-velger: fil-valg, lim inn (knapp + Ctrl/Cmd+V), nedskalering, forhåndsvisning.
 * Delt mellom registrerings-modalen (✎ Flere felt i ②) og redigerings-modalen
 * (✎ i observasjonslisten) — begge trenger nøyaktig samme oppførsel.
 */

const MAX_SIDE = 1600;

// Skalerer ned til maks 1600px langside (samme grense AO selv bruker server-side)
// og komprimerer til JPEG — mobilkamera leverer ofte langt større bilder enn
// nødvendig for et artsfunn, og base64 i JSON øker størrelsen med ~33 %.
function downscaleImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > MAX_SIDE || height > MAX_SIDE) {
          if (width > height) { height = Math.round(height * MAX_SIDE / width); width = MAX_SIDE; }
          else { width = Math.round(width * MAX_SIDE / height); height = MAX_SIDE; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = () => reject(new Error('Kunne ikke lese bildet'));
      img.src = reader.result;
    };
    reader.onerror = () => reject(new Error('Kunne ikke lese filen'));
    reader.readAsDataURL(file);
  });
}

/**
 * @param {object} els - { fileInput, pickBtn, pasteBtn (valgfri), previewWrap, previewImg, removeBtn }
 * @param {() => boolean} isActive - lim inn med Ctrl/Cmd+V håndteres kun når denne returnerer true
 *   (f.eks. «modalen er åpen») — ellers ville et bilde limt inn hvor som helst på siden
 *   uventet havnet i et skjult skjema.
 * @param {(value: string|null) => void} [onChange] - kalt med samme verdi som getValue()
 *   hver gang bildet endres — nyttig for en forbruker som selv ikke er en ES-modul
 *   (f.eks. et inline-script) og trenger verdien speilet i et skjult DOM-felt.
 */
export function initPhotoPicker(els, isActive, onChange) {
  const { fileInput, pickBtn, pasteBtn, previewWrap, previewImg, removeBtn } = els;
  const notify = () => { if (onChange) onChange(photoDataUrl); };

  // null = urørt (behold det obs allerede har, om noe). '' = eksplisitt fjernet.
  // Ellers: valgt/eksisterende bilde som data-URL.
  let photoDataUrl = null;

  function show(dataUrl) {
    photoDataUrl = dataUrl;
    previewImg.src = dataUrl;
    previewWrap.style.display = 'block';
    notify();
  }

  function clear() {
    photoDataUrl = '';
    previewImg.src = '';
    previewWrap.style.display = 'none';
    fileInput.value = '';
    notify();
  }

  function resetToUntouched() {
    photoDataUrl = null;
    previewImg.src = '';
    previewWrap.style.display = 'none';
    fileInput.value = '';
    notify();
  }

  async function handlePickedFile(file) {
    if (!file) return;
    try {
      const dataUrl = await downscaleImage(file);
      show(dataUrl);
    } catch (e) {
      console.warn('Kunne ikke lese bildet', e);
      alert('Kunne ikke lese bildet — prøv et annet.');
    }
  }

  pickBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    handlePickedFile(fileInput.files && fileInput.files[0]);
  });
  removeBtn.addEventListener('click', clear);

  // Lim inn med tastatur (Ctrl/Cmd+V) — samme mønster som orakel-prosjektet.
  document.addEventListener('paste', (e) => {
    if (!isActive()) return;
    const fil = [...(e.clipboardData && e.clipboardData.items || [])]
      .filter((i) => i.kind === 'file' && i.type.startsWith('image/'))
      .map((i) => i.getAsFile())
      .find(Boolean);
    if (fil) {
      e.preventDefault();
      handlePickedFile(fil);
    }
  });

  // Lim inn med knapp — mobil har ingen Ctrl+V. Vises bare der API-et finnes.
  if (pasteBtn && navigator.clipboard && navigator.clipboard.read) {
    pasteBtn.classList.remove('skjult');
    pasteBtn.addEventListener('click', async () => {
      // Tre ulike ting kan feile her (Android leverer ofte galleri-bilder som en
      // URI/annet format enn image/*, ikke bare en ren tilgangsnekt) — skill dem
      // fra hverandre i loggen så vi vet HVA som feilet neste gang noen rapporterer dette.
      let items;
      try {
        items = await navigator.clipboard.read();
      } catch (e) {
        console.warn('navigator.clipboard.read() feilet:', e.name, e.message);
        const arsak = e.name === 'NotAllowedError' ? 'tillatelse nektet' : e.name || 'ukjent feil';
        alert(`Fikk ikke tilgang til utklippstavla (${arsak}) — velg bildet fra fil i stedet.`);
        return;
      }

      for (const element of items) {
        const type = element.types.find((t) => t.startsWith('image/'));
        if (!type) {
          console.warn('Utklippstavle-element uten bilde-type, fant:', element.types);
          continue;
        }
        try {
          const blob = await element.getType(type);
          await handlePickedFile(new File([blob], 'limt-inn', { type: blob.type }));
          return;
        } catch (e) {
          console.warn('Fant bilde-type på utklippstavla, men klarte ikke hente den:', type, e.name, e.message);
          alert(`Fant et bilde på utklippstavla, men klarte ikke hente det (${e.name || 'ukjent feil'}) — velg bildet fra fil i stedet.`);
          return;
        }
      }
      console.warn('Utklippstavla hadde ingen elementer med bilde-type');
      alert('Fant ikke noe bilde på utklippstavla — velg bildet fra fil i stedet.');
    });
  }

  return {
    /** null = urørt, '' = eksplisitt fjernet, ellers data-URL */
    getValue: () => photoDataUrl,
    /** Vis et allerede lagret bilde (åpning av redigering på en obs som har bilde) */
    loadExisting: (dataUrl) => { if (dataUrl) show(dataUrl); },
    /** Nullstill til tomt/urørt skjema (ny registrering, eller etter lagring) */
    resetToUntouched,
  };
}
