# Changelog

All notable changes to this project will be documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0-beta.1] - Unreleased

### Added

- All eight WDK fiat methods for DFX production and sandbox environments.
- Indicative buy and sell quotes with lossless response parsing and exact base units.
- Authenticated widget URLs with account network binding and both amount modes.
- Instance-local session handling and one renewal on transaction-detail HTTP 401.
- Live catalogs, ISO fiat minor units, typed WDK errors and transaction status mapping.
- Manually maintained declarations, injected-fetch tests and 100% coverage thresholds.
- Configuration, security, compatibility and sandbox example documentation.

### Changed

- Package ownership and repository metadata now identify DFX AG.
- CI runs coverage gates; release publishing uses the Holepunch OIDC action.

### Known limitations

- Runtime tests, coverage, lint, Bare compatibility and sandbox end-to-end flows are pending.
- Assets without decimals and ambiguous tickers without a network are rejected.
- Amounts outside the API's conservative numeric precision boundary are rejected.
- Rate-limit and account-state error reasons are provisional pending WDK agreement.
