# Changelog

## 1.1.2 – 2026-01-12
- Løst problem med at input-felt for antall zoomet inn på mobil (font-size 16px på alle input/knapper).
- Forbedret visning av den grønne haken (submit-knapp) slik at den ikke klippes eller havner utenfor på små skjermer.
- Forbedret responsivitet: knapper nederst kan nå wrappe og havner ikke utenfor skjermen på mobil.
- Lagt inn hack for å scrolle art-feltet inn i synlig område på mobil når tastatur/autofyll vises.
- Forsøkt å skjule valgt-linjen (chosen) på mobil, men beholdt på desktop.
- Oppdatert TODO: behov for både prod- og test-side for trygg videreutvikling.

## 1.1.1 – 2026-01-11
- Penere statistikk-side (/stats)
- Statistikk hentes fra Supabase
- Robusthet: stats-siden skal virke selv om Supabase er nede (TODO)
- Fly.io-deploy med secrets for Supabase
- .env for lokal utvikling

## 1.1.0 – 2026-01-11
- Første versjon med Supabase-logging og statistikk
- Fly.io-deploy
- Responsivt og mobilvennlig GUI
