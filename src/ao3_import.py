"""Direkte reserveinnsending via AO3s ordinære innlogging og rapporteringsskjema."""

from datetime import datetime, time, timezone
from functools import lru_cache
from html.parser import HTMLParser
from urllib.parse import urljoin
from zoneinfo import ZoneInfo

import httpx


AO3 = 'https://mobil.artsobservasjoner.no'
AO3_LOGIN = 'https://login.artsobservasjoner.no'
_AO3_HEADERS = {'X-CSRF': '1', 'Accept': 'application/json', 'Origin': AO3}
_OSLO = ZoneInfo('Europe/Oslo')


class _KanIkkeSende(ValueError):
    pass


class _Innloggingsskjema(HTMLParser):
    def __init__(self):
        super().__init__()
        self.skjemaer = []
        self._aktivt = None

    def handle_starttag(self, tag, attrs):
        felt = dict(attrs)
        if tag == 'form':
            self._aktivt = (felt.get('action') or '', [])
        elif tag in ('input', 'button') and self._aktivt and felt.get('name'):
            self._aktivt[1].append(felt)

    def handle_endtag(self, tag):
        if tag == 'form' and self._aktivt:
            self.skjemaer.append(self._aktivt)
            self._aktivt = None


def _følg_innlogging(klient, svar):
    for _ in range(10):
        if not svar.is_redirect:
            svar.raise_for_status()
            return svar
        url = httpx.URL(urljoin(str(svar.url), svar.headers['location']))
        if (url.scheme != 'https' or url.port not in (None, 443)
                or url.host not in ('mobil.artsobservasjoner.no', 'login.artsobservasjoner.no')):
            raise _KanIkkeSende('AO3 ga en ukjent innloggingsadresse.')
        svar = klient.get(url)
    raise _KanIkkeSende('AO3 ga for mange omdirigeringer.')


def _logg_inn(klient, epost, passord):
    side = _følg_innlogging(klient, klient.get(AO3 + '/bff/login?returnUrl=/contribute/submit-sightings'))
    parser = _Innloggingsskjema()
    parser.feed(side.text)
    for handling, felter in parser.skjemaer:
        passordfelt = next((f for f in felter if f.get('type') == 'password'), None)
        epostfelt = next((f for f in felter if f.get('type') == 'email' or f.get('autocomplete') == 'username'), None)
        if passordfelt and epostfelt:
            break
    else:
        raise _KanIkkeSende('AO3-innloggingen er utilgjengelig.')

    adresse = httpx.URL(urljoin(str(side.url), handling))
    if adresse.scheme != 'https' or adresse.port not in (None, 443) or adresse.host != 'login.artsobservasjoner.no':
        raise _KanIkkeSende('AO3 ga en ukjent adresse for innlogging.')
    data = {f['name']: f.get('value', '') for f in felter if f.get('type') in ('hidden', 'submit')}
    data[epostfelt['name']] = epost
    data[passordfelt['name']] = passord
    svar = klient.post(adresse, data=data, headers={'Origin': AO3_LOGIN, 'Referer': str(side.url)})
    if svar.status_code not in (302, 303):
        raise _KanIkkeSende('AO3 godtok ikke direkte innlogging. Logg inn på AO3 med e-post.')
    _følg_innlogging(klient, svar)
    krav = klient.get(AO3 + '/bff/user', headers=_AO3_HEADERS).raise_for_status().json()
    identitet = {f['type']: f.get('value') for f in krav}
    if not identitet.get('user_account_id'):
        raise _KanIkkeSende('AO3-innloggingen kunne ikke bekreftes.')
    return identitet


def _private_lokaliteter(klient):
    def hent_side(side):
        return klient.get(AO3 + '/core/Sites/ByUser', headers=_AO3_HEADERS,
                          params={'pageNumber': side, 'pageSize': 50}).raise_for_status().json()

    første = hent_side(1)
    rader = list(første['data'])
    for side in range(2, første['totalPages'] + 1):
        rader.extend(hent_side(side)['data'])
    return [
        {'id': rad['id'], 'name': rad['name'], 'lat': rad['latitude'], 'lon': rad['longitude'],
         'acc': rad.get('accuracy'), 'municipality': rad.get('municipalityName')}
        for rad in rader if rad.get('isPrivate') is True
    ]


