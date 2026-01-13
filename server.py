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

from api_handlers import handle_species_search, handle_reverse_geocoding, handle_ao_sites_search
from html_templates import generate_stats_login_page, generate_stats_page, generate_error_page
from supabase_log import log_view_to_supabase

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
    
    def do_POST(self):
        """Håndter POST-forespørsler."""
        parsed = urlparse(self.path)
        
        if parsed.path == '/api/logview':
            self._handle_logview_post()
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

    def do_GET(self):
        """Håndter GET-forespørsler."""
        import sys
        
        user_agent = self.headers.get('User-Agent', '-')
        print(f"[LOG] IP: {self.client_address[0]} | UA: {user_agent} | PATH: {self.path}", file=sys.stderr)
        
        parsed = urlparse(self.path)
        
        # Route til riktig handler
        try:
            if parsed.path == '/stats':
                self._handle_stats_page(parsed)
            elif parsed.path == '/api/species':
                self._handle_species_api(parsed)
            elif parsed.path == '/api/reverse':
                self._handle_reverse_api(parsed)
            elif parsed.path == '/api/ao-sites':
                self._handle_ao_sites_api(parsed)
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
            from supabase_log import supabase
            if supabase:
                res = supabase.table("stats").select("ip,user_agent").execute()
                rows = res.data if hasattr(res, 'data') else res
                
                # Prosesser Supabase-statistikk
                total = len(rows)
                per_ip = {}
                per_ua = {}
                
                for row in rows:
                    ip = row.get('ip', '-')
                    ua = row.get('user_agent', '-')
                    per_ip[ip] = per_ip.get(ip, 0) + 1
                    per_ua[ua] = per_ua.get(ua, 0) + 1
                
                html = generate_stats_page(per_ip, per_ua, total, source="Supabase")
                self._send_html_response(html)
                return
        except Exception as e:
            print(f"[STATS] Supabase feil: {e}")
        
        # Fallback til in-memory statistikk
        with _stats_lock:
            total = _stats['total']
            per_ip = dict(_stats['per_ip'])
            per_ua = dict(_stats['per_ua'])
        
        html = generate_stats_page(per_ip, per_ua, total, source="In-memory (denne økt)")
        self._send_html_response(html)
    
    def _handle_species_api(self, parsed):
        """Håndter arts-søk API."""
        params = parse_qs(parsed.query)
        search = params.get('search', [''])[0].strip()
        
        try:
            results = handle_species_search(search)
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
        
        try:
            sites = handle_ao_sites_search(lat_raw, lon_raw, size_raw)
            self._send_json({'sites': sites})
        except ValueError as e:
            self._send_json({'error': str(e)}, status=400)
        except Exception:
            # Ikke la dette knekke klienten – returner bare tom liste
            self._send_json({'sites': []})
    
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
    
    def _send_json(self, data, status=200):
        """Send JSON-respons til klient."""
        payload = json.dumps(data).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(payload)))
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
