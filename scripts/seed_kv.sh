#!/usr/bin/env bash
set -euo pipefail

# Seed Azure Key Vault secrets needed by the Function App.
# Prefers values from environment variables; falls back to local.settings.json where reasonable.
# Requires: az CLI logged in and correct subscription selected.

RG_NAME="${AZURE_RESOURCE_GROUP:-rg-drone}"

# Resolve Key Vault name in the resource group
VAULT_NAME="$(az keyvault list -g "$RG_NAME" --query '[0].name' -o tsv 2>/dev/null || true)"
if [ -z "${VAULT_NAME:-}" ]; then
  echo "[seed_kv] No Key Vault found in resource group $RG_NAME" >&2
  exit 1
fi

# PROJECT_ENDPOINT (prefer env; fallback to local.settings.json)
PROJECT_ENDPOINT_VAL="${PROJECT_ENDPOINT:-}"
if [ -z "$PROJECT_ENDPOINT_VAL" ] && [ -f "DeepResearchFunctionApp/local.settings.json" ]; then
  PROJECT_ENDPOINT_VAL="$(python3 - <<'PY'
import json
try:
  with open('DeepResearchFunctionApp/local.settings.json') as f:
    print(json.load(f).get('Values',{}).get('PROJECT_ENDPOINT',''))
except Exception:
  print('')
PY
)"
fi
if [ -n "$PROJECT_ENDPOINT_VAL" ]; then
  az keyvault secret set --vault-name "$VAULT_NAME" --name PROJECT-ENDPOINT --value "$PROJECT_ENDPOINT_VAL" 1>/dev/null
  echo "[seed_kv] Set PROJECT-ENDPOINT in $VAULT_NAME"
fi

# Cosmos DB settings (discover from RG)
COSMOS_NAME="$(az cosmosdb list -g "$RG_NAME" --query '[0].name' -o tsv 2>/dev/null || true)"
if [ -n "$COSMOS_NAME" ]; then
  COSMOS_ENDPOINT="$(az cosmosdb show -n "$COSMOS_NAME" -g "$RG_NAME" --query documentEndpoint -o tsv)"
  COSMOS_KEY="$(az cosmosdb keys list -n "$COSMOS_NAME" -g "$RG_NAME" --query primaryMasterKey -o tsv)"
  DB_NAME="${COSMOS_DB_DATABASE:-DeepResearch}"
  JOBS="${COSMOS_JOBS_CONTAINER:-research_jobs}"
  STEPS="${COSMOS_STEPS_CONTAINER:-job_steps}"
  az keyvault secret set --vault-name "$VAULT_NAME" --name COSMOS-DB-ACCOUNT-URI --value "$COSMOS_ENDPOINT" 1>/dev/null
  az keyvault secret set --vault-name "$VAULT_NAME" --name COSMOS-DB-KEY --value "$COSMOS_KEY" 1>/dev/null
  az keyvault secret set --vault-name "$VAULT_NAME" --name COSMOS-DB-DATABASE --value "$DB_NAME" 1>/dev/null
  az keyvault secret set --vault-name "$VAULT_NAME" --name COSMOS-JOBS-CONTAINER --value "$JOBS" 1>/dev/null
  az keyvault secret set --vault-name "$VAULT_NAME" --name COSMOS-STEPS-CONTAINER --value "$STEPS" 1>/dev/null
  echo "[seed_kv] Seeded Cosmos DB secrets into $VAULT_NAME"
fi

echo "[seed_kv] Key Vault seeding complete for vault $VAULT_NAME"