def logg_inn_pa_ao3(epost, passord, *, med_lokaliteter=False):
    """Bekreft legitimasjonen, og hent eventuelt egne private lokaliteter i samme sesjon."""
    try:
        with httpx.Client(timeout=12, headers={'User-Agent': 'Enkel-AO (rapportering)'}) as klient:
            _logg_inn(klient, epost, passord)
            resultat = {'success': True, 'via': 'ao3'}
            if med_lokaliteter:
                try:
                    resultat['sites'] = _private_lokaliteter(klient)
                except (httpx.HTTPError, ValueError, KeyError, TypeError, AttributeError):
                    resultat['degradert'] = True
            return resultat
    except (httpx.HTTPError, ValueError, KeyError, TypeError, AttributeError):
        return None


@lru_cache(maxsize=8)
def _verdilister(gruppe_id=8):
    svar = httpx.get(AO3 + '/lists/Lists/GetAllLists', params={'languageCode': 'nb'},
                     headers=_AO3_HEADERS, timeout=8).raise_for_status().json()
    gruppe = {navn: next((r for r in svar[navn] if r['speciesGroupId'] == gruppe_id), {})
              for navn in ('speciesGroupActivities', 'speciesGroupStages', 'speciesGroupGenders',
                           'speciesGroupUnits', 'speciesGroupDiscoveryMethods')}
    aktiviteter = [a for kategori in gruppe['speciesGroupActivities'].get('activityCategories', [])
                   for a in kategori.get('activity', [])]
    return tuple(
        {r['resourceLabel'].strip().casefold(): r['id'] for r in rader}
        for rader in (
            aktiviteter,
            gruppe['speciesGroupStages'].get('stages', []),
            gruppe['speciesGroupGenders'].get('genders', []),
            gruppe['speciesGroupUnits'].get('units', []),
            gruppe['speciesGroupDiscoveryMethods'].get('discoveryMethods', []),
        )
    )


@lru_cache(maxsize=2048)
def _ao3_art(takson_id):
    return httpx.get(f'{AO3}/core/Taxons/{takson_id}/Information', headers=_AO3_HEADERS,
                     timeout=8).raise_for_status().json()


def _lokal_tid(verdi):
    dato = datetime.fromisoformat(verdi.replace('Z', '+00:00'))
    return dato.astimezone(_OSLO) if dato.tzinfo else dato.replace(tzinfo=_OSLO)


