# Changelog

All notable changes to this project will be documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0-beta.1] - Unreleased

### Added

- Re-export FiatProtocol, WDK error classes, ProviderErrorReason, BuyErrorReason,
  SellErrorReason and wallet account types;
  provide dedicated network-only quote option types.
- Optional wallet-assigned `externalTransactionId` for buy/sell widget URLs and
  transaction lookup via `getTransactionDetail(id, { idType: 'externalTransactionId' })`.
- Order-tracking timing and sandbox account compatibility documentation, including
  ERC-4337 owner delivery and native-asset decimal fallbacks.
- All eight WDK fiat methods for DFX production and sandbox environments.
- Indicative buy and sell quotes with lossless response parsing and exact base units.
- Authenticated widget URLs with account network binding and both amount modes.
- Instance-local session handling and one renewal on transaction-detail HTTP 401.
- Live catalogs, ISO fiat minor units, typed WDK errors and transaction status mapping.
- Manually maintained declarations, injected-fetch tests and 100% coverage thresholds.
- Configuration, security, compatibility and sandbox example documentation.
- Local replay integration tests for catalogs, quotes and authenticated URLs/details,
  using deterministic WDK EVM accounts without an external account module.
  The coverage gate includes both unit and integration execution.

### Changed

- Move stateful owner-cache and session scenarios to the local replay integration
  suite with real WDK EVM signatures, deterministic accounts and per-test resets.
  Compare complete catalogs with an independently supplied expectation fixture.
- Clarify DFX option and account-error documentation, mirror it in the maintained
  declarations and use explicit unit-test expectations for decimals and encoding.

- Follow C005 by trusting declared argument and account return types; retain value rules and external API response validation.
- Cache recovered EVM signers only after successful authentication; reject
  mismatched delivery addresses before signing or authentication requests only
  for non-EVM accounts and cached EOA signers matching the account address.
  Validate ERC-4337 delivery addresses after authentication so a stale owner
  cache can be cleared by a rejected login and recovered on the next call.
- Normalize null asset descriptions to undefined and align JSDoc with the
  manually maintained declarations and parent method descriptions.
- Clarify ERC-4337 owner gas, address visibility, transaction-detail network
  requirements and unsupported signing formats.
- Document heuristic payment matching, wallet waiting deadlines, unique IDs per
  widget opening and newest-transaction lookup within a reused widget session.
- Record successful sandbox authentication with WDK EVM, Tron, Solana, Spark and
  Bitcoin packages, including the completed Solana/Spark retest.
- Package ownership and repository metadata now identify DFX AG.
- CI runs coverage gates; release publishing uses the Holepunch OIDC action.
- Effective fiat-per-crypto rates now divide unrounded response amounts, including
  fees, and round half up to 18 significant digits instead of using DFX's rounded rate.
- Asset/currency names and networks compare case-insensitively; outgoing requests
  retain DFX spelling. EVM address comparisons accept checksum case differences.
- Account error allowlists require exact constructors; transaction details pass
  through only ProviderRequiredError and ProviderError from account operations.
- Declare Node.js ≥ 22 and document testing on Node.js 22.22.0 (CI) and Bare, the CI coverage gate, known limitations
  and permanent sandbox user creation by `tests/integration/record.js` and authenticated `e2e/` probes.

### Fixed

- Preserve a concurrently established session when another sign-in fails; use
  the token returned by each authentication for its transaction-detail request.
- Invalidate only the token rejected by a transaction-detail HTTP 401, including
  the single retry. Instances handle parallel calls without discarding a newer
  session; parallel first sign-ins are not coalesced and each signs independently.
- Preserve replay registrations when switching authentication faults and return
  HTTP 401 with Invalid credentials for registered addresses, or HTTP 400 with
  Invalid signature for unregistered addresses, for the unauthorized fault.
- Fail lifecycle simulations when the backend has not reached the required payout
  boundary; validate prepared seed ownership and clarify owner-only file permissions.

- Clear the session token and an account's cached EVM owner when its authentication
  POST fails or returns an invalid access token; recover the signer on the next login
  without an automatic retry, including the next transaction lookup.
- Treat empty asset descriptions like null, returning an undefined display name.
- Authenticate EVM ERC-4337 accounts using the EIP-191 signing owner, as in DFX's
  own wallet, with signature-only Noble recovery and an instance-local owner cache.
  DFX delivers purchases to the owner EOA outside the smart account; recipient and
  refund overrides must match that authentication address. Malformed signatures
  retain backend validation. Sandbox verification on 2026-09-28 against `ec9b788`
  includes the live matrix, deployed ERC-4337 (13/13) and native quotes; see TESTING.md.
- Use 8 decimals for Bitcoin/BTC, Lightning/BTC, Arkade/BTC and Firo/FIRO only when
  API decimals are null or absent, enabling their supported-list entries, quotes
  and trades while preserving API precedence and exclusion of other missing-decimal assets.
- Normalize recognized Solana hex signatures to Base58 and Spark DER-hex signatures
  to compact hex for authentication, without accessing keys or adding dependencies.
- Restrict external transaction IDs to 1–256 ASCII letters, digits, dots,
  underscores, colons and hyphens for both buy/sell URLs and detail lookup;
  invalid-ID errors identify the selected ID type.
- Map authentication POST HTTP 401 and HTTP 400 with exactly `Invalid signature`
  to `UNAUTHORIZED`; other authentication 400 responses remain internal provider
  errors with their backend message.
- Join non-empty error-message arrays with `'; '` across all endpoints when every
  element is a non-empty string after parsing, including JSON numbers parsed as
  strings. Empty strings or other element types make the entire array fall back
  to `DFX HTTP <status>`.
- Bind injected and ambient fetch to the global receiver.
- Reject non-finite or non-positive timeouts and empty or whitespace-only string options with ValueError.
- Reject timeouts above 2147483647 ms and empty or whitespace-only per-operation networks.
- Prefer a unique exact spelling for asset collisions on one network; reject
  unresolved asset ambiguity and multiple matching fiat catalog rows.
- Resolve ISO fiat minor units by exact uppercase catalog names; exclude rows
  without a table entry while matching user input case-insensitively.
- Filter inactive catalog rows before validation; resolve historical rows from
  unfiltered catalogs and validate only the matched entries.
- Accept future blockchain names as non-empty strings without whitespace, control or format characters.
- Cover ProviderError subclasses from account operations with transaction-detail wrapping tests.
- Re-export IFiatProtocol as a declaration value; maintain updated declarations by hand.
- Remove per-token suffix slicing from JSON number parsing.
- Replace BigInt-unsafe test titles and test-body loops; expand regression cases.
- Format fiat minor-unit entries individually for Standard lint.

### Known limitations

- Assets without API decimals or a native fallback, and ambiguous tickers without a network, are rejected.
- Amounts outside the API's conservative numeric precision boundary are rejected.
- Rate-limit and account-state error reasons are provisional pending WDK agreement.
