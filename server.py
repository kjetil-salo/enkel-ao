#!/usr/bin/env python3
"""
HTTP server for fugleobservasjoner.

Håndterer routing og HTTP-forespørsler, delegerer API-logikk til separate moduler.
"""

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

import json
import os
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

from src.api_handlers import handle_species_search, handle_reverse_geocoding, handle_ao_sites_search, login_to_ao, refresh_ao_cookie_if_needed, mask_token
from src.html_templates import generate_stats_login_page, generate_stats_page, generate_error_page
from src.supabase_log import log_view_to_supabase
from src.ao_import_httpx import post_with_curl

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PUBLIC_DIR = os.path.join(BASE_DIR, 'public')

# Enkel in-memory statistikk (beskyttet av lock)
_stats_lock = threading.Lock()
_stats = {
    'total': 0,
    'per_ip': {},
    'per_ua': {},
}


class Handler(SimpleHTTPRequestHandler):
    """HTTP request handler med API-routing."""

    def do_OPTIONS(self):
        """Håndter CORS preflight requests."""
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, X-AO-User-Id, X-AO-Login-Token, X-AO-Auth-Cookie')
        self.end_headers()

    def do_POST(self):
        """Håndter POST-forespørsler."""
        parsed = urlparse(self.path)

        if parsed.path == '/api/logview':
            self._handle_logview_post()
            return

        if parsed.path == '/api/ao-import':
            self._handle_ao_import_post()
            return

        if parsed.path == '/api/ao-login':
            self._handle_ao_login_post()
            return

        if parsed.path == '/api/ao-refresh':
            self._handle_ao_refresh_post()
            return

        if parsed.path == '/api/ao-create-site':
            self._handle_ao_create_site_post()
            return

        # For alt annet, returner 404
        self.send_response(404)
        self.end_headers()
    
    def _handle_logview_post(self):
        """Håndter logging av sidevisning."""
        import sys
        
        # Hent ekte IP-adresse (støtt for proxies)
        xff = self.headers.get('X-Forwarded-For')
        real_ip = xff.split(',')[0].strip() if xff else self.client_address[0]
        user_agent = self.headers.get('User-Agent', '-')
        
        print(f"[LOGVIEW] IP: {real_ip} | UA: {user_agent}", file=sys.stderr)
        
        # Oppdater in-memory statistikk
        with _stats_lock:
            _stats['total'] += 1
            _stats['per_ip'][real_ip] = _stats['per_ip'].get(real_ip, 0) + 1
            _stats['per_ua'][user_agent] = _stats['per_ua'].get(user_agent, 0) + 1
        
        # Logg til Supabase (ikke blokkerende)
        try:
            log_view_to_supabase(real_ip, user_agent)
        except Exception as e:
            print(f"[Supabase] Feil ved logging: {e}")
        
        self._send_json({'ok': True})

    def _handle_ao_import_post(self):
        """Håndter direkte posting av observasjoner til AO (kun for eier)."""
        import sys

        # Les request body
        try:
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length).decode('utf-8')
            data = json.loads(body)
            observations = data.get('observations', [])
            login_token = data.get('loginToken')
            auth_cookie = data.get('authCookie')
            area_id = data.get('areaId', '')

            if not observations:
                self._send_json({'error': 'Ingen observasjoner å importere'}, status=400)
                return

            if not login_token or not auth_cookie:
                self._send_json({'error': 'Mangler loginToken eller authCookie'}, status=400)
                return

            print(f'[AO-IMPORT] Mottatt {len(observations)} observasjoner, area={area_id}', file=sys.stderr)

            # Post til AO med curl (tokens fra klient)
            result = post_with_curl(observations, login_token, auth_cookie, area_id=area_id)

            print(f'[AO-IMPORT] Suksess: {result}', file=sys.stderr)
            self._send_json(result)

        except ValueError as e:
            # Valideringsfeil eller AO-feil
            print(f'[AO-IMPORT] Feil: {e}', file=sys.stderr)
            self._send_json({'error': str(e)}, status=400)
        except Exception as e:
            # Uventet feil
            print(f'[AO-IMPORT] Uventet feil: {e}', file=sys.stderr)
            self._send_json({'error': f'Server-feil: {str(e)}'}, status=500)

    def _handle_ao_login_post(self):
        """Håndter innlogging til AO med brukernavn/passord."""
        import sys

        try:
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length).decode('utf-8')
            data = json.loads(body)

            username = data.get('username', '').strip()
            password = data.get('password', '').strip()

            if not username or not password:
                self._send_json({'error': 'Brukernavn og passord er påkrevd'}, status=400)
                return

            print(f'[AO-LOGIN] Innloggingsforsøk for bruker: {username}', file=sys.stderr)

            # Logg inn via api_handlers
            result = login_to_ao(username, password)

            print(f'[AO-LOGIN] Vellykket for user_id={result.get("userId")}', file=sys.stderr)
            self._send_json({
                'success': True,
                'authCookie': result['authCookie'],
                'loginToken': result['loginToken'],
                'userId': result['userId']
            })

        except ValueError as e:
            print(f'[AO-LOGIN] Feil: {e}', file=sys.stderr)
            self._send_json({'error': str(e)}, status=401)
        except Exception as e:
            print(f'[AO-LOGIN] Uventet feil: {e}', file=sys.stderr)
            self._send_json({'error': f'Server-feil: {str(e)}'}, status=500)

    def _handle_ao_refresh_post(self):
        """Håndter refresh av AO session token."""
        import sys
        import httpx

        try:
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length).decode('utf-8')
            data = json.loads(body)

            login_token = data.get('loginToken', '').strip()
            auth_cookie = data.get('authCookie', '').strip()
            user_id = data.get('userId', '').strip()

            print(f'[AO-REFRESH] === Session Refresh Request ===', file=sys.stderr)
            print(f'[AO-REFRESH] Input tokens:', file=sys.stderr)
            print(f'[AO-REFRESH]   loginToken: {mask_token(login_token)}', file=sys.stderr)
            print(f'[AO-REFRESH]   authCookie: {mask_token(auth_cookie)}', file=sys.stderr)
            print(f'[AO-REFRESH]   userId: {user_id}', file=sys.stderr)

            if not login_token:
                self._send_json({'error': 'loginToken er påkrevd'}, status=400)
                return

            # Normaliser auth cookie
            auth_val = auth_cookie
            if auth_val and auth_val.startswith('.ASPXAUTHNO='):
                auth_val = auth_val.split('=', 1)[1]

            # Bygg cookies dict for httpx
            cookies = {'logintoken': login_token, 'logintoken_ssl': '1'}
            if auth_val:
                cookies['.ASPXAUTHNO'] = auth_val

            # Prøv å refreshe ved å treffe en beskyttet AO-side
            probe_url = 'https://www.artsobservasjoner.no/User/MyPages'
            print(f'[AO-REFRESH] Prober: {probe_url}', file=sys.stderr)

            # VIKTIG: Sett cookies på CLIENT-nivå, ikke request-nivå!
            # Per-request cookies sendes kun med første request og videresendes IKKE ved redirects.
            # Client-level cookies sendes med ALLE requests i redirect-kjeden.
            with httpx.Client(cookies=cookies) as client:
                response = client.get(
                    probe_url,
                    headers={'User-Agent': 'Mozilla/5.0 (compatible; Fugleobservasjoner/1.0)'},
                    timeout=15,
                    follow_redirects=True
                )
                # Hent alle cookies (inkl. opprinnelige + nye fra AO)
                all_cookies = dict(client.cookies)

            # Parse response for refreshed cookies
            refreshed_auth = None
            refreshed_login_token = None

            print(f'[AO-REFRESH] Response status: {response.status_code}', file=sys.stderr)
            print(f'[AO-REFRESH] Final URL: {response.url}', file=sys.stderr)
            print(f'[AO-REFRESH] Client cookies: {list(all_cookies.keys())}', file=sys.stderr)

            # Sjekk om AO sendte NY .ASPXAUTHNO (forskjellig fra den vi sendte inn)
            if '.ASPXAUTHNO' in all_cookies and all_cookies['.ASPXAUTHNO'] != auth_val:
                refreshed_auth = all_cookies['.ASPXAUTHNO']
                print(f'[AO-REFRESH]   New authCookie: {mask_token(refreshed_auth)}', file=sys.stderr)

            if 'logintoken' in all_cookies and all_cookies['logintoken'] != login_token:
                refreshed_login_token = all_cookies['logintoken']
                print(f'[AO-REFRESH]   New loginToken: {mask_token(refreshed_login_token)}', file=sys.stderr)

            print(f'[AO-REFRESH] === Refresh Result ===', file=sys.stderr)
            print(f'[AO-REFRESH]   New authCookie: {mask_token(refreshed_auth)}', file=sys.stderr)
            print(f'[AO-REFRESH]   New loginToken: {mask_token(refreshed_login_token)}', file=sys.stderr)

            result = {}
            if refreshed_auth:
                result['refreshedAuthCookie'] = refreshed_auth
            if refreshed_login_token:
                result['refreshedLoginToken'] = refreshed_login_token

            if not result:
                # Sjekk om vi ble redirectet til login (token utløpt)
                if '/LogOn' in str(response.url) or response.status_code == 302:
                    print(f'[AO-REFRESH] Token utløpt - redirect til LogOn', file=sys.stderr)
                    result['error'] = 'Token utløpt - krever ny innlogging'
                else:
                    result['message'] = 'Ingen ny token mottatt, eksisterende kan fortsatt være gyldig'

            self._send_json(result)

        except Exception as e:
            print(f'[AO-REFRESH] Feil: {e}', file=sys.stderr)
            self._send_json({'error': str(e)}, status=500)

    def _handle_ao_create_site_post(self):
        """Håndter opprettelse av ny AO-lokasjon."""
        import sys
        from src.ao_create_site import create_ao_site

        try:
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length).decode('utf-8')
            data = json.loads(body)

            name = data.get('name', '').strip()
            lat = data.get('lat')
            lon = data.get('lon')
            accuracy = data.get('accuracy', 50)
            login_token = data.get('loginToken', '').strip()
            auth_cookie = data.get('authCookie', '').strip()

            if not name:
                self._send_json({'error': 'Navn er påkrevd'}, status=400)
                return

            if lat is None or lon is None:
                self._send_json({'error': 'Koordinater er påkrevd'}, status=400)
                return

            if not login_token or not auth_cookie:
                self._send_json({'error': 'Mangler loginToken eller authCookie'}, status=401)
                return

            lat = float(lat)
            lon = float(lon)
            accuracy = int(accuracy)

            print(f'[AO-CREATE-SITE] Oppretter "{name}" ved {lat}, {lon} (±{accuracy}m)', file=sys.stderr)

            result = create_ao_site(name, lat, lon, accuracy, login_token, auth_cookie)

            print(f'[AO-CREATE-SITE] Resultat: {result}', file=sys.stderr)
            self._send_json(result)

        except (ValueError, TypeError) as e:
            print(f'[AO-CREATE-SITE] Valideringsfeil: {e}', file=sys.stderr)
            self._send_json({'error': str(e)}, status=400)
        except Exception as e:
            print(f'[AO-CREATE-SITE] Uventet feil: {e}', file=sys.stderr)
            self._send_json({'error': f'Server-feil: {str(e)}'}, status=500)

    def do_GET(self):
        """Håndter GET-forespørsler."""
        import sys
        
        user_agent = self.headers.get('User-Agent', '-')
        print(f"[LOG] IP: {self.client_address[0]} | UA: {user_agent} | PATH: {self.path}", file=sys.stderr)
        
        parsed = urlparse(self.path)
        
        # Route til riktig handler
        try:
            if parsed.path == '/health':
                import time
                self._send_json({'status': 'ok', 'timestamp': time.time()})
                return
            if parsed.path == '/stats':
                self._handle_stats_page(parsed)
            elif parsed.path == '/api/species':
                self._handle_species_api(parsed)
            elif parsed.path == '/api/reverse':
                self._handle_reverse_api(parsed)
            elif parsed.path == '/api/ao-sites':
                self._handle_ao_sites_api(parsed)
            elif parsed.path == '/api/ao-areas':
                self._handle_ao_areas_api(parsed)
            elif parsed.path == '/api/ao-autocomplete':
                self._handle_ao_autocomplete_api(parsed)
            else:
                self._handle_static_files(parsed)
        except Exception as e:
            print(f"[ERROR] Feil i {parsed.path}: {e}", file=sys.stderr)
            self._send_error_response(str(e))
    
    def _handle_stats_page(self, parsed):
        """Håndter statistikk-siden."""
        expected_key = os.environ.get('STATS_KEY', 'salo')
        qs = parse_qs(parsed.query)
        provided_key = qs.get('key', [''])[0]
        
        # Sjekk autentisering
        if provided_key != expected_key:
            self._send_html_response(generate_stats_login_page())
            return
        
        # Forsøk å hente data fra Supabase først
        try:
            from src.supabase_log import supabase
            if supabase:
                # Hent totalt antall sidevisninger
                count_res = supabase.table("stats").select("id", count='exact').execute()
                total = count_res.count if hasattr(count_res, 'count') else 0

                # Hent de siste 10 unike IP-er (nyeste først)
                ip_res = supabase.rpc('recent_unique_ips', {"limit_num": 10}).execute()
                # Forventet at recent_unique_ips returnerer [{ip: 'x.x.x.x', count: n}, ...]
                recent_ips = [(row['ip'], row['count']) for row in ip_res.data] if hasattr(ip_res, 'data') else []

                # Hent totalt antall unike IP-er
                unique_ip_res = supabase.rpc('count_unique_ips').execute()
                total_unique_ips = unique_ip_res.data[0]['count'] if hasattr(unique_ip_res, 'data') and unique_ip_res.data else 0

                # Hent statistikk for nettleser
                browser_res = supabase.rpc('count_per_browser').execute()
                per_browser = {row['browser']: row['count'] for row in browser_res.data} if hasattr(browser_res, 'data') and browser_res.data else {}

                # Hent statistikk for OS
                os_res = supabase.rpc('count_per_os').execute()
                per_os = {row['os']: row['count'] for row in os_res.data} if hasattr(os_res, 'data') and os_res.data else {}

                html = generate_stats_page(
                    recent_ips,
                    {},  # per_ua ikke brukt med Supabase-data
                    total,
                    {},  # per_device ikke brukt
                    per_os=per_os,
                    per_browser=per_browser,
                    total_unique_ips=total_unique_ips,
                    source="Supabase"
                )
                self._send_html_response(html)
                return
        except Exception as e:
            print(f"[STATS] Supabase feil: {e}")
        
        # Fallback til in-memory statistikk
        with _stats_lock:
            total = _stats['total']
            per_ip = dict(_stats['per_ip'])
            per_ua = dict(_stats['per_ua'])

        recent_ips = list(per_ip.items())[:10]
        # per_ua brukes som fallback for både browser og os hvis Supabase ikke er tilgjengelig
        html = generate_stats_page(
            recent_ips,
            per_ua,
            total,
            {},  # per_device
            {},  # per_os
            {},  # per_browser
            len(per_ip),
            source="In-memory (denne økt)"
        )
        self._send_html_response(html)
    
    def _handle_species_api(self, parsed):
        """Håndter arts-søk API."""
        params = parse_qs(parsed.query)
        search = params.get('search', [''])[0].strip()
        dont_include_sub = params.get('dontIncludeSubSpecies', ['true'])[0]
        ao_base = os.environ.get(
            'AO_URL', 'https://www.artsobservasjoner.no'
        )
        try:
            results = handle_species_search(search, dont_include_sub, ao_base)
            self._send_json(results)
        except Exception as e:
            self._send_json({'error': 'Feil ved henting fra Artsobservasjoner.'}, status=500)
    
    def _handle_reverse_api(self, parsed):
        """Håndter reverse geokoding API."""
        params = parse_qs(parsed.query)
        lat = params.get('lat', [''])[0].strip()
        lon = params.get('lon', [''])[0].strip()
        
        # Hent Nominatim URL fra miljøvariabler
        nominatim_base = os.environ.get(
            'NOMINATIM_URL', 'https://nominatim.openstreetmap.org/reverse'
        )
        
        try:
            name = handle_reverse_geocoding(lat, lon, nominatim_base)
            self._send_json({'name': name})
        except ValueError as e:
            self._send_json({'error': str(e)}, status=400)
        except Exception as e:
            self._send_json({'error': 'Feil ved henting av stedsnavn.'}, status=500)
    
    def _handle_ao_sites_api(self, parsed):
        """Håndter AO-lokaliteter API."""
        params = parse_qs(parsed.query)
        lat_raw = params.get('lat', [''])[0].strip()
        lon_raw = params.get('lon', [''])[0].strip()
        size_raw = params.get('size', ['600'])[0].strip()
        
        # Hent bruker-auth fra headers (sendt fra frontend)
        # Ny enkel måte: kun loginToken trengs (userId ekstraheres, authCookie hentes automatisk)
        login_token = self.headers.get('X-AO-Login-Token', '').strip() or None
        
        # Bakoverkompatibilitet: godta fortsatt separate verdier
        user_id = self.headers.get('X-AO-User-Id', '').strip() or None
        auth_cookie = self.headers.get('X-AO-Auth-Cookie', '').strip() or None
        
        # Hvis vi har loginToken men ikke user_id, ekstraher fra loginToken
        if login_token and not user_id and ':' in login_token:
            user_id = login_token.split(':')[0]
            print(f'[DEBUG] Ekstraherte user_id={user_id} fra loginToken', flush=True)
        
        print(f'[DEBUG] ao-sites mottok auth: user_id={user_id is not None}, login_token={login_token is not None}, auth_cookie={auth_cookie is not None}', flush=True)
        
        ao_mobile_base = os.environ.get(
            'AO_MOBILE_URL', 'https://mobil.artsobservasjoner.no'
        )
        try:
            sites, refreshed_auth_cookie, auth_failed = handle_ao_sites_search(lat_raw, lon_raw, size_raw, ao_mobile_base, user_id, login_token, auth_cookie)
            response_data = {'sites': sites}
            print(f'[DEBUG] ao-sites refresh resultat: refreshed_auth_cookie={refreshed_auth_cookie is not None}, auth_failed={auth_failed}', flush=True)
            if refreshed_auth_cookie:
                response_data['refreshedAuthCookie'] = refreshed_auth_cookie
                print(f'[DEBUG] Sender refreshed auth cookie tilbake til frontend: {mask_token(refreshed_auth_cookie)}', flush=True)
            if auth_failed:
                response_data['authRequired'] = True
                print(f'[DEBUG] Auth feilet - sender authRequired=true til frontend', flush=True)
            self._send_json(response_data)
        except ValueError as e:
            self._send_json({'error': str(e)}, status=400)
        except Exception:
            # Ikke la dette knekke klienten – returner bare tom liste
            self._send_json({'sites': []})
    
    def _handle_ao_areas_api(self, parsed):
        """Proxy for AO område-søk (politiske grenser). Åpent API med access-key."""
        import sys
        import httpx

        params = parse_qs(parsed.query)
        search = params.get('search', [''])[0].strip()
        if not search or len(search) < 2:
            self._send_json([])
            return

        ao_url = f'https://www.artsobservasjoner.no/Api/Areas/politicalboundary/{search}/'
        try:
            with httpx.Client() as client:
                response = client.get(
                    ao_url,
                    headers={
                        'access-key': '20a2d12937024a7391c10871d35bcc3a',
                        'X-Requested-With': 'XMLHttpRequest',
                    },
                    timeout=10
                )
                response.raise_for_status()
                data = response.json()
            self._send_json(data)
        except Exception as e:
            print(f'[AO-AREAS] Feil: {e}', file=sys.stderr)
            self._send_json([])

    def _handle_ao_autocomplete_api(self, parsed):
        """Proxy for AO autocomplete-søk på lokaliteter."""
        import sys
        from src.api_handlers import fetch_ao_autocomplete

        params = parse_qs(parsed.query)
        term = params.get('term', [''])[0].strip()
        login_token = self.headers.get('X-AO-Login-Token', '').strip()
        auth_cookie = self.headers.get('X-AO-Auth-Cookie', '').strip()
        user_id = self.headers.get('X-AO-User-Id', '').strip()

        if not term or len(term) < 2:
            self._send_json({'results': [], 'refreshed_auth_cookie': None})
            return

        print(f'[AO-AUTOCOMPLETE] Søk: term={term}, autentisert={bool(login_token and auth_cookie)}, user_id={user_id}', file=sys.stderr)

        try:
            # Kall autocomplete med auto-relogin support
            data = fetch_ao_autocomplete(
                term=term,
                login_token=login_token if login_token else None,
                auth_cookie=auth_cookie if auth_cookie else None,
                user_id=user_id if user_id else None
            )
            # data er nå {'results': [...], 'refreshed_auth_cookie': ...}
            self._send_json(data)
        except Exception as e:
            print(f'[AO-AUTOCOMPLETE] Feil: {e}', file=sys.stderr)
            self._send_json({'results': [], 'refreshed_auth_cookie': None})

    def _handle_static_files(self, parsed):
        """Håndter statiske filer."""
        if parsed.path == '/':
            self.path = '/public/index.html'
        elif parsed.path.startswith('/public/'):
            # La SimpleHTTPRequestHandler håndtere dette direkte
            pass
        else:
            # Prøv å mappe til public-katalogen
            candidate = os.path.join(PUBLIC_DIR, parsed.path.lstrip('/'))
            if os.path.exists(candidate) and os.path.isfile(candidate):
                self.path = '/public/' + parsed.path.lstrip('/')
            else:
                # Fallback til index.html
                self.path = '/public/index.html'
        
        return super().do_GET()

    def translate_path(self, path):
        """Mappe URL-path til filsystemet under PUBLIC_DIR for /public/*.

        SimpleHTTPRequestHandler sin standardoppførsel er å bruke cwd.
        Vi overstyrer for å peke eksplisitt på ./public.
        """
        path = super().translate_path(path)

        # Sørg for at alt under /public havner i PUBLIC_DIR
        rel = os.path.relpath(path, os.getcwd())
        if rel.startswith('public' + os.sep):
            return os.path.join(BASE_DIR, rel)
        return path

    def end_headers(self):
        """Legg til Cache-Control headers for å unngå aggressive mobilcache."""
        # HTML-filer: Alltid revalider med server (inkluderer root path /)
        if self.path.endswith('.html') or self.path == '/' or self.path == '/public/index.html':
            self.send_header('Cache-Control', 'no-cache, must-revalidate')
        # JS/CSS: Kort cache (5 minutter) for bedre ytelse
        elif self.path.endswith(('.js', '.css')):
            self.send_header('Cache-Control', 'max-age=300')
        # Andre filer: Standard 1-time cache
        else:
            self.send_header('Cache-Control', 'max-age=3600')

        super().end_headers()

    def _send_json(self, data, status=200):
        """Send JSON-respons til klient."""
        payload = json.dumps(data).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(payload)))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(payload)
    
    def _send_html_response(self, html, status=200):
        """Send HTML-respons til klient."""
        payload = html.encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)
    
    def _send_error_response(self, error_msg, status=500):
        """Send feilrespons til klient."""
        error_data = {'error': error_msg}
        self._send_json(error_data, status=status)


def run(port=3000):
    """Start HTTP-serveren."""
    os.chdir(BASE_DIR)
    server_address = ('', port)
    httpd = ThreadingHTTPServer(server_address, Handler)
    print(f'Server kjører på port {port}')
    httpd.serve_forever()


if __name__ == '__main__':
    # Bruk PORT fra miljøvariabel dersom den er satt
    env_port = os.environ.get('PORT')
    try:
        port = int(env_port) if env_port else 3000
    except ValueError:
        port = 3000
    run(port)
