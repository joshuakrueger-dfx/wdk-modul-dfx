// Copyright 2026 DFX AG
// SPDX-License-Identifier: Apache-2.0

import {
  FiatProtocol, AccountRequiredError, BuyError, SellError, MaximumFeeExceededError,
  NoSuchElementError, ProviderError, ProviderRequiredError, ValueError
} from '@tetherto/wdk-wallet/protocols'
import { ProviderErrorReason } from '@tetherto/wdk-wallet'
import DfxClient from './dfx-client.js'
import { decimal, displayAmount, invertRate, minorUnits, positiveAmount, unexpected } from './amounts.js'
import { BLOCKCHAINS, FAILED_STATES, FIAT_DECIMALS, INPUT_ERRORS } from './constants.js'

/** @typedef {import('@tetherto/wdk-wallet').IWalletAccount} IWalletAccount */
/** @typedef {import('@tetherto/wdk-wallet').IWalletAccountReadOnly} IWalletAccountReadOnly */
/** @typedef {import('@tetherto/wdk-wallet/protocols').BuyOptions} BuyOptions */
/** @typedef {import('@tetherto/wdk-wallet/protocols').SellOptions} SellOptions */
/** @typedef {import('@tetherto/wdk-wallet/protocols').BuyResult} BuyResult */
/** @typedef {import('@tetherto/wdk-wallet/protocols').SellResult} SellResult */
/** @typedef {import('@tetherto/wdk-wallet/protocols').FiatQuote} FiatQuote */
/** @typedef {import('@tetherto/wdk-wallet/protocols').FiatTransactionDetail} FiatTransactionDetail */
/** @typedef {import('@tetherto/wdk-wallet/protocols').SupportedCryptoAsset} SupportedCryptoAsset */
/** @typedef {import('@tetherto/wdk-wallet/protocols').SupportedFiatCurrency} SupportedFiatCurrency */
/** @typedef {import('@tetherto/wdk-wallet/protocols').SupportedCountry} SupportedCountry */

/**
 * Configuration for DFX API and widget access.
 *
 * @typedef {Object} DfxProtocolConfig
 * @property {'production' | 'sandbox'} [environment] - API and app environment. Defaults to production.
 * @property {string} [wallet] - Partner identifier supplied by the integrating wallet developer. No default.
 * @property {string} [network] - Lowercase DFX blockchain name binding the account to its chain. No default.
 * @property {string} [publicKey] - Public key sent as key during authentication. No default.
 * @property {string} [language] - Widget language code. Defaults to en.
 * @property {typeof fetch} [fetch] - HTTP implementation. Defaults to globalThis.fetch.
 * @property {number} [timeout] - HTTP request deadline in milliseconds. Defaults to 30000.
 */

/**
 * Per-operation network selection.
 *
 * @typedef {Object} DfxTradeConfig
 * @property {string} [network] - Lowercase DFX blockchain name. Defaults to the constructor network.
 */

/**
 * Purchase options with an optional network selection.
 *
 * @typedef {BuyOptions & { config?: DfxTradeConfig }} DfxBuyOptions
 */

/**
 * Sale options with an optional network selection.
 *
 * @typedef {SellOptions & { config?: DfxTradeConfig }} DfxSellOptions
 */

const ACCOUNT_ERRORS = {
  buy: [AccountRequiredError, ValueError, ProviderRequiredError, ProviderError, BuyError, MaximumFeeExceededError],
  sell: [AccountRequiredError, ValueError, ProviderRequiredError, ProviderError, SellError, MaximumFeeExceededError],
  detail: [ValueError, NoSuchElementError, ProviderRequiredError, ProviderError]
}

function record (value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw unexpected()
  return value
}

function textField (value) {
  if (typeof value !== 'string' || value.length === 0) throw unexpected()
  return value
}

function hasDecimals (asset) {
  return asset.decimals !== undefined && asset.decimals !== null
}

function assetDecimals (asset) {
  const value = decimal(asset.decimals)
  if (value.lt(0) || value.gt(255) || !value.eq(value.round(0))) throw unexpected('Invalid asset decimals')
  return Number(value.toFixed())
}

