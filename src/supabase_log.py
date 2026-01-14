# Enkel Supabase-logging for fugleobservasjoner
# Krever: pip install supabase
import os
from supabase import create_client, Client

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY")

supabase = None
if SUPABASE_URL and SUPABASE_KEY:
    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

def log_view_to_supabase(ip: str, user_agent: str):
    if not supabase:
        return False
    try:
        data = {
            "ip": ip,
            "user_agent": user_agent,
            # timestamp settes automatisk av Supabase (default now())
        }
        supabase.table("stats").insert(data).execute()
        return True
    except Exception as e:
        print(f"[Supabase] Feil ved logging: {e}")
        return False
