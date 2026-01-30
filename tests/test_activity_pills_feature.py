"""
Test for konfigurerbare aktivitetspills feature.
Verifiserer at storage, observation-commit og settings-siden fungerer sammen.
"""
import pytest
import json
import re


def test_storage_module_has_new_functions():
    """Verifiser at storage.js har nye funksjoner"""
    with open('public/js/storage.js', 'r') as f:
        content = f.read()

    assert 'ACTIVITY_PILLS_KEY' in content
    assert 'saveActivityPills' in content
    assert 'loadActivityPills' in content
    assert 'migrateFromOldPillCount' in content


def test_observation_commit_uses_dynamic_pills():
    """Verifiser at observation-commit.js bruker dynamisk konfig"""
    with open('public/js/observation-commit.js', 'r') as f:
        content = f.read()

    # Skal IKKE ha hardkodede konstanter lenger
    assert 'ALL_ACTIVITY_PILLS' not in content
    assert 'DEFAULT_PILL_COUNT' not in content

    # Skal importere loadActivityPills
    assert 'loadActivityPills' in content

    # getActivePills skal bruke loadActivityPills
    assert 'getActivePills()' in content or 'function getActivePills()' in content


def test_settings_has_new_ui():
    """Verifiser at settings.html har nytt UI"""
    with open('public/settings.html', 'r') as f:
        content = f.read()

    # Skal IKKE ha gammelt UI
    assert 'activity-pill-count' not in content

    # Skal ha nytt UI
    assert 'activity-pills-config' in content
    assert 'add-activity-pill' in content
    assert 'Aktivitets-hurtigknapper (0-6)' in content


def test_settings_imports_correct_modules():
    """Verifiser at settings.html importerer riktige moduler"""
    with open('public/settings.html', 'r') as f:
        content = f.read()

    assert 'import { loadActivityPills, saveActivityPills } from' in content
    assert 'import { loadActivities } from' in content


def test_default_pills_match_plan():
    """Verifiser at default pills matcher planen"""
    with open('public/js/storage.js', 'r') as f:
        content = f.read()

    # Sjekk at migreringsfunksjonen har riktige default-verdier
    expected_pills = [
        ("Stasjonær", "23"),
        ("Rastende", "22"),
        ("Overflygende", "24"),
        ("Næringssøkende", "25"),
        ("Trekkende", "32"),
        ("Sang/spill", "52")
    ]

    for label, value in expected_pills:
        assert f"label: '{label}'" in content or f'label: "{label}"' in content
        assert f"value: '{value}'" in content or f'value: "{value}"' in content


def test_activities_json_has_correct_values():
    """Verifiser at activities.json har riktige verdier for default pills"""
    with open('public/data/activities.json', 'r') as f:
        activities = json.load(f)

    # Bygg lookup
    lookup = {a['value']: a['label'] for a in activities}

    expected = {
        '23': 'Stasjonær',
        '22': 'Rastende',
        '24': 'Overflygende',
        '25': 'Næringssøkende',
        '32': 'Trekkende',
        '52': 'Sang/spill'
    }

    for value, label in expected.items():
        assert value in lookup, f"Value {value} ikke funnet i activities.json"
        assert lookup[value] == label, f"Label mismatch for {value}: {lookup[value]} != {label}"


def test_no_breaking_changes():
    """Verifiser at eksisterende funksjonalitet ikke er ødelagt"""
    # observation-commit.js skal fortsatt ha commitObservation og renderActivityPills
    with open('public/js/observation-commit.js', 'r') as f:
        content = f.read()

    assert 'export function commitObservation' in content
    assert 'export function renderActivityPills' in content

    # renderActivityPills skal fortsatt ta dom og commitFn
    assert 'renderActivityPills(dom, commitFn)' in content


def test_settings_has_init_function():
    """Verifiser at settings.html har initieringsfunksjon"""
    with open('public/settings.html', 'r') as f:
        content = f.read()

    assert 'initActivityPillsConfig' in content
    assert 'addPillRow' in content
    assert 'savePillsFromUI' in content
    assert 'updateAddButtonState' in content
