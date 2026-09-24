# DFX module E2E probes

This private package contains the six probes and wallet simulator used for the
2026-09-24 module checks. It consumes the module from `file:..`; it is excluded
from the root package's publish allowlist and Standard lint scope. Historical
results belong in the repository's `TESTING.md`; copying these probes is not a
new successful test run.

## Prerequisites and installation

Use Node.js 22 and install the root package dependencies first, then this package
and its pinned Playwright Chromium browser. From the repository root:

```sh
npm install
cd e2e
npm install
npx playwright install chromium
mkdir -p out
```

The local `.npmrc` sets `install-links=true`, so npm installs `file:..` as a
packed copy, like a consumer installation, instead of a symlink to the repository.
A symlink can resolve a different `@tetherto/wdk-wallet` copy from the root:
the resulting `FiatProtocol` class mismatch causes the same silent registration
failure integrators encounter with duplicate wallet packages (`No fiat protocol
registered for label: dfx.`). The live matrix, full-stack probe and wallet server
abort early if DFX and WDK resolve different wallet paths. If an existing install
still uses a symlink, remove `e2e/node_modules` and reinstall from `e2e/` with
this setting enabled.

All commands below run from `e2e/`. Direct dependencies are pinned to the tested
versions, including `bs58` 6.0.0 and `@noble/curves` 1.2.0 read from the original
probe installation. There is no generated lockfile in this import: transitive
dependency resolution is not frozen. Installation and execution were not performed
as part of the import.

The network probes need access to DFX and the configured public chain RPCs. The
signature differential needs no network after installation. Wallet journeys need
loopback port 4748 free (override with `WALLET_SIM_PORT`); they start and stop their own simulator for every journey.
Do not start a separate simulator at the same time.

## Side effects and output

The live matrix creates fresh wallets and DFX users through authentication, both
in sandbox and, when explicitly selected, production. Production requires
`DFX_ENV=production`; the default is sandbox. The native quote probe only reads
catalogs and quotes, using the same environment selection. Wallet journeys always
use sandbox and can create sandbox users. The widget check opens authenticated
URLs and may create requests in the environment those URLs target. Use only
throwaway wallets, never funded wallets or real recovery phrases in the simulator.

Generated JSON, screenshots and the logs in the commands below go under `out/`,
which is ignored by Git. Seeds are never logged. Session values are masked in
console diagnostics and matrix result reports. The private handoff files
`out/e2e-urls-sandbox.json` and `out/e2e-urls-production.json` necessarily contain
active session URLs for the subsequent widget check. They are written with mode
`0600`; do not print, upload or share them. Remove them after the widget check.
This exception preserves the original file-based handoff; it is not a redacted
report. Screenshots show rendered test
account/payment information; treat output as local test data. Filenames are reused
on subsequent runs, except for the full-stack screenshots with unique run IDs.

These are the original exploratory probes, not a uniform assertion suite. The
matrix records failed steps but exits zero; native quotes report `ERR` inline;
the differential prints mismatch counts; the journey runner records a `stop`
(including the intended too-low-amount case). Inspect their output, not just exit
codes. Full-stack exits nonzero for failed or blocked steps.

## Commands

### Live chain matrix

```sh
node live-matrix.mjs > out/live-matrix-sandbox.log 2>&1
# Optional single chain, using a CASES chain name:
node live-matrix.mjs solana > out/live-matrix-solana.log 2>&1
# Explicit production run (creates production users):
DFX_ENV=production node live-matrix.mjs > out/live-matrix-production.log 2>&1
```

Reports are `out/e2e-results-sandbox.json` or
`out/e2e-results-production.json`. A single-chain run replaces that environment's
output with only that chain's results.

### Widget check

Run after the corresponding live matrix. Default selections are `ethereum-buy`,
`ethereum-sell`, `tron-buy`, and `base-sell`.

