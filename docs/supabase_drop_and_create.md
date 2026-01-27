# Slik oppdaterer du Supabase-funksjoner trygt

Når du endrer returtypen eller signaturen til en eksisterende SQL-funksjon i Supabase/Postgres, må du først slette (DROP) funksjonen før du kan opprette (CREATE) den på nytt.

## Eksempel: Oppdater recent_unique_ips

1. **Slett funksjonen først:**

```sql
DROP FUNCTION IF EXISTS recent_unique_ips(integer);
```

2. **Opprett funksjonen på nytt (med riktig kolonnenavn):**

```sql
CREATE OR REPLACE FUNCTION recent_unique_ips(limit_num integer)
RETURNS TABLE(ip text, count bigint) AS $$
BEGIN
  RETURN QUERY
    SELECT ip, count(*)
    FROM stats
    GROUP BY ip
    ORDER BY max(timestamp) DESC
    LIMIT limit_num;
END;
$$ LANGUAGE plpgsql;
```

## Gjenta for andre funksjoner
Hvis du endrer signatur eller returtype på andre funksjoner (f.eks. count_unique_ips, count_per_browser, count_per_os), bruk også `DROP FUNCTION IF EXISTS ...` før du oppretter dem på nytt.

## Tips
- Kjør DROP og CREATE i samme SQL-editor-økt for å unngå nedetid.
- Pass på at du bruker riktig kolonnenavn (timestamp, ikke created_at).
- Se docs/supabase_statistikk.sql.md for oppdaterte funksjoner.

---
Sist oppdatert: 2026-01-26