function identifier (value) {
  const id = decimal(value)
  if (id.lte(0) || !id.eq(id.round(0)) || id.gt(Number.MAX_SAFE_INTEGER.toString())) {
    throw unexpected('Invalid DFX identifier')
  }
  return id.toFixed()
}

function fiatDecimals (currency) {
  return Object.hasOwn(FIAT_DECIMALS, currency.name) ? FIAT_DECIMALS[currency.name] : undefined
}

function transactionCode (rows, id, name, blockchain) {
  const byId = id == null ? undefined : rows.find(row => row.id === identifier(id))
  const matches = rows.filter(row => name != null && (row.name === name || row.uniqueName === name) &&
    (blockchain == null || row.blockchain === blockchain))
  if (byId) {
    if ((name != null && byId.name !== name && byId.uniqueName !== name) ||
      (blockchain != null && byId.blockchain !== blockchain)) throw unexpected('Conflicting transaction asset metadata')
    return byId.name
  }
  if (matches.length !== 1) throw unexpected('Unable to resolve transaction asset')
  return matches[0].name
}

/**
 * Provides DFX fiat quotes, widget URLs and transaction status.
 *
 * @extends FiatProtocol
 */
export default class DfxProtocol extends FiatProtocol {
  /** @private */
  #token

  /**
   * Creates an account-free DFX interface for quotes and supported lists.
   *
   * @overload
   * @param {undefined} [account] - Omit for public API access.
   * @param {DfxProtocolConfig} [config] - API and widget configuration.
   * @throws {ValueError} If the environment is unknown.
   */
  /**
   * Creates a DFX interface with a read-only wallet account.
   *
   * @overload
   * @param {IWalletAccountReadOnly} account - Account available to the protocol.
   * @param {DfxProtocolConfig} [config] - API and widget configuration.
   * @throws {ValueError} If the environment is unknown.
   */
  /**
   * Creates a DFX interface with a signing wallet account.
   *
   * @overload
   * @param {IWalletAccount} account - Account used to sign DFX authentication messages.
   * @param {DfxProtocolConfig} [config] - API and widget configuration.
   * @throws {ValueError} If the environment is unknown.
   */
  constructor (account, config = {}) {
    super(account)
    const environment = config.environment ?? 'production'
    if (environment !== 'production' && environment !== 'sandbox') {
      throw new ValueError('environment must be production or sandbox')
    }
    /** @private */
    this._config = { ...config, environment }
    /** @private */
    this._client = new DfxClient(this._config)
    /** @private */
    this._app = environment === 'sandbox' ? 'https://dev.app.dfx.swiss' : 'https://app.dfx.swiss'
  }

  /**
   * Generates a fresh authenticated purchase widget URL.
   *
   * @param {DfxBuyOptions} options - Purchase asset, currency and one amount in smallest units.
   * @returns {Promise<BuyResult>} The purchase widget URL.
   * @throws {AccountRequiredError} If a signing account is unavailable.
   * @throws {ValueError} If the asset or currency is unsupported for buying.
   * @throws {ValueError} If the amount is invalid or exceeds accepted precision.
   * @throws {ValueError} If the network is missing or differs from the account network.
   * @throws {ValueError} If recipient differs from the account address.
   * @throws {ProviderError} If authentication or the API request fails.
   * @throws {ProviderRequiredError} If the account requires a provider.
   * @throws {BuyError} If the account reports a purchase failure.
   * @throws {MaximumFeeExceededError} If the account reports an excessive fee.
   */
  async buy (options) {
    return { buyUrl: await this._widget('buy', options) }
  }

  /**
   * Quotes an indicative purchase without a signature or reservation.
   *
   * @param {DfxBuyOptions} options - Purchase asset, currency and one amount in smallest units.
   * @returns {Promise<FiatQuote>} Amounts and fees in smallest units; rate in fiat per crypto.
   * @throws {ValueError} If the pair, network or amount is invalid.
   * @throws {ProviderError} If the API fails or returns malformed quote data.
   */
  async quoteBuy (options) {
    return this._quote('buy', options)
  }

