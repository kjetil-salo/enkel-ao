try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass
import threading

# Enkel in-memory statistikk (beskyttet av lock)
_stats_lock = threading.Lock()
_stats = {
    'total': 0,
    'per_ip': {},
    'per_ua': {},
}

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


from supabase_log import log_view_to_supabase

class Handler(SimpleHTTPRequestHandler):
    def do_POST(self):
        import sys
        from urllib.parse import urlparse
        parsed = urlparse(self.path)
        if parsed.path == '/api/logview':
            xff = self.headers.get('X-Forwarded-For')
            if xff:
                real_ip = xff.split(',')[0].strip()
            else:
                real_ip = self.client_address[0]
            user_agent = self.headers.get('User-Agent', '-')
            print(f"[LOGVIEW] IP: {real_ip} | UA: {user_agent}", file=sys.stderr)
            # Oppdater statistikk
            with _stats_lock:
                _stats['total'] += 1
                _stats['per_ip'][real_ip] = _stats['per_ip'].get(real_ip, 0) + 1
                _stats['per_ua'][user_agent] = _stats['per_ua'].get(user_agent, 0) + 1
            # Logg til Supabase (ikke blokkerende for klienten)
            try:
                log_view_to_supabase(real_ip, user_agent)
            except Exception as e:
                print(f"[Supabase] Feil ved logging: {e}")
            self._send_json({'ok': True}, status=200)
            return
        # For alt annet, returner 404
        self.send_response(404)
        self.end_headers()

    def do_GET(self):
        import sys
        user_agent = self.headers.get('User-Agent', '-')
        print(f"[LOG] IP: {self.client_address[0]} | UA: {user_agent} | PATH: {self.path}", file=sys.stderr)
        parsed = urlparse(self.path)

                # Statistikk fra Supabase (krever nøkkel)
                if parsed.path == '/stats':
                        # Hent forventet key fra miljø (default 'salo')
                        expected_key = os.environ.get('STATS_KEY', 'salo')
                        qs = parse_qs(parsed.query)
                        provided = qs.get('key', [''])[0]
                        # Hvis ikke riktig key, returner en liten login-side som lagrer key i localStorage
                        if provided != expected_key:
                                login_html = f"""
<html>
<head><meta name='viewport' content='width=device-width,initial-scale=1'><title>Logg inn for statistikk</title></head>
<body style="font-family:system-ui, sans-serif;padding:18px;">
    <h2>Logg inn</h2>
    <p>Oppgi nøkkel for å se statistikk.</p>
    <input id="stats-key" type="text" placeholder="Skriv inn nøkkel" style="padding:8px;font-size:16px;" />
    <button id="stats-go" style="padding:8px 10px;margin-left:8px;">Vis</button>
    <p style="color:#666;margin-top:12px;font-size:0.9rem">Nøkkelen lagres i din nettleser slik at du ikke må skrive den igjen.</p>
    <script>
        (function(){
            const inp = document.getElementById('stats-key');
            const btn = document.getElementById('stats-go');
            const saved = localStorage.getItem('stats_key');
            if (saved) inp.value = saved;
            btn.addEventListener('click', () => {
                const v = inp.value.trim();
                if (!v) return alert('Skriv inn nøkkel');
                localStorage.setItem('stats_key', v);
                // redirect med key
                location.search = '?key=' + encodeURIComponent(v);
            });
        })();
    </script>
</body>
</html>
"""
                                self.send_response(200)
                                self.send_header('Content-Type', 'text/html; charset=utf-8')
                                self.send_header('Content-Length', str(len(login_html.encode('utf-8'))))
                                self.end_headers()
                                self.wfile.write(login_html.encode('utf-8'))
                                return
            try:
                from supabase_log import supabase
                if not supabase:
                    raise Exception("Supabase ikke konfigurert.")
                # Hent alle rader (kan evt. pagineres for store datamengder)
                res = supabase.table("stats").select("ip,user_agent").execute()
                rows = res.data if hasattr(res, 'data') else res
                total = len(rows)
                per_ip = {}
                per_ua = {}
                for row in rows:
                    ip = row.get('ip', '-')
                    ua = row.get('user_agent', '-')
                    per_ip[ip] = per_ip.get(ip, 0) + 1
                    per_ua[ua] = per_ua.get(ua, 0) + 1
                html = f"""
<html>
<head>
    <title>Brukerstatistikk (Supabase)</title>
    <meta name='viewport' content='width=device-width, initial-scale=1'>
    <style>
        body {{ font-family: system-ui, sans-serif; background: #f8f9fa; color: #222; margin: 0; padding: 0; }}
        .container {{ max-width: 600px; margin: 2em auto; background: #fff; border-radius: 10px; box-shadow: 0 2px 8px #0001; padding: 2em; }}
        h1, h2, h3 {{ margin-top: 0; }}
        table {{ border-collapse: collapse; width: 100%; margin-bottom: 2em; }}
        th, td {{ border: 1px solid #ddd; padding: 8px; text-align: left; }}
        th {{ background: #f0f0f0; }}
        .stat {{ font-size: 2em; font-weight: bold; margin-bottom: 0.5em; }}
        .section-title {{ margin-top: 2em; margin-bottom: 0.5em; font-size: 1.2em; color: #444; }}
    </style>
</head>
<body>
    <div class="container">
        <h1>Brukerstatistikk</h1>
        <div class="stat">{total} sidevisninger</div>
        <div>{len(per_ip)} unike IP-adresser</div>

        <div class="section-title">Sidevisninger per IP</div>
        <table>
            <tr><th>IP-adresse</th><th>Antall</th></tr>
            {''.join(f'<tr><td>{ip}</td><td>{count}</td></tr>' for ip, count in sorted(per_ip.items(), key=lambda x: -x[1]))}
        </table>

        <div class="section-title">User-Agents</div>
        <table>
            <tr><th>User-Agent</th><th>Antall</th></tr>
            {''.join(f'<tr><td>{ua}</td><td>{count}</td></tr>' for ua, count in sorted(per_ua.items(), key=lambda x: -x[1]))}
        </table>
    </div>
</body>
</html>
                                """
                self.send_response(200)
                self.send_header('Content-Type', 'text/html; charset=utf-8')
                self.send_header('Content-Length', str(len(html.encode('utf-8'))))
                self.end_headers()
                self.wfile.write(html.encode('utf-8'))
                return
            except Exception as e:
                err = f"<html><body><h2>Feil ved henting av statistikk fra Supabase:</h2><pre>{e}</pre></body></html>"
                self.send_response(500)
                self.send_header('Content-Type', 'text/html; charset=utf-8')
                self.send_header('Content-Length', str(len(err.encode('utf-8'))))
                self.end_headers()
                self.wfile.write(err.encode('utf-8'))
                return

        # ...eksisterende kode fortsetter...
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
