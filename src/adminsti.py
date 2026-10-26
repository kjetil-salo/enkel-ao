"""
Hemmelig adresse til admin-sidene (statistikk og tilbakemeldinger).

Erstatter `/stats?key=salo`. Den gamle løsningen hadde en standardnøkkel som sto
i klartekst i et offentlig repo — altså ingen beskyttelse i det hele tatt for den
som leste koden.

**Hva dette faktisk gir, og ikke gir.** En hemmelig sti er ikke kryptografisk
sterkere enn en hemmelig nøkkel i en query-streng: begge står i URL-en, begge
havner i serverlogger og i nettleserhistorikk. Styrken ligger i at hemmeligheten
er lang og tilfeldig, ikke i hvor i URL-en den står. Gevinsten her er at det ikke
finnes noen standardverdi å gjette, at adressen ikke kan røpes ved et uhell i et
skjermbilde av en URL med `?key=`, og at den er grei å lenke fra driftssiden.

Dette er ikke autentisering. Den som har lenka, er inne. Det er avveid og godtatt:
sidene inneholder bruksstatistikk og innmeldte tilbakemeldinger, ikke
innloggingsdata, og de lenkes kun fra en Tailscale-intern driftsside.

Hemmeligheten genereres automatisk første gang og lagres i docker-volumet, samme
mønster som `fellestur_peer`. Den skal aldri skrives inn for hånd — den leses av
driftssiden på Pi-en, som bygger ferdige lenker.
"""

import logging
import os
import secrets
import threading

logger = logging.getLogger('fugleobs')

# Samme alfabet som nanoid: URL-trygt, ingen tegn som må escapes.
_ALFABET = 'useandom26T198340PX75pxJACKVERYMINDBUSHWOLFGQZbfghjklqvwyzrict'
_LENGDE = 22

# Hvor hemmeligheten lagres. Må ligge i docker-volumet (/data), ikke i
# repo-mappa — ellers forsvinner den ved hver rebuild, og alle lagrede lenker
# slutter å virke.
STI_FIL = os.environ.get('ADMIN_STI_FIL', '/data/admin_sti.txt')

_laas = threading.Lock()
_bufret = None


def _generer():
    return ''.join(secrets.choice(_ALFABET) for _ in range(_LENGDE))


def hent_admin_sti():
    """
    Hemmeligheten som gir tilgang til admin-sidene.

    Rekkefølge:
      1. `ADMIN_STI` fra miljøet — lar deg sette en fast verdi i staging/test.
      2. Fila på `STI_FIL`, hvis den finnes.
      3. Ny tilfeldig verdi, lagret til fila.

    Kan ikke fila skrives (f.eks. lokal utvikling uten /data), beholdes verdien
    i minnet for denne prosessen og logges, slik at utvikling fungerer uten at
    en ustabil hemmelighet havner på disk et uventet sted.
    """
    global _bufret

    fra_miljo = os.environ.get('ADMIN_STI', '').strip()
    if fra_miljo:
        return fra_miljo

    with _laas:
        if _bufret:
            return _bufret

        try:
            with open(STI_FIL, 'r', encoding='utf-8') as f:
                lagret = f.read().strip()
            if lagret:
                _bufret = lagret
                return _bufret
        except FileNotFoundError:
            pass
        except Exception as e:
            logger.warning(f'[ADMIN] Kunne ikke lese {STI_FIL}: {e}')

        _bufret = _generer()
        try:
            os.makedirs(os.path.dirname(STI_FIL), exist_ok=True)
            with open(STI_FIL, 'w', encoding='utf-8') as f:
                f.write(_bufret)
            os.chmod(STI_FIL, 0o600)
            logger.info(f'[ADMIN] Ny hemmelig admin-sti generert og lagret i {STI_FIL}')
        except Exception as e:
            logger.warning(
                f'[ADMIN] Kunne ikke lagre admin-sti i {STI_FIL} ({e}). '
                'Bruker en midlertidig verdi for denne prosessen.'
            )
        return _bufret


def sti_stemmer(oppgitt):
    """
    Sammenlign i konstant tid.

    Et vanlig `==` på strenger avbryter ved første ulike tegn, og gjør det i
    prinsippet mulig å gjette seg fram tegn for tegn ved å måle svartid. Kostnaden
    ved å gjøre det riktig er null.
    """
    if not oppgitt:
        return False
    return secrets.compare_digest(str(oppgitt), hent_admin_sti())
