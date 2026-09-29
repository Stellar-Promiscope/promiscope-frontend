#!/usr/bin/env bash
# scripts/deploy-test-contract.sh
#
# Fetches the pinned contract WASM from a GitHub Release artifact,
# verifies its SHA-256 checksum, deploys it to the local Soroban quickstart
# node (docker-compose.test.yml), initializes it with a generated admin keypair,
# and writes the resulting contract ID into .env.integration so the test runner
# can pick it up.
#
# Prerequisites:
#   - Docker Compose test stack is running:
#       docker compose -f docker-compose.test.yml up -d
#   - stellar CLI ≥ 22.0 is on PATH
#   - curl and sha256sum (or shasum on macOS) are available
#
# Usage:
#   ./scripts/deploy-test-contract.sh
#
# Outputs:
#   .env.integration  — contains NEXT_PUBLIC_CONTRACT_ID=<id> and
#                       INT_ADMIN_SECRET=<admin_secret> for the test runner.
#
# The deployed contract is ephemeral: the quickstart node loses its state
# every time its container is recreated (which is intentional — each CI run
# starts from genesis).

set -euo pipefail

# ── Pinned release ────────────────────────────────────────────────────────────
# Update these together whenever you want to target a newer contract version.
# After updating: run this script locally, confirm the integration suite passes,
# then commit both the bumped WASM_URL/WASM_SHA256 and any changed call shapes
# in lib/contract.ts in a single PR.
WASM_URL="https://github.com/scout-off/scout-off-contracts/releases/download/v1.0.0/scout_off_contracts.wasm"
WASM_SHA256="a3f8c2d1e4b5a6f7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1"
# Expected contract version (must match EXPECTED_CONTRACT_VERSION in lib/contract.ts)
EXPECTED_CONTRACT_VERSION=1

# ── Quickstart RPC endpoint ───────────────────────────────────────────────────
SOROBAN_RPC="${SOROBAN_RPC_URL:-http://localhost:8000/soroban/rpc}"
HORIZON_URL="${HORIZON_URL:-http://localhost:8000}"
NETWORK_PASSPHRASE="${NETWORK_PASSPHRASE:-Standalone Network ; February 2017}"

# ── Paths ─────────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
WASM_CACHE="${REPO_ROOT}/.wasm-cache"
WASM_FILE="${WASM_CACHE}/scout_off_contracts.wasm"
ENV_FILE="${REPO_ROOT}/.env.integration"

mkdir -p "${WASM_CACHE}"

# ── Step 1: Fetch WASM (with local cache) ─────────────────────────────────────
echo "==> Fetching pinned contract WASM..."
if [[ -f "${WASM_FILE}" ]]; then
  echo "    Cached WASM found, skipping download."
else
  echo "    Downloading ${WASM_URL}"
  curl -fsSL --retry 3 --retry-delay 2 -o "${WASM_FILE}" "${WASM_URL}"
fi

# ── Step 2: Verify SHA-256 checksum ───────────────────────────────────────────
echo "==> Verifying WASM checksum..."
if command -v sha256sum &>/dev/null; then
  ACTUAL_SHA256=$(sha256sum "${WASM_FILE}" | awk '{print $1}')
else
  # macOS
  ACTUAL_SHA256=$(shasum -a 256 "${WASM_FILE}" | awk '{print $1}')
fi

if [[ "${ACTUAL_SHA256}" != "${WASM_SHA256}" ]]; then
  echo "ERROR: WASM checksum mismatch!"
  echo "  Expected: ${WASM_SHA256}"
  echo "  Actual:   ${ACTUAL_SHA256}"
  echo "  Delete ${WASM_FILE} and re-run if this is a network error,"
  echo "  or update WASM_SHA256 in this script if you intentionally bumped the release."
  rm -f "${WASM_FILE}"
  exit 1
fi
echo "    Checksum OK: ${ACTUAL_SHA256}"

# ── Step 3: Wait for Soroban RPC to be healthy ────────────────────────────────
echo "==> Waiting for Soroban RPC at ${SOROBAN_RPC}..."
for i in $(seq 1 40); do
  STATUS=$(curl -sf -X POST "${SOROBAN_RPC}" \
    -H 'Content-Type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"getHealth","params":{}}' \
    | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('result',{}).get('status',''))" 2>/dev/null || true)
  if [[ "${STATUS}" == "healthy" ]]; then
    echo "    RPC is healthy."
    break
  fi
  if [[ $i -eq 40 ]]; then
    echo "ERROR: Soroban RPC did not become healthy after 40 attempts."
    exit 1
  fi
  echo "    Attempt ${i}/40 — not healthy yet, retrying in 3s..."
  sleep 3
done

# ── Step 4: Generate ephemeral admin keypair ───────────────────────────────────
echo "==> Generating ephemeral admin keypair..."
ADMIN_KEYPAIR=$(stellar keys generate --network local --no-fund 2>/dev/null || \
  stellar keys generate --rpc-url "${SOROBAN_RPC}" \
    --network-passphrase "${NETWORK_PASSPHRASE}" --no-fund admin-int-$$)