def _dato(dato):
    midnatt = datetime.combine(dato.date(), time(), _OSLO)
    return midnatt.astimezone(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')


def _prepare(funn):
    # Felter som krever egen flyt eller som ikke er verifisert i AO3, går til manuell import.
    if (any(funn.get('coObservers') or [])
            or any(funn.get(k) for k in ('photo', 'secondhand', 'interesting', 'notSpontaneous', 'hideUntil'))):
        raise _KanIkkeSende('Bruk AO3-importen for å kontrollere alle feltene i lista.')
    if funn.get('comment') and funn.get('privateComment'):
        raise _KanIkkeSende('Bruk AO3-importen for å ta med både offentlig og privat merknad.')
    art = funn['species']
    takson = int(art['taxonId'])
    sted = int(funn['placeId'])
    gruppe_id = int(funn.get('speciesGroupId') or art.get('speciesGroupId') or 8)
    # Ukjent antall (se docs/ukjent-antall-og-uoppgitt-aktivitet.md) gir count=None —
    # 0 er aldri et ekte antall, så den eksisterende min(...)<1-sjekken under fanger
    # det uttrykt og sender funnet til manuell AO3-import i stedet for å kaste.
    antall = int(funn['count']) if funn.get('count') is not None else 0
    if min(takson, sted, antall) < 1:
        raise _KanIkkeSende('Bruk AO3-importen for funn uten entydig art, lokalitet eller antall.')
    ao3_art = _ao3_art(takson)
    navn = ((ao3_art.get('vernacularName') or {}).get('name') or '').strip().casefold()
    if ao3_art['speciesGroupId'] != gruppe_id or navn != art['taxonName'].strip().casefold():
        raise _KanIkkeSende('Artens navn og ID kunne ikke verifiseres i AO3.')

    verdier_tuple = _verdilister(gruppe_id) if gruppe_id != 8 else _verdilister()
    aktiviteter, alder, kjønn = verdier_tuple[:3]
    enheter = verdier_tuple[3] if len(verdier_tuple) > 3 else {}
    metoder = verdier_tuple[4] if len(verdier_tuple) > 4 else {}
    fra = _lokal_tid(funn['timestamp'])
    til = _lokal_tid(funn['tilKlokkeslett']) if funn.get('tilKlokkeslett') else fra
    felter = {
        'taxonId': takson, 'siteId': sted, 'quantity': antall,
        'discovererIds': [],
        'startDate': _dato(fra),
        'startTime': None if fra.time() == time() else fra.strftime('%H:%M'),
        'endTime': None if til.time() == time() else til.strftime('%H:%M'),
        'fromOrakel': False,
        # AO3s skjema sender også en standardverdi her ved en eksisterende lokalitet.
        'newSiteInfo': {'siteName': '', 'longitude': 0, 'latitude': 0,
                        'isPolygon': False, 'polygonCoordinates': None, 'accuracy': 200},
    }
    if til.date() != fra.date():
        felter['endDate'] = _dato(til)
    for appfelt, ao3felt, verdier in (
        ('activity', 'activityId', aktiviteter),
        ('age', 'stageId', alder),
        ('gender', 'genderId', kjønn),
        ('unit', 'unitId', enheter),
        ('discoveryMethod', 'discoveryMethodId', metoder),
    ):
        if verdi := (funn.get(appfelt) or '').strip().casefold():
            felter[ao3felt] = verdier[verdi]
    for merknad in ('comment', 'privateComment'):
        if funn.get(merknad):
            felter[merknad] = funn[merknad]
    for appfelt, ao3felt in (('uncertain', 'unsureDetermination'), ('notRefound', 'notRecovered'), ('notFound', 'notPresent')):
        if funn.get(appfelt):
            felter[ao3felt] = True
    return felter


def send_via_ao3(epost, passord, observasjoner):
    """Opprett og verifiser bare denne sendingens utkast før ID-ene publiseres samlet."""
    innsending_startet = False
    try:
        klargjort = [_prepare(funn) for funn in observasjoner]
        with httpx.Client(timeout=12, headers={'User-Agent': 'Enkel-AO (rapportering)'}) as klient:
            identitet = _logg_inn(klient, epost, passord)
            observatør = int(identitet['user_id'])
            if observatør <= 0:
                raise _KanIkkeSende('AO3 ga ikke en gyldig observatør-ID.')
            ider = []
            for funn in klargjort:
                innsending_startet = True
                svar = klient.post(AO3 + '/core/Sightings',
                                  json={**funn, 'observerIds': [observatør]}, headers=_AO3_HEADERS)
                if svar.status_code != 201:
                    raise _KanIkkeSende('AO3 bekreftet ikke opprettelsen av utkastet.')
                funn_id = svar.json()['id']
                if type(funn_id) is not int or funn_id <= 0 or funn_id in ider:
                    raise _KanIkkeSende('AO3 ga ingen entydig kvittering for utkastet.')
                detalj = klient.get(f'{AO3}/core/Sightings/{funn_id}', headers=_AO3_HEADERS).raise_for_status().json()
                if (detalj['id'] != funn_id or detalj['site']['id'] != funn['siteId']
                        or detalj['taxon']['id'] != funn['taxonId']
                        or detalj['quantity'] != funn['quantity']
                        or not any(o['id'] == observatør for o in detalj['observers'])
                        or not detalj['sightingStateType'] or detalj['sightingStateType'] == 'Published'):
                    raise _KanIkkeSende('AO3-utkastet kunne ikke verifiseres.')
                ider.append(funn_id)
            klient.put(AO3 + '/core/Sightings/Publish', json=ider, headers=_AO3_HEADERS).raise_for_status()
            for funn_id in ider:
                detalj = klient.get(f'{AO3}/core/Sightings/{funn_id}', headers=_AO3_HEADERS).raise_for_status().json()
                if detalj.get('sightingStateType') != 'Published':
                    raise _KanIkkeSende('AO3 bekreftet ikke publisering av alle funnene.')
            return {'success': True, 'published': True, 'count': len(ider), 'via': 'ao3'}
    except (httpx.HTTPError, KeyError, TypeError, ValueError, StopIteration, AttributeError):
        if innsending_startet:
            return {'success': False, 'code': 'ao3_unconfirmed'}
        return {'success': False, 'code': 'ao3_manual'}
