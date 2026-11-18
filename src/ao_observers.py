"""Les observatører og AOs rapportskjema uten å åpne et publisert funn."""

import os
from html.parser import HTMLParser
from pathlib import Path

from src.ao_sightings import AO_BASE, AoSessionExpired, _current_user_alias, _looks_logged_in, fetch_raw_row
from src.ao_delete import er_rapportor, gjelder_gruppe


def valider_aliaser(aliaser):
    """Alias identifiserer kontoer; visningsnavn skal aldri gjettes til en bruker."""
    if not isinstance(aliaser, list) or len(aliaser) > 10:
        raise ValueError('Velg maksimalt 10 medobservatører fra AO-søket.')
    ut = []
    brukt = set()
    for alias in aliaser:
        if (not isinstance(alias, str) or not alias.strip() or len(alias) > 200
                or any(ord(tegn) < 32 for tegn in alias)):
            raise ValueError('Alle medobservatører må ha et gyldig AO-alias.')
        alias = alias.strip()
        if alias.casefold() not in brukt:
            ut.append(alias)
            brukt.add(alias.casefold())
    return ut


def slaa_opp_alias(client, alias):
    """Bruk AOs eget observer-søk, og krev et entydig, eksakt aliastreff."""
    svar = client.post(AO_BASE + '/User/FindUsersByName', json={
        'Search': alias, 'FilterByHasCollection': False,
        'IncludeAccountsFromOldPortals': False, 'IncludeCurrentUserInResult': True,
        'includeDeletedUsersInResult': False, 'TopListUsers': False,
    }, headers={'X-Requested-With': 'XMLHttpRequest'}, timeout=15)
    if svar.status_code in (401, 403):
        raise AoSessionExpired()
    svar.raise_for_status()
    brukere = svar.json()
    if not isinstance(brukere, list):
        raise ValueError('Kunne ikke lese observatørsøket hos Artsobservasjoner.')
    treff = [b for b in brukere if isinstance(b, dict)
             and str(b.get('UserAlias') or '').casefold() == alias.casefold()
             and isinstance(b.get('Id'), int) and not isinstance(b['Id'], bool) and b['Id'] > 0]
    if len(treff) != 1:
        raise ValueError('Et valgt AO-alias kunne ikke bekreftes entydig. Velg personen på nytt i AO-søket.')
    b = treff[0]
    return {'id': b['Id'], 'alias': b['UserAlias'], 'name': str(b.get('PresentationName') or b['UserAlias'])}


class _ObserverParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.observers = []
        self._current = None

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if a.get('data-useralias'):
            self._current = {'alias': a['data-useralias'], 'name': ''}
            self.observers.append(self._current)

    def handle_data(self, data):
        if self._current is not None:
            self._current['name'] += data

    def handle_endtag(self, tag):
        if tag == 'span':
            self._current = None


def observere_fra_rad(rad):
    parser = _ObserverParser()
    parser.feed(str(rad.get('Observers') or ''))
    return [{'alias': x['alias'], 'name': x['name'].strip() or x['alias']} for x in parser.observers]


def observer_setup(login_token, auth_cookie, sighting_id, expected_group=None):
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
    try:
        rad = fetch_raw_row(login_token, auth_cookie, sighting_id)
        if not er_rapportor(rad) or not gjelder_gruppe(rad, expected_group):
            return {'ok': False, 'error': 'Kunne ikke bekrefte at dette er ditt eget funn på valgt sted og dato.'}
        from src import ao_edit
        with ao_edit.ny_klient(login_token, auth_cookie) as client:
            svar = client.get(AO_BASE + '/SubmitSighting/Report', follow_redirects=True, timeout=25)
            if svar.status_code in (401, 403) or not _looks_logged_in(svar.text):
                raise AoSessionExpired()
            svar.raise_for_status()
            # Midlertidig kartlegging aktiveres bare eksplisitt lokalt. Rå HTML
            # returneres aldri til klienten, og sesjonstokens skrives ikke her.
            capture = os.environ.get('AO_SCHEMA_CAPTURE_PATH')
            if capture:
                Path(capture).write_text(svar.text, encoding='utf-8')
            felt, _ = ao_edit.parse_edit_form(svar.text)
            observerfelt = sorted({n for n, _, _ in felt if n.startswith(ao_edit._V + 'Observers[')})
            if not observerfelt:
                return {'ok': False, 'error': 'Fant ikke observatørfeltene i rapportskjemaet hos AO.'}
        return {'ok': True, 'selfAlias': _current_user_alias([rad]),
                'coobservers': observere_fra_rad(rad), 'observerFields': observerfelt}
    except AoSessionExpired:
        return {'ok': False, 'needsLogin': True, 'error': 'Sesjonen mot Artsobservasjoner er utløpt.'}
    except Exception:
        return {'ok': False, 'error': 'Kunne ikke lese observatørvalgene hos Artsobservasjoner.'}
