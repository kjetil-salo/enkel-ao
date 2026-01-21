#!/usr/bin/env python3
"""
Migreringsscript for å parse eksisterende user_agent-data i Supabase.

Kjør dette EN gang etter at du har lagt til kolonnene i Supabase:

SQL for å legge til kolonner (kjør i Supabase SQL Editor):
---------------------------------------------------------
ALTER TABLE stats ADD COLUMN IF NOT EXISTS device_type TEXT;
ALTER TABLE stats ADD COLUMN IF NOT EXISTS os TEXT;
ALTER TABLE stats ADD COLUMN IF NOT EXISTS browser TEXT;
---------------------------------------------------------

Bruk:
    python3 tools/migrate_user_agents.py

Krever miljøvariabler:
    SUPABASE_URL
    SUPABASE_KEY
"""

import os
import sys

# Legg til src i path for import
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src'))

from supabase import create_client
from supabase_log import parse_user_agent

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    print("Feil: SUPABASE_URL og SUPABASE_KEY må være satt")
    sys.exit(1)

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)


def migrate():
    print("Henter eksisterende data fra stats-tabellen...")

    # Hent alle rader som mangler device_type (ikke migrert ennå)
    result = supabase.table("stats").select("id, user_agent").is_("device_type", "null").execute()
    rows = result.data

    print(f"Fant {len(rows)} rader som skal migreres")

    if not rows:
        print("Ingen rader å migrere!")
        return

    migrated = 0
    errors = 0

    for row in rows:
        row_id = row.get("id")
        user_agent = row.get("user_agent") or ""

        # Parse user agent
        ua_info = parse_user_agent(user_agent)

        try:
            supabase.table("stats").update({
                "device_type": ua_info["device_type"],
                "os": ua_info["os"],
                "browser": ua_info["browser"],
            }).eq("id", row_id).execute()
            migrated += 1

            if migrated % 50 == 0:
                print(f"  Migrert {migrated}/{len(rows)}...")

        except Exception as e:
            print(f"  Feil ved rad {row_id}: {e}")
            errors += 1

    print(f"\nFerdig! Migrert: {migrated}, Feil: {errors}")


if __name__ == "__main__":
    migrate()
