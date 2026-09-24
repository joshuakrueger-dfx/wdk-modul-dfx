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
    /** Partner identifier supplied by the wallet developer. No default. */
    wallet?: string;
    /** Lowercase DFX blockchain name binding the account to its chain. No default. */
    network?: string;
    /** Public key sent as key during authentication. No default. */
    publicKey?: string;
    /** Widget language code. Defaults to en. */
    language?: string;
    /** HTTP implementation. Defaults to globalThis.fetch. */
    fetch?: typeof fetch;
    /** HTTP request deadline in milliseconds. Defaults to 30000. */
    timeout?: number;
}

/** Per-operation network selection. */
export interface DfxTradeConfig {
    /** Lowercase DFX blockchain name. Defaults to the constructor network. */
    network?: string;
}

/** Purchase options with an optional network selection. */
export type DfxBuyOptions = BuyOptions & { config?: DfxTradeConfig };
/** Sale options with an optional network selection. */
export type DfxSellOptions = SellOptions & { config?: DfxTradeConfig };

/** Provides DFX fiat quotes, widget URLs and transaction status. */
export default class DfxProtocol extends FiatProtocol {
    /** Creates an account-free interface. Throws ValueError for an unknown environment. */
    constructor(account?: undefined, config?: DfxProtocolConfig);
    /** Creates a read-only interface. Throws ValueError for an unknown environment. */
    constructor(account: IWalletAccountReadOnly, config?: DfxProtocolConfig);
    /** Creates a signing interface. Throws ValueError for an unknown environment. */
    constructor(account: IWalletAccount, config?: DfxProtocolConfig);
    /** Generates a fresh purchase URL. Requires a signing account and constructor network. */
    buy(options: DfxBuyOptions): Promise<BuyResult>;
    /** Quotes a purchase; amounts and fee use smallest units, rate is fiat per crypto. */
    quoteBuy(options: DfxBuyOptions): Promise<FiatQuote>;
    /** Generates a fresh sale URL. Requires a signing account and constructor network. */
    sell(options: DfxSellOptions): Promise<SellResult>;
    /** Quotes a sale; amounts and fee use smallest units, rate is fiat per crypto. */
    quoteSell(options: DfxSellOptions): Promise<FiatQuote>;
    /** Retrieves by UID, renewing an expired session once. Requires authentication. */
    getTransactionDetail(txId: string): Promise<FiatTransactionDetail>;
    /** Lists assets tradable in either direction with known decimals. */
    getSupportedCryptoAssets(): Promise<SupportedCryptoAsset[]>;
    /** Lists currencies tradable in either direction with known ISO minor units. */
    getSupportedFiatCurrencies(): Promise<SupportedFiatCurrency[]>;
    /** Lists countries using bankAllowed for both directions. */
    getSupportedCountries(): Promise<SupportedCountry[]>;
}
