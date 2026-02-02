"""
API handlers for fugleobservasjoner.

Håndterer eksterne API-kall til Artsobservasjoner og Nominatim.
"""

import json
import math
import re
import os
from html import unescape
from urllib.parse import urlencode
from urllib.request import Request, urlopen


def handle_species_search(search_term, dont_include_sub='true', ao_base_url='https://www.artsobservasjoner.no'):
    """Håndter søk etter arter via Artsobservasjoner.no."""
    if not search_term.strip():
        return []

    # Bygg URL til Artsobservasjoner
    query_params = {
        'search': search_term,
        'returnformat': 'html',
        'onlyReportable': 'true',
        'dontIncludeSubSpecies': dont_include_sub,
        'speciesGroup': '8',
        'language': '4',
    }
    ao_url = ao_base_url + '/Taxon/PickerSearch?' + urlencode(query_params)

    req = Request(
        ao_url,
        headers={
            'User-Agent': 'Mozilla/5.0 (compatible; Fugleobservasjoner-Python/0.1)',
            'Accept': 'text/html, */*; q=0.01',
            'X-Requested-With': 'XMLHttpRequest',
            'Referer': 'https://www.artsobservasjoner.no/SubmitSighting/Report',
        },
    )

    try:
        with urlopen(req, timeout=10) as resp:
            html_bytes = resp.read()
        html = html_bytes.decode('utf-8', errors='ignore')

        # Finn alle <span class="itemjson">...</span>
        items = re.findall(r'<span class="itemjson">(.*?)</span>', html)
        results = []

        for item in items:
            try:
                data = json.loads(item)
                taxon_name_raw = data.get('taxonname')
                taxon_name = unescape(taxon_name_raw) if taxon_name_raw else None
                scientific_raw = data.get('scientificname')
                scientific_html = unescape(scientific_raw) if scientific_raw else None
                
                results.append({
                    'taxonId': data.get('taxonid'),
                    'taxonName': taxon_name,
                    'scientificNameHtml': scientific_html,
                    'speciesGroupId': data.get('speciesgroupid'),
                    'protectionLevelId': data.get('protectionlevelid'),
                    'leaf': (data.get('leaf') == 'true'),
                })
            except Exception:
                # Ignorer rader vi ikke klarer å parse
                continue

        return results
    except Exception as e:
        print('Feil ved henting fra Artsobservasjoner:', e)
        raise


def handle_reverse_geocoding(lat, lon, nominatim_base_url):
    """Håndter reverse geokoding via Nominatim."""
    # Valider koordinater
    try:
        float(lat)
        float(lon)
    except ValueError:
        raise ValueError('Ugyldig lat/lon')

    nominatim_url = f'{nominatim_base_url}?format=jsonv2&lat={lat}&lon={lon}&zoom=14&addressdetails=1'

    req = Request(
        nominatim_url,
        headers={
            'User-Agent': 'Fugleobservasjoner/0.1 (hobbyprosjekt)',
            'Accept': 'application/json',
        },
    )

    try:
        with urlopen(req, timeout=10) as resp:
            body = resp.read().decode('utf-8', errors='ignore')
        
        if not body.strip():
            return None

        data = json.loads(body)
        address = data.get('address', {}) or {}
        
        # Finn kort stedsnavn
        name = (
            address.get('locality') or
            address.get('village') or
            address.get('town') or
            address.get('city') or
            address.get('hamlet') or
            address.get('municipality') or
            address.get('county') or
            data.get('name') or
            data.get('display_name')
        )
        
        return name
    except Exception as e:
        print('Feil ved reverse geokoding:', e)
        raise


