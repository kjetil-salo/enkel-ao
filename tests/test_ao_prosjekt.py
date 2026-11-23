"""AO-prosjekt per funn: gruppering ved import og oppslag i AOs prosjektvelger.

Se docs/ao-prosjekt.md. AO knytter prosjekt per import (`ProjectToAdd`), ikke per
CSV-rad, så funn med ulike prosjekter må importeres som hver sin gruppe.
"""
from unittest.mock import Mock
from urllib.parse import parse_qs

from src.ao_import_httpx import _grupper_etter_prosjekt, _prosjekt_id, post_with_curl
from src.ao_projects import les_prosjekter, hent_prosjekter


def _obs(art, prosjekt=None):
    o = {'species': {'taxonName': art}, 'count': 1, 'timestamp': '2024-01-15T14:00:00Z',
         'placeName': 'Hylkje'}
    if prosjekt:
        o['project'] = prosjekt
    return o


VIPE = {'id': '192', 'name': 'Vern vipa i Hordaland'}
TOMT = {'id': '4044', 'name': 'Tomtekryss Hylkjesvingen 49'}


# --- gruppering -------------------------------------------------------------

def test_uten_prosjekt_gir_en_gruppe_som_for():
    obs = [_obs('Gråspurv'), _obs('Kjøttmeis')]
    grupper = _grupper_etter_prosjekt(obs)
    assert len(grupper) == 1
    assert grupper[0][0] is None
    assert grupper[0][1] == obs


def test_grupperer_per_prosjekt_i_forste_rekkefolge():
    a, b, c, d = _obs('A', TOMT), _obs('B'), _obs('C', VIPE), _obs('D', TOMT)
    grupper = _grupper_etter_prosjekt([a, b, c, d])
    assert [(g[0] and g[0]['id'], g[1]) for g in grupper] == [
        ('4044', [a, d]), (None, [b]), ('192', [c])]


def test_ugyldig_prosjekt_id_ignoreres():
    assert _prosjekt_id({'project': {'id': '12&ProjectToAdd=3', 'name': 'x'}}) == ''
    assert _prosjekt_id({'project': 'tull'}) == ''
    assert _prosjekt_id({'project': {'id': 4044, 'name': 'x'}}) == '4044'


# --- import ------------------------------------------------------------------

def importkall(klient):
    return [c for c in klient.post.call_args_list if 'ParseObservations' in c.args[0]]


def _mock_ao(monkeypatch):
    """Tom kø før import, så fylles den etter hvert som gruppene importeres."""
    monkeypatch.setattr('src.ao_import_httpx.fetch_csrf_tokens', lambda lt, ac: ('FORM', 'COOKIE', None))
    svar = Mock(status_code=200, text='<html>ok</html>', url='https://x/ImportSighting')
    klient = Mock()
    klient.__enter__ = Mock(return_value=klient)
    klient.__exit__ = Mock(return_value=None)
    klient.post = Mock(return_value=svar)
    monkeypatch.setattr('httpx.Client', lambda: klient)
    monkeypatch.setattr('time.sleep', lambda x: None)
    tilstand = {'kall': 0, 'publisert': False}

    def submitted(lt, ac, **kw):
        tilstand['kall'] += 1
        if tilstand['kall'] == 1 or tilstand['publisert']:
            return 0
        return sum(len(parse_qs(c.kwargs['content'])['ImportSightingViewModel.Observations'][0]
                       .strip().split('\n')) - 1 for c in importkall(klient))
    monkeypatch.setattr('src.ao_import_httpx.number_of_sightings_submitted', submitted)

    def publish(*a, **k):
        tilstand['publisert'] = True
        tilstand['publiseringer'] = tilstand.get('publiseringer', 0) + 1
        return {'status': 200}
    monkeypatch.setattr('src.ao_import_httpx.publish_all', publish)
    klient.tilstand = tilstand
    return klient


def test_import_sender_prosjekt_id_og_navn(monkeypatch):
    klient = _mock_ao(monkeypatch)
    resultat = post_with_curl([_obs('Gråspurv', TOMT)], 'L', 'A')
    assert resultat['success'] is True
    felt = parse_qs(importkall(klient)[-1].kwargs['content'])
    assert felt['ImportSightingViewModel.ProjectToAdd'] == ['4044']
    assert felt['ImportSightingViewModel.ProjectToAdd_Name'] == ['Tomtekryss Hylkjesvingen 49']


def test_import_uten_prosjekt_sender_tomt_felt_i_ett_kall(monkeypatch):
    klient = _mock_ao(monkeypatch)
    post_with_curl([_obs('Gråspurv'), _obs('Kjøttmeis')], 'L', 'A')
    assert len(importkall(klient)) == 1
    felt = parse_qs(importkall(klient)[-1].kwargs['content'], keep_blank_values=True)
    assert felt['ImportSightingViewModel.ProjectToAdd'] == ['']


