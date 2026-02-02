#!/usr/bin/env python3
"""Analyser og sammenlign AO GeoJSON-responser med og uten userId."""
import json

with_user = json.load(open('/tmp/ao_geojson_with_user.json'))
no_user = json.load(open('/tmp/ao_geojson_no_user.json'))

print('=== MED userId ===')
print('Keys:', list(with_user.keys()) if isinstance(with_user, dict) else type(with_user))
feats = with_user.get('features', []) if isinstance(with_user, dict) else []
print('Antall features:', len(feats))
for i, f in enumerate(feats[:5]):
    props = f.get('properties', {})
    print(f"  [{i}] Id={props.get('Id')}, Name={props.get('Name')}, IsPrivate={props.get('IsPrivate')}")
    if i == 0:
        print(f"      All keys: {list(props.keys())}")

print()
print('=== UTEN userId ===')
feats2 = no_user.get('features', []) if isinstance(no_user, dict) else []
print('Antall features:', len(feats2))
for i, f in enumerate(feats2[:3]):
    props = f.get('properties', {})
    print(f"  [{i}] Id={props.get('Id')}, Name={props.get('Name')}")

ids_with = {f.get('properties',{}).get('Id') for f in feats if f.get('properties',{}).get('Id')}
ids_no = {f.get('properties',{}).get('Id') for f in feats2 if f.get('properties',{}).get('Id')}
only_mine = ids_with - ids_no
print()
print('DINE private lokasjoner (kun med userId):', only_mine if only_mine else '(ingen)')
