"""Fellesfunksjoner brukt på tvers av backend-moduler."""

import hashlib

try:
    from user_agents import parse as parse_ua_string
except ImportError:
    parse_ua_string = None


def mask_token(token, visible=6):
    """Masker et token for logging — de første tegnene pluss et kort hash av hele.

    Prefikset alene skiller ikke et rotert AO-logintoken fra det gamle (de starter
    likt), så hashen trengs for å se om klienten sendte det nye eller det gamle.
    8 hex-tegn av SHA-256 kan ikke regnes tilbake til tokenet.
    """
    if not token:
        return 'None'
    fingeravtrykk = hashlib.sha256(token.encode('utf-8')).hexdigest()[:8]
    return f'{token[:visible]}***#{fingeravtrykk}'


def parse_user_agent(user_agent: str) -> dict:
    """Parser user agent og returnerer strukturert info."""
    if not user_agent or parse_ua_string is None:
        return {"device_type": "unknown", "os": "unknown", "browser": "unknown"}

    try:
        ua = parse_ua_string(user_agent)

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

        return {
            "device_type": device_type,
            "os": ua.os.family or "unknown",
            "browser": ua.browser.family or "unknown",
        }
    except Exception:
        return {"device_type": "unknown", "os": "unknown", "browser": "unknown"}