def test_flere_prosjekter_gir_en_import_per_prosjekt_og_en_publisering(monkeypatch):
    klient = _mock_ao(monkeypatch)
    resultat = post_with_curl([_obs('A', TOMT), _obs('B'), _obs('C', TOMT)], 'L', 'A')
    assert len(importkall(klient)) == 2
    prosjekter = [parse_qs(c.kwargs['content'], keep_blank_values=True)
                  ['ImportSightingViewModel.ProjectToAdd'][0] for c in importkall(klient)]
    assert prosjekter == ['4044', '']
    assert klient.tilstand['publiseringer'] == 1
    assert resultat['count'] == 3
    assert 'heldBack' not in resultat


# --- prosjektoppslag ---------------------------------------------------------

AO_SVAR = '''
<li><span class="item"><span class="itemjson">{&quot;name&quot;:&quot;Vern vipa i Hordaland&quot;,&quot;id&quot;:&quot;192&quot;}</span></span></li>
<li><span class="item"><span class="itemjson">{"name":"Tomtekryss Hylkjesvingen 49","id":"4044"}</span></span></li>
<li><span class="itemjson">{"name":"","id":"5"}</span></li>
<li><span class="itemjson">ikke json</span></li>
'''


def test_les_prosjekter_tar_kun_gyldige_treff():
    assert les_prosjekter(AO_SVAR) == [VIPE, TOMT]


def _klient_med_svar(monkeypatch, svar_per_sti):
    klient = Mock()
    klient.__enter__ = Mock(return_value=klient)
    klient.__exit__ = Mock(return_value=None)

    def get(url, params=None):
        for sti, svar in svar_per_sti.items():
            if url.endswith(sti):
                return svar
        raise AssertionError(url)
    klient.get = Mock(side_effect=get)
    monkeypatch.setattr('src.ao_projects.httpx.Client', lambda **kw: klient)
    return klient


def test_tomt_sok_gir_egne_prosjekter(monkeypatch):
    klient = _klient_med_svar(monkeypatch, {
        'RenderUserProjects': Mock(status_code=200, text=AO_SVAR)})
    svar = hent_prosjekter('L', 'A', '')
    assert svar == {'projects': [{**VIPE, 'mine': True}, {**TOMT, 'mine': True}], 'needsLogin': False}
    assert klient.get.call_count == 1


def test_sok_gir_egne_forst_uten_duplikater(monkeypatch):
    sok = '<span class="itemjson">{"name":"Tomtekryss Hylkjesvingen 49","id":"4044"}</span>' \
          '<span class="itemjson">{"name":"Tomtefugler","id":"77"}</span>'
    _klient_med_svar(monkeypatch, {
        'RenderUserProjects': Mock(status_code=200, text=AO_SVAR),
        'SearchUserProject': Mock(status_code=200, text=sok)})
    svar = hent_prosjekter('L', 'A', 'tomte')
    assert svar['projects'] == [{**TOMT, 'mine': True}, {'id': '77', 'name': 'Tomtefugler', 'mine': False}]


def test_utlopt_sesjon_gir_needs_login_selv_om_ao_svarer_200(monkeypatch):
    # AO svarer 200 + tom liste for en utløpt sesjon; /Project avslører den (302)
    _klient_med_svar(monkeypatch, {
        'RenderUserProjects': Mock(status_code=200, text=''),
        '/Project': Mock(status_code=302, text='')})
    assert hent_prosjekter('L', 'A', 'tomte') == {'projects': [], 'needsLogin': True}


def test_innlogget_uten_egne_prosjekter_soker_videre(monkeypatch):
    sok = '<span class="itemjson">{"name":"FUGLEBLIKK","id":"3868"}</span>'
    _klient_med_svar(monkeypatch, {
        'RenderUserProjects': Mock(status_code=200, text=''),
        '/Project': Mock(status_code=200, text='<html></html>'),
        'SearchUserProject': Mock(status_code=200, text=sok)})
    assert hent_prosjekter('L', 'A', 'fug')['projects'] == [{'id': '3868', 'name': 'FUGLEBLIKK', 'mine': False}]


def test_uinnlogget_gir_needs_login(monkeypatch):
    _klient_med_svar(monkeypatch, {'RenderUserProjects': Mock(status_code=302, text='')})
    assert hent_prosjekter('L', 'A', 'x') == {'projects': [], 'needsLogin': True}


def test_nettverksfeil_gir_tom_liste(monkeypatch):
    import httpx
    klient = _klient_med_svar(monkeypatch, {})
    klient.get.side_effect = httpx.ConnectError('nede')
    assert hent_prosjekter('L', 'A', 'x') == {'projects': [], 'needsLogin': False}
