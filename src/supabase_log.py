# Enkel Supabase-logging for fugleobservasjoner
# Krever: pip install supabase user-agents
import os
from supabase import create_client, Client
from user_agents import parse

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY")

supabase = None
if SUPABASE_URL and SUPABASE_KEY:
    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)


def parse_user_agent(user_agent: str) -> dict:
    """Parser user agent og returnerer strukturert info."""
    if not user_agent:
        return {"device_type": "unknown", "os": "unknown", "browser": "unknown"}

    try:
        ua = parse(user_agent)

        # Device type
        if ua.is_mobile:
            device_type = "mobile"
        elif ua.is_tablet:
            device_type = "tablet"
        elif ua.is_pc:
            device_type = "desktop"
        elif ua.is_bot:
            device_type = "bot"
        else:
            device_type = "unknown"

        # OS - forenklet navn
        os_name = ua.os.family or "unknown"

        # Browser - forenklet navn
        browser = ua.browser.family or "unknown"

        return {
            "device_type": device_type,
            "os": os_name,
            "browser": browser,
        }
    except Exception:
        return {"device_type": "unknown", "os": "unknown", "browser": "unknown"}


def log_view_to_supabase(ip: str, user_agent: str, device_id: str = ''):
    if not supabase:
        return False
    try:
        # Parse user agent
        ua_info = parse_user_agent(user_agent)

        data = {
            "ip": ip,
            "user_agent": user_agent,  # Behold original som backup
            "device_type": ua_info["device_type"],
            "os": ua_info["os"],
            "browser": ua_info["browser"],
            # timestamp settes automatisk av Supabase (default now())
        }
        if device_id:
            data["device_id"] = device_id
        supabase.table("stats").insert(data).execute()
        return True
    except Exception as e:
        print(f"[Supabase] Feil ved logging: {e}")
        return False
