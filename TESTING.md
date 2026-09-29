# Testing

This document records how `@dfx.swiss/wdk-protocol-fiat-dfx` was verified, what each test layer proves, and what it
does not prove. Every result below was produced by running the named command. Nothing is inferred from reading code
unless it says so.

- **Which code each result belongs to.** Results belong to the explicitly named revisions:
  - **The last commit that changes this sentence (2026-09-29):** lint, unit, integration, coverage and mutation layers —
    the first four rows of the summary table. It includes three small library fixes made after `27dd624`: a cached
    signing owner is dropped when sign-in fails; an empty asset description is treated like a missing one; the check of
    `recipient`/`refundAddress` before sign-in only runs when the sign-in address is the account address itself
    (non-EVM or EOA), so a stale cached owner of an ERC-4337 account cannot block its own renewal.
  - **Library code `ec9b788` (2026-09-28):** the e2e probes of section 11 and the remaining rows of the summary table.
    They consumed a packed copy of the module whose `src/` and `index.js` were compared byte for byte with the
    repository before the run. The three fixes above are not exercised by those probes and were not re-run there.
  - **Earlier code `0be1b6d`:** the real purchase with real money (section 9, 2026-09-28 morning). It was not repeated
    after the review changes of rounds 13–16 (sign-in cache after success, early address check, removal of type guards),
    because repeating it needs new money.
- **First runs:** 2026-09-24 (sections 1–5) and 2026-09-25 (sections 6–8) against `0be1b6d`; the numbers in this document
  are those of the 2026-09-28 re-run unless a section says otherwise.
- **Runtime:** Node.js `v22.22.0` (official binary, version printed in every run), macOS arm64; Bare for the Bare entry point.
- **WDK packages used by `tests/integration`:** root-lockfile versions `@tetherto/wdk-wallet` 1.0.0-beta.19
  and `@tetherto/wdk-wallet-evm` 1.0.0-beta.19.
- **WDK packages used by the recorded `e2e/` runs:** `@tetherto/wdk` 1.0.0-beta.18,
  `@tetherto/wdk-wallet` 1.0.0-beta.20, `@tetherto/wdk-wallet-evm` 1.0.0-beta.19,
  `@tetherto/wdk-wallet-evm-erc-4337` 1.0.0-beta.20,
  `@tetherto/wdk-wallet-tron` 1.0.0-beta.14, `@tetherto/wdk-wallet-solana` 1.0.0-beta.16,
  `@tetherto/wdk-wallet-btc` 1.0.0-beta.16, `@tetherto/wdk-wallet-spark` 1.0.0-beta.27.
- **DFX environments:** sandbox `dev.api.dfx.swiss` / `dev.app.dfx.swiss`, production `api.dfx.swiss` / `app.dfx.swiss`,
  and a local full stack (real DFX API and real Postgres, external providers mocked) built from `DFXswiss/backend`
  `63cb9d569` and `DFXswiss/app` `1321f956`.

## Summary

