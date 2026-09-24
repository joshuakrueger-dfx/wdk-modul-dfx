# Changelog

All notable changes to this project will be documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0-beta.1] - Unreleased

### Added

- Optional wallet-assigned `externalTransactionId` for buy/sell widget URLs and
  transaction lookup via `getTransactionDetail(id, { idType: 'externalTransactionId' })`.
- Order-tracking timing and sandbox account compatibility documentation, including
  ERC-4337 authentication and Bitcoin trading limitations.
- All eight WDK fiat methods for DFX production and sandbox environments.
- Indicative buy and sell quotes with lossless response parsing and exact base units.
- Authenticated widget URLs with account network binding and both amount modes.
- Instance-local session handling and one renewal on transaction-detail HTTP 401.
- Live catalogs, ISO fiat minor units, typed WDK errors and transaction status mapping.
- Manually maintained declarations, injected-fetch tests and 100% coverage thresholds.
- Configuration, security, compatibility and sandbox example documentation.
- Opt-in sandbox catalog and quote integration tests, plus authenticated URL/detail
  tests using a local account module; unit coverage excludes integration execution.

### Changed

- Package ownership and repository metadata now identify DFX AG.
- CI runs coverage gates; release publishing uses the Holepunch OIDC action.
- Effective fiat-per-crypto rates now divide unrounded response amounts, including
  fees, and round half up to 18 significant digits instead of using DFX's rounded rate.
- Asset/currency names and networks compare case-insensitively; outgoing requests
  retain DFX spelling. EVM address comparisons accept checksum case differences.
- Account error allowlists require exact constructors; transaction details pass
  through only ProviderRequiredError and ProviderError from account operations.
- Declare Node.js ≥ 22 and document testing on Node.js 22.22.0 (CI) and Bare, the CI coverage gate, known limitations
  and permanent sandbox user creation by authenticated integration tests.

### Fixed

- Normalize recognized Solana hex signatures to Base58 and Spark DER-hex signatures
  to compact hex for authentication, without accessing keys or adding dependencies.
- Map authentication POST HTTP 400/401 to `UNAUTHORIZED`, preserving the backend message.
- Bind injected and ambient fetch to the global receiver.
- Reject invalid configuration, timeout, string options and trade options with ValueError.
- Reject timeouts above 2147483647 ms and invalid per-operation config objects/networks.
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

- Assets without decimals and ambiguous tickers without a network are rejected.
- Amounts outside the API's conservative numeric precision boundary are rejected.
- Rate-limit and account-state error reasons are provisional pending WDK agreement.
