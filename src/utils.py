"""Fellesfunksjoner brukt på tvers av backend-moduler."""

from user_agents import parse as parse_ua_string


def mask_token(token, visible=6):
    """Masker et token for logging — viser kun de første tegnene."""
    if not token:
        return 'None'
    return token[:visible] + '***'


def parse_user_agent(user_agent: str) -> dict:
    """Parser user agent og returnerer strukturert info."""
    if not user_agent:
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
