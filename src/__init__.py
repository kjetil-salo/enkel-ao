"""
Fugleobservasjoner - Python moduler.

Inneholder:
- api_handlers: Eksterne API-kall til Artsobservasjoner og Nominatim
- html_templates: HTML-generering for statistikk og login
- supabase_log: Logging til Supabase
"""

from .api_handlers import handle_species_search, handle_reverse_geocoding, handle_ao_sites_search
from .html_templates import generate_stats_login_page, generate_stats_page, generate_error_page
from .supabase_log import log_view_to_supabase

__all__ = [
    'handle_species_search',
    'handle_reverse_geocoding', 
    'handle_ao_sites_search',
    'generate_stats_login_page',
    'generate_stats_page',
    'generate_error_page',
    'log_view_to_supabase',
]
