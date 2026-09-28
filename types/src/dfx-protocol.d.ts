import { FiatProtocol } from '@tetherto/wdk-wallet/protocols';

export type IWalletAccount = import('@tetherto/wdk-wallet').IWalletAccount;
export type IWalletAccountReadOnly = import('@tetherto/wdk-wallet').IWalletAccountReadOnly;
export type BuyOptions = import('@tetherto/wdk-wallet/protocols').BuyOptions;
export type SellOptions = import('@tetherto/wdk-wallet/protocols').SellOptions;
export type BuyResult = import('@tetherto/wdk-wallet/protocols').BuyResult;
export type SellResult = import('@tetherto/wdk-wallet/protocols').SellResult;
export type FiatQuote = import('@tetherto/wdk-wallet/protocols').FiatQuote;
export type FiatTransactionDetail = import('@tetherto/wdk-wallet/protocols').FiatTransactionDetail;
export type SupportedCryptoAsset = import('@tetherto/wdk-wallet/protocols').SupportedCryptoAsset;
export type SupportedFiatCurrency = import('@tetherto/wdk-wallet/protocols').SupportedFiatCurrency;
export type SupportedCountry = import('@tetherto/wdk-wallet/protocols').SupportedCountry;

/** Configuration for DFX API and widget access. */
export interface DfxProtocolConfig {
    /** API and app environment. Defaults to production. */
    environment?: 'production' | 'sandbox';
    /** Partner identifier supplied by the integrating wallet developer. No default. */
    wallet?: string;
    /** Non-empty DFX blockchain name binding the account to its chain, case-insensitively. No default. Required for buy and sell. */
    network?: string;
    /** Public key sent as key during authentication. No default. */
    publicKey?: string;
    /** Widget language code. Defaults to en. */
    language?: string;
    /** HTTP implementation called with globalThis as receiver. Defaults to globalThis.fetch. */
    fetch?: typeof fetch;
    /** Finite positive HTTP request deadline in milliseconds, at most 2147483647. Defaults to 30000. */
    timeout?: number;
}

/** Per-operation network selection and wallet transaction identifier. */
export interface DfxTradeConfig {
    /** Non-empty DFX blockchain name, compared case-insensitively. Defaults to the constructor network. Selectable for quotes; must match the constructor network for buy and sell. */
    network?: string;
    /** Wallet-assigned ID, unique per widget opening; 1–256 characters from A-Z, a-z, 0-9, dot, underscore, colon and hyphen. */
    externalTransactionId?: string;
}

/** Per-operation trade configuration. */
export interface DfxTradeOptions {
    /** Trade configuration. */
    config?: DfxTradeConfig;
}

/** Per-quote network selection. */
export interface DfxQuoteConfig {
    /** Non-empty DFX blockchain name, compared case-insensitively. Defaults to the constructor network. */
    network?: string;
}

/** Per-operation quote configuration. */
export interface DfxQuoteOptions {
    /** Quote configuration. */
    config?: DfxQuoteConfig;
}

export type DfxBuyOptions = BuyOptions & DfxTradeOptions;
export type DfxSellOptions = SellOptions & DfxTradeOptions;
export type DfxBuyQuoteOptions = Omit<BuyOptions, 'recipient'> & DfxQuoteOptions;
export type DfxSellQuoteOptions = Omit<SellOptions, 'refundAddress'> & DfxQuoteOptions;