def handle_ao_sites_search(lat, lon, size_m=600.0, ao_mobile_base_url='https://mobil.artsobservasjoner.no', user_id=None, login_token=None, auth_cookie=None):
    """Håndter søk etter AO-lokaliteter.
    
    Returns:
        tuple: (sites_list, refreshed_auth_cookie_or_None)
    """
    # Valider input
    try:
        lat = float(lat)
        lon = float(lon)
        size_m = float(size_m) if size_m else 600.0
    except ValueError:
        raise ValueError('Ugyldig lat/lon/size')
        
    # Variabel for å holde styr på refreshed tokens
    refreshed_auth_cookie = None

    # Beregn geografisk boks
    half_m = max(size_m, 1.0) / 2.0
    meters_per_deg_lat = 111_320.0
    meters_per_deg_lon = meters_per_deg_lat * math.cos(math.radians(lat)) or 1.0

    d_lat = half_m / meters_per_deg_lat
    d_lon = half_m / meters_per_deg_lon

    min_y = lat - d_lat
    max_y = lat + d_lat
    min_x = lon - d_lon
    max_x = lon + d_lon

    print(
        f'[DEBUG] AO-sites forespørsel: lat={lat:.6f}, lon={lon:.6f}, size_m={size_m:.1f}, '
        f'minX={min_x:.6f}, minY={min_y:.6f}, maxX={max_x:.6f}, maxY={max_y:.6f}',
        flush=True
    )
    print(f'[DEBUG] AO-tokens mottatt: user_id={bool(user_id)}, login_token={bool(login_token)}, auth_cookie={bool(auth_cookie)}', flush=True)

    # Samler raw sites her
    raw_sites = []
    my_site_ids = set()  # Holder styr på ALLE brukerens site-IDer (ikke bare i bbox)

    # --- KALL 1: Hent brukerens lokasjoner via GetSitesGeoJson ---
    # Bruker samme bbox for å finne brukerens egne sites i området
    ao_login = login_token or os.getenv('AO_LOGIN_TOKEN')
    ao_auth = auth_cookie or os.getenv('AO_AUTH_COOKIE')
    ao_user_id = user_id or os.getenv('AO_USER_ID')

    print(f'[DEBUG] AO-tokens final: user_id={ao_user_id}, login_token={ao_login[:20] if ao_login else None}..., auth_cookie={ao_auth[:30] if ao_auth else None}...', flush=True)
    
    if ao_login and ao_auth and ao_user_id:
        try:
            # Normaliser AO_AUTH_COOKIE verdi
            auth_val = ao_auth
            if auth_val.startswith('.ASPXAUTHNO='):
                auth_val = auth_val.split('=', 1)[1]

            # Konverter lat/lon til Web Mercator (EPSG:3857) for bbox
            def lat_lon_to_mercator(lat, lon):
                x = lon * 20037508.34 / 180
                y = math.log(math.tan((90 + lat) * math.pi / 360)) / (math.pi / 180)
                y = y * 20037508.34 / 180
                return x, y

            center_x, center_y = lat_lon_to_mercator(lat, lon)
            # Bbox ca 200m rundt sentrum (tilpasset zoom 16) - bruk heltall
            half_size = 100
            bbox_str = f'{int(center_x - half_size)},{int(center_y - half_size)},{int(center_x + half_size)},{int(center_y + half_size)}'

            # Cookie-streng - kun det nødvendige
            cookies = f'AcceptCookies=1; .ASPXAUTHNO={auth_val}; logintoken={ao_login}'
            
            geojson_url = 'https://www.artsobservasjoner.no/Map/GetSitesGeoJson'
            post_data = json.dumps({
                'zoomLevel': 16,
                'bbox': bbox_str,
                'userId': int(ao_user_id),
                'coordSyst': 0,
                'speciesGroupId': '8',
                'taxonId': None
            }).encode('utf-8')

            request_headers = {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:147.0) Gecko/20100101 Firefox/147.0',
                'Accept': 'application/json, text/javascript, */*; q=0.01',
                'Accept-Language': 'nb-NO,nb;q=0.9,no;q=0.8,nn;q=0.7,en;q=0.6',
                'Content-Type': 'application/json; charset=UTF-8',
                'X-Requested-With': 'XMLHttpRequest',
                'Origin': 'https://www.artsobservasjoner.no',
                'Referer': 'https://www.artsobservasjoner.no/SubmitSighting/Report',
                'Cookie': cookies,
            }
            print(f'[DEBUG] GetSitesGeoJson POST to {geojson_url}', flush=True)
            print(f'[DEBUG] GetSitesGeoJson bbox: {bbox_str}', flush=True)
            
            geojson_req = Request(
                geojson_url,
                data=post_data,
                headers=request_headers,
                method='POST'
            )
            with urlopen(geojson_req, timeout=10) as resp:
                print(f'[DEBUG] GetSitesGeoJson HTTP status: {resp.status}', flush=True)
                print(f'[DEBUG] GetSitesGeoJson Content-Type: {resp.headers.get("Content-Type", "N/A")}', flush=True)
                # Sjekk etter refreshed auth cookie
                try:
                    set_cookie_header = resp.headers.get('Set-Cookie', '')
                    if set_cookie_header and '.ASPXAUTHNO=' in set_cookie_header:
                        # Parse ut ny .ASPXAUTHNO verdi
                        import re
                        match = re.search(r'\.ASPXAUTHNO=([^;]+)', set_cookie_header)
                        if match:
                            refreshed_auth_cookie = match.group(1)
                            print(f'Fikk refreshed auth cookie fra GetSitesGeoJson')
                except Exception as cookie_err:
                    print(f'Feil ved parsing av Set-Cookie: {cookie_err}')
                
                content_encoding = resp.headers.get('Content-Encoding', '')
                raw_body = resp.read()
                print(f'[DEBUG] GetSitesGeoJson raw_body length: {len(raw_body)}, encoding: {content_encoding}', flush=True)
                if content_encoding == 'gzip':
                    import gzip
                    body = gzip.decompress(raw_body).decode('utf-8', errors='ignore')
                elif content_encoding == 'br':
                    # Brotli-komprimering krever brotli-bibliotek
                    try:
                        import brotli
                        body = brotli.decompress(raw_body).decode('utf-8', errors='ignore')
                    except ImportError:
                        body = raw_body.decode('utf-8', errors='ignore')
                else:
                    body = raw_body.decode('utf-8', errors='ignore')
            
            print(f'[DEBUG] GetSitesGeoJson body length: {len(body)}, first 500: {repr(body[:500])}', flush=True)
            geojson_data = json.loads(body) if body else None
            print(f'[DEBUG] GetSitesGeoJson parsed keys: {list(geojson_data.keys()) if isinstance(geojson_data, dict) else type(geojson_data)}', flush=True)

            # GetSitesGeoJson returnerer { points: { features: [...] }, polygons: {...} }
            # Brukerens egne sites har isPrivate=true
            if isinstance(geojson_data, dict):
                # Sjekk points.features
                points = geojson_data.get('points', {})
                if isinstance(points, dict):
                    for feature in points.get('features', []):
                        props = feature.get('properties', {})
                        if props.get('isPrivate'):
                            site_id = props.get('siteId') or props.get('id') or feature.get('id')
                            if site_id is not None:
                                my_site_ids.add(int(site_id))
                # Sjekk også polygons.features
                polygons = geojson_data.get('polygons', {})
                if isinstance(polygons, dict):
                    for feature in polygons.get('features', []):
                        props = feature.get('properties', {})
                        if props.get('isPrivate'):
                            site_id = props.get('siteId') or props.get('id') or feature.get('id')
                            if site_id is not None:
                                my_site_ids.add(int(site_id))
            
            print(f'GetSitesGeoJson: fant {len(my_site_ids)} private site-IDs')
        except Exception as geojs_err:
            # Logging feil ved henting av brukerens egne lokasjoner - ikke kritisk
            print(f'Feil i GetSitesGeoJson: {geojs_err}')
            pass

    # --- KALL 2: Hent offentlige lokasjoner (ByBoundingBox) ---
    query_params = {
        'maxSites': '1000',
        'minX': f'{min_x:.6f}',
        'minY': f'{min_y:.6f}',
        'maxX': f'{max_x:.6f}',
        'maxY': f'{max_y:.6f}',
        'includePublicSites': 'true',
    }

    ao_sites_url = (
        ao_mobile_base_url + '/core/Sites/ByBoundingBox?' +
        urlencode(query_params)
    )

    req = Request(
        ao_sites_url,
        headers={
            'User-Agent': 'Mozilla/5.0 (compatible; Fugleobservasjoner-Python/0.1)',
            'Accept': 'application/json, text/plain, */*',
            'Accept-Encoding': 'identity',
            'X-CSRF': '1',
            'Referer': 'https://mobil.artsobservasjoner.no/contribute/submit-sightings',
        },
    )

    try:
        with urlopen(req, timeout=10) as resp:
            # Sjekk etter refreshed auth cookie også her
            if not refreshed_auth_cookie:  # Kun hvis ikke allerede satt
                try:
                    set_cookie_header = resp.headers.get('Set-Cookie', '')
                    if set_cookie_header and '.ASPXAUTHNO=' in set_cookie_header:
                        import re
                        match = re.search(r'\.ASPXAUTHNO=([^;]+)', set_cookie_header)
                        if match:
                            refreshed_auth_cookie = match.group(1)
                            print(f'Fikk refreshed auth cookie fra ByBoundingBox')
                except Exception as cookie_err:
                    print(f'Feil ved parsing av Set-Cookie: {cookie_err}')
            
            body = resp.read().decode('utf-8', errors='ignore')
        data = json.loads(body)

        # Normaliser datastruktur fra ByBoundingBox
        if isinstance(data, list):
            public_sites = data
        elif isinstance(data, dict):
            public_sites = data.get('sites') or data.get('Sites') or []
        else:
            public_sites = []

        # Legg til alle sites fra ByBoundingBox
        for item in public_sites or []:
            if not isinstance(item, dict):
                continue
            raw_sites.append(item)

        # Prosesser steder
        sites = []
        for item in raw_sites or []:
            if not isinstance(item, dict):
                continue

            name = (
                item.get('name') or
                item.get('Name') or
                item.get('siteName') or
                item.get('SiteName')
            )
            site_id = item.get('id') or item.get('Id') or item.get('siteId')
            lat_val = item.get('lat') or item.get('latitude') or item.get('Lat')
            lon_val = item.get('lon') or item.get('longitude') or item.get('Lon')

            site = {'raw': item}
            if name:
                site['name'] = name
            if site_id is not None:
                site['id'] = site_id
                # Sjekk om dette er en av mine lokasjoner (basert på GetMySites)
                try:
                    if int(site_id) in my_site_ids:
                        site['isMine'] = True
                except (ValueError, TypeError):
                    pass

            if lat_val is not None:
                site['lat'] = lat_val
            if lon_val is not None:
                site['lon'] = lon_val
            # Oppdag om dette er en "superlokasjon" eller har en parent-id.
            # Artsobservasjoner kan bruke flere ulike feltnavn/typer, så vi
            # sjekker flere varianter og normaliserer til booleansk
            # `isSuper` og eventuelt `parentId`.
            try:
                # Sjekk eksplisitte flagg (bool eller strings)
                for k in ('isSuper', 'isSuperSite', 'IsSuper', 'IsSuperSite', 'is_super'):
                    if k in item:
                        v = item.get(k)
                        if v is True or v == 'true' or v == 'True' or v == '1':
                            site['isSuper'] = True
                        elif v is False or v == 'false' or v == 'False' or v == '0':
                            site['isSuper'] = False
                        break

                # Sjekk om typen inneholder ordet 'super' eller 'superlokalitet'
                if 'isSuper' not in site:
                    t = item.get('siteType') or item.get('type') or item.get('SiteType')
                    if isinstance(t, str) and ('super' in t.lower() or 'superlok' in t.lower()):
                        site['isSuper'] = True

                # Parent-id kan indikere at dette er en underlokalitet (ikke super)
                for pk in ('parentId', 'parentSiteId', 'ParentId', 'parent'):
                    if pk in item and item.get(pk) is not None:
                        site['parentId'] = item.get(pk)
                        # Hvis parent finnes og isSuper ikke eksplisitt satt,
                        # merk isSuper som False (dette er en barn-lokalitet)
                        if 'isSuper' not in site:
                            site['isSuper'] = False
                        break
            except Exception:
                # Ikke la parsing av ekstra felt knekke hele kall
                pass
            sites.append(site)

        # Etter at vi har samlet alle sites, utled om noen er "superlokasjoner"
        # ved å se etter parent-referanser. Hvis et item A har parentSiteId = B,
        # så er B en superlokasjon (forelder) og A er en underlokalitet.
        try:
            id_map = {s.get('id'): s for s in sites if s.get('id') is not None}
            for s in sites:
                raw = s.get('raw') or {}
                # Sjekk flere varianter av parent-felt
                parent_keys = ('parentSiteId', 'parentId', 'parent', 'ParentId', 'parentSite')
                for pk in parent_keys:
                    if pk in raw and raw.get(pk) is not None:
                        pid = raw.get(pk)
                        s['parentId'] = pid
                        # Barn-lokalitet
                        s['isSuper'] = False
                        # Marker parent som super hvis vi har den i resultatsettet
                        if pid in id_map:
                            id_map[pid]['isSuper'] = True
                        break
        except Exception:
            pass

        print(f'AO-sites svar: {len(sites)} lokaliteter returnert')
        if sites[:3]:
            print('AO-sites eksempelsteder:', [s.get('name') for s in sites[:3]])

        # Merk bruker-eide lokasjoner hvis de er angitt i miljøvariabel
        # MY_AO_SITE_IDS kan være en kommaseparert liste med site-id'er som eies av brukeren.
        try:
            my_ids_raw = os.getenv('MY_AO_SITE_IDS', '')
            if my_ids_raw:
                my_ids = set([int(x.strip()) for x in my_ids_raw.split(',') if x.strip()])
                for s in sites:
                    sid = s.get('id')
                    if sid is not None and int(sid) in my_ids:
                        s['isMine'] = True
        except Exception:
            # Ikke la parsing av denne configen knekke kall
            pass

        # Sorter slik at `isMine` (brukerens egne) kommer først, deretter resten uendret
        try:
            sites.sort(key=lambda s: (0 if s.get('isMine') else 1))
        except Exception:
            pass

        return sites, refreshed_auth_cookie
    except Exception as e:
        print('Feil ved henting av AO-lokaliteter:', repr(e))
        raise