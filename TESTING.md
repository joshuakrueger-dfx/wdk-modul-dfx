# Testing

This document records how `@dfx.swiss/wdk-protocol-fiat-dfx` was verified, what each test layer proves, and what it
does not prove. Every result below was produced by running the named command. Nothing is inferred from reading code
unless it says so.

- **Date:** 2026-09-24
- **Module under test:** this repository, `feat/module` at commit `0be1b6d` (library code). The `e2e/` tooling was added
  on top without touching `src/`, `types/` or `tests/`.
- **Runtime:** Node.js `v22.22.0` (official binary, version printed in every run), macOS arm64; Bare for the Bare entry point.
- **WDK packages used by the integration tests:** `@tetherto/wdk` 1.0.0-beta.18, `@tetherto/wdk-wallet` 1.0.0-beta.20,
  `@tetherto/wdk-wallet-evm` 1.0.0-beta.19, `@tetherto/wdk-wallet-evm-erc-4337` 1.0.0-beta.20,
  `@tetherto/wdk-wallet-tron` 1.0.0-beta.14, `@tetherto/wdk-wallet-solana` 1.0.0-beta.16,
  `@tetherto/wdk-wallet-btc` 1.0.0-beta.16, `@tetherto/wdk-wallet-spark` 1.0.0-beta.27.
- **DFX environments:** sandbox `dev.api.dfx.swiss` / `dev.app.dfx.swiss`, production `api.dfx.swiss` / `app.dfx.swiss`,
  and a local full stack (real DFX API and real Postgres, external providers mocked) built from `DFXswiss/backend`
  `63cb9d569` and `DFXswiss/app` `1321f956`.

## Summary

