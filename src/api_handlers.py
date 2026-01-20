"""
API handlers for fugleobservasjoner.

Håndterer eksterne API-kall til Artsobservasjoner og Nominatim.
"""

import json
import math
import re
from html import unescape
from urllib.parse import urlencode
from urllib.request import Request, urlopen


def handle_species_search(search_term, dont_include_sub='true'):
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
    ao_url = 'https://www.artsobservasjoner.no/Taxon/PickerSearch?' + urlencode(query_params)

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


def handle_ao_sites_search(lat, lon, size_m=600.0):
    """Håndter søk etter AO-lokaliteter."""
    # Valider input
    try:
        lat = float(lat)
        lon = float(lon)
        size_m = float(size_m) if size_m else 600.0
    except ValueError:
        raise ValueError('Ugyldig lat/lon/size')

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
        f'AO-sites forespørsel: lat={lat:.6f}, lon={lon:.6f}, size_m={size_m:.1f}, '
        f'minX={min_x:.6f}, minY={min_y:.6f}, maxX={max_x:.6f}, maxY={max_y:.6f}'
    )

    query_params = {
        'maxSites': '200',
        'minX': f'{min_x:.6f}',
        'minY': f'{min_y:.6f}',
        'maxX': f'{max_x:.6f}',
        'maxY': f'{max_y:.6f}',
        'includePublicSites': 'true',
    }

    ao_sites_url = (
        'https://mobil.artsobservasjoner.no/core/Sites/ByBoundingBox?' +
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
            body = resp.read().decode('utf-8', errors='ignore')
        data = json.loads(body)

        # Normaliser datastruktur
        if isinstance(data, list):
            raw_sites = data
        elif isinstance(data, dict):
            raw_sites = data.get('sites') or data.get('Sites') or []
        else:
            raw_sites = []

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

        print(f'AO-sites svar: antall steder = {len(sites)}')
        if sites[:3]:
            print('AO-sites eksempelsteder:', [s.get('name') for s in sites[:3]])

        return sites
    except Exception as e:
        print('Feil ved henting av AO-lokaliteter:', repr(e))
        raise