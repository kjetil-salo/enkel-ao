"""Hent konto-ID fra profilen til brukeren AO nettopp autentiserte."""

from html.parser import HTMLParser
import re

import httpx


_PROFIL = 'https://www.artsobservasjoner.no/User/EditMyProfile'


class _ProfilParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.kontoer = []
        self.aliaser = []

    def handle_starttag(self, tag, attrs):
        felt = dict(attrs)
        if tag == 'input' and felt.get('name') == 'EditUser.User.Id' and felt.get('type') == 'hidden':
            self.kontoer.append(felt.get('value') or '')
        if tag == 'ul' and felt.get('id') == 'usernavigation':
            self.aliaser.append(felt.get('data-useralias') or '')


def hent_ao_konto(auth_cookie):
    """Returner (kontonøkkel, alias) fra AOs profilside, eller None ved avvik."""
    if not auth_cookie:
        return None
    try:
        svar = httpx.get(_PROFIL, cookies={'.ASPXAUTHNO': auth_cookie, 'AcceptCookies': '1'}, timeout=10)
        if svar.status_code != 200:
            return None
        parser = _ProfilParser()
        parser.feed(svar.text)
        if len(parser.kontoer) == len(parser.aliaser) == 1:
            konto, alias = parser.kontoer[0], parser.aliaser[0]
            if re.fullmatch(r'[1-9][0-9]{0,19}', konto) and alias.strip() and len(alias) <= 80:
                return f'ao:{konto}', alias
    except (httpx.HTTPError, ValueError):
        pass
    return None