| Layer | Command | Result |
| --- | --- | --- |
| Unit tests + coverage | `npm run lint && npm run test:coverage` | lint output empty; 824/824 tests; 100 % statements, branches, functions, lines |
| Mutation probes | ad-hoc script (see [Mutation probes](#mutation-probes)) | 36/36 mutations detected, each by 1–60 targeted tests |
| Signature normalisation vs. reference libraries | `cd e2e && node signature-diff.mjs` | 0 mismatches in 20 000 Solana and 5 000 Spark signatures |
| Live matrix, sandbox | `cd e2e && DFX_ENV=sandbox node live-matrix.mjs` | 172/178 steps; the 6 failures are expected (see below) |
| Live matrix, production | `cd e2e && DFX_ENV=production node live-matrix.mjs` | 175/179 steps; the 4 failures are a DFX data issue (see below) |
| Widget as the user sees it | `cd e2e && node widget-check.mjs` | the widget opens signed in, amount/asset/network prefilled, in sandbox and production |
| Wallet user journeys | `cd e2e && node wallet-journeys.mjs` | 7/7 journeys, 0 page errors |
| After the widget (local full stack) | `cd e2e && node fullstack.mjs` | 29/29 steps |
| Chains without a WDK wallet | `cd e2e && node native-quotes.mjs` | Lightning, Arkade, Firo listed and quoted in sandbox and production |

See [`e2e/README.md`](e2e/README.md) for prerequisites and side effects before running anything under `e2e/`.

## 1. Unit tests

`npm run lint && npm run test:coverage` (Node 22.22.0): `standard` prints nothing; Jest runs 2 suites, 824 tests, all
passing, at 100 % coverage in all four categories. Tests use an injected `fetch` routed by method and URL and cover
both trade directions, both amount modes, lossless 18-decimal arithmetic, every HTTP-status mapping, every DFX
transaction state, the account-error allowlist per method, signature normalisation (Solana, Spark), EIP-191 owner
recovery for ERC-4337 accounts with real secp256k1 keys, and the native-decimals fallback.

### Mutation probes

A passing suite only matters if it fails on wrong code. Each mutation below was applied to the source (asserting the
pattern matched exactly once), the unit suite was run in band, and the source was restored. All 36 were detected.

Examples: sell rate not inverted; sell fee taken from the source side; a failed DFX state mapped to `in_progress`;
`PayoutInProgress` mapped to `completed`; network binding not enforced; `isValid: false` not checked first; EVM
address compared case-sensitively; always `amount-in`; account-error allowlist via `instanceof`; `fetch` called with the
wrong receiver; `blockchain` omitted at sign-in; lossy JSON numbers; external-ID character set opened; Solana signature
not Base58-encoded; leading zero bytes dropped in Base58; Spark DER kept; DER scalars not left-padded; ERC-4337 owner
not used for sign-in; signer cache disabled; wrong EIP-191 prefix; native decimals fallback removed or given priority
over API decimals.

The probe script is a local tool and is not part of this repository.

## 2. Live matrix (sandbox and production)

`e2e/live-matrix.mjs` builds a real WDK instance from a fresh random seed for each run, registers each wallet package
and this module with `registerProtocol`, and calls the module through `account.getFiatProtocol('dfx')`, exactly as an
integrating wallet does. Per chain it checks: registration; the three catalogues; `quoteBuy` and `quoteSell`;
sign-in (via `getTransactionDetail` on an unknown ID, expecting `NoSuchElementError` after a successful sign-in);
`buy()` and `sell()` URLs; that the session in each URL is valid (`GET /v2/user` returns 200); rejection of a foreign
`recipient`; rejection of a read-only account; `externalTransactionId` in the URL; and `getTransactionDetail` by
external ID before any payment.

Chains: Ethereum, Polygon, Arbitrum, Base, Optimism, BNB Smart Chain and Sepolia (`wdk-wallet-evm`); Polygon as an
ERC-4337 smart account; Tron; Solana; Bitcoin (BIP-84); Spark.

**Sandbox: 172/178.** The 6 failures are purchases of Sepolia USDT and Spark BTC, which the sandbox lists as
`sellable` but not `buyable`. The module rejects them with `ValueError`, which is the intended behaviour.

**Production: 175/179.** Every mainnet chain signs in and produces valid widget sessions. The 4 failures are all
Sepolia. Production lists the testnet asset Sepolia/USDT as sellable, and its sell quote fails upstream with
`Base fee is missing`. This is DFX catalogue data, not module behaviour.

**ERC-4337 accounts.** They sign in with the owner address recovered from the signature, as DFX's own WDK wallet does.
The widget session belongs to the owner EOA, so DFX delivers to that address and not to the smart account. The test
confirms that a smart-account address passed as `recipient` is rejected with a message naming the owner address.

**Production side effect.** Signing in creates a DFX user per address. The production run created these throwaway
test users, none with KYC or funds:

| Account | Address |
| --- | --- |
| EVM (also the owner of the ERC-4337 account) | `0xA37b911F48F44afaA3fD4e10D7CD59b786a51e8d` |
| Tron | `TARxmnAxy9nfiCEJDwbASo9oiuuArBFegW` |
| Solana | `Eomxq9KQVUc2ERQRZ412qHEQUpjwemg1P5CBx24zdnKG` |
| Bitcoin | `bc1q7aqevm93a9urcaqqzgq7s2d5zeneknye7vu5zd` |
| Spark | `spark1pgssxuy4rn42lfmj57g4hp5sdxx4qfp8ddy4fp2044swrh8jnd6nlt6f03yxna` |

The production run used the same script before it moved into `e2e/`; it was not repeated from the repository to
avoid creating further production users.

## 3. What the user sees

`e2e/widget-check.mjs` opens the generated URLs headless. In sandbox and production the DFX app opens signed in, with no
login screen. It shows the wallet address, and the amount, asset and network are taken from the URL. DFX then
continues with its own steps: KYC (sandbox) or e-mail (production) for buying, IBAN for selling.

`e2e/wallet-journeys.mjs` drives the simulated wallet app in `e2e/wallet-sim/` (phone layout, DFX opened in an in-app
browser frame). Each journey creates a wallet, taps Buy or Sell, reads the live offer, continues to DFX and checks the
order list. All 7 passed with 0 page errors:

| Journey | Offer shown to the user | DFX window |
| --- | --- | --- |
| Ethereum, buy USDT | 100.00 EUR → ~112.02 USDT, fee 1.49 EUR | signed in, KYC step |
| Ethereum smart account, buy USDT | same | signed in with the owner address |
| Tron, buy USDT | 100.00 CHF → ~113.64 USDT, fee 6.00 CHF | signed in, KYC step |
| Solana, sell USDT | ~58.011 USDT → 50.00 EUR | signed in, IBAN step |
| Bitcoin, buy BTC | 100.00 EUR → ~0.0013324 BTC | signed in, KYC step |
| Spark, sell BTC | 0.001 BTC → ~72.46 EUR | signed in, IBAN step |
| Ethereum, 1 EUR | accepted (sandbox has no minimum) | signed in |

## 4. After the widget: KYC, payment, settlement, status

The public sandbox cannot take a fresh account through a bank purchase (`RecommendationRequired`/`KycRequired`), and
production has no test money. `e2e/fullstack.mjs` therefore runs against the local DFX full stack (`DFXswiss/app`
`e2e-stack/`, real API and Postgres). The module talks to it unchanged: its injectable `fetch` rewrites the sandbox host
to the local API.

All 29 steps passed:

1. The WDK wallet signs in through the module, and `buy()` returns a URL with `external-transaction-id`.
2. KYC level 50 and complete personal data are set in the database, as the harness factories do. This simulates a
   verified user; the KYC process itself is not exercised.
3. In the browser, the widget reaches **Payment Information**. The backend stores a `transaction_request` carrying the
   external ID.
4. An incoming bank transfer is inserted as an unassigned `bank_tx` and assigned to the buy route through the **real
   admin endpoint**. That runs the backend's own path: `createFromBankTx` → `getAndCompleteTxRequest` →
   `findAndComplete`. The backend itself links the request and writes our ID to `transaction.externalId`.
5. The module's `getTransactionDetail(id, { idType: 'externalTransactionId' })` returns `in_progress` (DFX state
   `Created`). The same transaction by DFX `uid` returns the same result.
6. With `buy_crypto` set to completed, the module returns `completed`; with a failed AML check it returns `failed`.
7. **Matching heuristic, counter-test:** a second widget session followed by a transfer 10 % above the quoted amount.
   The backend does not match it, `transaction.externalId` stays empty, and the module returns `NoSuchElementError` for
   the second ID.
8. **Sell:** the widget reaches the deposit address, and the backend stores the request with the external ID. The module
   returns `in_progress` and then `completed` with `cryptoAsset` ETH and `fiatCurrency` CHF.

## 5. Chains without a WDK wallet package

No WDK wallet package exists for Lightning, Arkade or Firo, so no WDK user can currently arrive from those chains.
`e2e/native-quotes.mjs` confirms that the module still lists them (8 decimals via the native fallback) and quotes them
in sandbox and production. A Firo sell of 0.01 FIRO is correctly rejected as `AmountTooLow` with DFX's minimum.

## Not covered

- **The KYC process itself.** The full-stack test sets the KYC level in the database; the widget's KYC screens are
  DFX's own flow and are not part of this module.
- **Automatic settlement.** Background jobs are off in the local stack. The bank transfer is assigned through the admin
  endpoint, and completion is simulated by setting the `buy_crypto`/`buy_fiat` fields. Payout to a chain is not
  exercised.
- **Sell assignment through the backend.** There is no admin endpoint that turns a crypto deposit into a sale, and pay-in
  processing needs blockchain access. The sell transaction is therefore written to the database with the external ID;
  the module's status mapping is tested, the backend's sell-side matching is not. It uses the same `findAndComplete`
  function that step 4 exercises for buying.
- **A deployed ERC-4337 account.** Only counterfactual (not yet deployed) accounts were tested live. `@tetherto/wdk-wallet-evm-erc-4337`
  signs messages via its owner account regardless of deployment (`wallet-account-evm-erc-4337.js`, `sign()`
  delegates to `this._ownerAccount.sign`), so the sign-in path is the same; this is established from code, not run.
- **Real money.** No real transaction was executed in any environment.
