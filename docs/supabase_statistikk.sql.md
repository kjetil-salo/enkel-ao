# Supabase SQL-skript for statistikk (admin)

Dette dokumentet beskriver de nødvendige SQL-funksjonene (RPCs) som må opprettes i Supabase for at statistikk-siden i fugleobservasjoner skal fungere effektivt og uten 1000-radsbegrensning.

## Funksjoner som må opprettes

### 1. recent_unique_ips
Returnerer de siste N unike IP-adressene med antall sidevisninger per IP (nyeste først).

```sql
create or replace function recent_unique_ips(limit_num integer)
returns table(ip text, count bigint) as $$
begin
  return query
    select ip, count(*)
    from stats
    group by ip
    order by max(created_at) desc
    limit limit_num;
end;
$$ language plpgsql;
```

### 2. count_unique_ips
Returnerer totalt antall unike IP-adresser.

```sql
create or replace function count_unique_ips()
returns table(count bigint) as $$
begin
  return query
    select count(distinct ip) from stats;
end;
$$ language plpgsql;
```

### 3. count_per_browser
Returnerer antall sidevisninger per nettleser (basert på user-agent-parsing i backend).

```sql
create or replace function count_per_browser()
returns table(browser text, count bigint) as $$
begin
  return query
    select browser, count(*)
    from stats
    group by browser
    order by count desc;
end;
$$ language plpgsql;
```

### 4. count_per_os
Returnerer antall sidevisninger per operativsystem (basert på user-agent-parsing i backend).

```sql
create or replace function count_per_os()
returns table(os text, count bigint) as $$
begin
  return query
    select os, count(*)
    from stats
    group by os
    order by count desc;
end;
$$ language plpgsql;
```

## Forutsetninger
- Tabell: `stats` må ha kolonnene `ip`, `browser`, `os`, `created_at` (timestamp).
- Funksjonene må opprettes i SQL-editoren i Supabase-prosjektet.
- Funksjonene må være eksponert som RPC-endepunkter i Supabase API.

## Bruk i backend
Se `server.py` for hvordan disse funksjonene kalles fra Python.

---
Sist oppdatert: 2026-01-26
