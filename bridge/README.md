# `bridge/` — Kubernetes files

## Short answer: you do not write these by hand

These YAML files are **generated** from `docker-compose.yml` by a tool called
[kompose](https://kompose.io). Kompose reads the compose file and writes the
Kubernetes versions of the same services.

Every file starts with:

```yaml
#! api-gateway-deployment.yaml
# Generated code, do not edit
```

That header is not decoration. It means: change `docker-compose.yml`, then
regenerate. Do not sit in Notepad copying YAML between files.

`docker-compose.yml` is the single source of truth. `.env` holds the secrets.

---

## Which `apiVersion` / `kind` each file uses

You asked what versions to type. These are the only ones in this folder:

| File type | `apiVersion` | `kind` |
|---|---|---|
| `*-deployment.yaml` | `apps/v1` | `Deployment` |
| `*-service.yaml` | `v1` | `Service` |
| `*-expose.yaml` | `v1` | `Service` |
| `0-anomalyengine-namespace.yaml` | `v1` | `Namespace` |
| `*-persistentVolumeClaim.yaml` | `v1` | `PersistentVolumeClaim` |
| `default-network-policy.yaml` | `networking.k8s.io/v1` | `NetworkPolicy` |
| `kustomization.yaml` | `kustomize.config.k8s.io/v1beta1` | `Kustomization` |

These are the current stable versions for Kubernetes 1.36 (the `kubectl` that
ships with Docker Desktop). Nothing here is deprecated.

---

## Regenerate the files (PowerShell)

Run from the repository root: `D:\Anomaly Engine`

### 1. Install kompose once

```powershell
$dir = "$env:LOCALAPPDATA\Programs\kompose"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
Invoke-WebRequest -Uri "https://github.com/kubernetes/kompose/releases/download/v1.38.0/kompose-windows-amd64.exe" -OutFile "$dir\kompose.exe"
[Environment]::SetEnvironmentVariable("Path", $env:Path + ";$dir", "User")
$env:Path += ";$dir"
kompose version
```

`kompose version` should print `1.38.0`. Open a new terminal afterwards so the
`Path` change sticks.

### 2. Regenerate

**Important:** move `.env` out of the folder first. Kompose copies the values
from `env_file` straight into the YAML, so running it with `.env` present would
write your real Supabase / Redis / Finnhub keys into files that get committed.

```powershell
Move-Item .env .env.keep
kompose convert -f docker-compose.yml -o bridge/base
Move-Item .env.keep .env
```

### 3. Put the secret reference back

Kompose cannot know about Kubernetes Secrets, so it writes empty or placeholder
env values. After regenerating, replace the `env:` block in these six files:

`api-gateway-deployment.yaml`, `backtester-deployment.yaml`,
`ingestion-market-deployment.yaml`, `ingestion-us-deployment.yaml`,
`nlp-engine-deployment.yaml`, `task-queue-deployment.yaml`

with exactly this (keep the indentation):

```yaml
                  env:
                    - name: EDGAR_USER_AGENT
                      value: "AnomalyEngine/1.0 (research@anomalyengine.dev)"
                    - name: FINBERT_MODEL
                      value: "ProsusAI/finbert"
                    - name: MODEL_DEVICE
                      value: "cpu"
                  envFrom:
                    - secretRef:
                        name: anomaly-secrets
```

Those three values are plain config, not secrets. Everything private
(`SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_SERVICE_KEY`, `REDIS_URL`,
`FINNHUB_API_KEY`, `SEC_AUTH_EMAIL`, `MONGODB_URI`) comes from the Kubernetes
Secret named `anomaly-secrets`.

`frontend-deployment.yaml` only needs `NEXT_PUBLIC_API_URL`, which is public, so
leave it alone.

---

## Apply it

The Docker Desktop Kubernetes cluster must be running first. Check with:

```powershell
kubectl get nodes
```

If that fails, open Docker Desktop → Settings → Kubernetes → **Enable
Kubernetes** → Apply & Restart.

Then:

```powershell
kubectl create namespace anomalyengine --dry-run=client -o yaml | kubectl apply -f -
kubectl create secret generic anomaly-secrets --namespace anomalyengine --from-env-file=.env --dry-run=client -o yaml | kubectl apply -f -
kubectl apply -k bridge/base
kubectl get pods -n anomalyengine -w
```

`--dry-run=client -o yaml | kubectl apply -f -` makes both commands safe to run
twice; a plain `create` errors out if the object already exists.

Check what will be sent to the cluster without a cluster:

```powershell
kubectl kustomize bridge/base
```

That command only reads and renders the YAML locally, so it works even when
Docker is stopped. It currently succeeds on this repo.

---

## Honest limits

- **This path is optional.** The demo runs natively with
  `.\start-dev.ps1 -IncludeFrontend`, not on Kubernetes. Nothing in the demo
  depends on this folder.
- **It has not been deployed end-to-end.** The cluster on this machine is not
  running, so `kubectl get nodes` fails. The YAML renders and validates, but no
  pod has actually started here.
- **The images must exist inside the cluster.** `image:` is set to local names
  like `anomalyengine-api-gateway`. With Docker Desktop they normally resolve,
  but if a pod reports `ErrImageNeverPull` or `ImagePullBackOff`, build the
  images locally with `docker compose build` first.
- **The `hostPath` volumes use the Docker Desktop host mount.** They read
  `/run/desktop/mnt/host/d/Anomaly Engine/...`, which is where Docker Desktop's
  Linux node sees the `D:` drive. If you clone the repo somewhere else, that
  prefix has to change to match your drive and folder. These mounts exist only
  because the images are built from each service folder, so `packages/` is not
  baked into the image. In production you would copy the shared package into the
  image instead and drop the mounts.

If the goal is just to show that the project can be described as containers,
`docker compose up` already does that and is the path that runs today.
