"""
Tester for Sjeldenhetsvarsel-featurens backend (fase 1):
- src.api_handlers._oslo_midnight_utc_iso
- src.api_handlers.fetch_site_areas
- src.api_handlers.check_taxon_rarity
- src.api_handlers.get_ao_rarity
- server.py sitt /api/ao-rarity endepunkt
"""

import json
import os
import sys
import threading
import time
from http.server import HTTPServer
from unittest.mock import MagicMock

import pytest
import requests

REPO_ROOT = os.path.dirname(os.path.dirname(__file__))
sys.path.insert(0, REPO_ROOT)

from src.api_handlers import (
    _oslo_midnight_utc_iso,
    fetch_site_areas,
    check_taxon_rarity,
    get_ao_rarity,
)
from server import Handler


def start_server(port):
    server = HTTPServer(('', port), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server


class FakeResponse:
    def __init__(self, data=None, status_code=200, json_exc=None):
        self._data = data
        self.status_code = status_code
        self._json_exc = json_exc

    def raise_for_status(self):
        if self.status_code >= 400:
            raise Exception(f'HTTP {self.status_code}')

    def json(self):
        if self._json_exc:
            raise self._json_exc
        return self._data


class FakeClient:
    """Minimal httpx.Client-stub. post_handler(url, kwargs) -> FakeResponse."""
    def __init__(self, post_handler=None, **kwargs):
        self._post_handler = post_handler or (lambda url, **kw: FakeResponse({}))

    def post(self, url, **kwargs):
        return self._post_handler(url, **kwargs)

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


# ============================================================================
# _oslo_midnight_utc_iso
# ============================================================================

class TestOsloMidnightUtcIso:
    def test_summer_time_offset(self):
        # UTC+2 om sommeren
        assert _oslo_midnight_utc_iso('2026-09-12') == '2026-09-11T22:00:00.000Z'

    def test_winter_time_offset(self):
        # UTC+1 om vinteren
        assert _oslo_midnight_utc_iso('2026-01-15') == '2026-01-14T23:00:00.000Z'

    def test_dst_boundary_last_day_before_spring_forward(self):
        # 2026-03-29 (søndag) er fortsatt vintertid ved midnatt lokalt
        assert _oslo_midnight_utc_iso('2026-03-29') == '2026-03-28T23:00:00.000Z'

    def test_dst_boundary_first_day_after_spring_forward(self):
        # 2026-03-30 er sommertid ved midnatt lokalt (overgang skjedde natt til 30.)
        assert _oslo_midnight_utc_iso('2026-03-30') == '2026-03-29T22:00:00.000Z'

    def test_dst_boundary_around_fall_back(self):
        assert _oslo_midnight_utc_iso('2026-10-24') == '2026-10-23T22:00:00.000Z'
        assert _oslo_midnight_utc_iso('2026-10-26') == '2026-10-25T23:00:00.000Z'

    def test_invalid_date_string_raises(self):
        """Funksjonen selv validerer ikke input - kallere (check_taxon_rarity)
        har try/except rundt kallet. Dokumenterer denne kontrakten."""
        with pytest.raises(ValueError):
            _oslo_midnight_utc_iso('ikke-en-dato')

    def test_empty_string_raises(self):
        with pytest.raises(ValueError):
            _oslo_midnight_utc_iso('')

    def test_incomplete_date_raises(self):
        with pytest.raises(ValueError):
            _oslo_midnight_utc_iso('2026-09')


# ============================================================================
# fetch_site_areas
# ============================================================================

class TestFetchSiteAreas:
    def test_success_returns_areas_string(self, monkeypatch):
        def handler(url, **kw):
            assert 'GetSite' in url
            assert kw['json'] == {'SiteId': 1234}
            return FakeResponse({'Areas': '12,34,56'})
        monkeypatch.setattr('httpx.Client', lambda **kw: FakeClient(handler))
        assert fetch_site_areas(1234, 'cookie') == '12,34,56'

    def test_areas_missing_returns_none(self, monkeypatch):
        monkeypatch.setattr('httpx.Client', lambda **kw: FakeClient(lambda url, **kw2: FakeResponse({})))
        assert fetch_site_areas(1, 'cookie') is None

    def test_areas_wrong_type_int_returns_none(self, monkeypatch):
        monkeypatch.setattr('httpx.Client', lambda **kw: FakeClient(lambda url, **kw2: FakeResponse({'Areas': 123})))
        assert fetch_site_areas(1, 'cookie') is None

    def test_areas_wrong_type_list_returns_none(self, monkeypatch):
        monkeypatch.setattr('httpx.Client', lambda **kw: FakeClient(lambda url, **kw2: FakeResponse({'Areas': ['12', '34']})))
        assert fetch_site_areas(1, 'cookie') is None

    def test_areas_empty_string_returns_none(self, monkeypatch):
        monkeypatch.setattr('httpx.Client', lambda **kw: FakeClient(lambda url, **kw2: FakeResponse({'Areas': ''})))
        assert fetch_site_areas(1, 'cookie') is None

    def test_areas_none_returns_none(self, monkeypatch):
        monkeypatch.setattr('httpx.Client', lambda **kw: FakeClient(lambda url, **kw2: FakeResponse({'Areas': None})))
        assert fetch_site_areas(1, 'cookie') is None

    def test_http_error_returns_none(self, monkeypatch):
        def handler(url, **kw):
            return FakeResponse(status_code=500)
        monkeypatch.setattr('httpx.Client', lambda **kw: FakeClient(handler))
        assert fetch_site_areas(1, 'cookie') is None

    def test_invalid_json_returns_none(self, monkeypatch):
        def handler(url, **kw):
            return FakeResponse(json_exc=ValueError('bad json'))
        monkeypatch.setattr('httpx.Client', lambda **kw: FakeClient(handler))
        assert fetch_site_areas(1, 'cookie') is None

    def test_timeout_returns_none(self, monkeypatch):
        import httpx as httpx_mod

        def handler(url, **kw):
            raise httpx_mod.TimeoutException('timeout')
        monkeypatch.setattr('httpx.Client', lambda **kw: FakeClient(handler))
        assert fetch_site_areas(1, 'cookie') is None

    def test_non_integer_site_id_returns_none(self, monkeypatch):
        # int(site_id) feiler inne i try -> None, ikke exception ut
        monkeypatch.setattr('httpx.Client', lambda **kw: FakeClient())
        assert fetch_site_areas('abc', 'cookie') is None


# ============================================================================
# check_taxon_rarity
# ============================================================================

class TestCheckTaxonRarity:
    def test_success_returns_warning_and_information(self, monkeypatch):
        def handler(url, **kw):
            assert 'ValidateTaxonAndArea' in url
            body = kw['json']
            assert body['Taxon'] == '1234'
            assert body['Areas'] == ['12', '34']
            assert body['fromDate'] == body['toDate']
            return FakeResponse({'Warning': {'Header': 'Sjelden!', 'Body': 'x'}, 'Information': None})
        monkeypatch.setattr('httpx.Client', lambda **kw: FakeClient(handler))
        result = check_taxon_rarity(1234, '12,34', '2026-09-12', 'cookie')
        assert result == {'warning': {'Header': 'Sjelden!', 'Body': 'x'}, 'information': None}

    def test_empty_areas_csv_returns_none_without_http_call(self, monkeypatch):
        called = []
        monkeypatch.setattr('httpx.Client', lambda **kw: called.append(1) or FakeClient())
        assert check_taxon_rarity(1234, '', '2026-09-12', 'cookie') is None
        assert called == []

    def test_only_commas_and_whitespace_returns_none(self, monkeypatch):
        called = []
        monkeypatch.setattr('httpx.Client', lambda **kw: called.append(1) or FakeClient())
        assert check_taxon_rarity(1234, ' , , ,', '2026-09-12', 'cookie') is None
        assert called == []

    def test_strips_whitespace_in_areas(self, monkeypatch):
        captured = {}

        def handler(url, **kw):
            captured['areas'] = kw['json']['Areas']
            return FakeResponse({'Warning': None, 'Information': None})
        monkeypatch.setattr('httpx.Client', lambda **kw: FakeClient(handler))
        check_taxon_rarity(1, ' 12 , 34 ', '2026-09-12', 'cookie')
        assert captured['areas'] == ['12', '34']

    def test_invalid_date_str_returns_none(self, monkeypatch):
        monkeypatch.setattr('httpx.Client', lambda **kw: FakeClient())
        assert check_taxon_rarity(1, '12', 'ikke-en-dato', 'cookie') is None

    def test_http_error_returns_none(self, monkeypatch):
        monkeypatch.setattr('httpx.Client', lambda **kw: FakeClient(lambda url, **kw2: FakeResponse(status_code=500)))
        assert check_taxon_rarity(1, '12', '2026-09-12', 'cookie') is None

    def test_malformed_json_body_missing_fields_returns_empty_dict_values(self, monkeypatch):
        # AO returnerer noe uventet, men gyldig JSON uten Warning/Information
        monkeypatch.setattr('httpx.Client', lambda **kw: FakeClient(lambda url, **kw2: FakeResponse({'foo': 'bar'})))
        result = check_taxon_rarity(1, '12', '2026-09-12', 'cookie')
        assert result == {'warning': None, 'information': None}

    def test_json_not_a_dict_returns_none(self, monkeypatch):
        # AO returnerer f.eks. en liste eller streng i stedet for objekt -> .get() feiler -> fanges
        monkeypatch.setattr('httpx.Client', lambda **kw: FakeClient(lambda url, **kw2: FakeResponse(['unexpected'])))
        assert check_taxon_rarity(1, '12', '2026-09-12', 'cookie') is None

    def test_connect_error_returns_none(self, monkeypatch):
        import httpx as httpx_mod

        def handler(url, **kw):
            raise httpx_mod.ConnectError('connection refused')
        monkeypatch.setattr('httpx.Client', lambda **kw: FakeClient(handler))
        assert check_taxon_rarity(1, '12', '2026-09-12', 'cookie') is None


# ============================================================================
# get_ao_rarity (orkestrering)
# ============================================================================

class TestGetAoRarity:
    def test_not_logged_in_no_login_token_returns_none_none(self):
        result, refreshed = get_ao_rarity(1, 2, '2026-09-12', user_id='u1', auth_cookie='c1', login_token=None)
        assert (result, refreshed) == (None, None)

    def test_not_logged_in_missing_both_cookie_and_userid(self):
        result, refreshed = get_ao_rarity(1, 2, '2026-09-12', login_token='tok', user_id=None, auth_cookie=None)
        assert (result, refreshed) == (None, None)

    def test_missing_taxon_id_returns_none(self):
        result, refreshed = get_ao_rarity(None, 2, '2026-09-12', login_token='tok', auth_cookie='c1')
        assert (result, refreshed) == (None, None)

    def test_missing_site_id_returns_none(self):
        result, refreshed = get_ao_rarity(1, None, '2026-09-12', login_token='tok', auth_cookie='c1')
        assert (result, refreshed) == (None, None)

    def test_missing_date_returns_none(self):
        result, refreshed = get_ao_rarity(1, 2, '', login_token='tok', auth_cookie='c1')
        assert (result, refreshed) == (None, None)

    def test_uses_cached_areas_skips_fetch_site_areas(self, monkeypatch):
        mock_db = MagicMock()
        mock_db.get_cached_areas.return_value = '12,34'

        fetch_called = []
        monkeypatch.setattr('src.api_handlers.fetch_site_areas', lambda *a, **kw: fetch_called.append(1))
        monkeypatch.setattr(
            'src.api_handlers.check_taxon_rarity',
            lambda taxon_id, areas_csv, date_str, auth_cookie, login_token=None: {'warning': None, 'information': None}
        )

        result, refreshed = get_ao_rarity(
            1, 2, '2026-09-12', login_token='tok', auth_cookie='c1', location_db=mock_db
        )
        assert result == {'warning': None, 'information': None}
        assert fetch_called == []
        mock_db.set_areas.assert_not_called()

    def test_cache_miss_fetches_and_caches(self, monkeypatch):
        mock_db = MagicMock()
        mock_db.get_cached_areas.return_value = None

        monkeypatch.setattr('src.api_handlers.fetch_site_areas', lambda *a, **kw: '12,34')
        monkeypatch.setattr(
            'src.api_handlers.check_taxon_rarity',
            lambda taxon_id, areas_csv, date_str, auth_cookie, login_token=None: {'warning': 'w', 'information': None}
        )

        result, refreshed = get_ao_rarity(
            1, 2, '2026-09-12', login_token='tok', auth_cookie='c1', location_db=mock_db
        )
        assert result == {'warning': 'w', 'information': None}
        mock_db.set_areas.assert_called_once_with(2, '12,34')

    def test_cache_lookup_raises_falls_back_to_fetch(self, monkeypatch):
        """Robusthet: hvis location_db.get_cached_areas() kaster, skal ikke hele
        kallet kollapse - det skal falle tilbake til å hente fra AO."""
        mock_db = MagicMock()
        mock_db.get_cached_areas.side_effect = Exception('db is locked')

        monkeypatch.setattr('src.api_handlers.fetch_site_areas', lambda *a, **kw: '12,34')
        monkeypatch.setattr(
            'src.api_handlers.check_taxon_rarity',
            lambda taxon_id, areas_csv, date_str, auth_cookie, login_token=None: {'warning': None, 'information': None}
        )

        result, refreshed = get_ao_rarity(
            1, 2, '2026-09-12', login_token='tok', auth_cookie='c1', location_db=mock_db
        )
        assert result == {'warning': None, 'information': None}

    def test_set_areas_raises_does_not_break_result(self, monkeypatch):
        mock_db = MagicMock()
        mock_db.get_cached_areas.return_value = None
        mock_db.set_areas.side_effect = Exception('db is locked')

        monkeypatch.setattr('src.api_handlers.fetch_site_areas', lambda *a, **kw: '12,34')
        monkeypatch.setattr(
            'src.api_handlers.check_taxon_rarity',
            lambda taxon_id, areas_csv, date_str, auth_cookie, login_token=None: {'warning': None, 'information': None}
        )

        result, refreshed = get_ao_rarity(
            1, 2, '2026-09-12', login_token='tok', auth_cookie='c1', location_db=mock_db
        )
        assert result == {'warning': None, 'information': None}

    def test_no_areas_available_returns_none(self, monkeypatch):
        mock_db = MagicMock()
        mock_db.get_cached_areas.return_value = None
        monkeypatch.setattr('src.api_handlers.fetch_site_areas', lambda *a, **kw: None)
        check_called = []
        monkeypatch.setattr(
            'src.api_handlers.check_taxon_rarity',
            lambda *a, **kw: check_called.append(1)
        )

        result, refreshed = get_ao_rarity(
            1, 2, '2026-09-12', login_token='tok', auth_cookie='c1', location_db=mock_db
        )
        assert result is None
        assert check_called == []

    def test_no_location_db_still_fetches_from_ao(self, monkeypatch):
        monkeypatch.setattr('src.api_handlers.fetch_site_areas', lambda *a, **kw: '12,34')
        monkeypatch.setattr(
            'src.api_handlers.check_taxon_rarity',
            lambda *a, **kw: {'warning': None, 'information': None}
        )
        result, refreshed = get_ao_rarity(
            1, 2, '2026-09-12', login_token='tok', auth_cookie='c1', location_db=None
        )
        assert result == {'warning': None, 'information': None}

    def test_full_relogin_fails_returns_none_gracefully(self, monkeypatch):
        """Innlogget bruker uten gyldig auth_cookie hvor relogin feiler
        (f.eks. AO nede) skal degradere stille, ikke krasje."""
        monkeypatch.setattr('src.api_handlers._sliding_expiration', lambda *a, **kw: None)
        monkeypatch.setattr('src.api_handlers._full_relogin', lambda *a, **kw: None)
        fetch_called = []
        monkeypatch.setattr('src.api_handlers.fetch_site_areas', lambda *a, **kw: fetch_called.append(1))

        result, refreshed = get_ao_rarity(
            1, 2, '2026-09-12', login_token='tok', user_id='u1', auth_cookie=None, location_db=None
        )
        assert result is None
        assert fetch_called == []


# ============================================================================
# /api/ao-rarity endepunkt (server.py)
# ============================================================================

def _get(port, path):
    return requests.get(f'http://127.0.0.1:{port}{path}')


class TestAoRarityEndpoint:
    def test_no_auth_headers_returns_empty_200(self):
        port = 38401
        srv = start_server(port)
        time.sleep(0.05)
        try:
            r = _get(port, '/api/ao-rarity?taxonId=1234&siteId=99&date=2026-09-12')
            assert r.status_code == 200
            assert r.json() == {}
        finally:
            srv.shutdown()

    def test_missing_taxon_id_returns_empty_200(self):
        port = 38402
        srv = start_server(port)
        time.sleep(0.05)
        try:
            r = _get(port, '/api/ao-rarity?siteId=99&date=2026-09-12')
            assert r.status_code == 200
            assert r.json() == {}
        finally:
            srv.shutdown()

    def test_missing_site_id_returns_empty_200(self):
        port = 38403
        srv = start_server(port)
        time.sleep(0.05)
        try:
            r = _get(port, '/api/ao-rarity?taxonId=1234&date=2026-09-12')
            assert r.status_code == 200
            assert r.json() == {}
        finally:
            srv.shutdown()

    def test_missing_date_returns_empty_200(self):
        port = 38404
        srv = start_server(port)
        time.sleep(0.05)
        try:
            r = _get(port, '/api/ao-rarity?taxonId=1234&siteId=99')
            assert r.status_code == 200
            assert r.json() == {}
        finally:
            srv.shutdown()

    def test_all_params_missing_returns_empty_200(self):
        port = 38405
        srv = start_server(port)
        time.sleep(0.05)
        try:
            r = _get(port, '/api/ao-rarity')
            assert r.status_code == 200
            assert r.json() == {}
        finally:
            srv.shutdown()

    def test_empty_string_params_treated_as_missing(self):
        port = 38406
        srv = start_server(port)
        time.sleep(0.05)
        try:
            r = _get(port, '/api/ao-rarity?taxonId=&siteId=&date=')
            assert r.status_code == 200
            assert r.json() == {}
        finally:
            srv.shutdown()

    def test_logged_in_but_ao_unreachable_returns_empty_200_not_500(self, monkeypatch):
        """Kjernekravet: AO nede skal ALDRI gi 500 til klienten."""
        def raise_it(*a, **kw):
            raise Exception('AO er nede')
        monkeypatch.setattr('src.api_handlers.get_ao_rarity', raise_it)

        port = 38407
        srv = start_server(port)
        time.sleep(0.05)
        try:
            r = requests.get(
                f'http://127.0.0.1:{port}/api/ao-rarity?taxonId=1234&siteId=99&date=2026-09-12',
                headers={
                    'X-AO-Login-Token': 'tok',
                    'X-AO-Auth-Cookie': 'cookie123',
                    'X-AO-User-Id': 'u1',
                },
            )
            assert r.status_code == 200
            assert r.json() == {}
        finally:
            srv.shutdown()

    def test_logged_in_success_returns_warning(self, monkeypatch):
        monkeypatch.setattr(
            'src.api_handlers.get_ao_rarity',
            lambda *a, **kw: ({'warning': {'Header': 'Sjelden art'}, 'information': None}, None)
        )
        port = 38408
        srv = start_server(port)
        time.sleep(0.05)
        try:
            r = requests.get(
                f'http://127.0.0.1:{port}/api/ao-rarity?taxonId=1234&siteId=99&date=2026-09-12',
                headers={
                    'X-AO-Login-Token': 'tok',
                    'X-AO-Auth-Cookie': 'cookie123',
                    'X-AO-User-Id': 'u1',
                },
            )
            assert r.status_code == 200
            data = r.json()
            assert data['warning'] == {'Header': 'Sjelden art'}
        finally:
            srv.shutdown()

    def test_refreshed_auth_cookie_included_in_response(self, monkeypatch):
        monkeypatch.setattr(
            'src.api_handlers.get_ao_rarity',
            lambda *a, **kw: ({'warning': None, 'information': None}, 'new-cookie-value')
        )
        port = 38409
        srv = start_server(port)
        time.sleep(0.05)
        try:
            r = requests.get(
                f'http://127.0.0.1:{port}/api/ao-rarity?taxonId=1234&siteId=99&date=2026-09-12',
                headers={'X-AO-Login-Token': 'tok', 'X-AO-User-Id': 'u1'},
            )
            assert r.status_code == 200
            data = r.json()
            assert data['refreshedAuthCookie'] == 'new-cookie-value'
        finally:
            srv.shutdown()

    def test_special_characters_in_params_do_not_crash(self):
        port = 38410
        srv = start_server(port)
        time.sleep(0.05)
        try:
            r = requests.get(
                f'http://127.0.0.1:{port}/api/ao-rarity',
                params={'taxonId': '<script>alert(1)</script>', 'siteId': '99;DROP TABLE', 'date': 'not\ta-date'},
            )
            assert r.status_code == 200
            assert r.json() == {}
        finally:
            srv.shutdown()
