"""
Minimal gjenskaping av AOs redigeringsskjema (`#report`).

Ikke et utklipp av AOs 312 KB-side — en håndlaget fixture som gjengir nøyaktig de
særegenhetene som ble målt 26.10.2026 (`docs/ao-rediger-maling-2026-10-26.md`), og
som `ao_edit.bygg_save_body()` må håndtere:

  * `Taxon` to ganger, der ANDRE forekomst er en rå .NET-typestreng
  * datoer med `00:00:00`-suffiks
  * `Activity`/`Stage`/`Gender` som <select> UTEN `selected`
  * `selectedSiteName="false"` og tom `SelectedSite.Id`
  * felt AOs JS deaktiverer (`Unit`, `DiscoveryMethod`, `NewSite`-koordinater)
  * `SiteViewModel.*` som dublett-widget
  * checkbox-par (`Observers[0].IsSelected` true/false)

Fixturen har ingen personopplysninger og ingen ekte CSRF-token.
"""

S = 'SightingViewModel.TemporarySighting.Sighting.'
V = 'SightingViewModel.'

# Aktivitetslista forkortet, men med de samme fellene: første opsjon er value="0"
# med tom tekst, slik at en «velg første»-fallback ville slettet aktiviteten.
AKTIVITETER = [
    ('0', ''),
    ('1', 'Reir med egg eller unger'),
    ('23', 'Stasjonær'),
    ('25', 'Næringssøkende'),
    ('26', 'Overflygende'),
]


def _dobbelt(name):
    """
    AO rendrer hvert felt med TO navn: `Name="SightingViewModel.X"` og `name="X"`.

    Python lowercaser attributtnavn, så en naiv `dict(attrs)` lar den siste vinne
    og mister `SightingViewModel`-prefikset. Fixturen må ha dette, ellers tester
    den noe AO ikke sender. Lagt inn 27.10.2026 etter at feilen traff i praksis.
    """
    kort = name.replace('SightingViewModel.', '')
    return f'Name="{name}" name="{kort}"'


def _select(name, options, selected=None):
    ut = [f'<select {_dobbelt(name)}>']
    for verdi, tekst in options:
        mark = ' selected' if selected is not None and verdi == selected else ''
        ut.append(f'<option value="{verdi}"{mark}>{tekst}</option>')
    ut.append('</select>')
    return ''.join(ut)


