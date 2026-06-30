# GitOps med dedikert infrastruktur-repo

## Hvorfor dette er relevant

I dag har vi infrastruktur-konfigurasjon i selve app-repoene, kombinert med monorepo. Dette gir oss to utfordringer:

- **Infrastruktur i app-repo** — blander ansvar. En endring i en Helm values-fil trigger bygg av hele applikasjonen. Rollback av infrastruktur-endringer krever rollback av appkode. Utviklere må forholde seg til infrastruktur de ikke eier.
- **Monorepo** — en commit i én tjeneste trigger bygg og deploy av alt. Unødvendig lang byggetid, unødvendig risiko, og vanskelig å spore hvilken endring som faktisk påvirket hva.

## Prinsipp: Separer app-kode og infrastruktur

Applikasjonskode og infrastruktur-konfigurasjon bør leve i separate repositories med tydelig ansvarsfordeling.

### Repositories

| Repo | Innhold | Eier |
|------|---------|------|
| **App-repo** (per tjeneste) | Applikasjonskode, Dockerfile, enhetstester | Utviklingsteam |
| **Infrastruktur-repo** (ett felles) | Helm charts/values, Kubernetes-manifester, miljøkonfigurasjon | Plattformteam / DevOps |

## Flyten: Fra kode til deploy

```
Utvikler pusher kode til app-repo (tjeneste-A)
        ↓
Azure DevOps Pipeline bygger .NET-app → docker build → push til ACR
        ↓
Pipeline oppdaterer image-tag i infrastruktur-repo (automatisk commit eller PR)
        ↓
Infrastruktur-repoet har egen pipeline som deployer til AKS
```

### Steg 1: App-pipeline (i app-repoet)

Bygger og publiserer — ingenting mer:

```yaml
# azure-pipelines.yml i tjeneste-A sitt repo
trigger:
  - main

steps:
  - task: Docker@2
    inputs:
      command: buildAndPush
      repository: tjeneste-a
      containerRegistry: myacr
      tags: $(Build.BuildId)

  - script: |
      git clone $(INFRASTRUCTURE_REPO_URL)
      cd infrastructure-repo
      yq -i ".image.tag = \"$(Build.BuildId)\"" envs/dev/tjeneste-a/values.yaml
      git config user.name "Azure DevOps"
      git config user.email "pipeline@company.no"
      git commit -am "auto: bump tjeneste-a to $(Build.BuildId)"
      git push
    displayName: Oppdater infrastruktur-repo
```

Pipeline autentiserer mot infrastruktur-repoet med en **service connection** eller **PAT-token** konfigurert i Azure DevOps.

### Steg 2: Infrastruktur-pipeline (i infrastruktur-repoet)

Trigges av commits til infrastruktur-repoet og deployer:

```yaml
# azure-pipelines.yml i infrastruktur-repo
trigger:
  - main

steps:
  - task: HelmDeploy@0
    inputs:
      command: upgrade
      chartPath: envs/dev/tjeneste-a
      releaseName: tjeneste-a
      namespace: dev
```

## Miljøstyring

| Miljø | Trigger | Beskrivelse |
|-------|---------|-------------|
| **Dev** | Automatisk commit | App-pipeline committer ny tag rett til main i infrastruktur-repo |
| **Test** | PR | App-pipeline oppretter PR i infrastruktur-repo → krever godkjenning |
| **Prod** | PR + approval gate | Samme som test, pluss environment approval i Azure DevOps |

### Struktur i infrastruktur-repoet

```
infrastructure-repo/
├── base/                    # Felles Helm templates
│   ├── tjeneste-a/
│   ├── tjeneste-b/
│   └── tjeneste-c/
├── envs/
│   ├── dev/
│   │   ├── tjeneste-a/values.yaml
│   │   ├── tjeneste-b/values.yaml
│   │   └── tjeneste-c/values.yaml
│   ├── test/
│   └── prod/
└── pipelines/               # Deploy-pipelines per miljø
```

## Hva vi oppnår

### Kontra infrastruktur i app-repo

- **Ren separasjon** — infrastruktur-endringer trigger ikke app-bygg og omvendt
- **Uavhengig livssyklus** — kan endre skalering, ressurser eller miljøvariabler uten å røre appkoden
- **Tydelig eierskap** — utviklere eier app-kode, plattformteam eier infrastruktur
- **Enklere rollback** — revert i infrastruktur-repo ruller tilbake kun infrastruktur

### Kontra monorepo

- **Bygger kun det som er endret** — hvert app-repo har sin egen pipeline
- **Raskere feedback** — kortere byggetid, enklere feilsøking
- **Uavhengige releaser** — team deployer uten å vente på hverandre

### Generelle fordeler

- **Komplett audit trail** — all infrastruktur-endring sporbar som Git-commits
- **Katastrofegjenoppretting** — klusteret kan gjenskapes fra infrastruktur-repoet
- **Én sannhetskilde** — infrastruktur-repoet beskriver nøyaktig hva som kjører i hvert miljø

## Anbefalt tilnærming

1. Opprett et dedikert infrastruktur-repo med Helm values per miljø
2. Migrer én tjeneste som pilot
3. Evaluer og utvid basert på erfaringene
