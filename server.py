#!/usr/bin/env python3
import json
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
                data = json.loads(body)

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