| Layer | Command | Result |
| --- | --- | --- |
| Integration, local | `npm run test:integration` | 32/32 tests in 1 suite against a local DFX server replaying recorded sandbox responses; no network |
| Unit tests | `npm run lint && npm test` | lint output empty; 697/697 tests in 1 suite |
| Coverage (unit + integration) | `npm run test:coverage` | 729/729 tests in 2 suites; 100 % statements, branches, functions, lines |
| Mutation probes | ad-hoc script (see [Mutation probes](#mutation-probes)) | 46/46 mutations detected across unit and integration suites, each by 1–609 tests |
| Signature normalisation vs. reference libraries | `cd e2e && node signature-diff.mjs` | 0 mismatches in 20 000 Solana and 5 000 Spark signatures |
| Live matrix, sandbox | `cd e2e && DFX_ENV=sandbox node live-matrix.mjs` | 172/178 steps; the 6 failures are expected (see below) |
| Live matrix, production | `cd e2e && DFX_ENV=production node live-matrix.mjs` | 175/179 steps; the 4 failures are a DFX data issue (see below) |
| Widget as the user sees it | `cd e2e && node widget-check.mjs` | the widget opens signed in, amount/asset/network prefilled, in sandbox and production |
| Wallet user journeys | `cd e2e && node wallet-journeys.mjs` | 7/7 journeys, 0 page errors |
| After the widget (local full stack) | `cd e2e && node fullstack.mjs` | 29/29 steps |
| Chains without a WDK wallet | `cd e2e && node native-quotes.mjs` | Lightning, Arkade, Firo listed and quoted in sandbox and production |
| Backend processing, first look | `cd e2e && node fullstack-processing.mjs` | the sell deposit is matched by the real `BuyFiat` job; a +10 % counter-test is not matched |
| Transaction lifecycle, real backend jobs | `cd e2e && node fullstack-lifecycle.mjs` | buy and sell reach an automatic AML `Pass`; rejection and refund reach `Returned`; the module status matches every DFX state observed |
| KYC in the widget | `cd e2e && node kyc-widget.mjs` | e-mail code → level 10 → personal data → level 20 → nationality → stops at the Sumsub identification call |
| Deployed ERC-4337 account | `cd e2e && node safe-deployed.mjs` | 13/13 steps: the smart account is deployed on a Polygon fork, its signature is identical before and after, `buy`/`sell` work in the sandbox |
| Reviews | independent code review; Tether's `wdk-review-jsdocs`, `wdk-review-dts`, `wdk-review-tests` | see [section 10](#10-reviews-2026-09-28): all findings fixed or named; second test-skill pass applied |

See [`e2e/README.md`](e2e/README.md) for prerequisites and side effects before running anything under `e2e/`.

## 1. Unit tests

`npm run lint && npm test` (Node 22.22.0): `standard` prints nothing; Jest runs the unit suite, 697 tests, all passing;
`npm run test:coverage` adds the integration suite (729 tests together) and reaches 100 % coverage in all four categories. The
session and signer-cache cases need several public calls and live in the integration suites (skill rule R3). All
unit tests use an injected `fetch` routed by method and URL and cover
both trade directions, both amount modes, lossless 18-decimal arithmetic, every HTTP-status mapping, every DFX
transaction state, the account-error allowlist per method, signature normalisation (Solana, Spark), EIP-191 owner
recovery for ERC-4337 accounts with real secp256k1 keys, and the native-decimals fallback.

### Mutation probes

A passing suite only matters if it fails on wrong code. Each mutation below was applied to the source (asserting the
pattern matched exactly once), the unit and integration suites were run in band, and the source was restored. All 46 were detected. For one of them (an error class no longer re-exported) the integration suites fail to load, so only the dedicated export test is real evidence there. (Commit `75877e6` stated 43; the correct count at that commit was 42. One mutation, `options.config` not validated, no longer applies since the type guard was removed under C005.)

Examples: sell rate not inverted; sell fee taken from the source side; a failed DFX state mapped to `in_progress`;
`PayoutInProgress` mapped to `completed`; network binding not enforced; `isValid: false` not checked first; EVM
address compared case-sensitively; always `amount-in`; account-error allowlist via `instanceof`; `fetch` called with the
wrong receiver; `blockchain` omitted at sign-in; lossy JSON numbers; external-ID character set opened; Solana signature
not Base58-encoded; leading zero bytes dropped in Base58; Spark DER kept; DER scalars not left-padded; ERC-4337 owner
not used for sign-in; signer cache disabled; wrong EIP-191 prefix; native decimals fallback removed or given priority
over API decimals; signer cached before a successful sign-in; early address check disabled; an uncached EVM account
treated as known; EIP-191 length counted in UTF-16 units instead of bytes; `null` asset description passed through;
an error class no longer re-exported.

EIP-191 recovery is additionally pinned to a reference value produced by ethers `Wallet.signMessage` (private key 2,
UTF-8 message with multi-byte characters), so a mistake shared by the module and the test helper cannot stay green.

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

## 6. Real backend processing (2026-09-25)

For these runs the local API was restarted with selected background jobs **enabled** (list in
[`e2e/README.md`](e2e/README.md)). Everything that talks to the outside world (blockchain scanning and payout, bank
transmission, pricing and liquidity) stayed off. Only external events are simulated:
- an incoming bank transfer (a `bank_tx` row with `senderAccount`, as the bank import writes it);
- a blockchain confirmation of a crypto deposit;
- a completed identification (KYC level 50, `verifiedName`, current `lastNameCheckDate`);
- the bank's execution of a refund.

Everything else is done by the backend or through the real admin endpoints that DFX operations use.

**Sell matching through the backend** (`fullstack-processing.mjs`). A crypto deposit is written as the blockchain scan
would write it. The `BuyFiat` job then registers it about 60 s later, creates the sale, and sets our
`externalTransactionId` on the transaction through `findAndComplete`. The module returns `in_progress`. A second
deposit 10 % above the quoted amount is assigned to the route but not to the request, and the module returns
`NoSuchElementError` for that ID.

**Lifecycle** (`fullstack-lifecycle.mjs`, `OBSERVE_MINUTES=15`). DFX state as returned by the API against the module's
status, at each observed change:

| Scenario | Event | DFX state | Module |
| --- | --- | --- | --- |
| Buy A | bank transfer assigned by admin | `Created` → `Processing` → `CheckPending` | `in_progress` |
| Buy A | bank data verified by the backend job, phone check recorded, `reviewReset` | `Created` → `LiquidityPending` (AML `Pass`, automatic) | `in_progress` |
| Buy B (separate user) | bank transfer assigned by admin | `CheckPending` | `in_progress` |
| Buy B | compliance rejects via `PUT /v1/buyCrypto/:id/amlCheck` | `Failed` | `failed` |
| Buy B | refund approved with creditor data | `ReturnPending` | `in_progress` |
| Buy B | refund executed by the bank (simulated) | `Returned` | `failed` |
| Sell | deposit registered by the backend, blockchain confirmation | `Created` → `Processing` (AML `Pass`, automatic) | `in_progress` |

Both buy and sell reach an automatic AML `Pass`. After that the backend waits for liquidity (buy, `LiquidityPending`) or
for a fiat output (sell, `Processing`). Both need the pricing and liquidity jobs, which talk to real exchanges and stay
off, so `completed` through the real pipeline is not reached. The `completed` mapping is covered by section 4, where
the completion fields are set directly.

Wallet-visible note: during a refund the status goes `failed` → `in_progress` → `failed`, because `ReturnPending` counts
as in progress (build spec, decision E7).

The runs surfaced these DFX rules. They had to be satisfied the way operations satisfies them, and none of them is a
module issue:
- **An IBAN may be active on only one account**, so each scenario uses its own valid IBAN.
- **An IP country differing from the residence country** requires a recorded phone check (`ManualCheckIpCountryPhone`).
- **Sender bank data** is created by the backend from `bank_tx.senderAccount` (type `BankIn`), then verified by the
  `BankDataVerification` job. `PUT /v1/bankData/:id` without `status` puts non-`User` bank data back into
  `InternalReview`, which the AML job skips silently.
- **An AML verdict, once written, is locked.** Compliance decisions go through `PUT /v1/buyCrypto/:id/amlCheck`.

Two backend robustness findings (DFX backend, not this module):
- `UserRepository.getNextRef` (`user.repository.ts:67-75`) throws `Cannot read properties of null (reading 'ref')` when no
  user has a numeric referral code yet. On a fresh database this breaks both the AML check and `PUT /v1/userData/:id` for
  users at KYC level 50. The test seeds one code, as every real database has.
- `NameCheckService.classifyRiskData` throws `Cannot read properties of undefined (reading 'every')` on an empty
  name-check provider response.

## 7. KYC in the widget

`kyc-widget.mjs` signs in a fresh wallet through the module, opens the buy widget, taps *Complete KYC*, and completes
the DFX screens in the UI: e-mail with the confirmation code from the harness mail fixture (level 10), then personal
data (level 20), then nationality. With the KYC jobs enabled, the next step is identification. There the backend calls
Sumsub (`KycService.initiateStep` → `SumsubService.initiateIdent` → `createApplicant`), which is unreachable locally,
and answers `PUT /v2/kyc` with 503. The same account then still quotes and opens the widget through the module at
level 20.

Wallet-visible note: on that 503 the widget loops on its *Continue* spinner instead of showing an error. This is DFX
app behaviour.

## 8. Deployed ERC-4337 account

`safe-deployed.mjs` forks Polygon with `anvil`. It deploys the WDK smart account there without a bundler, using the
package's own factory data; `eth_getCode` is empty before deployment and non-empty after. The account's signature over
a fixed message is byte-for-byte identical before and after deployment, and it recovers to the owner. Against the DFX
sandbox, `quoteBuy`, `buy()` and `sell()` work with the deployed account, and both sessions belong to the owner address
(`activeAddress` in `/v2/user` and the JWT `address` claim). A smart-account `recipient` is rejected. 13/13 steps.

## 9. Real purchase with real money (production, 2026-09-28)

A real buy was made from the wallet simulator running against **production**
(`WALLET_SIM_ENV=production`, see [`e2e/README.md`](e2e/README.md)). The simulator loaded a wallet prepared by
`e2e/real-purchase.mjs`: a fresh seed, stored `0600` on the test machine and never printed.

The user flow in the wallet: *Kaufen* → ETH on Arbitrum, 20.00 EUR → *Weiter zu DFX*. The DFX widget opened in the
wallet's in-app browser, already signed in. The e-mail link then linked the new address to an existing verified DFX
account, and the SEPA transfer was made by hand. The order was placed for **ETH**; USDC had been planned.

Recorded from the wallet's side by polling the module (`getTransactionDetail` by `externalTransactionId`) and the
on-chain balance every 60 s:

| Time (UTC) | Order status via the module | Arbitrum balance |
| --- | --- | --- |
| 08:08:00 | order created (`wallet-1790582879930-f2fca7e950a9`) | 0 ETH |
| 08:09:15 | `NoSuchElementError` (no DFX transaction yet) | 0 ETH |
| 08:42:31 | `in_progress` | 0 ETH |
| 08:43:32 | `completed` | **0.00717295 ETH** |

- **Wallet:** `0x463e558CC8842078CD1FeC6dF1Ff7F54058BE6C7`. Its derivation path `m/44'/60'/0'/0/0` gives the same
  address in MetaMask (checked by deriving it with `ethers`).
- **Payout:** [`0x081eb861f4f9d2d34f29b2f1bf3595c415ce3603f9be734cb576c7bd9dca5902`](https://arbiscan.io/tx/0x081eb861f4f9d2d34f29b2f1bf3595c415ce3603f9be734cb576c7bd9dca5902),
  08:42:37 UTC, 0.00717295 ETH from `0xFAEefD557ffD2714f16e1A44A165FCd5d6a6b6a0`, status ok (Blockscout).
- **Second order:** an earlier order from the same wallet (08:05:56) received no payment and correctly stays without
  a transaction (`NoSuchElementError`).
- **Screenshots:** the wallet's order list and portfolio after completion are in
  [`e2e/evidence/`](e2e/evidence/).

This is the first run in which every step between wallet and payout was real: sign-in, widget, account linking,
bank transfer, DFX processing, on-chain payout and status reporting through the module.

## 10. Reviews (2026-09-28)

**Independent code review** of the native-decimals fallback and the ERC-4337 owner sign-in. Two defects were
confirmed and fixed:

- The recovered owner was cached before the sign-in succeeded. A signature that recovers to an unrelated address
  (for example an ERC-1271 format) left the instance unable to sign in. The owner is now cached only after DFX returns
  an access token.
- On Tron, Solana, Bitcoin and cached EVM accounts, a mismatching `recipient`/`refundAddress` was rejected only after
  a signature and a sign-in request, which creates a DFX user. It is now rejected before either.

Documented instead of changed: purchases for ERC-4337 accounts go to the owner EOA, which usually has no gas and is
not shown in wallet apps (as in DFX's own wallet); `getTransactionDetail` for ERC-4337 accounts needs the constructor
`network`; ERC-1271 signature formats are not supported. Not changed: two parallel first sign-ins on one instance
request two signatures each.

**Tether's review skills** (`tetherto/wdk-agent-skills` at `219077f`):

- `wdk-review-jsdocs`: 33 findings under 9 of 35 rules (R8, R9, R17, R23, R25, R26, R28, R31, R32). All fixed:
  parent descriptions kept, one `@throws` per condition, named typedefs instead of inline objects, `quoteBuy`/`quoteSell`
  typed without `recipient`/`refundAddress` as in the parent, `null` description returned as `undefined`.
- `wdk-review-dts`: 2 findings (TD1/TD9 text drift between JSDoc and `.d.ts`; TD4 error classes not re-exported). Both
  fixed; the error classes, `ProviderErrorReason` and the account types are now exported from this module. The
  declarations were type-checked with `tsc --strict` together with a consumer file, including a check that
  `recipient` is rejected in quote options.
- `wdk-review-tests`, first pass: 7 of 11 rules reported (R1–R6, R11) plus conventions. Applied together with the code
  of conduct's C005 (no runtime type guards on typed parameters): 15 type-only checks and the 131 test cases for
  type-excluded inputs were removed; value rules, documented `@throws` conditions and all validation of DFX responses
  remain. The suite was rebuilt: tests only through the public API (signature cases now via the exact `POST /v1/auth`
  body), dummy account classes, every request and signing call asserted as fixed values inside each test, complete
  return objects, exact error class, message and reason, one act per test.
- `wdk-review-tests`, second pass on the rebuilt suite: 3 of 11 rules still reported (R1, R3, R11) plus hook
  assertions (T001), naming and the integration environment. All fixed.
- Integration tests (`npm run test:integration`, `tests/integration/`): at introduction 12/12 (now 32/32, see section
  11 and the summary) against a local DFX server started
  from Jest's global setup. It replays sandbox responses recorded on 2026-09-28 (`tests/integration/record.js`,
  fixtures without tokens, seeds or test addresses) and verifies EIP-191 signatures at `POST /v1/auth` like DFX.
  Expected values are fixed literals computed independently from the recorded responses. Checks: 12/12 with all
  outbound network access denied by a macOS sandbox profile (a control fetch in the same profile is blocked);
  turning off the fake's signature check makes the wrong-key test fail; module mutations M02 and M12 fail 2 and 5 of
  the 12. No environment variable is needed; a fresh WDK EVM account is generated per test. Before this change the
  three authenticated tests were skipped unless an account module was supplied, so they never ran in the gate.
- Live coverage moved entirely to `e2e/live-matrix.mjs`; rerun on 2026-09-28 with `ec9b788` against the
  sandbox: 172/178, the same six expected failures as in section 2.
- Test files are excluded from `npm run lint` by the Tether scaffold (`standard.ignore`). They were linted
  separately with the `standard` rules and ignore disabled; output empty.
- Third pass of all three skills on `ec9b788`:
  - `wdk-review-jsdocs`: 7 of 39 rules reported (missing typedef descriptions, tautologies, one text for three
    constructor overloads, implementation prose, missing `@throws` for passed-through account errors).
  - `wdk-review-dts`: 2 of 9 (declaration order changed without need; `FiatProtocol`, `BuyErrorReason` and
    `SellErrorReason` not re-exported).
  - `wdk-review-tests`: 4 of 11 (expected values rebuilding module logic, tests calling several methods, duplicates, a
    random seed in integration tests).

  All fixed in `c9b2c90`. The session and signer-cache scenarios moved to `tests/integration/module.test.js`
  (real WDK signatures, fixed public test phrase from the skill, server state reset per test). The full catalogs are
  compared against `tests/integration/fixtures/expected-catalog.json`, computed independently in Python from the
  recorded responses.
- Fourth pass of all three skills on `8c3f53e`: `wdk-review-dts` 0 violations (6 of 9 rules met, 3 not applicable),
  `wdk-review-jsdocs` 0 violations (30 of 39 met, 9 not applicable), `wdk-review-tests` 7 small violations (subsumed
  assertions, arrange after act, constant scope, `DUMMY_` naming, one `describe` name, one integration file and one
  file per method). All fixed in the following commit; the session scenarios now live in
  `tests/integration/module.test.js`. No fifth pass has been run.

## 11. E2E re-run against `ec9b788` (2026-09-28)

Every probe under `e2e/` that needs no new money was run again against library code `ec9b788` (module copy compared
byte for byte with `src/` before the run):

| Probe | Result |
| --- | --- |
| `signature-diff.mjs` | 0 mismatches (20 000 Solana, 5 000 Spark) |
| `native-quotes.mjs`, sandbox and production | Lightning, Arkade and Firo listed and quoted; one expected `AmountTooLow` for the 0.01 FIRO sell |
| `live-matrix.mjs`, sandbox | 172/178, the same six expected failures as in section 2 |
| `live-matrix.mjs`, production | 175/179, the same four failures (Sepolia USDT, DFX data) as in section 2 |
| `widget-check.mjs`, sandbox and production | widget opens signed in with amount, asset and network prefilled |
| `wallet-journeys.mjs` | 7/7 journeys |
| `fullstack.mjs` | first run: the local backend answered "No valid price found for CHF → ETH" for the first buy (local price feed, not the module; sign-in and widget URL were green, and a later buy in the same run got payment details); second run: 29/29 |
| `fullstack-processing.mjs` | sell matching by the real `BuyFiat` job and the +10 % counter-test as in section 6; the two "observe processing for six minutes" steps stay red, because this first probe does not perform the operating steps (bank data approval, IP phone check) that the AML decision needs. Whether they were also red on 2026-09-25 cannot be shown, because that log was not kept. The lifecycle probe covers the AML decision |
| `fullstack-lifecycle.mjs` (`OBSERVE_MINUTES=15`) | 60 steps OK, 0 failed; buy A reaches automatic AML `Pass`, the rejected buy B goes through `Failed` to `Returned`, the sale reaches AML `Pass`; the module status matched all seven DFX states observed (`Created`, `CheckPending`, `LiquidityPending`, `Processing` → `in_progress`; `Failed`, `Returned` → `failed`; `ReturnPending` → `in_progress`) |
| `kyc-widget.mjs` | module steps green (sign-in, level 10, level 20, nationality, then quote and widget for the same account); the API log shows the documented boundary: `PUT /v2/kyc` answers 503 after the Sumsub call fails, and the widget loops on *Continue*. The probe's own boundary check stays red because no identification step is created |
| `safe-deployed.mjs` | 13/13 |
| Real purchase (section 9) | not repeated; belongs to `0be1b6d` |

After the pull-request review (2026-09-29) the probe scripts gained safeguards: the two full-stack probes refuse
non-local targets, wallet journeys force the sandbox, `real-purchase.mjs prepare` needs `--confirm`, refuses a seed
or state file readable by others and no longer passes the session URL to a browser command line, `anvil` is taken
from `PATH`, and the lifecycle probe derives the API container from the database container. Checked: every changed
script passes `node --check`; `safe-deployed.mjs` again 13/13; `fullstack.mjs` against `https://api.dfx.swiss` stops
with "Disposable local stack only"; `real-purchase.mjs prepare` without `--confirm` shows the public quote and stops before any sign-in. The
local-stack probes were not re-run after these changes, because ports 3020/3021 were then used by another local
stack.

## Not covered

- **Identification itself (Sumsub) and the external name check.** Both are external providers. The UI flow stops at
  the identification call, and the lifecycle test simulates a completed identification. In the real purchase
  (section 9) the account was already verified.
- **Real sell.** Only a real buy was made (section 9). Selling with real crypto was not tested.
- **USDC with real money.** The real purchase was ETH. USDC is covered by quotes and widget tests only.
- **Deposit detection on a real chain.** The sale in the local tests starts from a deposit row as the blockchain scan
  would write it; the scan itself is not exercised.
- **Drift between the recorded sandbox and the live API.** The integration fixtures are a snapshot of
  2026-09-28. Changes in DFX responses after that date show up in `e2e/live-matrix.mjs`, not in `npm run
  test:integration`; re-record with `node tests/integration/record.js`.
