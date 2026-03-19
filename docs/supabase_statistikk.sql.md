# Supabase SQL-skript for statistikk (admin)

Statistikk-siden på Fly.io-instansen bruker Supabase. All statistikk hentes via én enkelt RPC-funksjon `get_stats`.

> **Merk:** Pi-instansen bruker SQLite (`/data/stats.db`) og trenger ikke disse funksjonene.

## Tabeller

```sql
-- Sidevisninger
CREATE TABLE IF NOT EXISTS stats (
    id          BIGSERIAL PRIMARY KEY,
    ip          TEXT,
    device_id   TEXT,
    device_type TEXT,
    os          TEXT,
    browser     TEXT,
    user_agent  TEXT,
    timestamp   TIMESTAMPTZ DEFAULT NOW()
);

-- Eksport-hendelser
CREATE TABLE IF NOT EXISTS exports (
    id        BIGSERIAL PRIMARY KEY,
    type      TEXT,  -- 'copy_open' eller 'direct'
    timestamp TIMESTAMPTZ DEFAULT NOW()
);
```

## Aktiv funksjon: get_stats

Returnerer all statistikk samlet i ett JSON-objekt. Kalles fra `src/supabase_log.py`.

```sql
DROP FUNCTION IF EXISTS get_stats();

CREATE OR REPLACE FUNCTION get_stats()
RETURNS json AS $$
DECLARE
  result json;
BEGIN
  SELECT json_build_object(
    'total',          (SELECT COUNT(*) FROM stats),
    'unique_ips',     (SELECT COUNT(DISTINCT ip) FROM stats),
    'unique_devices', (SELECT COUNT(DISTINCT device_id) FROM stats WHERE device_id IS NOT NULL AND device_id != ''),
    'top_ips',        (SELECT json_agg(t) FROM (SELECT ip, COUNT(*) as cnt FROM stats GROUP BY ip ORDER BY MAX(timestamp) DESC LIMIT 10) t),
    'per_browser',    (SELECT json_object_agg(browser, cnt) FROM (SELECT browser, COUNT(*) as cnt FROM stats GROUP BY browser) t),
    'per_os',         (SELECT json_object_agg(os, cnt) FROM (SELECT os, COUNT(*) as cnt FROM stats GROUP BY os) t),
    'exports',        (SELECT json_object_agg(type, cnt) FROM (SELECT type, COUNT(*) as cnt FROM exports GROUP BY type) t),
    'trend_30d',      (SELECT json_agg(t ORDER BY dato) FROM (SELECT DATE(timestamp) as dato, COUNT(*) as cnt FROM stats WHERE timestamp >= NOW() - INTERVAL '29 days' GROUP BY dato) t)
  ) INTO result;
  RETURN result;
END;
$$ LANGUAGE plpgsql;
```

## Oppdatere funksjonen

Siden `get_stats` returnerer `json` (ikke `RETURNS TABLE`), kan den vanligvis oppdateres med `CREATE OR REPLACE` uten `DROP`. Men ved endring av signatur: kjør `DROP FUNCTION IF EXISTS get_stats()` først.

---
Sist oppdatert: 2026-03-19
