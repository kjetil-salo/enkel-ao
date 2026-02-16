# AO Direct - Sikkerhet og innlogging

## 📋 Innholdsfortegnelse
- [Hva lagres hvor?](#hva-lagres-hvor)
- [To innloggingsmoduser](#to-innloggingsmoduser)
- [Enkel oppskrift: Kun loginToken (anbefalt)](#enkel-oppskrift-kun-logintoken-anbefalt)
- [Avansert: Med passordlagring](#avansert-med-passordlagring)
- [Sikkerhet og risiko](#sikkerhet-og-risiko)
- [FAQ](#faq)

---

## 🔑 Hva lagres hvor?

### I nettleseren (localStorage):
- **userId** - Ditt bruker-ID på Artsobservasjoner (tall, f.eks. "15969")
- **loginToken** - Magisk nøkkel som varer i **1 år** (trygt å lagre)
- **authCookie** - Sesjon som varer i **30 minutter** (fornyes automatisk)
- **ao_username** - Ditt brukernavn (KLARTEKST) ⚠️
- **ao_password** - Ditt passord (KLARTEKST) ⚠️

### På serveren (midlertidig minne):
- Ingenting permanent lagres!
- Kun midlertidig cache mens serveren kjører
- Alt slettes når serveren restarter

---

## 🎯 To innloggingsmoduser

### Modus 1: Kun loginToken (ANBEFALT ✅)
**Hva skjer:**
- Du logger inn én gang
- App lagrer loginToken (1 år gyldighet)
- Automatisk fornying av sesjon i 1 år
- **Ingen passord lagret**

**Må gjøre:**
- Logge inn på nytt én gang per år

**Risiko:**
- Veldig lav - kun loginToken lagres (kan ikke brukes andre steder)

---

### Modus 2: Med passordlagring (AVANSERT ⚠️)
**Hva skjer:**
- App lagrer BÅDE loginToken OG passord
- Automatisk re-innlogging selv etter 1 år
- Aldri tenke på innlogging igjen

**Må gjøre:**
- **BRUK ET UNIKT PASSORD KUN FOR ARTSOBSERVASJONER.NO**
- Ikke samme passord som bank, e-post, Facebook, osv.

**Risiko:**
- Middels - passord lagres i klartekst
- XSS-angrep kan lese passordet
- Malware på PC-en din kan lese passordet

---

## 📖 Enkel oppskrift: Kun loginToken (anbefalt)

### Steg 1: Logg inn første gang
1. Åpne https://enkel-ao.fly.dev/ao-direct.html
2. Skriv inn brukernavn og passord
3. Kryss av "Husk meg" ✅
4. Trykk "Logg inn"

### Steg 2: Slett passordet (viktig!)
1. Høyreklikk på siden → "Inspiser" (eller trykk F12)
2. Velg fanen "Console" (øverst)
3. Skriv inn denne magiske kommandoen:
   ```javascript
   localStorage.removeItem('ao_username'); localStorage.removeItem('ao_password'); console.log('✅ Passord slettet!');
   ```
4. Trykk Enter
5. Du skal se "✅ Passord slettet!" i konsollen
6. Lukk utviklerverktøyene (F12 igjen)

### Steg 3: Ferdig! 🎉
- Du er nå innlogget i 1 år
- Ingen passord lagret lokalt
- Kun loginToken og sesjon lagres (trygt)

### Hva skjer om 1 år?
- App viser innloggingsskjema igjen
- Du logger inn på nytt
- Gjenta Steg 2 hvis du vil være ekstra trygg

---

## 🔐 Avansert: Med passordlagring

**⚠️ LES DETTE FØRST:**
- Bruk KUN hvis du forstår risikoen
- Lag et **nytt passord** som du kun bruker på Artsobservasjoner.no
- Aldri gjenbruk passord fra andre tjenester!

### Steg-for-steg:
1. Lag et nytt, unikt passord for Artsobservasjoner.no (f.eks. "MineFugler2026!")
2. Logg inn på Artsobservasjoner.no og endre passordet ditt til det nye
3. Logg inn i AO Direct med det nye passordet
4. Kryss av "Husk meg"
5. Passordet lagres nå lokalt

### Konsekvenser:
✅ Aldri tenke på innlogging igjen
⚠️ Passord lagret i klartekst på PC-en din
⚠️ Kan leses av ondsinnet programvare
⚠️ **DERFOR:** Bruk KUN et passord du ikke bruker andre steder!

---

## 🛡️ Sikkerhet og risiko

### Hva er risikoen egentlig?

**Verste scenario:**
- En hacker får tilgang til PC-en din
- Leser localStorage i nettleseren
- Får tak i passordet ditt
- Logger inn på Artsobservasjoner.no som deg

**Hva kan de gjøre?**
- Rapportere falske fugleobservasjoner
- Slette dine observasjoner
- Se hvor du har vært og observert fugler

**Hva kan de IKKE gjøre?**
- Ta pengene dine (ingen økonomi på AO)
- Lese private meldinger (AO har ikke meldinger)
- Få tilgang til andre tjenester (hvis du bruker unikt passord)

### Sammenligning med andre risiki:

| Risiko | Sannsynlighet | Konsekvens |
|--------|---------------|------------|
| Bruke samme passord på flere steder | 🔴 Høy | 🔴 Alvorlig |
| XSS-angrep på denne appen | 🟢 Svært lav | 🟡 Middels |
| Malware på PC | 🟡 Lav-middels | 🔴 Alvorlig |
| Fysisk tilgang til låst PC | 🟢 Svært lav | 🟡 Middels |

**Konklusjon:** Unikt passord = liten risiko. Gjenbrukt passord = STOR risiko!

---

## ❓ FAQ

### Hvorfor lagre passord i det hele tatt?
For at du slipper å logge inn hver gang loginToken utløper (1 gang per år). Hvis du er OK med å logge inn én gang per år, trenger du IKKE lagre passord.

### Er det trygt å bruke?
Ja, **hvis du bruker et unikt passord** kun for Artsobservasjoner.no. Da er verste scenario at noen kan rote med fugleobservasjonene dine.

### Hva om jeg glemmer å slette passordet?
Da lagres det, men så lenge det er et **unikt passord** som du ikke bruker andre steder, er det OK. Ikke ideelt, men ikke katastrofalt.

### Kan utvikleren (Kjetil) se passordet mitt?
**Nei.** Alt lagres **kun på din PC**, i **din nettleser**. Serveren ser aldri passordet ditt - kun loginToken og authCookie.

### Hva om PC-en min blir hacket?
Hvis de får tilgang til nettleseren din, kan de lese alt i localStorage (inkl. passord hvis du har lagret det). **Derfor:** Bruk unikt passord!

### Hvordan sletter jeg alt?
**I nettleseren:**
1. F12 → Console
2. Kjør: `localStorage.clear(); console.log('✅ Alt slettet!');`

**Eller:**
1. Nettleserinnstillinger → Personvern → Slett nettstedsdata
2. Velg "enkel-ao.fly.dev"
3. Slett

### Hva er forskjellen på loginToken og authCookie?
- **loginToken**: Langtids-nøkkel (1 år). Som et passord, men tryggere.
- **authCookie**: Korttids-sesjon (30 min). Fornyes automatisk ved aktivitet.

### Hva om jeg bare vil prøve appen?
Gjør **Steg 1** (logg inn) og **ikke Steg 2** (slett passord). Da har du full funksjonalitet med auto-relogin. Hvis du liker det, **endre passordet på AO til noe unikt** først!

### Hvorfor er denne siden skjult?
Fordi passord-lagring i klartekst kan misforstås som usikkert. Med riktig dokumentasjon og brukervalg er det trygt nok for denne brukssaken.

---

## 🎯 Anbefaling

**For de fleste brukere:**
- Bruk Modus 1 (kun loginToken)
- Logger inn én gang per år
- Null risiko

**For power-users som vil ha null innlogginger:**
- Bruk Modus 2 (med passord)
- **LAG ET NYTT PASSORD KUN FOR AO**
- Liten risiko hvis du følger denne regelen

**Det verste du kan gjøre:**
- Lagre passordet ditt
- OG gjenbruke det samme passordet på Gmail/Facebook/bank
- **ALDRI GJØR DETTE!**

---

## 📞 Spørsmål?

Ta kontakt på GitHub: https://github.com/kjetil-salo/bird-observations-made-simple/issues

---

**Sist oppdatert:** 2026-02-16
**Versjon:** 1.0