  /**
   * Generates a fresh authenticated sale widget URL.
   *
   * @param {DfxSellOptions} options - Sale asset, currency and one amount in smallest units.
   * @returns {Promise<SellResult>} The sale widget URL.
   * @throws {AccountRequiredError} If a signing account is unavailable.
   * @throws {ValueError} If the asset or currency is unsupported for selling.
   * @throws {ValueError} If the amount is invalid or exceeds accepted precision.
   * @throws {ValueError} If the network is missing or differs from the account network.
   * @throws {ValueError} If refundAddress differs from the account address.
   * @throws {ProviderError} If authentication or the API request fails.
   * @throws {ProviderRequiredError} If the account requires a provider.
   * @throws {SellError} If the account reports a sale failure.
   * @throws {MaximumFeeExceededError} If the account reports an excessive fee.
   */
  async sell (options) {
    return { sellUrl: await this._widget('sell', options) }
  }

  /**
   * Quotes an indicative sale without a signature or reservation.
   *
   * @param {DfxSellOptions} options - Sale asset, currency and one amount in smallest units.
   * @returns {Promise<FiatQuote>} Amounts and fees in smallest units; rate in fiat per crypto.
   * @throws {ValueError} If the pair, network or amount is invalid.
   * @throws {ProviderError} If the API fails or returns malformed quote data.
   */
  async quoteSell (options) {
    return this._quote('sell', options)
  }

