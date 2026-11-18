"""Fjern innlogget bruker som medobservatør på et publisert AO-funn.

AOs ``ToggleObserver`` er en toggle, ikke en idempotent sletting. Medlemskap
leses derfor rett før ett enkelt POST-kall, under lås, og leses tilbake etterpå.
Ingen feil etter sending fører til et nytt POST-kall.
"""

import logging
import threading
from html.parser import HTMLParser

import httpx

from src.ao_sightings import (
    AO_BASE, AoSessionExpired, _cookies, _current_user_alias, _looks_logged_in,
    fetch_raw_row,
)
from src.ao_delete import gjelder_gruppe

logger = logging.getLogger('fugleobs')

# Samme funn havner i samme lås selv om to enheter har ulike sesjonstokens.
# Fast antall låser gir avgrenset minnebruk uten en voksende nøkkeltabell.
_LAASER = tuple(threading.Lock() for _ in range(32))

# En timeout lokalt betyr ikke at AO har stoppet POST-kallet. Behold derfor
# sperren til fravær er bekreftet, uten tidsbasert oppheving eller utkastelse.
_UAVKLARTE = set()
_UAVKLARTE_LAAS = threading.Lock()
_MAKS_UAVKLARTE = 1024


class _Observatoerer(HTMLParser):
    def __init__(self):
        super().__init__()
        self.dybde = 0
        self.funnet = False
        self.aliaser = set()

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag != 'span':
            return
        if attrs.get('id') == 'coobservers':
            self.funnet = True
            self.dybde = 1
        elif self.dybde:
            self.dybde += 1
        if self.dybde and attrs.get('data-useralias'):
            self.aliaser.add(attrs['data-useralias'].casefold())

    def handle_endtag(self, tag):
        if tag == 'span' and self.dybde:
            self.dybde -= 1


def _les_observatoerer(client, sighting_id):
    svar = client.get(f'{AO_BASE}/Sighting/{sighting_id}', follow_redirects=True)
    if svar.status_code in (401, 403):
        raise AoSessionExpired()
    if svar.status_code != 200:
        raise ValueError('Kunne ikke lese funnet hos Artsobservasjoner.')
    if not _looks_logged_in(svar.text):
        raise AoSessionExpired()
    parser = _Observatoerer()
    parser.feed(svar.text)
    # En tom liste kan også bety endret markup. Vi skal aldri tolke det som
    # bekreftet fravær og risikere å legge brukeren TIL med toggle-kallet.
    if not parser.funnet or not parser.aliaser or parser.dybde:
        raise ValueError('Kunne ikke kontrollere observatørlisten hos Artsobservasjoner.')
    return parser.aliaser


def fjern_meg(login_token, auth_cookie, sighting_id, expected_group=None):
    """Fjern bare gjeldende bruker; stol aldri på klientens rolle eller alias."""
    if not login_token or not auth_cookie:
        return {'ok': False, 'needsLogin': True}
    if isinstance(sighting_id, bool):
        return {'ok': False, 'error': 'Ugyldig funn-ID.'}
    try:
        sighting_id = int(str(sighting_id))
        if sighting_id < 1:
            raise ValueError()
    except (TypeError, ValueError):
        return {'ok': False, 'error': 'Ugyldig funn-ID.'}

    sendt = False
    try:
        with _LAASER[sighting_id % len(_LAASER)]:
            rad = fetch_raw_row(login_token, auth_cookie, sighting_id)
            if not gjelder_gruppe(rad, expected_group):
                return {'ok': False, 'error': 'Funnet tilhører ikke lenger valgt sted og dato. Ingen endring er sendt.'}
            alias = _current_user_alias([rad]) if rad else None
            rapportoer = str((rad or {}).get('ReporterUserAlias') or '').strip()
            if not alias or not rapportoer:
                return {'ok': False, 'error': 'Kunne ikke bekrefte at du er medobservatør på funnet.'}
            alias = alias.casefold()
            noekkel = (alias, sighting_id)
            if rapportoer.casefold() == alias:
                return {'ok': False, 'error': 'Du er rapportør for funnet og kan ikke fjerne deg her.'}

            with httpx.Client(cookies=_cookies(login_token, auth_cookie), timeout=25) as client:
                foer = _les_observatoerer(client, sighting_id)
                if alias not in foer:
                    with _UAVKLARTE_LAAS:
                        _UAVKLARTE.discard(noekkel)
                    return {'ok': True, 'verified': True, 'alreadyRemoved': True}
                with _UAVKLARTE_LAAS:
                    if noekkel in _UAVKLARTE:
                        return {'ok': False, 'uncertain': True,
                                'error': 'Et tidligere forsøk er fortsatt uavklart. Ingen ny endring er sendt. Kontroller funnet hos Artsobservasjoner.'}
                    if len(_UAVKLARTE) >= _MAKS_UAVKLARTE:
                        return {'ok': False,
                                'error': 'For mange endringer venter på bekreftelse. Ingen ny endring er sendt. Bruk Artsobservasjoner for å kontrollere funnet.'}
                    _UAVKLARTE.add(noekkel)
                sendt = True
                svar = client.post(
                    f'{AO_BASE}/ViewSighting/ToggleObserver/{sighting_id}',
                    json={'sightingId': sighting_id},
                    headers={'X-Requested-With': 'XMLHttpRequest',
                             'Referer': f'{AO_BASE}/Sighting/{sighting_id}'},
                )
                if (svar.status_code != 200
                        or svar.headers.get('REQUIRES_AUTH') == '1'
                        or svar.headers.get('SESSION_TIMEOUT') == '1'):
                    raise ValueError('Artsobservasjoner bekreftet ikke endringen.')
                etter = _les_observatoerer(client, sighting_id)
                if alias in etter:
                    return {'ok': False, 'uncertain': True,
                            'error': 'Artsobservasjoner viser deg fortsatt som observatør. Oppdater listen og kontroller funnet før du prøver igjen.'}
                with _UAVKLARTE_LAAS:
                    _UAVKLARTE.discard(noekkel)
                return {'ok': True, 'verified': True}
    except AoSessionExpired:
        if not sendt:
            return {'ok': False, 'needsLogin': True,
                    'error': 'Sesjonen mot Artsobservasjoner er utløpt.'}
    except Exception as exc:
        logger.warning('[AO-OBSERVATOER] Kunne ikke fjerne medobservatør på funn %s: %s',
                       sighting_id, type(exc).__name__)
    if sendt:
        return {'ok': False, 'uncertain': True,
                'error': 'Endringen kan ha blitt lagret hos Artsobservasjoner, men vi fikk ikke bekreftet den. Oppdater listen og kontroller funnet før du prøver igjen.'}
    return {'ok': False,
            'error': 'Kunne ikke kontrollere funnet hos Artsobservasjoner. Ingen endring er sendt.'}