def lag_skjema(taxon_id='4397', quantity='3', dato='25.10.2026 00:00:00',
               start_tid='15:52', site_id_tom=True):
    """Bygg et redigeringsskjema som ligner AOs, med de målte særegenhetene."""
    d = []
    a = d.append

    a('<html><body>')
    a('<form id="report" action="/ReviewSighting/Save" method="post">')

    a('<input name="__RequestVerificationToken" type="hidden" value="TESTTOKEN-ikke-ekte"/>')
    a(f'<input name="{V}SelectedTempSightings" type="hidden" value="30826136"/>')
    a(f'<input name="{V}SelectedCorrectionSightings" type="hidden" value=""/>')
    a(f'<input name="{V}TemporarySighting.Id" type="hidden" value="0"/>')

    # Art: to forekomster. Den andre har AOs rå .NET-typestreng — den JS erstatter.
    a(f'<input name="{V}EditableProperties.Taxon.IsEditable" type="hidden" value="True"/>')
    a(f'<input name="{S}Taxon" type="hidden" value="{taxon_id}"/>')
    a(f'<input name="{S}Taxon" type="hidden" '
      'value="Artportalen.ObjectModel.Domain.Persisted.Immutable.Taxon"/>')
    a(f'<input name="{S}Taxon_speciesgroupid" type="hidden" value="8"/>')
    a(f'<input name="{S}Taxon_Name" type="hidden" value=""/>')

    # Datoer med 00:00:00 — nettleseren normaliserer dem
    a(f'<input {_dobbelt(S + "StartDate")} type="text" value="{dato}"/>')
    a(f'<input name="{S}StartTime" type="text" value="{start_tid}"/>')
    a(f'<input name="{S}EndDate" type="text" value="{dato}"/>')
    a(f'<input name="{S}EndTime" type="text" value="{start_tid}"/>')

    a(f'<input {_dobbelt(S + "Quantity")} type="text" value="{quantity}"/>')
    a(f'<input name="{V}EditableProperties.Quantity.IsEditable" type="hidden" value="True"/>')

    # Nedtrekkslister UTEN selected — kjernen i problemet
    a(_select(S + 'Activity', AKTIVITETER))
    a(_select(S + 'Stage', [('0', ''), ('1', 'Egg')]))
    a(_select(S + 'Gender', [('0', ''), ('1', 'Hann')]))
    a(_select(S + 'DeterminationMethod', [('0', ''), ('1', 'Sett')]))
    a(_select(S + 'SightingSpeciesCollectionItem.SpeciesCollection', [('-1', ''), ('1', 'Noe')]))
    a(_select(V + 'FavoriteSite', [('', ''), ('1', 'Et sted')]))
    a(_select(V + 'UserMapExtent', [('-1', ''), ('1', 'Noe')]))

    # Felt AOs JS deaktiverer — må IKKE sendes
    a(_select(S + 'Unit', [('-1', ''), ('0', ''), ('1', 'Planter')]))
    a(_select(S + 'DiscoveryMethod', [('0', ''), ('1', 'Hørt')]))
    a(f'<input name="{S}Length" type="text" value=""/>')
    a(f'<input name="{S}Weight" type="text" value=""/>')
    a(f'<input name="{S}QuantityOfSubstrate" type="text" value=""/>')
    a(f'<input name="{V}ExternalId" type="hidden" value=""/>')
    a(f'<input name="{V}NewSite.NewSiteCoordinate.CoordEast" type="hidden" value="0"/>')
    a(f'<input name="{V}NewSite.NewSiteCoordinate.CoordNorth" type="hidden" value="0"/>')
    a(f'<input name="{V}NewSite.NewSiteCoordinate.Longitude" type="hidden" value="0"/>')
    a(f'<input name="{V}NewSite.NewSiteCoordinate.Latitude" type="hidden" value="0"/>')
    a(f'<input name="{V}NewSite.NewSiteCoordinate.CoordinateSystem" type="hidden" '
      'value="Artportalen.ObjectModel.Domain.Persisted.Immutable.CoordinateSystem"/>')

    # Dublett-widget — nettleseren sender ingen av dem
    a('<input name="SiteViewModel.NewSite.Site.Name" type="hidden" value=""/>')
    a('<input name="SiteViewModel.NewSite.NewSiteCoordinate.CoordEast" type="hidden" value="0"/>')

    # NewSite-felt nettleseren LIKEVEL sender, med tomme/0-verdier
    a(f'<input name="{V}NewSite.Site.Name" type="hidden" value=""/>')
    a(f'<input name="{V}NewSite.Site.Comment" type="hidden" value=""/>')
    a(f'<input name="{V}NewSite.Site.ParentId" type="hidden" value=""/>')
    a(f'<input name="{V}NewSite.NewSiteCoordinate.Geometry" type="hidden" value=""/>')
    a(f'<input name="{V}NewSite.NewSiteCoordinate.Accuracy" type="hidden" value="0"/>')
    a(f'<input name="{V}NewSite.NewSiteCoordinate.Accuracy" type="hidden" value="0"/>')
    a(f'<input name="{V}NewSite.NewSiteCoordinate.CoordinateSystemNotation.Id" '
      'type="hidden" value="1"/>')

    # Lokalitet: rå HTML lyver
    site_val = '' if site_id_tom else '362858'
    a(f'<input name="{V}SelectedSite.Id" type="hidden" value="{site_val}"/>')
    a('<input name="selectedSite" type="hidden" value=""/>')
    a('<input name="selectedSiteName" type="hidden" value="false"/>')
    a('<input name="selectedSiteIsPrivate" type="hidden" value="false"/>')
    a('<input name="selectedSiteIsFavorite" type="hidden" value="false"/>')
    a('<input name="selectedSiteSpeciesGroupId" type="hidden" value="0"/>')
    a('<input name="currentSpeciesGroupId" type="hidden" value="-1"/>')
    a('<input name="coordinatesystem" type="hidden" value=""/>')
    a(f'<input name="{V}IsNewSite" type="hidden" value="false"/>')

    # Kommentarer som textarea
    a(f'<textarea name="{S}PublicComment.Comment"></textarea>')
    a(f'<textarea name="{S}PrivateComment.Comment"></textarea>')
    a(f'<input name="{S}HiddenByProvider" type="text" value=""/>')

    # Observatør, med ASP.NET checkbox-par
    a(f'<input name="{V}Observers[0].IsSelected" type="checkbox" checked value="true"/>')
    a(f'<input name="{V}Observers[0].IsSelected" type="hidden" value="false"/>')
    a(f'<input name="{V}Observers[0].User" type="hidden" value="15969"/>')

    # Uavhuket checkbox — skal ikke sendes
    a('<input name="DontClearOnSave" type="checkbox" value="true"/>')

    # Knapper — skal ikke sendes
    a('<input name="Shared_SaveChanges" type="submit" value="Lagre"/>')
    a('<button name="enKnapp" type="submit">Lagre</button>')

    a('</form></body></html>')
    return '\n'.join(d)


KORT_SKJEMA = (
    '<html><body><form id="cancelForm" action="/ReviewSighting/CancelEdit">'
    '<input name="__RequestVerificationToken" value="x"/>'
    '</form></body></html>'
)
