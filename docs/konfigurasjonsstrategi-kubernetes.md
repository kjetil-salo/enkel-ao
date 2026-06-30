# Konfigurasjonsstrategi for Kubernetes/.NET

## Prinsipp: Riktig config på riktig sted

Konfigurasjon deles i tre kategorier med tydelig eierskap og plassering.

| Hva | Hvor | Hvem eier |
|-----|------|-----------|
| App-defaults (timeouts, retry-config) | `appsettings.json` i app-repo | Utvikler |
| Miljøspesifikk config (URLs, feature flags) | Helm values i infrastruktur-repo | Plattformteam |
| Secrets (connection strings, API-nøkler) | Azure Key Vault | Plattformteam |

## Helm values per miljø

Konfigurasjon lever i infrastruktur-repoet, med base-values og miljø-overrides:

```
infrastructure-repo/
├── base/tjeneste-a/
│   ├── Chart.yaml
│   ├── templates/
│   │   ├── deployment.yaml      # Refererer til {{ .Values.x }}
│   │   ├── configmap.yaml       # Genereres fra values
│   │   └── sealed-secret.yaml
│   └── values.yaml              # Defaults
├── envs/
│   ├── dev/tjeneste-a/values.yaml      # Override for dev
│   ├── test/tjeneste-a/values.yaml     # Override for test
│   └── prod/tjeneste-a/values.yaml     # Override for prod
```

Helm merger base values med miljø-override. Én kilde, tydelig hva som er forskjellig mellom miljøer.

## Hemmeligheter: Azure Key Vault

Vanlige config-verdier kan ligge rett i Helm values. Men secrets skal **aldri** i Git i klartekst. To vanlige løsninger:

| Tilnærming | Beskrivelse |
|------------|-------------|
| **Azure Key Vault + CSI driver** | Secrets lever i Azure Key Vault, monteres som volum/env i podden. Plattformteam styrer tilgang via Azure RBAC. |
| **Sealed Secrets** | Krypterte secrets som trygt kan committes til Git. Decrypteres av en controller i klusteret. |

For et Azure-tungt miljø er **Key Vault med CSI driver** det naturlige valget. Da trenger ikke infrastruktur-repoet inneholde secrets i det hele tatt.

## .NET og appsettings.json

I .NET-verdenen er det `appsettings.json` + `appsettings.{Environment}.json`. Problemet med å ha miljøspesifikke filer i app-repoet:

- **Blander ansvar** — utviklere committer infrastruktur-config sammen med kode
- **Rebuild kreves** — ny config betyr nytt image (eller i beste fall ny deploy)
- **Secrets lekker** — fristende å putte connection strings rett i filen

### Anbefalt mønster

```
appsettings.json          ← i app-repo, kun app-defaults (logging-nivå, timeouts)
                            INGEN miljøspesifikke verdier

Helm values per miljø     ← i infrastruktur-repo, injiseres som env-variabler
                            eller ConfigMap som monteres

Azure Key Vault           ← secrets (connection strings, API-nøkler)
```

.NET sin `IConfiguration` leser automatisk fra environment variables, som overstyrer appsettings.json. Så flyten blir:

```
appsettings.json (defaults)
        ↓ overstyres av
Environment variables (fra Helm/ConfigMap)
        ↓ overstyres av
Azure Key Vault (secrets)
```
