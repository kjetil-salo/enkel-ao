# Release Checklist

Kort sjekkliste for deploy til produksjon.

For hver deploy til `main` (production) må følgende verifiseres manuelt eller via smoke-test:

1. Start server lokalt eller kjør smoke-test mot staging/prod.
2. Verifiser at applikasjonen laster og at root-side returnerer 200.
3. Verifiser at lokasjon fungerer:
   - Trykk `Oppdater posisjon` i UI og bekreft at geolocation dialog vises og at appen mottar koordinater.
   - Alternativt: kall `/api/reverse?lat=<lat>&lon=<lon>` direkte mot appen.
4. Verifiser artssøk:
   - Skriv en artsnavn i autocomplete-feltet og bekreft at resultater vises.
   - Velg en art og bekreft at UI viser valgt art.
5. Verifiser antall og registrering:
   - Velg eller skriv antall.
   - Legg til observasjon og bekreft at den vises i listen nederst.
6. Overvåk logs under og etter deploy: `flyctl logs` eller appens overvåkningsside.
7. Hvis noe feiler: rollback til forrige release (se steg for rollback).

Rollback:
- Bruk tidligere image eller release i Fly:

```bash
# Se releases
flyctl releases --app enkel-ao
# Rull tilbake til en tidligere release
flyctl releases revert <id> --app enkel-ao
```

Dokumenter eventuelle avvik i PR eller releasenote.