```sh
node widget-check.mjs > out/widget-sandbox.log 2>&1
DFX_ENV=production node widget-check.mjs > out/widget-production.log 2>&1
PICK=solana-buy,solana-sell node widget-check.mjs > out/widget-solana.log 2>&1
```

`URLS` optionally supplies a different URL JSON file, relative to the current
working directory or absolute. Screenshot names use its basename and selection
key. A URL override determines the actual target environment; `DFX_ENV` selects
only the default filename. Use production URL input only with explicit
`DFX_ENV=production`.

### Native-chain quotes

Lightning, Arkade and Firo, without wallet authentication:

```sh
node native-quotes.mjs > out/native-quotes-sandbox.log 2>&1
DFX_ENV=production node native-quotes.mjs > out/native-quotes-production.log 2>&1
```

### Signature differential

Directly imports `../src/signature.js`, compares 20,000 Solana signatures with
`bs58` and 5,000 Spark signatures with `@noble/curves`. Both mismatch counts
must be zero.

```sh
node signature-diff.mjs > out/signature-diff.log 2>&1
```

### Wallet journeys

Runs all seven journeys, or one by name. Each journey gets a fresh server process
and wallet state, with a 200-second browser-page timeout and guaranteed server
cleanup on ordinary completion or failure. SIGINT/SIGTERM also terminate the
owned server. No shell runner or process-name killing is used.

```sh
node wallet-journeys.mjs > out/wallet-journeys.log 2>&1
node wallet-journeys.mjs eth-4337-buy-usdt > out/wallet-journey-4337.log 2>&1
```

The simulator consists of `wallet-sim/server.mjs` and `wallet-sim/public/`.
For manual sandbox exploration only, run `node wallet-sim/server.mjs` and open
`http://127.0.0.1:4748`; stop that server before running automated journeys.

### Local full stack

Requires Docker on `PATH` and the disposable full-stack harness from
`DFXswiss/app`, directory `e2e-stack/`, already running with its initialized
PostgreSQL database. Follow that checkout's harness setup instructions. Default
API/frontend ports are 3020/3021. The probe neither builds nor starts the stack.

Build the frontend separately with
`REACT_APP_API_URL=http://localhost:3020` and serve that build on port 3021.
The frontend API URL is embedded at build time: redirecting the widget URL to
localhost does not change the backend used by an already-built frontend. A build
pointing at sandbox/production would send browser requests there rather than to
the local fixtures. When overriding `DFX_LOCAL_API`, rebuild the frontend with
the same API origin.

```sh
node fullstack.mjs > out/fullstack.log 2>&1
# Explicit defaults; endpoints must be origins, without path prefixes:
DFX_LOCAL_API=http://localhost:3020 \
DFX_LOCAL_APP=http://localhost:3021 \
DFX_LOCAL_DB_CONTAINER=dfx-e2e-wdk2-db-1 \
node fullstack.mjs > out/fullstack.log 2>&1
```

The DB container must provide `psql`, database `dfx`, user `sa`, and the harness
schema/fixtures. Deposit seeding reads `EVM_DEPOSIT_SEED` from the API container
unless `E2E_EVM_DEPOSIT_SEED` is already set in the environment. Never print that
seed. `DFX_LOCAL_API_CONTAINER` can override the API container; by default its
name is derived from the DB container by replacing the `-db-1` suffix with
`-api-1` (default `dfx-e2e-wdk2-api-1`).

This probe writes local fixture data: random users, an admin with staff clearance,
KYC data, price-rule updates, deposit addresses, bank transactions and simulated
transaction states. These remain in the disposable database for inspection.
Buy assignment uses the backend admin endpoint; sell assignment is an explicit
SQL fixture and does **not** prove automatic backend sell matching. No real bank
transfer, blockchain deposit or payout is tested. Use only a disposable harness
with the expected local `[loc]_` signing challenge.

Results update atomically at `out/fullstack/results.json`; screenshots are under
`out/fullstack/shots/`. Inspect per-step evidence and rendered screenshots.
