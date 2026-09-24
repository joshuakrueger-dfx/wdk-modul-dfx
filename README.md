# @dfx.swiss/wdk-protocol-fiat-dfx

[![Powered by WDK](https://img.shields.io/badge/Powered%20by-WDK-26A17B)](https://wdk.tether.io)

DFX on- and off-ramping for WDK wallets. `DfxProtocol` provides indicative quotes,
authenticated DFX purchase and sale widget URLs, supported asset/currency/country
lists, and normalized transaction status. The user completes payment and any KYC
in the DFX widget; this module does not execute trades or hold funds.

## Compatibility

Implements `IFiatProtocol` by extending `FiatProtocol` from
`@tetherto/wdk-wallet`; tested against `1.0.0-beta.19`, with declared dependency range `^1.0.0-beta.19` (not a tested compatibility matrix).

ES modules. Tested on Node.js 22.22.0 (CI) and Bare. The Bare entry point
loads `bare-node-runtime/global`. HTTP uses `fetch` or an injected implementation.
The module receives a WDK account from its caller and does not depend directly on
`@tetherto/wdk` or any specific chain wallet package. Use one installed copy of
`@tetherto/wdk-wallet` throughout the wallet application.

## Install and quick start

```sh
npm install @dfx.swiss/wdk-protocol-fiat-dfx
```

This account-free example can run as an ES module in Node.js. Quotes are indicative:
they do not authenticate, reserve funds or create a transaction.

```js
import DfxProtocol from '@dfx.swiss/wdk-protocol-fiat-dfx'

const dfx = new DfxProtocol(undefined, { environment: 'sandbox' })
const assets = await dfx.getSupportedCryptoAssets()
const currencies = await dfx.getSupportedFiatCurrencies()
const countries = await dfx.getSupportedCountries()
const quote = await dfx.quoteBuy({
  cryptoAsset: 'ETH',
  fiatCurrency: 'EUR',
  fiatAmount: 10000n,
  config: { network: 'ethereum' }
})
// Display these values in the application; quote amounts are bigint base units.
export { assets, currencies, countries, quote }
```

With an existing signing WDK account bound to Ethereum:

```js
const dfx = new DfxProtocol(account, {
  environment: 'sandbox',
  network: 'ethereum',
  wallet: 'YourWalletName'
})
const { buyUrl } = await dfx.buy({
  cryptoAsset: 'ETH', fiatCurrency: 'EUR', fiatAmount: 10000n
})
const { sellUrl } = await dfx.sell({
  cryptoAsset: 'ETH', fiatCurrency: 'EUR', cryptoAmount: 50000000000000000n
})
// Open buyUrl or sellUrl in the wallet's user-facing browser.
// Supply a DFX transaction UID received from the DFX flow, not an internal ID:
const detail = await dfx.getTransactionDetail(transactionUid)
```

The source checkout also contains [examples/buy.js](examples/buy.js), which runs a
sandbox quote by default. Its account is explicitly a placeholder: substitute a
real WDK account to generate an authenticated URL. No private keys are embedded.

## Configuration

Use `new DfxProtocol(account?, config?)`. Configuration belongs to the instance;
the library never reads environment variables. `.env.example` is for the example
application and opt-in integration tests.

| Option | Default | Meaning |
| --- | --- | --- |
| `environment` | `'production'` | `'production'` or `'sandbox'`; unknown values throw `ValueError` at construction |
| `wallet` | unset | Partner identifier supplied by the integrating wallet developer; forwarded to both quotes and authentication |
| `network` | unset | Account's DFX blockchain name, compared case-insensitively; required for `buy` and `sell` |
| `publicKey` | unset | Public key sent as `key` during authentication (e.g. Arweave, Cardano, Internet Computer) |
| `language` | `'en'` | Widget `lang` value |
| `fetch` | `globalThis.fetch` | Injectable HTTP implementation called with `globalThis` as receiver; absence fails on the first request, not construction |
| `timeout` | `30000` | Finite number greater than zero and at most `2147483647`; request deadline in milliseconds, implemented with `AbortController` |

Configuration must be an object. When supplied, `network`, `wallet`, `publicKey`
and `language` must be non-empty strings (whitespace-only strings are rejected).
Invalid configuration throws `ValueError` in the constructor. All four trading
methods reject missing, null or non-object options with `ValueError`.
When supplied, `options.config` must be a non-null object and its `network` must
be a non-empty string; invalid values throw `ValueError`.

Production uses `https://api.dfx.swiss` and `https://app.dfx.swiss`.
Sandbox uses `https://dev.api.dfx.swiss` and `https://dev.app.dfx.swiss`.
The supplied fetch implementation must support abort signals, including response
body reads.

`options.config.network` selects the network for a trade. Quotes use it in
preference to the constructor network. For widget URLs it must equal the
constructor network case-insensitively; the caller is responsible for binding the actual account to
that network. Authentication forwards its matching PascalCase DFX blockchain
enum value; an unknown network has no `blockchain` auth field. The module never
reads account key material. `getAddress()` and `sign(message)` are the account
operations used.

## Methods and units

| Method | Result | Account |
| --- | --- | --- |
| `getSupportedCryptoAssets()` | `{ code, networkCode, decimals, name? }[]` | None |
| `getSupportedFiatCurrencies()` | `{ code, decimals }[]` | None |
| `getSupportedCountries()` | `{ code, name, isBuyAllowed, isSellAllowed }[]` | None |
| `quoteBuy(options)` | `FiatQuote` | None |
| `quoteSell(options)` | `FiatQuote` | None |
| `buy(options)` | `{ buyUrl }` | Signing account |
| `sell(options)` | `{ sellUrl }` | Signing account |
| `getTransactionDetail(txId)` | `{ cryptoAsset, fiatCurrency, status }` | Authenticated session; signing account to obtain or renew it |

Both trade directions take `cryptoAsset`, `fiatCurrency`, and **exactly one** of
`cryptoAmount` and `fiatAmount`. Inputs accept positive `bigint` or positive safe
integer `number` values in the smallest unit. Fractions, zero, negative numbers,
unsafe integers, NaN and infinity are rejected. For EUR/CHF, `10000n` is 100.00;
for an 18-decimal asset, `50000000000000000n` is 0.05.

| Direction | Specified amount | Quote request | Widget query |
| --- | --- | --- | --- |
| Buy | Fiat | `amount` | `amount-in` |
| Buy | Crypto | `targetAmount` | `amount-out` |
| Sell | Crypto | `amount` | `amount-in` |
| Sell | Fiat | `targetAmount` | `amount-out` |

Responses are read as text and JSON numeric literals are preserved as strings
before decimal arithmetic. `cryptoAmount`, `fiatAmount`, and `fee` in a quote are
`bigint` in smallest units. Fractional smallest units in provider responses are
rejected, never rounded. Requests use exact decimal literals; an amount whose
normalized decimal representation changes through `Number` is rejected.
This restriction also applies to widget amounts.

`fee` is **fiat**, from `fees.total` on buys and `feesTarget.total` on sells, scaled
to the smallest fiat unit. It includes the provider's reported aggregate fee;
`feeAmount` and `exchangeRate` are not used. `rate` is the effective **fiat per
crypto** rate including fees, calculated from the unrounded decimal strings of
the response amounts in display units: buy `amount / estimatedAmount`, sell
`estimatedAmount / amount`. It is rounded once, half up to 18 significant digits,
and returned as a string without an exponent. For example, buying 114.32 USDT for
100 CHF gives `"0.874737578726382085"`. DFX's already rounded `rate` field is ignored.
Nonpositive response amounts cause `ProviderError(INTERNAL_SERVER_ERROR)`.
`isValid` is checked before inspecting amounts or calculating the rate.

`buy` and `sell` do not request a quote or check provider amount limits. They
validate inputs, resolve the pair for the direction, authenticate freshly and
build the widget URL. A prior quote can surface limits before opening the widget;
only confirmation in the widget is binding. `recipient` and `refundAddress`
default to the account address. If both addresses match `0x` followed by exactly
40 hexadecimal digits, comparison ignores letter case to accept EVM checksum
spelling. All other addresses must match exactly.

## Networks, currencies and countries

The authoritative supported list comes live from the DFX API; it is not a static
chain allowlist. Crypto `code` is the asset's ticker (`name`), not `uniqueName`.
Input tickers and fiat currency names are compared case-insensitively (`USDt`
matches `USDT`). Quote bodies and widget URLs preserve the resolved DFX spelling.
`networkCode = blockchain.toLowerCase()`. The widget uses the original
blockchain value. This covers DFX networks with complete asset
metadata, not only EVM chains.

A ticker can occur on multiple networks. Without a network, ambiguous tickers
throw `ValueError` listing the candidate networks. Lists include assets and
currencies that are buyable **or** sellable. Each trading method additionally
requires availability in its own direction. Fiat minor units come from the
module's ISO 4217 table, keyed by exact uppercase catalog names; currencies without
an exact table entry are excluded from lists and trade selection.
Rows with neither `buyable === true` nor `sellable === true` are discarded before
validation. Tradable rows remain strictly validated; malformed metadata is a
provider error rather than a silently omitted trading asset.
For case-insensitive asset collisions on the same network,
a unique exact spelling wins; otherwise the trade fails with `ValueError`.
Multiple matching fiat catalog rows fail with `ValueError`, including duplicate
rows with the same uppercase ISO name.

Country availability uses `bankAllowed` for **both** directions. Treating this
nondirectional flag as buy and sell availability is an assumption; `cardAllowed`
and the IP-related `locationAllowed` are not substituted. The module has no country
selection argument; provider geography restrictions can still reject a request.

## Transaction states and timing

`txId` is always passed as DFX `uid`, even if it looks numeric. Asset and fiat IDs
resolve against their respective unfiltered catalogs, including inactive entries;
only matched rows are strictly validated. Unambiguous catalog names are a
fallback; contradictory or unresolved metadata fails explicitly. Swap and Referral
transactions are outside this fiat interface.

| DFX state | WDK status |
| --- | --- |
| `Completed` | `completed` |
| `Failed`, `Returned`, `Stopped`, `LimitExceeded`, `FeeTooHigh`, `PriceUndeterminable` | `failed` |
| `Created`, `Processing`, `LiquidityPending`, `CheckPending`, `KycRequired`, `PayoutInProgress`, `WaitingForPayment`, `Unassigned`, `ReturnPending` | `in_progress` |
| Any unknown state | `in_progress` |

DFX's flow uses a bank transfer and payment reference. A transaction can remain
`in_progress` while awaiting the incoming payment; completion time is not guaranteed.

A session token is kept only in private instance memory. Transaction details reuse
it and renew it once after HTTP 401 when a signing account is available. A second
401 is returned as `ProviderError` with `UNAUTHORIZED`. Widget calls always obtain
a fresh token. Supported lists and quotes need no signature; details do.

## Errors

Error classes are the WDK classes from `@tetherto/wdk-wallet/protocols`;
`ProviderErrorReason` comes from `@tetherto/wdk-wallet`.

| Class | Use |
| --- | --- |
| `ValueError` | Invalid configuration, pair, network, amount, address override or UID; input-related quote errors |
| `AccountRequiredError` | `buy`/`sell` without a signing account |
| `NoSuchElementError` | Transaction detail 404, or a Swap/Referral transaction |
| `ProviderError` | HTTP, transport, timeout, authentication and malformed response failures |
| `ProviderRequiredError` | Not generated by this module: direct API access has no provider callback; may pass through from an account where the method contract permits it |
| `MaximumFeeExceededError` | Not generated: no max-fee option; may pass through from an account on `buy`/`sell` |
| `ReadOnlyAccountRequiredError` | Not generated: quotes are public; account-thrown instances are wrapped, including on widget calls |
| `BuyError` | Not generated: its only reason is `INSUFFICIENT_FUNDS`, which URL generation cannot determine; may pass through from an account on `buy` |
| `SellError` | Not generated for the same reason; may pass through from an account on `sell` |

Only account errors whose `constructor` exactly equals a listed class pass through:

| Method | Exact account error constructors passed through |
| --- | --- |
| `buy` | `AccountRequiredError`, `ValueError`, `ProviderRequiredError`, `ProviderError`, `BuyError`, `MaximumFeeExceededError` |
| `sell` | `AccountRequiredError`, `ValueError`, `ProviderRequiredError`, `ProviderError`, `SellError`, `MaximumFeeExceededError` |
| `getTransactionDetail` | `ProviderRequiredError`, `ProviderError` |

Subclasses are not implicitly allowed. In particular, account-thrown `ValueError`
and `NoSuchElementError` on transaction details are wrapped, so they cannot be
misread as an invalid UID or missing order.
Other failures thrown by `getAddress()` or `sign()` become
`ProviderError(UNAUTHORIZED)` with the original error as `cause`.

| HTTP / failure | Mapping |
| --- | --- |
| Detail endpoint 404 | `NoSuchElementError` |
| Quote or detail 400 / 422 attributable to caller input | `ValueError` |
| Supported-list, authentication, or unattributable 400 / 422 | `ProviderError(INTERNAL_SERVER_ERROR)` |
| 401 | `ProviderError(UNAUTHORIZED)` |
| 403, including authentication geo-filter | `ProviderError(FORBIDDEN)`; provider message preserved |
| 408 or abort deadline | `ProviderError(REQUEST_TIMEOUT)` |
| 429 | `ProviderError(INTERNAL_SERVER_ERROR)` — provisional rate-limit mapping |
| 5xx, other 404, all other unsuccessful statuses | `ProviderError(INTERNAL_SERVER_ERROR)` |
| Connection or body transport failure | `ProviderError(NETWORK_ERROR)` |
| Invalid JSON or unexpected response structure | `ProviderError(INTERNAL_SERVER_ERROR)` |

HTTP 400/422 is attributed to input only for recognized input codes or explicit
validation messages naming the quote fields or transaction UID. Unknown HTTP
validation failures remain provider errors.

For `isValid: false`, the first structured error takes precedence over deprecated
`error`. `AmountTooLow`, `AmountTooHigh`, `PaymentMethodNotAllowed`,
`IbanCurrencyMismatch`, `AssetUnsupported`, and `CurrencyUnsupported` map to
`ValueError`, with the corresponding source/target limit when provided.
KYC, bank setup, account limits, unconfirmed email and other account-state errors
use `INTERNAL_SERVER_ERROR` provisionally. Missing or unknown error codes use the
same fallback.

## Known limitations

- The module excludes every asset without `decimals` from supported lists and
  rejects it in trades. At publication, the DFX API omits `decimals` for
  Bitcoin/BTC, Lightning/BTC, Arkade/BTC and Firo/FIRO; there is no crypto fallback table.
- Ambiguous tickers without a network are rejected.
- HTTP 429 and account-state failures provisionally map to `INTERNAL_SERVER_ERROR`.
- A `recipient` or `refundAddress` differing from the account address is rejected.
- Request and widget amounts are limited to decimal values that `Number` carries
  without loss.
- `networkCode` is `blockchain.toLowerCase()`; no chain aliases are translated.
- For non-EVM authentication, the module sends the signature supplied by the
  account. Whether it matches the format DFX verifies for that chain depends on
  the wallet package. For EVM accounts, tests verify that signing the DFX challenge
  produces a signature compatible with the backend's EVM verification procedure
  (`verifyMessage` under EIP-191). End-to-end login is not part of the test suite.

## Security

See [SECURITY.md](SECURITY.md) for private vulnerability reporting. No logging or
telemetry is implemented. Private keys and seeds are never read; authentication
uses the account's signing method and the exact message returned by the chosen
DFX environment (including sandbox prefixes).

Widget URLs contain a bearer session token: deliver them only to the user-facing
browser and do not log or share them. Tokens are not persisted by the module.
The integrating wallet controls signing consent, account/network binding and the
lifetime of its instance. Supply only a **public** key in `publicKey` when needed.

## Development and verification

```sh
npm install && npm run lint && npm run test:coverage
```

Tests route injected fetch calls by HTTP method and URL. Coverage thresholds are
100% statements, branches, functions and lines across `src/`, enforced as a
CI gate. Type declarations are maintained manually;
do not regenerate them with `build:types`.

Sandbox integration tests are skipped unless `DFX_INTEGRATION=1`. They use real
fetch and always target the sandbox, regardless of `DFX_ENVIRONMENT`. Public tests
cover all three catalogs and both amount modes for both quote directions:

```sh
DFX_INTEGRATION=1 npm run test:integration
```

Defaults are USDT on Ethereum and CHF, with `10000` fiat minor units and
`100000000` crypto minor units (100 CHF and 100 USDT). Override `DFX_NETWORK`,
`DFX_TEST_CRYPTO_ASSET`, `DFX_TEST_FIAT_CURRENCY`, `DFX_TEST_FIAT_AMOUNT` and
`DFX_TEST_CRYPTO_AMOUNT` together as needed for a live sandbox pair and its limits.
An optional `DFX_WALLET` is forwarded. Export these variables in the shell;
the test runner does not automatically load `.env.example`.

Authenticated tests additionally require `DFX_TEST_ACCOUNT_MODULE`, an absolute
path (or path relative to the checkout) to a local JS module with a **default
export** implementing this small interface:

```ts
interface TestAccount {
  getAddress(): Promise<string>;
  sign(message: string): Promise<string>;
}
```

Use a sandbox signing account bound to `DFX_NETWORK`; no chain wallet dependency
is required by the test suite. The local module manages its own account access.
Supply `DFX_TEST_TRANSACTION_UID` for an existing sandbox fiat transaction owned
by that account. Missing UID fails the detail test rather than silently skipping it.

```sh
DFX_INTEGRATION=1 DFX_TEST_ACCOUNT_MODULE=/absolute/path/test-account.js \
  DFX_TEST_TRANSACTION_UID=your-sandbox-uid npm run test:integration
```

Authenticated tests call `POST /v1/auth`, which permanently creates a DFX sandbox
user on the first call for an unknown address, recording the address, IP and,
if supplied, `DFX_WALLET`. Public catalog and quote tests do not write data.
Authenticated tests generate buy/sell URLs and retrieve the existing transaction;
they do not complete bank payment or KYC in the widget.
`test:coverage` explicitly excludes the integration file, even when integration
environment variables are set; the 100% gate is measured from unit tests only.

The release workflow uses `holepunchto/actions/publish` after lint and coverage
checks.

## Support and license

Use [GitHub Issues](https://github.com/DFXswiss/wdk-protocol-fiat-dfx/issues) for
integration questions and non-sensitive bug reports. Report security issues
privately using [GitHub Security Advisories](https://github.com/DFXswiss/wdk-protocol-fiat-dfx/security/advisories/new).

Apache-2.0; see [LICENSE](LICENSE). Maintained by DFX AG.
