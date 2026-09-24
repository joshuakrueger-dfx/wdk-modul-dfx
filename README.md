# @dfx.swiss/wdk-protocol-fiat-dfx

WDK module to interact with the dfx fiat provider.

## Installation

```bash
npm install @dfx.swiss/wdk-protocol-fiat-dfx
```

## Usage

```javascript
import DfxProtocol from '@dfx.swiss/wdk-protocol-fiat-dfx'

// Create fiat provider (account is optional for quotes)
const fiatProtocol = new DfxProtocol(undefined, {
  apiKey: 'your-api-key'
})

// Get supported assets
const cryptoAssets = await fiatProtocol.getSupportedCryptoAssets()
const fiatCurrencies = await fiatProtocol.getSupportedFiatCurrencies()
const countries = await fiatProtocol.getSupportedCountries()

// Get a buy quote
const buyQuote = await fiatProtocol.quoteBuy({
  cryptoAsset: 'btc',
  fiatCurrency: 'USD',
  fiatAmount: 10000n // $100.00 in cents
})

console.log('Buy quote:', buyQuote)

// Generate buy URL (with wallet account for recipient address)
const buyResult = await fiatProtocol.buy({
  cryptoAsset: 'btc',
  fiatCurrency: 'USD',
  fiatAmount: 10000n,
  recipient: '0x...' // optional, defaults to account address
})

console.log('Buy URL:', buyResult.buyUrl)
```

## API Reference

### DfxProtocol

#### Constructor

```javascript
new DfxProtocol(account?)
```

- `account` - Wallet account (optional, used for default recipient/refund addresses)

#### Methods

- `quoteBuy(options)` - Get a buy quote
- `buy(options)` - Generate buy widget URL
- `quoteSell(options)` - Get a sell quote
- `sell(options)` - Generate sell widget URL
- `getTransactionDetail(txId)` - Get transaction status
- `getSupportedCryptoAssets()` - List supported crypto assets
- `getSupportedFiatCurrencies()` - List supported fiat currencies
- `getSupportedCountries()` - List supported countries

## Development

```bash
npm install
npm test
npm run lint
```

## License

Apache-2.0
