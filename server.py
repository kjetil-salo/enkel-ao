#!/usr/bin/env python3
import json
import math
import os
import re
from html import unescape
from http.server import SimpleHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse, parse_qs, urlencode
from urllib.request import Request, urlopen

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PUBLIC_DIR = os.path.join(BASE_DIR, 'public')


class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        import sys
        user_agent = self.headers.get('User-Agent', '-')
        print(f"[LOG] IP: {self.client_address[0]} | UA: {user_agent} | PATH: {self.path}", file=sys.stderr)
        parsed = urlparse(self.path)

        # API-endepunkt for arts-autocomplete
        if parsed.path == '/api/species':
            params = parse_qs(parsed.query)
            search = params.get('search', [''])[0].strip()

            if not search:
                self._send_json([], status=200)
                return

            # Bygg opp URL til Artsobservasjoner
            query_params = {
                'search': search,
                'returnformat': 'html',
                'onlyReportable': 'true',
                'dontIncludeSubSpecies': 'true',
                'speciesGroup': '8',
                'language': '4',
            }
            ao_url = (
                'https://www.artsobservasjoner.no/Taxon/PickerSearch?' + urlencode(query_params)
            )

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
                        taxon_name = unescape(taxon_name_raw) if taxon_name_raw is not None else None
                        scientific_raw = data.get('scientificname')
                        scientific_html = unescape(scientific_raw) if scientific_raw is not None else None
                        results.append(
                            {
                                'taxonId': data.get('taxonid'),
                                'taxonName': taxon_name,
                                'scientificNameHtml': scientific_html,
                                'speciesGroupId': data.get('speciesgroupid'),
                                'protectionLevelId': data.get('protectionlevelid'),
                                'leaf': (data.get('leaf') == 'true'),
                            }
                        )
                    except Exception:
                        # Ignorer rader vi ikke klarer å parse
                        continue

                self._send_json(results, status=200)
                return

            except Exception as e:
                print('Feil ved henting fra Artsobservasjoner:', e)
                self._send_json(
                    {'error': 'Feil ved henting fra Artsobservasjoner.'}, status=500
                )
                return

        # Reverse geokoding: lat/lon -> stedsnavn (Nominatim / OpenStreetMap)
        if parsed.path == '/api/reverse':
            params = parse_qs(parsed.query)
            lat = params.get('lat', [''])[0].strip()
            lon = params.get('lon', [''])[0].strip()

            try:
                float(lat)
                float(lon)
            except ValueError:
                self._send_json({'error': 'Ugyldig lat/lon.'}, status=400)
                return

            nominatim_url = (
                'https://nominatim.openstreetmap.org/reverse'
                f'?format=jsonv2&lat={lat}&lon={lon}&zoom=14&addressdetails=1'
            )

            req = Request(
                nominatim_url,
                headers={
                    # Nominatim krever User-Agent som identifiserer applikasjonen
                    'User-Agent': 'Fugleobservasjoner/0.1 (hobbyprosjekt)',
                    'Accept': 'application/json',
                },
            )

            try:
                with urlopen(req, timeout=10) as resp:
                    body = resp.read().decode('utf-8', errors='ignore')

                text = (body or '').strip()
                if not text:
                    # Ingen data tilbake -> ingen lokasjoner
                    self._send_json({'sites': []}, status=200)
                    return

                try:
                    data = json.loads(text)
                except Exception:
                    # Uventet svarformat (HTML, feilside e.l.)
                    print('Uventet respons fra AO-sites (ikke JSON). Første 200 tegn:\n', text[:200])
                    self._send_json({'sites': []}, status=200)
                    return

                address = data.get('address', {}) or {}
                # Forsøk å plukke ut et kort stedsnavn
                name = (
                    address.get('locality')
                    or address.get('village')
                    or address.get('town')
                    or address.get('city')
                    or address.get('hamlet')
                    or address.get('municipality')
                    or address.get('county')
                    or data.get('name')
                    or data.get('display_name')
                )

                self._send_json({'name': name}, status=200)
                return
            except Exception as e:
                print('Feil ved reverse geokoding:', e)
                self._send_json(
                    {'error': 'Feil ved henting av stedsnavn.'}, status=500
                )
                return

        # Hent lokasjoner ("sites") fra mobil.artsobservasjoner.no rundt en posisjon
        if parsed.path == '/api/ao-sites':
            params = parse_qs(parsed.query)
            lat_raw = params.get('lat', [''])[0].strip()
            lon_raw = params.get('lon', [''])[0].strip()
            # meters (kantlengde på søkeboksen). Default = 600 m
            size_raw = params.get('size', ['600'])[0].strip()

            try:
                lat = float(lat_raw)
                lon = float(lon_raw)
                # Standardboks: 600 m x 600 m rundt punktet (kan overrides via ?size=)
                size_m = float(size_raw) if size_raw else 600.0
            except ValueError:
                self._send_json({'error': 'Ugyldig lat/lon/size.'}, status=400)
                return

            # Beregn en enkel boks i desimalgrader rundt punktet.
            # 1 grad bredde ~ 111_320 m. Lengdegrad skaleres med cos(lat).
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
                'AO-sites forespørsel:',
                f'lat={lat:.6f}, lon={lon:.6f}, size_m={size_m:.1f}, '
                f'minX={min_x:.6f}, minY={min_y:.6f}, maxX={max_x:.6f}, maxY={max_y:.6f}',
            )

            query_params = {
                'maxSites': '200',
                'minX': f'{min_x:.6f}',
                'minY': f'{min_y:.6f}',
                'maxX': f'{max_x:.6f}',
                'maxY': f'{max_y:.6f}',
                'includePublicSites': 'true',
            }

            # Bruk det samme ByBoundingBox-endepunktet som mobilklienten,
            # men be om ukomprimert (identity) svar for enkel JSON-parsing.
            ao_sites_url = (
                'https://mobil.artsobservasjoner.no/core/Sites/ByBoundingBox?'
                + urlencode(query_params)
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

                # Prøv å hente ut en liste med steder uavhengig av struktur
                if isinstance(data, list):
                    raw_sites = data
                elif isinstance(data, dict):
                    raw_sites = data.get('sites') or data.get('Sites') or []
                else:
                    raw_sites = []

                # Debug: logg full JSON for alle steder som heter/inkluderer "Byparken"
                try:
                    for item in raw_sites or []:
                        if not isinstance(item, dict):
                            continue
                        name_field = (
                            item.get('name')
                            or item.get('Name')
                            or item.get('siteName')
                            or item.get('SiteName')
                        )
                        if isinstance(name_field, str) and 'byparken' in name_field.lower():
                            print('AO-sites BYPARKEN-debug:\n', json.dumps(item, ensure_ascii=False, indent=2))
                except Exception as debug_err:
                    print('Klarte ikke å debug-logge BYPARKEN-objekt:', repr(debug_err))

                sites = []
                for item in raw_sites or []:
                    if not isinstance(item, dict):
                        continue

                    name = (
                        item.get('name')
                        or item.get('Name')
                        or item.get('siteName')
                        or item.get('SiteName')
                    )
                    site_id = item.get('id') or item.get('Id') or item.get('siteId')
                    lat_val = item.get('lat') or item.get('latitude') or item.get('Lat')
                    lon_val = item.get('lon') or item.get('longitude') or item.get('Lon')

                    site = {
                        'raw': item,
                    }
                    if name:
                        site['name'] = name
                    if site_id is not None:
                        site['id'] = site_id
                    if lat_val is not None:
                        site['lat'] = lat_val
                    if lon_val is not None:
                        site['lon'] = lon_val
                    sites.append(site)

                print('AO-sites svar: antall steder =', len(sites))
                if sites[:3]:
                    print('AO-sites eksempelsteder:', [s.get('name') for s in sites[:3]])

                self._send_json({'sites': sites}, status=200)
                return
            except Exception as e:
                print('Feil ved henting av AO-lokaliteter:', repr(e))
                # Ikke la dette knekke klienten – returner bare tom liste.
                self._send_json({'sites': []}, status=200)
                return

        # Alt annet: server statiske filer fra ./public
        if parsed.path == '/':
            # Standard: vis index.html
            self.path = '/public/index.html'
        elif parsed.path.startswith('/public/'):
            # La SimpleHTTPRequestHandler håndtere dette direkte
            pass
        else:
            # Prøv å mappe andre stier til public-katalogen
            candidate = os.path.join(PUBLIC_DIR, parsed.path.lstrip('/'))
            if os.path.exists(candidate) and os.path.isfile(candidate):
                self.path = '/public/' + parsed.path.lstrip('/')
            else:
                # Fallback til index.html for ukjente ruter
                self.path = '/public/index.html'

        return super().do_GET()

    def translate_path(self, path):
        """Mappe URL-path til filsystemet under PUBLIC_DIR for /public/*.

        SimpleHTTPRequestHandler sin standardoppførsel er å bruke cwd.
        Vi overstyrer for å peke eksplisitt på ./public.
        """
        # Bruk original implementasjon til å løse opp path
        path = super().translate_path(path)

        # Sørg for at alt under /public havner i PUBLIC_DIR
        rel = os.path.relpath(path, os.getcwd())
        if rel.startswith('public' + os.sep):
            return os.path.join(BASE_DIR, rel)
        # Andre filer (skulle i praksis ikke skje) får default-oppførsel
        return path

    def _send_json(self, data, status=200):
        payload = json.dumps(data).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)


def run(port=3000):
    os.chdir(BASE_DIR)
    server_address = ('', port)
    httpd = HTTPServer(server_address, Handler)
    print(f'Server kjører på port {port}')
    httpd.serve_forever()


if __name__ == '__main__':
    # Bruk PORT fra miljøvariabel dersom den er satt (for hosting-plattformer)
    env_port = os.environ.get('PORT')
    try:
        port = int(env_port) if env_port else 3000
    except ValueError:
        port = 3000
    run(port)
