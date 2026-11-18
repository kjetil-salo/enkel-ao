"""Slett egne publiserte AO-funn og bekreft resultatet på selve funnsiden.

Endepunkt og JSON-format kommer fra AOs egen ``deleteSighting``-funksjon.
Søkeresultatene kan henge etter sletting og er derfor ikke en kvittering.
"""

import logging
import threading
from html.parser import HTMLParser
from urllib.parse import urlparse

import httpx

from src.ao_sightings import (
    AO_BASE, AoSessionExpired, _cookies, _current_user_alias, _looks_logged_in,
    fetch_raw_row,
)

logger = logging.getLogger('fugleobs')
_LAASER = tuple(threading.Lock() for _ in range(32))


def er_rapportor(rad):
    """Krev at AO positivt identifiserer gjeldende bruker som rapportøren."""
    alias = _current_user_alias([rad]) if rad else None
    rapportor = str((rad or {}).get('ReporterUserAlias') or '').strip()
    return bool(alias and rapportor and alias.casefold() == rapportor.casefold())


def gjelder_gruppe(rad, gruppe):
    """Et frosset masseutvalg skal ikke følge med funn flyttet til et annet sted."""
    if gruppe is None:
        return True
    if not isinstance(gruppe, dict) or not rad:
        return False
    dato = gruppe.get('date')
    sted = gruppe.get('siteId')
    return (isinstance(dato, str) and len(dato) == 10
            and not isinstance(sted, bool) and sted is not None and str(sted) != ''
            and str(rad.get('UniversalDate') or '')[:10] == dato
            and str(rad.get('SiteId') or '') == str(sted))


class _Slettehandling(HTMLParser):
    def __init__(self):
        super().__init__()
        self.tillatt = False

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if (tag in ('a', 'button') and attrs.get('id') == 'delete_sightings'
                and 'disabled' not in attrs
                and attrs.get('aria-disabled') != 'true'):
            self.tillatt = True


def _slettet(svar):
    """AOs målte 404-side, ikke en generisk nettverks-/proxyfeil."""
    url = urlparse(str(svar.url))
    return (svar.status_code == 404
            and url.hostname == 'www.artsobservasjoner.no'
            and url.path.rstrip('/') == '/Error/PageNotFound'
            and '<h2>Siden finnes ikke</h2>' in svar.text)


def slett_funn(login_token, auth_cookie, sighting_id, expected_group=None):
    if not login_token or not auth_cookie:
        return {'ok': False, 'needsLogin': True}
    try:
        if isinstance(sighting_id, bool):
            raise ValueError()
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
                return {'ok': False, 'error': 'Funnet tilhører ikke lenger valgt sted og dato. Ingen sletting er sendt.'}
            if not er_rapportor(rad):
                return {'ok': False, 'error': 'Bare rapportøren kan slette dette funnet. Ingen sletting er sendt.'}
            with httpx.Client(cookies=_cookies(login_token, auth_cookie), timeout=25) as client:
                url = f'{AO_BASE}/Sighting/{sighting_id}'
                foer = client.get(url, follow_redirects=True)
                if _slettet(foer):
                    return {'ok': True, 'verified': True, 'alreadyDeleted': True}
                if foer.status_code in (401, 403) or not _looks_logged_in(foer.text):
                    raise AoSessionExpired()
                if foer.status_code != 200:
                    raise ValueError('Kunne ikke lese funnet.')
                handling = _Slettehandling()
                handling.feed(foer.text)
                if not handling.tillatt:
                    return {'ok': False, 'error': 'Artsobservasjoner tilbyr ikke sletting av dette funnet. Ingen sletting er sendt.'}

                sendt = True
                svar = client.post(
                    f'{AO_BASE}/ReviewSighting/DeleteSighting',
                    json={'sightingId': sighting_id, 'isTemporary': False},
                    headers={'X-Requested-With': 'XMLHttpRequest', 'Referer': url},
                )
                if (svar.status_code != 200
                        or svar.headers.get('REQUIRES_AUTH') == '1'
                        or svar.headers.get('SESSION_TIMEOUT') == '1'):
                    raise ValueError('Slettingen ble ikke bekreftet.')
                etter = client.get(url, follow_redirects=True)
                if _slettet(etter):
                    return {'ok': True, 'verified': True}
    except AoSessionExpired:
        if not sendt:
            return {'ok': False, 'needsLogin': True,
                    'error': 'Sesjonen mot Artsobservasjoner er utløpt.'}
    except Exception as exc:
        logger.warning('[AO-SLETT] Kunne ikke slette funn %s: %s',
                       sighting_id, type(exc).__name__)
    if sendt:
        return {'ok': False, 'uncertain': True,
                'error': 'Slettingen kan ha blitt utført, men vi fikk ikke bekreftet den. Kontroller funnet hos Artsobservasjoner før du fortsetter.'}
    return {'ok': False, 'error': 'Kunne ikke kontrollere funnet. Ingen sletting er sendt.'}
