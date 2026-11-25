# Push-varsler

Status 2026-11-25: infrastrukturen er på plass. Varsler sendes bare for hånd,
og foreløpig bare om nyheter.

## Hva brukeren ser

- `/varsler.html` har én bryter per varseltype. Foreløpig finnes bare
  «📰 Nyheter i appen». Siden er lenket fra Innstillinger og fra toppen av
  hjelpesiden.
- Appen spør **aldri** om tillatelse av seg selv. Det skjer først når
  brukeren slår på en bryter. Nettleseren krever uansett et brukertrykk, og et
  uoppfordret spørsmål gir som regel et varig nei.
- På iPhone virker push bare når appen er lagt på hjemskjermen (iOS 16.4+).
  Er den ikke det, forklarer siden hvordan, i stedet for å vise en død bryter.
- Et trykk på varselet åpner URL-en i meldingen. Er appen allerede åpen,
  brukes det vinduet. Bare egne adresser åpnes, aldri en fremmed.

## Slik henger det sammen

| Del | Fil |
|---|---|
| Lagring, VAPID-nøkler, utsending, CLI | `src/push_varsel.py` |
| `GET /api/push-public-key`, `POST /api/push-subscribe`, `POST /api/push-unsubscribe` | `server.py` |
| Visning av varsel og trykk på det | `public/sw.js` (`push`, `notificationclick`) |
| Abonnering og valgte varseltyper | `public/js/push-varsel.js` |
| Siden | `public/varsler.html` |

- Abonnementene ligger i tabellen `push_abonnement` i `stats.db`, med en
  `emner`-liste per rad.
- VAPID-nøkkelparet lages automatisk ved første kall til `/api/push-public-key`
  og lagres i `/data/vapid_private.pem` og `/data/vapid_public.txt`, altså i
  docker-volumet. **Mistes privatnøkkelen, er alle abonnementer verdiløse.**
  Brukerne må da slå varsler av og på igjen.
- Endepunktet må være `https` mot en kjent push-tjeneste (Google, Mozilla,
  Apple, Microsoft). Ellers kunne hvem som helst fått serveren til å POSTe til
  en vilkårlig adresse ved neste utsending (SSRF).
- `pywebpush` står for kryptering (aes128gcm) og VAPID-signering. Den er
  verifisert ende-til-ende i `tests/test_push_varsel.py`: en simulert nettleser
  dekrypterer det som kommer fram og sjekker signaturen.
- Utsendingen bruker `TTL` på 3 døgn og `Urgency: low`. En nyhet haster ikke.
- Svarer push-tjenesten 404 eller 410, er abonnementet avsluttet av
  nettleseren, og raden slettes.

## Sende et varsel

Alltid inne i containeren på Pi-en, slik at den riktige databasen og
nøkkelen brukes:

```bash
# Hvor mange har slått på?
docker compose -f docker-compose.pi.yml exec enkel-ao python3 -m src.push_varsel status

# Tørrkjøring (standard): viser meldingen og antall mottakere, sender ingenting
docker compose -f docker-compose.pi.yml exec enkel-ao python3 -m src.push_varsel send \
  --tittel "Nytt i Enkel-AO" --tekst "Kartet er lynraskt" --url /

# Test på egen telefon først: --kun filtrerer på en bit av endepunktet (se status)
docker compose -f docker-compose.pi.yml exec enkel-ao python3 -m src.push_varsel send \
  --tittel "…" --tekst "…" --kun "<bit av endepunktet>" --send

# Til alle som har valgt nyheter
docker compose -f docker-compose.pi.yml exec enkel-ao python3 -m src.push_varsel send \
  --tittel "…" --tekst "…" --send
```

Rekkefølgen ved en nyhet: publiser nyhetssplashen og deploy, test på egen
telefon med `--kun`, og send til alle. Varselet åpner appen, der splashen tar
over. Teksten i varselet er bare en teaser.

Sett gjerne `VAPID_KONTAKT=mailto:…` i `.env` på Pi-en. Push-tjenestene kan
bruke den adressen hvis noe går galt. Standardverdien er `https://ao.efugl.no`.

## Legge til en ny varseltype

For eksempel meldinger fra Artsobservasjoner:

1. Legg id-en til `KJENTE_EMNER` i `src/push_varsel.py` og `VARSELTYPER` i
   `public/js/push-varsel.js`. Da dukker bryteren opp på `/varsler.html`.
2. Send med `--emne <id>`. Bare de som har valgt typen, får varselet.

**AO-meldinger er en vesentlig større jobb enn nyheter.** AO har ingen push
selv, så serveren må spørre AO jevnlig, på vegne av hver bruker, med de
lagrede innloggingene (`/data/credentials.json`). Det krever at abonnementet
knyttes til et AO-brukernavn, en bakgrunnsjobb med hensyn til AOs last
(«External API Ethics» i `CLAUDE.md`), og en avveining av hvor ofte. Det er
ikke bygget.