  /**
   * Retrieves a fiat transaction by its DFX UID, renewing an expired session once.
   *
   * @param {string} txId - DFX transaction UID, including numeric-looking UIDs.
   * @returns {Promise<FiatTransactionDetail>} Normalized transaction status and asset codes.
   * @throws {ValueError} If the UID is empty or rejected by DFX.
   * @throws {NoSuchElementError} If the UID is absent or identifies a Swap or Referral.
   * @throws {ProviderRequiredError} If the signing account requires a provider.
   * @throws {ProviderError} If authentication fails or the response cannot be resolved.
   */
  async getTransactionDetail (txId) {
    if (typeof txId !== 'string' || txId.trim() === '') throw new ValueError('txId must be a non-empty UID')
    if (!this.#token) await this._authenticate('detail')
    const path = `/v1/transaction/detail/single?${new URLSearchParams({ uid: txId })}`
    let data
    try {
      data = await this._client._request(path, { token: this.#token, input: true, detail: true })
    } catch (error) {
      if (!(error instanceof ProviderError) || error.reason !== ProviderErrorReason.UNAUTHORIZED || !this._hasAccount()) throw error
      this.#token = undefined
      await this._authenticate('detail')
      data = await this._client._request(path, { token: this.#token, input: true, detail: true })
    }
    record(data)
    if (data.type === 'Swap' || data.type === 'Referral') throw new NoSuchElementError('Transaction is not a DFX fiat transaction')
    if (data.type !== 'Buy' && data.type !== 'Sell') throw unexpected('Unknown DFX transaction type')
    textField(data.state)
    const [assets, currencies] = await Promise.all([this._catalog('asset'), this._catalog('fiat')])
    const cryptoSide = data.type === 'Buy' ? 'output' : 'input'
    const fiatSide = data.type === 'Buy' ? 'input' : 'output'
    return {
      cryptoAsset: transactionCode(assets, data[`${cryptoSide}AssetId`], data[`${cryptoSide}Asset`], data[`${cryptoSide}Blockchain`]),
      fiatCurrency: transactionCode(currencies, data[`${fiatSide}AssetId`], data[`${fiatSide}Asset`]),
      status: data.state === 'Completed' ? 'completed' : FAILED_STATES.has(data.state) ? 'failed' : 'in_progress'
    }
  }

  /**
   * Lists assets available for buying or selling with known decimals.
   *
   * @returns {Promise<SupportedCryptoAsset[]>} Tickers, lowercase blockchain names and base-unit decimals.
   * @throws {ProviderError} If the API fails or returns malformed asset metadata.
   */
  async getSupportedCryptoAssets () {
    const assets = await this._catalog('asset')
    return assets.filter(asset => (asset.buyable || asset.sellable) && hasDecimals(asset)).map(asset => ({
      code: asset.name,
      networkCode: asset.blockchain.toLowerCase(),
      decimals: assetDecimals(asset),
      name: asset.description
    }))
  }

  /**
   * Lists fiat currencies available in either direction with known ISO minor units.
   *
   * @returns {Promise<SupportedFiatCurrency[]>} ISO currency codes and minor-unit decimals.
   * @throws {ProviderError} If the API fails or returns malformed currency metadata.
   */
  async getSupportedFiatCurrencies () {
    const currencies = await this._catalog('fiat')
    return currencies.filter(currency => (currency.buyable || currency.sellable) && fiatDecimals(currency) !== undefined)
      .map(currency => ({ code: currency.name, decimals: fiatDecimals(currency) }))
  }

  /**
   * Lists countries with bank-transfer availability for both trade directions.
   *
   * @returns {Promise<SupportedCountry[]>} Country codes, names and bank availability flags.
   * @throws {ProviderError} If the API fails or returns malformed country metadata.
   */
  async getSupportedCountries () {
    const countries = await this._client._request('/v1/country')
    if (!Array.isArray(countries)) throw unexpected()
    return countries.map(country => {
      record(country)
      if (typeof country.bankAllowed !== 'boolean') throw unexpected()
      return {
        code: textField(country.symbol),
        name: textField(country.name),
        isBuyAllowed: country.bankAllowed,
        isSellAllowed: country.bankAllowed
      }
    })
  }

  /** @private */
  _hasAccount () {
    return typeof this._account?.sign === 'function'
  }

  /** @private */
  async _accountCall (method, operation, ...args) {
    try {
      return await this._account[operation](...args)
    } catch (cause) {
      if (ACCOUNT_ERRORS[method].some(ErrorClass => cause instanceof ErrorClass)) throw cause
      throw new ProviderError('DFX account authentication failed', { reason: ProviderErrorReason.UNAUTHORIZED, cause })
    }
  }

  /** @private */
  async _authenticate (method, address) {
    if (!this._hasAccount()) throw new ProviderError('A signing account is required for transaction details', { reason: ProviderErrorReason.UNAUTHORIZED })
    const accountAddress = address ?? await this._accountCall(method, 'getAddress')
    textField(accountAddress)
    const challenge = record(await this._client._request(`/v1/auth/signMessage?${new URLSearchParams({ address: accountAddress })}`))
    const signature = await this._accountCall(method, 'sign', textField(challenge.message))
    textField(signature)
    const body = {
      address: accountAddress,
      signature,
      wallet: this._config.wallet,
      blockchain: BLOCKCHAINS.find(chain => chain.toLowerCase() === this._config.network),
      key: this._config.publicKey
    }
    const auth = record(await this._client._request('/v1/auth', { method: 'POST', body: JSON.stringify(body) }))
    this.#token = textField(auth.accessToken)
    return this.#token
  }

  /** @private */
  async _catalog (kind) {
    const rows = await this._client._request(`/v1/${kind}`)
    if (!Array.isArray(rows)) throw unexpected()
    return rows.map(row => {
      record(row)
      textField(row.name)
      if (typeof row.buyable !== 'boolean' || typeof row.sellable !== 'boolean') throw unexpected()
      if (kind === 'asset') {
        textField(row.blockchain)
        if (row.description != null) textField(row.description)
        if (hasDecimals(row)) assetDecimals(row)
      }
      return { ...row, id: identifier(row.id) }
    })
  }

  /** @private */
  async _trade (direction, options, widget = false) {
    const isFiat = options.fiatAmount !== undefined
    if (isFiat === (options.cryptoAmount !== undefined)) throw new ValueError('Exactly one of fiatAmount and cryptoAmount must be supplied')
    const amount = positiveAmount(isFiat ? options.fiatAmount : options.cryptoAmount)
    const network = options.config?.network ?? this._config.network
    if (widget) {
      if (!this._config.network) throw new ValueError('network must be configured in the constructor to bind the account to a chain')
      if (network !== this._config.network) throw new ValueError('network must match the account network configured in the constructor')
    }
    const [assets, currencies] = await Promise.all([this._catalog('asset'), this._catalog('fiat')])
    const capability = direction === 'buy' ? 'buyable' : 'sellable'
    const matches = assets.filter(asset => asset.name === options.cryptoAsset && asset[capability] &&
      (network === undefined || asset.blockchain.toLowerCase() === network))
    if (!matches.length) throw new ValueError(`Unsupported ${direction} asset or network: ${options.cryptoAsset}`)
    if (matches.length > 1) throw new ValueError(`Ambiguous asset ${options.cryptoAsset}; configure network: ${matches.map(asset => asset.blockchain.toLowerCase()).join(', ')}`)
    const asset = matches[0]
    if (!hasDecimals(asset)) throw new ValueError(`Missing decimals for ${asset.blockchain}/${asset.name}`)
    const currency = currencies.find(currency => currency.name === options.fiatCurrency && currency[capability])
    if (!currency || fiatDecimals(currency) === undefined) throw new ValueError(`Unsupported ${direction} fiat currency: ${options.fiatCurrency}`)
    const source = direction === 'buy' ? isFiat : !isFiat
    return {
      asset,
      currency,
      source,
      amount: displayAmount(amount, isFiat ? fiatDecimals(currency) : assetDecimals(asset))
    }
  }

  /** @private */
  async _quote (direction, options) {
    const { asset, currency, source, amount } = await this._trade(direction, options)
    const body = {
      currency: { name: currency.name },
      asset: { id: Number(asset.id) },
      wallet: this._config.wallet,
      specialCode: ''
    }
    if (direction === 'buy') body.paymentMethod = 'Bank'
    const field = source ? 'amount' : 'targetAmount'
    // amount is a validated decimal literal; metadata always uses JSON escaping.
    const json = `${JSON.stringify(body).slice(0, -1)},"${field}":${amount}}`
    const quote = record(await this._client._request(`/v1/${direction}/quote`, { method: 'PUT', body: json, input: true }))
    if (quote.isValid === false) {
      const error = quote.errors?.[0]
      const code = error?.error ?? quote.error
      const limit = source ? error?.limit : error?.limitTarget
      const message = code ? `DFX quote rejected: ${code}${limit == null ? '' : ` (limit: ${limit})`}` : 'Invalid DFX quote without an error code'
      if (INPUT_ERRORS.has(code)) throw new ValueError(message)
      throw unexpected(message)
    }
    if (quote.isValid !== true) throw unexpected('Missing quote validity')
    const buy = direction === 'buy'
    decimal(quote.rate)
    return {
      cryptoAmount: minorUnits(buy ? quote.estimatedAmount : quote.amount, assetDecimals(asset)),
      fiatAmount: minorUnits(buy ? quote.amount : quote.estimatedAmount, fiatDecimals(currency)),
      fee: minorUnits(buy ? quote.fees?.total : quote.feesTarget?.total, fiatDecimals(currency)),
      rate: buy ? quote.rate : invertRate(quote.rate)
    }
  }

  /** @private */
  async _widget (direction, options) {
    if (!this._hasAccount()) throw new AccountRequiredError('A signing account is required for buy and sell')
    const { asset, currency, source, amount } = await this._trade(direction, options, true)
    const address = await this._accountCall(direction, 'getAddress')
    const field = direction === 'buy' ? 'recipient' : 'refundAddress'
    if (options[field] !== undefined && options[field] !== address) throw new ValueError(`${field} must match the account address`)
    const token = await this._authenticate(direction, address)
    const url = new URL(`/${direction}`, this._app)
    url.searchParams.set('session', token)
    url.searchParams.set('lang', this._config.language ?? 'en')
    url.searchParams.set('asset-in', direction === 'buy' ? currency.name : asset.name)
    url.searchParams.set('asset-out', direction === 'buy' ? asset.name : currency.name)
    url.searchParams.set('blockchain', asset.blockchain)
    url.searchParams.set(source ? 'amount-in' : 'amount-out', amount)
    return url.toString()
  }
}