/** Provides DFX fiat quotes, widget URLs and transaction status. */
export default class DfxProtocol extends FiatProtocol {
    /**
     * Creates a new interface to the protocol without binding it to a wallet account.
     * Creates an account-free DFX interface for quotes and supported lists.
     *
     * @overload
     * @param {undefined} [account] - Omit for public API access. Without sign, only quotes and lists are available; buy/sell throw AccountRequiredError and getTransactionDetail throws ProviderError.
     * @param {DfxProtocolConfig} [config] - API and widget configuration.
     * @throws {ValueError} If config is not an object.
     * @throws {ValueError} If environment is unknown.
     * @throws {ValueError} If timeout is not a finite positive number.
     * @throws {ValueError} If timeout exceeds 2147483647 milliseconds.
     * @throws {ValueError} If network is supplied but is not a non-empty string.
     * @throws {ValueError} If wallet is supplied but is not a non-empty string.
     * @throws {ValueError} If publicKey is supplied but is not a non-empty string.
     * @throws {ValueError} If language is supplied but is not a non-empty string.
     */
    constructor(account?: undefined, config?: DfxProtocolConfig);
    /**
     * Creates a new read-only interface to the protocol.
     * Creates a DFX interface with a read-only wallet account.
     *
     * @overload
     * @param {IWalletAccountReadOnly} account - Account available to the protocol. Without sign, only quotes and lists are available; buy/sell throw AccountRequiredError and getTransactionDetail throws ProviderError.
     * @param {DfxProtocolConfig} [config] - API and widget configuration.
     * @throws {ValueError} If config is not an object.
     * @throws {ValueError} If environment is unknown.
     * @throws {ValueError} If timeout is not a finite positive number.
     * @throws {ValueError} If timeout exceeds 2147483647 milliseconds.
     * @throws {ValueError} If network is supplied but is not a non-empty string.
     * @throws {ValueError} If wallet is supplied but is not a non-empty string.
     * @throws {ValueError} If publicKey is supplied but is not a non-empty string.
     * @throws {ValueError} If language is supplied but is not a non-empty string.
     */
    constructor(account: IWalletAccountReadOnly, config?: DfxProtocolConfig);
    /**
     * Creates a new interface to the protocol.
     * Creates a DFX interface with a signing wallet account.
     *
     * @overload
     * @param {IWalletAccount} account - Account used to sign DFX authentication messages. Without sign, only quotes and lists are available; buy/sell throw AccountRequiredError and getTransactionDetail throws ProviderError.
     * @param {DfxProtocolConfig} [config] - API and widget configuration.
     * @throws {ValueError} If config is not an object.
     * @throws {ValueError} If environment is unknown.
     * @throws {ValueError} If timeout is not a finite positive number.
     * @throws {ValueError} If timeout exceeds 2147483647 milliseconds.
     * @throws {ValueError} If network is supplied but is not a non-empty string.
     * @throws {ValueError} If wallet is supplied but is not a non-empty string.
     * @throws {ValueError} If publicKey is supplied but is not a non-empty string.
     * @throws {ValueError} If language is supplied but is not a non-empty string.
     */
    constructor(account: IWalletAccount, config?: DfxProtocolConfig);
    /**
     * Generates a URL for a user to purchase a crypto asset with fiat currency.
     * Generates a fresh authenticated purchase widget URL.
     * Tickers and networks are case-insensitive; EVM checksum addresses are equivalent.
     * ERC-4337 purchases go to the signing owner EOA outside the smart account.
     * Known authentication addresses are checked before login; uncached EVM addresses after login.
     * Account errors pass through only for the exact constructors listed below;
     * subclasses and other account failures become ProviderError with the original cause.
     *
     * @param {DfxBuyOptions} options - Purchase asset, currency and one amount in smallest units. recipient must match the authentication address, the signing owner EOA for ERC-4337.
     * @returns {Promise<BuyResult>} The purchase widget URL.
     * @throws {AccountRequiredError} If a signing account is unavailable.
     * @throws {ValueError} If options is not an object.
     * @throws {ValueError} If options.config is not an object.
     * @throws {ValueError} If the asset or network is unsupported for buying.
     * @throws {ValueError} If the asset spelling is ambiguous on a network.
     * @throws {ValueError} If the asset is ambiguous across networks.
     * @throws {ValueError} If asset decimals are missing.
     * @throws {ValueError} If the fiat currency is ambiguous.
     * @throws {ValueError} If the fiat currency is unsupported for buying.
     * @throws {ValueError} If exactly one amount is not supplied.
     * @throws {ValueError} If the amount is invalid.
     * @throws {ValueError} If the amount exceeds accepted precision.
     * @throws {ValueError} If the per-operation network is not a non-empty string.
     * @throws {ValueError} If the constructor network is missing.
     * @throws {ValueError} If the network differs from the account network.
     * @throws {ValueError} If recipient differs from the authentication address. Explicit Safe recipients are rejected.
     * @throws {ValueError} If externalTransactionId is not 1–256 characters from A-Z, a-z, 0-9, dot, underscore, colon and hyphen.
     * @throws {ProviderError} If authentication fails.
     * @throws {ProviderError} If the API request fails.
     * @throws {ProviderError} If the API returns malformed data.
     * @throws {ProviderRequiredError} If the account requires a provider.
     * @throws {BuyError} If the account reports a purchase failure.
     * @throws {MaximumFeeExceededError} If the account reports an excessive fee.
     */
    buy(options: DfxBuyOptions): Promise<BuyResult>;
    /**
     * Gets a quote for a crypto asset purchase.
     * Quotes an indicative purchase without a signature or reservation.
     *
     * @param {DfxBuyQuoteOptions} options - Purchase asset, currency and one amount in smallest units; optional config.network selects the network.
     * @returns {Promise<FiatQuote>} Amounts and fees in smallest units; rate from response fiat/crypto display amounts including fees, rounded half up to 18 significant digits without exponent notation.
     * @throws {ValueError} If options is not an object.
     * @throws {ValueError} If options.config is not an object.
     * @throws {ValueError} If the asset or network is unsupported for buying.
     * @throws {ValueError} If the asset spelling is ambiguous on a network.
     * @throws {ValueError} If the asset is ambiguous across networks.
     * @throws {ValueError} If asset decimals are missing.
     * @throws {ValueError} If the fiat currency is ambiguous.
     * @throws {ValueError} If the fiat currency is unsupported for buying.
     * @throws {ValueError} If exactly one amount is not supplied.
     * @throws {ValueError} If the amount is invalid.
     * @throws {ValueError} If the amount exceeds accepted precision.
     * @throws {ValueError} If the per-operation network is not a non-empty string.
     * @throws {ValueError} If DFX rejects quote input.
     * @throws {ProviderError} If the API fails.
     * @throws {ProviderError} If the API returns malformed quote data.
     */
    quoteBuy(options: DfxBuyQuoteOptions): Promise<FiatQuote>;
    /**
     * Generates a URL for a user to sell a crypto asset for fiat currency.
     * Generates a fresh authenticated sale widget URL.
     * Tickers and networks are case-insensitive; EVM checksum addresses are equivalent.
     * Known authentication addresses are checked before login; uncached EVM addresses after login.
     * Account errors pass through only for the exact constructors listed below;
     * subclasses and other account failures become ProviderError with the original cause.
     *
     * @param {DfxSellOptions} options - Sale asset, currency and one amount in smallest units. refundAddress must match the authentication address, the signing owner EOA for ERC-4337.
     * @returns {Promise<SellResult>} The sale widget URL.
     * @throws {AccountRequiredError} If a signing account is unavailable.
     * @throws {ValueError} If options is not an object.
     * @throws {ValueError} If options.config is not an object.
     * @throws {ValueError} If the asset or network is unsupported for selling.
     * @throws {ValueError} If the asset spelling is ambiguous on a network.
     * @throws {ValueError} If the asset is ambiguous across networks.
     * @throws {ValueError} If asset decimals are missing.
     * @throws {ValueError} If the fiat currency is ambiguous.
     * @throws {ValueError} If the fiat currency is unsupported for selling.
     * @throws {ValueError} If exactly one amount is not supplied.
     * @throws {ValueError} If the amount is invalid.
     * @throws {ValueError} If the amount exceeds accepted precision.
     * @throws {ValueError} If the per-operation network is not a non-empty string.
     * @throws {ValueError} If the constructor network is missing.
     * @throws {ValueError} If the network differs from the account network.
     * @throws {ValueError} If refundAddress differs from the authentication address. Explicit Safe refund addresses are rejected.
     * @throws {ValueError} If externalTransactionId is not 1–256 characters from A-Z, a-z, 0-9, dot, underscore, colon and hyphen.
     * @throws {ProviderError} If authentication fails.
     * @throws {ProviderError} If the API request fails.
     * @throws {ProviderError} If the API returns malformed data.
     * @throws {ProviderRequiredError} If the account requires a provider.
     * @throws {SellError} If the account reports a sale failure.
     * @throws {MaximumFeeExceededError} If the account reports an excessive fee.
     */
    sell(options: DfxSellOptions): Promise<SellResult>;
    /**
     * Gets a quote for a crypto asset sale.
     * Quotes an indicative sale without a signature or reservation.
     *
     * @param {DfxSellQuoteOptions} options - Sale asset, currency and one amount in smallest units; optional config.network selects the network.
     * @returns {Promise<FiatQuote>} Amounts and fees in smallest units; rate from response fiat/crypto display amounts including fees, rounded half up to 18 significant digits without exponent notation.
     * @throws {ValueError} If options is not an object.
     * @throws {ValueError} If options.config is not an object.
     * @throws {ValueError} If the asset or network is unsupported for selling.
     * @throws {ValueError} If the asset spelling is ambiguous on a network.
     * @throws {ValueError} If the asset is ambiguous across networks.
     * @throws {ValueError} If asset decimals are missing.
     * @throws {ValueError} If the fiat currency is ambiguous.
     * @throws {ValueError} If the fiat currency is unsupported for selling.
     * @throws {ValueError} If exactly one amount is not supplied.
     * @throws {ValueError} If the amount is invalid.
     * @throws {ValueError} If the amount exceeds accepted precision.
     * @throws {ValueError} If the per-operation network is not a non-empty string.
     * @throws {ValueError} If DFX rejects quote input.
     * @throws {ProviderError} If the API fails.
     * @throws {ProviderError} If the API returns malformed quote data.
     */
    quoteSell(options: DfxSellQuoteOptions): Promise<FiatQuote>;
    /**
     * Retrieves the details of a specific transaction from the provider.
     * Retrieves a fiat transaction by UID or external ID, renewing an expired session once.
     * Resolves inactive catalog rows too, validating only the matched rows.
     * Only exact ProviderRequiredError and ProviderError account errors pass through;
     * all other account failures become ProviderError with the original cause.
     *
     * @param {string} txId - DFX transaction UID or wallet-assigned external transaction ID.
     * @param {Object} [options] - Transaction lookup options.
     * @param {'uid' | 'externalTransactionId'} [options.idType] - Identifier type; defaults to uid.
     * @returns {Promise<FiatTransactionDetail>} Normalized transaction status and asset codes.
     * @throws {ValueError} If options is not an object.
     * @throws {ValueError} If idType is not uid or externalTransactionId.
     * @throws {ValueError} If the UID is not a non-empty string.
     * @throws {ValueError} If externalTransactionId is not 1–256 characters from A-Z, a-z, 0-9, dot, underscore, colon and hyphen.
     * @throws {ValueError} If the identifier is rejected by DFX.
     * @throws {NoSuchElementError} Until DFX has registered a transaction for this id.
     * @throws {NoSuchElementError} If the transaction is a Swap.
     * @throws {NoSuchElementError} If the transaction is a Referral.
     * @throws {ProviderRequiredError} If the signing account requires a provider.
     * @throws {ProviderError} If a signing account is unavailable.
     * @throws {ProviderError} If authentication fails.
     * @throws {ProviderError} If the API request fails.
     * @throws {ProviderError} If the response cannot be resolved.
     */
    getTransactionDetail(txId: string, options?: { idType?: 'uid' | 'externalTransactionId' }): Promise<FiatTransactionDetail>;
    /**
     * Retrieves a list of supported crypto assets from the provider.
     * Lists assets available for buying or selling with known decimals.
     * Bitcoin/BTC, Lightning/BTC, Arkade/BTC and Firo/FIRO default to 8 when API decimals are absent or null.
     *
     * @returns {Promise<SupportedCryptoAsset[]>} Tickers, lowercase blockchain names and base-unit decimals.
     * @throws {ProviderError} If the API fails.
     * @throws {ProviderError} If the API returns malformed asset metadata.
     */
    getSupportedCryptoAssets(): Promise<SupportedCryptoAsset[]>;
    /**
     * Retrieves a list of supported fiat currencies from the provider.
     * Lists fiat currencies available in either direction with known ISO minor units.
     *
     * @returns {Promise<SupportedFiatCurrency[]>} ISO currency codes and minor-unit decimals.
     * @throws {ProviderError} If the API fails.
     * @throws {ProviderError} If the API returns malformed currency metadata.
     */
    getSupportedFiatCurrencies(): Promise<SupportedFiatCurrency[]>;
    /**
     * Retrieves a list of supported countries or regions from the provider.
     * Lists countries with bank-transfer availability for both trade directions.
     *
     * @returns {Promise<SupportedCountry[]>} Country codes, names and bank availability flags.
     * @throws {ProviderError} If the API fails.
     * @throws {ProviderError} If the API returns malformed country metadata.
     */
    getSupportedCountries(): Promise<SupportedCountry[]>;
}