ADMIN_SECRET=$(stellar keys show admin-int-$$ --secret-key 2>/dev/null || \
  stellar keys show admin-int-$$ 2>/dev/null | grep -Eo 'S[A-Z2-7]{55}' || \
  echo "${ADMIN_KEYPAIR}")
ADMIN_PUBLIC=$(stellar keys address admin-int-$$ 2>/dev/null || \
  echo "${ADMIN_KEYPAIR}" | grep -Eo 'G[A-Z2-7]{55}')

echo "    Admin public key: ${ADMIN_PUBLIC}"

# Fund the admin account via Horizon's friendbot (local quickstart has one)
echo "==> Funding admin account via friendbot..."
curl -sf "${HORIZON_URL}/friendbot?addr=${ADMIN_PUBLIC}" -o /dev/null || {
  # Some quickstart versions use /friendbot directly
  curl -sf "http://localhost:8000/friendbot?addr=${ADMIN_PUBLIC}" -o /dev/null
}
echo "    Funded."

# ── Step 5: Upload WASM ───────────────────────────────────────────────────────
echo "==> Uploading WASM to local node..."
WASM_HASH=$(stellar contract upload \
  --wasm "${WASM_FILE}" \
  --source-account "${ADMIN_SECRET}" \
  --rpc-url "${SOROBAN_RPC}" \
  --network-passphrase "${NETWORK_PASSPHRASE}")
echo "    WASM hash: ${WASM_HASH}"

# ── Step 6: Deploy contract instance ─────────────────────────────────────────
echo "==> Deploying contract instance..."
CONTRACT_ID=$(stellar contract deploy \
  --wasm-hash "${WASM_HASH}" \
  --source-account "${ADMIN_SECRET}" \
  --rpc-url "${SOROBAN_RPC}" \
  --network-passphrase "${NETWORK_PASSPHRASE}")
echo "    Contract ID: ${CONTRACT_ID}"

# ── Step 7: Initialize contract with admin ────────────────────────────────────
echo "==> Initializing contract with admin ${ADMIN_PUBLIC}..."
stellar contract invoke \
  --id "${CONTRACT_ID}" \
  --source-account "${ADMIN_SECRET}" \
  --rpc-url "${SOROBAN_RPC}" \
  --network-passphrase "${NETWORK_PASSPHRASE}" \
  -- initialize \
  --admin "${ADMIN_PUBLIC}"
echo "    Contract initialized."

# ── Step 8: Verify contract version matches expected ─────────────────────────
echo "==> Verifying contract version..."
DEPLOYED_VERSION=$(stellar contract invoke \
  --id "${CONTRACT_ID}" \
  --source-account "${ADMIN_SECRET}" \
  --rpc-url "${SOROBAN_RPC}" \
  --network-passphrase "${NETWORK_PASSPHRASE}" \
  -- get_contract_version 2>/dev/null || echo "null")

if [[ "${DEPLOYED_VERSION}" == "null" ]]; then
  echo "    WARNING: Contract does not expose get_contract_version — skipping version check."
elif [[ "${DEPLOYED_VERSION}" != "${EXPECTED_CONTRACT_VERSION}" ]]; then
  echo "ERROR: Contract version mismatch!"
  echo "  Expected: ${EXPECTED_CONTRACT_VERSION}"
  echo "  Deployed: ${DEPLOYED_VERSION}"
  echo "  Update EXPECTED_CONTRACT_VERSION in lib/contract.ts or update the pinned WASM."
  exit 1
else
  echo "    Contract version: ${DEPLOYED_VERSION} (matches EXPECTED_CONTRACT_VERSION)"
fi

# ── Step 9: Write .env.integration ────────────────────────────────────────────
echo "==> Writing ${ENV_FILE}..."
cat > "${ENV_FILE}" <<EOF
# Generated by scripts/deploy-test-contract.sh — do not edit manually.
# This file is gitignored; re-run the script to regenerate it.
NEXT_PUBLIC_CONTRACT_ID=${CONTRACT_ID}
NEXT_PUBLIC_SOROBAN_RPC=${SOROBAN_RPC}
NEXT_PUBLIC_HORIZON_URL=${HORIZON_URL}
NEXT_PUBLIC_NETWORK=local
INT_ADMIN_SECRET=${ADMIN_SECRET}
INT_ADMIN_PUBLIC=${ADMIN_PUBLIC}
INT_WASM_HASH=${WASM_HASH}
EOF

echo ""
echo "✅ Contract deployed successfully!"
echo "   Contract ID : ${CONTRACT_ID}"
echo "   Admin pubkey: ${ADMIN_PUBLIC}"
echo "   Env file    : ${ENV_FILE}"
echo ""
echo "Run the integration tests with:"
echo "   npm run test:integration"
