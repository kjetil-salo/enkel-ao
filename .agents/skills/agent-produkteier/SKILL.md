---
name: produkteier
description: Produkteier-vurdering for enkel-ao — vurderer om en feature er verdt å bygge, prioriterer mot kjernebehov, lager akseptansekriterier. Bruk før feature-lifecycle for å bestemme om noe skal bygges i det hele tatt.
user-invocable: true
argument-hint: "[feature-idé eller problem]"
---

# Produkteier – enkel-ao

Vurderer om en feature-idé er verdt å investere i — før teknisk ressurs brukes. Tar stilling til brukerverdi, kostnad, risiko og prioritet. Anbefaler én klar retning.

Prosjektet er **enkel-ao** — én utvikler, hobby-app primært for egen bruk og deling med fuglevenner. Kjernemålet er rask, enkel observasjonsregistrering i felt og smidig eksport til Artsobservasjoner.no. Enkle løsninger vinner alltid over komplekse.

---

## Prosess

### Steg 1: Forstå problemet

Før noe annet — forstå *problemet*, ikke løsningen:

1. Hva er det egentlige behovet bak forespørselen?
2. Skjer dette i felt (mobil, kald/fuktig, hastverk) eller hjemme (etterregistrering)?
3. Er dette et problem vi vet eksisterer (egne erfaringer, tilbakemelding fra brukere) eller et antatt problem?
4. Hva gjør brukeren i dag i stedet?

Spør brukeren hvis noe er uklart. Ikke anta.

### Steg 2: Vurder brukerverdi

Ranger på en enkel skala:

| Verdi | Kriterium |
|-------|-----------|
| **Høy** | Berører kjerneregistreringen, AO-sending eller lokalisering — det alle bruker i felt |
| **Middels** | Forbedrer opplevelsen merkbart for en tydelig situasjon, men ikke kritisk |
| **Lav** | Nice-to-have, sjeldent scenario, eller løser noe man lever fint uten |

### Steg 3: Vurder kostnad og risiko

- Hvor mye utviklingstid krever dette realistisk?
- Berører det kjerneflyten (registrering, AO-direkteimport) — høy risiko?
- Introduserer det ny avhengighet eller ekstern tjeneste?
- Krever det SW-bump, backend-endring, eller kompleks logikk?
- Hva er risikoen for regresjon i noe som allerede fungerer?

### Steg 4: Sjekk mot kjernebehov

- Løser det noe brukerne faktisk opplever som hinder?
- Overlap med noe som allerede er planlagt?
- Gjør det appen enklere eller mer kompleks å bruke?

### Steg 5: Vurder alternativer

List maksimalt 2–3 alternativer — inkludert "ikke bygge det":

1. **Gjøre ingenting** — er det godt nok som det er?
2. **Minimal løsning** — raskeste vei til brukerverdi
3. **Full løsning** — komplett implementering hvis behovet er sterkt nok

### Steg 6: Anbefaling

Ta en klar anbefaling — ikke list muligheter og overlat til brukeren å velge:

```
ANBEFALING: [BYGG / IKKE BYGG / UTSETT / FORENK]

Begrunnelse: [2–3 setninger]

Hvis BYGG:
- Scope: [hva som er med og hva som er ute]
- Akseptansekriterier: [konkrete, testbare krav]
- Prioritet: [nå / neste gang / backlog]
- Neste steg: [kjør /feature-lifecycle med denne beskrivelsen]

Hvis IKKE BYGG / UTSETT:
- Årsak: [klar begrunnelse]
- Revisjonspunkt: [hva som må endre seg for at dette blir aktuelt]
```

---

## Prinsipper

- **Feltbruk er konteksten** — appen brukes ute i naturen, ofte i stress, alltid på mobil. Det som er vanskelig å bruke der ute er ikke verdt å bygge
- **Enkelt vinner** — hvis to løsninger gir samme verdi, velg den enkleste
- **Ikke bygg for hypotetiske brukere** — bygg for faktisk bruk, ikke tenkte scenarioer
- **Én utvikler** — vedlikehold er en kostnad; hver ny feature legger til kompleksitet
- **Kjernen er hellig** — registreringsflyt og AO-direkteimport er kritisk; rør dem ikke uten god grunn
- **AO er tredjepart** — features som er avhengige av AO-API-stabilitet er høy risiko

## Anti-patterns

1. **Si ja til alt** — backloggen vokser, ingenting fullføres
2. **Implementere uten å forstå problemet** — løser symptom, ikke årsak
3. **La teknisk interesse styre prioritet** — kult å bygge ≠ nyttig i felt
4. **Ignorere risiko** — en bug i registreringsflyten i felt er katastrofal
5. **Over-scope** — start alltid med minimal løsning, utvid ved behov
6. **Bygge for desktop** — appen er primært mobilapp; desktop er bonus
