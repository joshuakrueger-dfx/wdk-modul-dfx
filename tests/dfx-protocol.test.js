// Copyright 2026 DFX AG
// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, jest, test } from '@jest/globals'
import { ProviderErrorReason } from '@tetherto/wdk-wallet'
import {
  AccountRequiredError, BuyError, SellError, MaximumFeeExceededError, NoSuchElementError, IFiatProtocol as WalletFiatProtocol,
  ProviderError, ProviderRequiredError, ValueError, NotImplementedError, ReadOnlyAccountRequiredError
} from '@tetherto/wdk-wallet/protocols'
import DfxProtocol, { DfxProtocol as NamedDfxProtocol, IFiatProtocol } from '../index.js'

const DUMMY_ASSETS = [
  { id: 1, name: 'ETH', uniqueName: 'Ethereum/ETH', blockchain: 'Ethereum', description: 'Ether', decimals: 18, buyable: true, sellable: true },
  { id: 2, name: 'USDT', uniqueName: 'Ethereum/USDT', blockchain: 'Ethereum', description: 'Tether', decimals: 6, buyable: true, sellable: true },
  { id: 3, name: 'USDT', uniqueName: 'Tron/USDT', blockchain: 'Tron', description: 'Tether', decimals: 6, buyable: true, sellable: true },
  { id: 4, name: 'BTC', uniqueName: 'Bitcoin/BTC', blockchain: 'Bitcoin', description: 'Bitcoin', buyable: true, sellable: true },
  { id: 5, name: 'BUY', uniqueName: 'Ethereum/BUY', blockchain: 'Ethereum', description: 'Buy only', decimals: 2, buyable: true, sellable: false },
  { id: 6, name: 'SELL', uniqueName: 'Ethereum/SELL', blockchain: 'Ethereum', description: 'Sell only', decimals: 2, buyable: false, sellable: true },
  { id: 7, name: 'OFF', uniqueName: 'Ethereum/OFF', blockchain: 'Ethereum', decimals: 2, buyable: false, sellable: false }
]
const DUMMY_FIAT = [
  { id: 11, name: 'EUR', buyable: true, sellable: true },
  { id: 12, name: 'CHF', buyable: true, sellable: true },
  { id: 13, name: 'JPY', buyable: true, sellable: false },
  { id: 14, name: 'BHD', buyable: false, sellable: true },
  { id: 15, name: 'ZZZ', buyable: true, sellable: true },
  { id: 16, name: 'USD', buyable: false, sellable: false }
]
const DUMMY_COUNTRIES = [
  { symbol: 'CH', name: 'Switzerland', bankAllowed: true, cardAllowed: false, locationAllowed: false },
  { symbol: 'US', name: 'United States', bankAllowed: false, cardAllowed: true, locationAllowed: true }
]
const DUMMY_BUY = '{"isValid":true,"amount":100,"estimatedAmount":0.123456789012345678,"rate":810.000000000000001,"fees":{"total":1.23}}'
const DUMMY_SELL = '{"isValid":true,"amount":0.123456789012345678,"estimatedAmount":100,"rate":0.00125,"fees":{"total":0.9},"feesTarget":{"total":1.23}}'
const DUMMY_DETAIL = { uid: '123', type: 'Buy', state: 'Completed', inputAssetId: 11, inputAsset: 'EUR', outputAssetId: 1, outputAsset: 'Ethereum/ETH', outputBlockchain: 'Ethereum' }
const OPTIONS = { cryptoAsset: 'ETH', fiatCurrency: 'EUR', fiatAmount: 10000n }
const DUMMY_ADDRESS = '0x0000000000000000000000000000000000000001'

function response (data, status = 200) {
  return { ok: status >= 200 && status < 300, status, text: jest.fn().mockResolvedValue(typeof data === 'string' ? data : JSON.stringify(data)) }
}

// Explicit route lookup makes unexpected calls fail instead of borrowing another endpoint's fixture.
function setup (config = {}, overrides = {}, account = { getAddress: jest.fn().mockResolvedValue(DUMMY_ADDRESS), sign: jest.fn().mockResolvedValue('dummy-signature') }) {
  const routes = {
    'GET /v1/asset': response(DUMMY_ASSETS),
    'GET /v1/fiat': response(DUMMY_FIAT),
    'GET /v1/country': response(DUMMY_COUNTRIES),
    [`GET /v1/auth/signMessage?address=${DUMMY_ADDRESS}`]: response({ message: '[dev]_Sign this exact message', blockchains: ['Ethereum'] }),
    'POST /v1/auth': response({ accessToken: 'dummy-session' }, 201),
    'PUT /v1/buy/quote': response(DUMMY_BUY),
    'PUT /v1/sell/quote': response(DUMMY_SELL),
    'GET /v1/transaction/detail/single?uid=123': response(DUMMY_DETAIL),
    ...overrides
  }
  const fetch = jest.fn(async (url, init) => {
    const parsed = new URL(url)
    const value = routes[`${init.method} ${parsed.pathname}${parsed.search}`]
    if (value === undefined) throw new ProviderError('Unexpected test route', { reason: ProviderErrorReason.INTERNAL_SERVER_ERROR })
    return typeof value === 'function' ? value(init) : value
  })
  return { protocol: new DfxProtocol(account, { fetch, ...config }), fetch, account, routes }
}

function request (fetch, path, method, body, token, environment = 'production') {
  const base = environment === 'sandbox' ? 'https://dev.api.dfx.swiss' : 'https://api.dfx.swiss'
  const call = fetch.mock.calls.find(([url, init]) => url === `${base}${path}` && init.method === method)
  const headers = { Accept: 'application/json' }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (token !== undefined) headers.Authorization = `Bearer ${token}`
  expect(fetch).toHaveBeenCalledWith(`${base}${path}`, { method, headers, body, signal: call[1].signal })
  expect(call[1].signal.aborted).toBe(false)
}

async function failure (promise, ErrorClass, message, reason) {
  const error = await promise.then(() => undefined, error => error)
  expect(error?.constructor).toBe(ErrorClass)
  expect(error?.message).toBe(message)
  if (reason !== undefined) expect(error.reason).toBe(reason)
  return error
}

describe('@dfx.swiss/wdk-protocol-fiat-dfx', () => {
  afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks() })

  test('exports the class by name and default and the WDK interface', () => {
    expect(NamedDfxProtocol).toBe(DfxProtocol)
    expect(IFiatProtocol).toBe(WalletFiatProtocol)
  })

  test('rejects an unknown environment at construction', () => {
    expect(() => new DfxProtocol(undefined, { environment: 'unknown' })).toThrow(new ValueError('environment must be production or sandbox'))
  })

  test.each([null, false, 1, 'config', [], () => {}].map(config => [config]))('rejects non-object configuration %#', config => {
    expect(() => new DfxProtocol(undefined, config)).toThrow(new ValueError('config must be an object'))
  })

  test.each([null, false, '100', 0, -1, NaN, Infinity, -Infinity])('rejects invalid timeout %#', timeout => {
    expect(() => new DfxProtocol(undefined, { timeout })).toThrow(new ValueError('timeout must be a finite number greater than zero'))
  })

  test.each(['network', 'wallet', 'publicKey', 'language'].flatMap(field =>
    [null, false, 1, '', '  ', {}, []].map(value => [field, value])
  ))('rejects invalid constructor string %s case %#', (field, value) => {
    expect(() => new DfxProtocol(undefined, { [field]: value })).toThrow(new ValueError(`${field} must be a non-empty string`))
  })

  test.each(['buy', 'sell', 'quoteBuy', 'quoteSell'].flatMap(method =>
    [undefined, null, false, 1, 'options', [], () => {}].map(options => [method, options])
  ))('%s rejects non-object options %# before requiring an account', async (method, options) => {
    await failure(new DfxProtocol()[method](options), ValueError, 'options must be an object')
  })

  test.each([null, 1, ''])('rejects invalid per-operation networks %#', async network => {
    const { protocol } = setup()
    await failure(protocol.quoteBuy({ ...OPTIONS, config: { network } }), ValueError, 'network must be a non-empty string')
  })

  test.each([
    { cryptoAsset: undefined }, { cryptoAsset: 1 }, { fiatCurrency: undefined }, { fiatCurrency: 1 }
  ])('rejects invalid ticker fields %# as ValueError', async fields => {
    const { protocol } = setup()
    const field = Object.keys(fields)[0]
    const message = field === 'cryptoAsset' ? `Unsupported buy asset or network: ${fields[field]}` : `Unsupported buy fiat currency: ${fields[field]}`
    await failure(protocol.quoteBuy({ ...OPTIONS, ...fields }), ValueError, message)
  })

  test.each(['buy', 'sell'])('%s preserves DFX spelling with mixed-case input', async method => {
    const { protocol, fetch } = setup({ network: 'eThErEuM' })
    const result = await protocol[method]({ cryptoAsset: 'USDt', fiatCurrency: 'eUr', fiatAmount: 10000n, config: { network: 'ETHEREUM' } })
    const assets = method === 'buy' ? 'asset-in=EUR&asset-out=USDT' : 'asset-in=USDT&asset-out=EUR'
    const amount = method === 'buy' ? 'amount-in' : 'amount-out'
    expect(result).toEqual({ [`${method}Url`]: `https://app.dfx.swiss/${method}?session=dummy-session&lang=en&${assets}&blockchain=Ethereum&${amount}=100` })
    request(fetch, '/v1/auth', 'POST', `{"address":"${DUMMY_ADDRESS}","signature":"dummy-signature","blockchain":"Ethereum"}`)
  })

  test.each(['buy', 'sell'])('%s quote computes the effective CHF/USDT rate from amounts', async direction => {
    const body = direction === 'buy'
      ? '{"isValid":true,"amount":100,"estimatedAmount":114.32,"rate":0.87,"fees":{"total":1}}'
      : '{"isValid":true,"amount":3,"estimatedAmount":7,"rate":0.42857,"feesTarget":{"total":1}}'
    const { protocol, fetch } = setup({ network: 'ETHEREUM' }, { [`PUT /v1/${direction}/quote`]: response(body) })
    const method = direction === 'buy' ? 'quoteBuy' : 'quoteSell'
    const expected = direction === 'buy'
      ? { cryptoAmount: 114320000n, fiatAmount: 10000n, fee: 100n, rate: '0.874737578726382085' }
      : { cryptoAmount: 3000000n, fiatAmount: 700n, fee: 100n, rate: '2.33333333333333333' }
    expect(await protocol[method]({ cryptoAsset: 'USDt', fiatCurrency: 'chf', fiatAmount: 10000n, config: { network: 'TrOn' } })).toEqual(expected)
    const payment = direction === 'buy' ? ',"paymentMethod":"Bank"' : ''
    const field = direction === 'buy' ? 'amount' : 'targetAmount'
    request(fetch, `/v1/${direction}/quote`, 'PUT', `{"currency":{"name":"CHF"},"asset":{"id":3},"specialCode":""${payment},"${field}":100}`)
  })

  test.each([undefined, 0, -1, 'not-a-rate'])('does not use the provider rate field %#', async rate => {
    const { protocol } = setup({}, { 'PUT /v1/buy/quote': response({ isValid: true, amount: 3, estimatedAmount: 2, rate, fees: { total: 0 } }) })
    expect(await protocol.quoteBuy(OPTIONS)).toEqual({ cryptoAmount: 2000000000000000000n, fiatAmount: 300n, fee: 0n, rate: '1.5' })
  })

  test('rounds an exact halfway quotient up at the eighteenth significant digit', async () => {
    const { protocol } = setup({}, { 'PUT /v1/buy/quote': response('{"isValid":true,"amount":123456789012345678.50,"estimatedAmount":1,"fees":{"total":0}}') })
    expect((await protocol.quoteBuy(OPTIONS)).rate).toBe('123456789012345679')
  })

  test.each(['buy', 'sell'].flatMap(method => [
    ['0xabcdefabcdefabcdefabcdefabcdefabcdefabcd', '0xAbcdefABCDEFabcdefABCDEFabcdefABCDEFabcd', true],
    ['0xabcdefabcdefabcdefabcdefabcdefabcdefabcd', '0xabcdefabcdefabcdefabcdefabcdefabcdefabce', false],
    ['TronAddressAbC', 'TronAddressAbC', true],
    ['TronAddressAbC', 'tronaddressabc', false],
    ['0xAbCd', '0xabcd', false],
    ['0xabcdefabcdefabcdefabcdefabcdefabcdefabcd', 'not-hex', false]
  ].map(values => [method, ...values])))('%s compares address case %# correctly', async (method, address, override, accepted) => {
    const { protocol, account } = setup({ network: 'ethereum' }, {
      [`GET /v1/auth/signMessage?address=${address}`]: response({ message: 'dummy-challenge' })
    })
    account.getAddress.mockResolvedValue(address)
    const field = method === 'buy' ? 'recipient' : 'refundAddress'
    const pending = protocol[method]({ ...OPTIONS, [field]: override })
    if (accepted) {
      const assets = method === 'buy' ? 'asset-in=EUR&asset-out=ETH' : 'asset-in=ETH&asset-out=EUR'
      const amount = method === 'buy' ? 'amount-in' : 'amount-out'
      expect(await pending).toEqual({ [`${method}Url`]: `https://app.dfx.swiss/${method}?session=dummy-session&lang=en&${assets}&blockchain=Ethereum&${amount}=100` })
      expect(account.sign).toHaveBeenCalledWith('dummy-challenge')
    } else {
      await failure(pending, ValueError, `${field} must match the account address`)
      expect(account.sign.mock.calls).toEqual([])
    }
  })

  test.each(['injected', 'ambient'])('binds %s fetch to the global object', async mode => {
    const implementation = function () {
      if (this !== globalThis && this !== undefined) throw new ValueError('Illegal fetch receiver')
      return Promise.resolve(response([]))
    }
    const fetch = mode === 'ambient' ? jest.spyOn(globalThis, 'fetch').mockImplementation(implementation) : jest.fn(implementation)
    const protocol = new DfxProtocol(undefined, mode === 'ambient' ? {} : { fetch })
    expect(await protocol.getSupportedCountries()).toEqual([])
    expect(fetch.mock.contexts).toEqual([globalThis])
    request(fetch, '/v1/country', 'GET')
  })

  test.each(['asset', 'fiat'].flatMap(kind => [null, true, [], {}, { buyable: false, sellable: false, id: -1 }, { buyable: 'true' }].map(row => [kind, row])))('ignores non-tradable %s row %# before validation', async (kind, row) => {
    const { protocol } = setup({}, { [`GET /v1/${kind}`]: response([row]) })
    expect(await protocol[kind === 'asset' ? 'getSupportedCryptoAssets' : 'getSupportedFiatCurrencies']()).toEqual([])
  })

  test.each(['asset', 'fiat'])('resolves a historical inactive %s row among malformed unrelated rows', async kind => {
    const rows = kind === 'asset' ? DUMMY_ASSETS : DUMMY_FIAT
    const { protocol } = setup({}, {
      [`GET /v1/${kind}`]: response([null, {}, { buyable: true, id: 'unrelated' }, { ...rows[0], buyable: false, sellable: false }])
    })
    expect(await protocol.getTransactionDetail('123')).toEqual({ cryptoAsset: 'ETH', fiatCurrency: 'EUR', status: 'completed' })
  })

  test.each([true, false])('validates the historical matched row with ID lookup = %s', async byId => {
    const { protocol } = setup({}, {
      'GET /v1/asset': response([{ ...DUMMY_ASSETS[0], buyable: undefined }]),
      'GET /v1/transaction/detail/single?uid=123': response({ ...DUMMY_DETAIL, outputAssetId: byId ? 1 : undefined })
    })
    await failure(protocol.getTransactionDetail('123'), ProviderError, 'Unexpected DFX response', 'INTERNAL_SERVER_ERROR')
  })

  test('resolves a historical fallback past null and unrelated catalog rows', async () => {
    const { protocol } = setup({}, {
      'GET /v1/asset': response([null, {}, { ...DUMMY_ASSETS[0], buyable: false, sellable: false }]),
      'GET /v1/transaction/detail/single?uid=123': response({ ...DUMMY_DETAIL, outputAssetId: undefined })
    })
    expect(await protocol.getTransactionDetail('123')).toEqual({ cryptoAsset: 'ETH', fiatCurrency: 'EUR', status: 'completed' })
  })

  test('lists assets available in either direction and excludes missing decimals', async () => {
    const { protocol, fetch } = setup()
    expect(await protocol.getSupportedCryptoAssets()).toEqual([
      { code: 'ETH', networkCode: 'ethereum', decimals: 18, name: 'Ether' },
      { code: 'USDT', networkCode: 'ethereum', decimals: 6, name: 'Tether' },
      { code: 'USDT', networkCode: 'tron', decimals: 6, name: 'Tether' },
      { code: 'BUY', networkCode: 'ethereum', decimals: 2, name: 'Buy only' },
      { code: 'SELL', networkCode: 'ethereum', decimals: 2, name: 'Sell only' }
    ])
    request(fetch, '/v1/asset', 'GET')
  })

  test('lists fiat in either direction with ISO minor units and excludes unknown currencies', async () => {
    const { protocol, fetch } = setup()
    expect(await protocol.getSupportedFiatCurrencies()).toEqual([
      { code: 'EUR', decimals: 2 }, { code: 'CHF', decimals: 2 }, { code: 'JPY', decimals: 0 }, { code: 'BHD', decimals: 3 }
    ])
    request(fetch, '/v1/fiat', 'GET')
  })

  test('maps bank availability independently from card and location flags', async () => {
    const { protocol, fetch } = setup()
    expect(await protocol.getSupportedCountries()).toEqual([
      { code: 'CH', name: 'Switzerland', isBuyAllowed: true, isSellAllowed: true },
      { code: 'US', name: 'United States', isBuyAllowed: false, isSellAllowed: false }
    ])
    request(fetch, '/v1/country', 'GET')
  })

  test.each([
    ['quoteBuy', 'buy', { fiatAmount: 10000n }, 'amount', '100', { cryptoAmount: 123456789012345678n, fiatAmount: 10000n, fee: 123n, rate: '810.000007290000072' }],
    ['quoteBuy', 'buy', { cryptoAmount: 50000000000000000n }, 'targetAmount', '0.05', { cryptoAmount: 123456789012345678n, fiatAmount: 10000n, fee: 123n, rate: '810.000007290000072' }],
    ['quoteSell', 'sell', { cryptoAmount: 50000000000000000n }, 'amount', '0.05', { cryptoAmount: 123456789012345678n, fiatAmount: 10000n, fee: 123n, rate: '810.000007290000072' }],
    ['quoteSell', 'sell', { fiatAmount: 10000 }, 'targetAmount', '100', { cryptoAmount: 123456789012345678n, fiatAmount: 10000n, fee: 123n, rate: '810.000007290000072' }]
  ])('%s maps amount case %# with exact request and response units', async (method, direction, amount, field, literal, expected) => {
    const { protocol, fetch, account } = setup({ wallet: 'dummy-partner' })
    expect(await protocol[method]({ cryptoAsset: 'ETH', fiatCurrency: 'EUR', ...amount })).toEqual(expected)
    const payment = direction === 'buy' ? ',"paymentMethod":"Bank"' : ''
    request(fetch, `/v1/${direction}/quote`, 'PUT', `{"currency":{"name":"EUR"},"asset":{"id":1},"wallet":"dummy-partner","specialCode":""${payment},"${field}":${literal}}`)
    request(fetch, '/v1/asset', 'GET')
    request(fetch, '/v1/fiat', 'GET')
    expect(account.sign.mock.calls).toEqual([])
    expect(fetch.mock.calls.length).toBe(3)
  })

  test.each([
    ['buy', { fiatAmount: 10000n }, 'amount-in=100', 'EUR', 'ETH'],
    ['buy', { cryptoAmount: 50000000000000000n }, 'amount-out=0.05', 'EUR', 'ETH'],
    ['sell', { cryptoAmount: 50000000000000000n }, 'amount-in=0.05', 'ETH', 'EUR'],
    ['sell', { fiatAmount: 10000 }, 'amount-out=100', 'ETH', 'EUR']
  ])('%s builds the correct URL amount side for case %#', async (method, amount, parameter, assetIn, assetOut) => {
    const { protocol, fetch, account } = setup({ environment: 'sandbox', network: 'ethereum', wallet: 'dummy-partner', publicKey: 'dummy-public-key', language: 'de' })
    expect(await protocol[method]({ cryptoAsset: 'ETH', fiatCurrency: 'EUR', ...amount })).toEqual({
      [`${method}Url`]: `https://dev.app.dfx.swiss/${method}?session=dummy-session&lang=de&asset-in=${assetIn}&asset-out=${assetOut}&blockchain=Ethereum&${parameter}`
    })
    expect(account.getAddress).toHaveBeenCalledWith()
    expect(account.sign).toHaveBeenCalledWith('[dev]_Sign this exact message')
    request(fetch, `/v1/auth/signMessage?address=${DUMMY_ADDRESS}`, 'GET', undefined, undefined, 'sandbox')
    request(fetch, '/v1/auth', 'POST', `{"address":"${DUMMY_ADDRESS}","signature":"dummy-signature","wallet":"dummy-partner","blockchain":"Ethereum","key":"dummy-public-key"}`, undefined, 'sandbox')
    expect(fetch.mock.calls.length).toBe(4)
  })

  test.each(['buy', 'sell'])('%s accepts its default address explicitly and logs in freshly each time', async method => {
    let sessions = 0
    const { protocol, account, fetch } = setup({ network: 'ethereum' }, { 'POST /v1/auth': () => response({ accessToken: `dummy-${++sessions}` }) })
    const options = { ...OPTIONS, [method === 'buy' ? 'recipient' : 'refundAddress']: DUMMY_ADDRESS, config: { network: 'ethereum' } }
    const assets = method === 'buy' ? 'asset-in=EUR&asset-out=ETH' : 'asset-in=ETH&asset-out=EUR'
    const amount = method === 'buy' ? 'amount-in' : 'amount-out'
    expect(await protocol[method](options)).toEqual({ [`${method}Url`]: `https://app.dfx.swiss/${method}?session=dummy-1&lang=en&${assets}&blockchain=Ethereum&${amount}=100` })
    expect(await protocol[method](options)).toEqual({ [`${method}Url`]: `https://app.dfx.swiss/${method}?session=dummy-2&lang=en&${assets}&blockchain=Ethereum&${amount}=100` })
    expect(account.sign.mock.calls).toEqual([['[dev]_Sign this exact message'], ['[dev]_Sign this exact message']])
    request(fetch, '/v1/auth', 'POST', `{"address":"${DUMMY_ADDRESS}","signature":"dummy-signature","blockchain":"Ethereum"}`)
  })

  test.each(['buy', 'sell'])('%s rejects an address different from the signing account', async method => {
    const field = method === 'buy' ? 'recipient' : 'refundAddress'
    const { protocol, account } = setup({ network: 'ethereum' })
    await failure(protocol[method]({ ...OPTIONS, [field]: 'dummy-other-address' }), ValueError, `${field} must match the account address`)
    expect(account.sign.mock.calls).toEqual([])
  })

  test.each(['buy', 'sell'])('%s requires a full account', async method => {
    const { protocol, fetch } = setup({}, {}, { getAddress: jest.fn() })
    await failure(protocol[method](OPTIONS), AccountRequiredError, 'A signing account is required for buy and sell')
    expect(fetch.mock.calls).toEqual([])
  })

  test.each(['buy', 'sell'])('%s requires a constructor network', async method => {
    const { protocol, fetch } = setup()
    await failure(protocol[method](OPTIONS), ValueError, 'network must be configured in the constructor to bind the account to a chain')
    expect(fetch.mock.calls).toEqual([])
  })

  test.each(['buy', 'sell'])('%s rejects a network different from the constructor', async method => {
    const { protocol } = setup({ network: 'ethereum' })
    await failure(protocol[method]({ ...OPTIONS, config: { network: 'tron' } }), ValueError, 'network must match the account network configured in the constructor')
  })

  test.each(['quoteBuy', 'quoteSell'])('%s reports all ambiguous ticker networks', async method => {
    const { protocol } = setup()
    await failure(protocol[method]({ ...OPTIONS, cryptoAsset: 'USDT' }), ValueError, 'Ambiguous asset USDT; configure network: ethereum, tron')
  })

  test('per-quote network overrides the constructor without changing the account binding', async () => {
    const { protocol, fetch } = setup({ network: 'ethereum' }, { 'PUT /v1/buy/quote': response({ isValid: true, amount: 100, estimatedAmount: 100, rate: 1, fees: { total: 1 } }) })
    expect(await protocol.quoteBuy({ ...OPTIONS, cryptoAsset: 'USDT', config: { network: 'tron' } })).toEqual({ cryptoAmount: 100000000n, fiatAmount: 10000n, fee: 100n, rate: '1' })
    request(fetch, '/v1/buy/quote', 'PUT', '{"currency":{"name":"EUR"},"asset":{"id":3},"specialCode":"","paymentMethod":"Bank","amount":100}')
  })

  test.each(['buy', 'sell', 'quoteBuy', 'quoteSell'].flatMap(method =>
    [{}, { fiatAmount: 1n, cryptoAmount: 1n }].map(amounts => [method, amounts])
  ))('%s rejects invalid amount selection %#', async (method, amounts) => {
    const { protocol } = setup({ network: 'ethereum' })
    await failure(protocol[method]({ cryptoAsset: 'ETH', fiatCurrency: 'EUR', ...amounts }), ValueError, 'Exactly one of fiatAmount and cryptoAmount must be supplied')
  })

  test.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, 0n, -1n])('rejects invalid amount %s', async amount => {
    const { protocol, fetch } = setup()
    await failure(protocol.quoteBuy({ ...OPTIONS, fiatAmount: amount }), ValueError, 'amount must be a positive safe integer or positive bigint')
    expect(fetch.mock.calls).toEqual([])
  })

  test.each(['buy', 'sell', 'quoteBuy', 'quoteSell'])('%s rejects input precision loss', async method => {
    const { protocol } = setup({ network: 'ethereum' })
    await failure(protocol[method]({ cryptoAsset: 'ETH', fiatCurrency: 'EUR', cryptoAmount: 123456789012345678n }), ValueError, 'amount exceeds the precision the DFX API accepts')
  })

  test('rejects an amount exceeding finite API number precision', async () => {
    const { protocol } = setup()
    await failure(protocol.quoteBuy({ ...OPTIONS, fiatAmount: 10n ** 400n }), ValueError, 'amount exceeds the precision the DFX API accepts')
  })

  test.each(['buy', 'sell', 'quoteBuy', 'quoteSell'])('%s rejects assets with missing decimals', async method => {
    const { protocol } = setup({ network: 'bitcoin' })
    await failure(protocol[method]({ ...OPTIONS, cryptoAsset: 'BTC' }), ValueError, 'Missing decimals for Bitcoin/BTC')
  })

  test.each([
    ['buy', 'SELL', 'EUR', 'Unsupported buy asset or network: SELL'],
    ['quoteBuy', 'SELL', 'EUR', 'Unsupported buy asset or network: SELL'],
    ['sell', 'BUY', 'EUR', 'Unsupported sell asset or network: BUY'],
    ['quoteSell', 'BUY', 'EUR', 'Unsupported sell asset or network: BUY'],
    ['buy', 'ETH', 'BHD', 'Unsupported buy fiat currency: BHD'],
    ['quoteBuy', 'ETH', 'BHD', 'Unsupported buy fiat currency: BHD'],
    ['sell', 'ETH', 'JPY', 'Unsupported sell fiat currency: JPY'],
    ['quoteSell', 'ETH', 'JPY', 'Unsupported sell fiat currency: JPY'],
    ['quoteBuy', 'ETH', 'ZZZ', 'Unsupported buy fiat currency: ZZZ'],
    ['quoteBuy', 'ETH', 'XXX', 'Unsupported buy fiat currency: XXX'],
    ['quoteBuy', 'UNKNOWN', 'EUR', 'Unsupported buy asset or network: UNKNOWN']
  ])('%s enforces direction and supported metadata', async (method, cryptoAsset, fiatCurrency, message) => {
    const { protocol } = setup({ network: 'ethereum' })
    await failure(protocol[method]({ ...OPTIONS, cryptoAsset, fiatCurrency }), ValueError, message)
  })

  test('rejects a resolved asset outside the bound account network', async () => {
    const { protocol } = setup({ network: 'tron' })
    await failure(protocol.buy(OPTIONS), ValueError, 'Unsupported buy asset or network: ETH')
  })

  test.each([
    ['quoteBuy', 'buy', { fiatAmount: 1 }, 'limit', '10'],
    ['quoteBuy', 'buy', { cryptoAmount: 1n }, 'limitTarget', '0.01'],
    ['quoteSell', 'sell', { cryptoAmount: 1n }, 'limit', '0.01'],
    ['quoteSell', 'sell', { fiatAmount: 1 }, 'limitTarget', '10']
  ])('%s rejects an invalid quote before reading its sentinel rate', async (method, direction, amount, limitField, limit) => {
    const body = `{"isValid":false,"rate":1.7976931348623157e+308,"errors":[{"error":"AmountTooLow","limit":${limitField === 'limit' ? limit : '99'},"limitTarget":${limitField === 'limitTarget' ? limit : '99'}}]}`
    const { protocol } = setup({}, { [`PUT /v1/${direction}/quote`]: response(body) })
    await failure(protocol[method]({ cryptoAsset: 'ETH', fiatCurrency: 'EUR', ...amount }), ValueError, `DFX quote rejected: AmountTooLow (limit: ${limit})`)
  })

  test.each(['AmountTooHigh', 'PaymentMethodNotAllowed', 'IbanCurrencyMismatch', 'AssetUnsupported', 'CurrencyUnsupported'])('maps input quote error %s', async code => {
    const { protocol } = setup({}, { 'PUT /v1/buy/quote': response({ isValid: false, error: code }) })
    await failure(protocol.quoteBuy(OPTIONS), ValueError, `DFX quote rejected: ${code}`)
  })

  test.each(['KycRequired', 'BankTransactionMissing', 'PrimaryEmailNotConfirmed', 'LimitExceeded', 'NewAccountState'])('maps account state %s to the provider fallback', async code => {
    const { protocol } = setup({}, { 'PUT /v1/buy/quote': response({ isValid: false, errors: [{ error: code }] }) })
    await failure(protocol.quoteBuy(OPTIONS), ProviderError, `DFX quote rejected: ${code}`, ProviderErrorReason.INTERNAL_SERVER_ERROR)
  })

  test.each([{ isValid: false }, { isValid: false, errors: [] }])('rejects invalid quotes without error codes', async body => {
    const { protocol } = setup({}, { 'PUT /v1/buy/quote': response(body) })
    await failure(protocol.quoteBuy(OPTIONS), ProviderError, 'Invalid DFX quote without an error code', ProviderErrorReason.INTERNAL_SERVER_ERROR)
  })

  test('rejects a quote without explicit validity', async () => {
    const { protocol } = setup({}, { 'PUT /v1/buy/quote': response({}) })
    await failure(protocol.quoteBuy(OPTIONS), ProviderError, 'Missing quote validity', ProviderErrorReason.INTERNAL_SERVER_ERROR)
  })

  test.each([null, [], true].map(body => [body]))('rejects a non-object quote response %#', async body => {
    const { protocol } = setup({}, { 'PUT /v1/buy/quote': response(body) })
    await failure(protocol.quoteBuy(OPTIONS), ProviderError, 'Unexpected DFX response', 'INTERNAL_SERVER_ERROR')
  })

  test.each([
    ['3', '0.333333333333333333'], ['6', '0.166666666666666667'], ['1e-20', '100000000000000000000'],
    ['1e20', '0.00000000000000000001'], ['1.25e-30', '800000000000000000000000000000'],
    ['0.000000000000000003', '333333333333333333'], ['1', '1'], ['0.5', '2'],
    ['0.9999999999999999999', '1']
  ])('divides response amounts with denominator %s to 18 significant places', async (amount, expected) => {
    const { protocol } = setup({}, {
      'GET /v1/asset': response([{ ...DUMMY_ASSETS[0], decimals: 40 }]),
      'PUT /v1/sell/quote': response(`{"isValid":true,"amount":${amount},"estimatedAmount":1,"rate":7,"feesTarget":{"total":0}}`)
    })
    expect((await protocol.quoteSell(OPTIONS)).rate).toBe(expected)
  })

  test.each(['buy', 'sell'].flatMap(direction => ['amount', 'estimatedAmount'].flatMap(field =>
    [0, -1].map(value => [direction, field, value])
  )))('rejects nonpositive %s response %s = %s', async (direction, field, value) => {
    const { protocol } = setup({}, { [`PUT /v1/${direction}/quote`]: response({ isValid: true, amount: 1, estimatedAmount: 100, [field]: value }) })
    await failure(protocol[direction === 'buy' ? 'quoteBuy' : 'quoteSell'](OPTIONS), ProviderError, 'DFX quote amounts must be positive', ProviderErrorReason.INTERNAL_SERVER_ERROR)
  })

  test.each([
    ['estimatedAmount', '0.0000000000000000001'], ['amount', '1.001'], ['fees', { total: '-1' }]
  ])('rejects fractional or negative smallest units in %s', async (field, value) => {
    const body = { isValid: true, amount: '100', estimatedAmount: '0.05', rate: '2000', fees: { total: '1' }, [field]: value }
    const { protocol } = setup({}, { 'PUT /v1/buy/quote': response(body) })
    await failure(protocol.quoteBuy(OPTIONS), ProviderError, 'DFX amount is not a non-negative integer in smallest units', ProviderErrorReason.INTERNAL_SERVER_ERROR)
  })

  test.each([undefined, 'NaN', '01', true])('rejects malformed quote decimals %s', async amount => {
    const { protocol } = setup({}, { 'PUT /v1/buy/quote': response({ isValid: true, amount, estimatedAmount: 1 }) })
    await failure(protocol.quoteBuy(OPTIONS), ProviderError, 'Invalid decimal in DFX response', ProviderErrorReason.INTERNAL_SERVER_ERROR)
  })

  test.each(['quoteBuy', 'quoteSell'])('%s rejects absent fee totals', async method => {
    const direction = method === 'quoteBuy' ? 'buy' : 'sell'
    const { protocol } = setup({}, { [`PUT /v1/${direction}/quote`]: response({ isValid: true, amount: 1, estimatedAmount: 1, rate: 1 }) })
    await failure(protocol[method](OPTIONS), ProviderError, 'Invalid decimal in DFX response', ProviderErrorReason.INTERNAL_SERVER_ERROR)
  })

  test.each([
    [401, 'UNAUTHORIZED'], [403, 'FORBIDDEN'], [408, 'REQUEST_TIMEOUT'],
    [429, 'INTERNAL_SERVER_ERROR'], [500, 'INTERNAL_SERVER_ERROR'],
    [503, 'INTERNAL_SERVER_ERROR'], [404, 'INTERNAL_SERVER_ERROR'], [418, 'INTERNAL_SERVER_ERROR']
  ])('maps HTTP %s with its message', async (status, reason) => {
    const { protocol, fetch } = setup({}, { 'GET /v1/country': response({ message: 'dummy-provider-message' }, status) })
    await failure(protocol.getSupportedCountries(), ProviderError, 'dummy-provider-message', reason)
    request(fetch, '/v1/country', 'GET')
  })

  test.each([
    ['getSupportedCryptoAssets', 'GET /v1/asset'],
    ['getSupportedFiatCurrencies', 'GET /v1/fiat'],
    ['getSupportedCountries', 'GET /v1/country']
  ].flatMap(([method, route]) => [400, 422].map(status => [method, route, status])))('%s treats list validation response %# as a provider failure', async (method, route, status) => {
    const { protocol } = setup({}, { [route]: response({ message: 'dummy-validation-error' }, status) })
    await failure(protocol[method](), ProviderError, 'dummy-validation-error', 'INTERNAL_SERVER_ERROR')
  })

  test.each(['quoteBuy', 'quoteSell'].flatMap(method => [400, 422].map(status => [method, status])))('%s maps HTTP %s to invalid input', async (method, status) => {
    const route = method === 'quoteBuy' ? 'PUT /v1/buy/quote' : 'PUT /v1/sell/quote'
    const { protocol } = setup({}, { [route]: response({ message: 'Invalid amount' }, status) })
    await failure(protocol[method](OPTIONS), ValueError, 'Invalid amount')
  })

  test('maps a rejected transaction UID to ValueError', async () => {
    const { protocol } = setup({}, { 'GET /v1/transaction/detail/single?uid=123': response({ message: 'Invalid UID' }, 422) })
    await failure(protocol.getTransactionDetail('123'), ValueError, 'Invalid UID')
  })

  test.each([400, 422])('auth HTTP %s is not misclassified as a caller amount error', async status => {
    const { protocol } = setup({ network: 'ethereum' }, { 'POST /v1/auth': response({ message: 'Invalid signature format' }, status) })
    await failure(protocol.buy(OPTIONS), ProviderError, 'Invalid signature format', 'INTERNAL_SERVER_ERROR')
  })

  test('preserves the geo-filter message from authentication', async () => {
    const { protocol } = setup({ network: 'ethereum' }, { 'POST /v1/auth': response({ message: 'The country of IP address is not allowed' }, 403) })
    await failure(protocol.buy(OPTIONS), ProviderError, 'The country of IP address is not allowed', 'FORBIDDEN')
  })

  test.each(['<html>Unavailable</html>', '{}', 'null'])('uses an HTTP fallback message for body %s', async body => {
    const { protocol } = setup({}, { 'GET /v1/country': response(body, 503) })
    await failure(protocol.getSupportedCountries(), ProviderError, 'DFX HTTP 503', 'INTERNAL_SERVER_ERROR')
  })

  test('preserves a network error as the cause', async () => {
    const cause = new TypeError('dummy-network-failure')
    const fetch = jest.fn().mockRejectedValue(cause)
    const protocol = new DfxProtocol(undefined, { fetch })
    const error = await failure(protocol.getSupportedCountries(), ProviderError, 'DFX network request failed', 'NETWORK_ERROR')
    expect(error.cause).toBe(cause)
    request(fetch, '/v1/country', 'GET')
  })

  test('maps response body transport failures to NETWORK_ERROR', async () => {
    const cause = new TypeError('dummy-body-failure')
    const body = { ok: true, status: 200, text: jest.fn().mockRejectedValue(cause) }
    const { protocol } = setup({}, { 'GET /v1/country': body })
    const error = await failure(protocol.getSupportedCountries(), ProviderError, 'DFX network request failed', 'NETWORK_ERROR')
    expect(error.cause).toBe(cause)
    expect(body.text).toHaveBeenCalledWith()
  })

  test.each([undefined, 10])('aborts requests at the configured deadline %s', async timeout => {
    jest.useFakeTimers()
    let signal
    const fetch = jest.fn((url, init) => new Promise((resolve, reject) => {
      signal = init.signal
      signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
    }))
    const protocol = new DfxProtocol(undefined, { fetch, timeout })
    const pending = failure(protocol.getSupportedCountries(), ProviderError, 'DFX request timed out', 'REQUEST_TIMEOUT')
    await jest.advanceTimersByTimeAsync(timeout ?? 30000)
    await pending
    expect(signal.aborted).toBe(true)
    expect(fetch).toHaveBeenCalledWith('https://api.dfx.swiss/v1/country', { method: 'GET', headers: { Accept: 'application/json' }, body: undefined, signal })
    expect(jest.getTimerCount()).toBe(0)
  })

  test('defers missing-fetch failure until a public method is called', async () => {
    // Exercise a runtime capability absence, not an HTTP implementation double.
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'fetch')
    Reflect.deleteProperty(globalThis, 'fetch')
    try {
      const protocol = new DfxProtocol()
      await failure(protocol.getSupportedCountries(), ProviderError, 'No fetch implementation available', 'INTERNAL_SERVER_ERROR')
    } finally {
      if (descriptor) Object.defineProperty(globalThis, 'fetch', descriptor)
    }
  })

  test('uses the ambient fetch when no implementation is supplied', async () => {
    const fetch = jest.spyOn(globalThis, 'fetch').mockResolvedValue(response([]))
    const protocol = new DfxProtocol()
    expect(await protocol.getSupportedCountries()).toEqual([])
    request(fetch, '/v1/country', 'GET')
  })

  test.each(['{', '{"value":01}', '{"value":1e}', '{"value":NaN}', '{12:3}'])('rejects malformed JSON %s', async body => {
    const { protocol } = setup({}, { 'GET /v1/country': response(body) })
    await failure(protocol.getSupportedCountries(), ProviderError, 'Invalid JSON in DFX response', 'INTERNAL_SERVER_ERROR')
  })

  test('preserves quoted digits, escaped quotes and backslashes in JSON strings', async () => {
    const countries = [{ symbol: 'CH', name: 'Area 12 "North" \\ 3', bankAllowed: true }]
    const { protocol } = setup({}, { 'GET /v1/country': response(countries) })
    expect(await protocol.getSupportedCountries()).toEqual([{ code: 'CH', name: 'Area 12 "North" \\ 3', isBuyAllowed: true, isSellAllowed: true }])
  })

  test.each([
    ['getSupportedCryptoAssets', 'GET /v1/asset', {}],
    ['getSupportedFiatCurrencies', 'GET /v1/fiat', null],
    ['getSupportedCryptoAssets', 'GET /v1/asset', [{ ...DUMMY_ASSETS[0], name: '' }]],
    ['getSupportedCryptoAssets', 'GET /v1/asset', [{ ...DUMMY_ASSETS[0], buyable: undefined }]],
    ['getSupportedCryptoAssets', 'GET /v1/asset', [{ ...DUMMY_ASSETS[0], sellable: undefined }]],
    ['getSupportedCryptoAssets', 'GET /v1/asset', [{ ...DUMMY_ASSETS[0], blockchain: 1 }]],
    ['getSupportedCountries', 'GET /v1/country', {}],
    ['getSupportedCountries', 'GET /v1/country', [{ ...DUMMY_COUNTRIES[0], bankAllowed: 'true' }]],
    ['getSupportedCountries', 'GET /v1/country', [null]],
    ['getSupportedCountries', 'GET /v1/country', [{ ...DUMMY_COUNTRIES[0], symbol: false }]],
    ['getSupportedCountries', 'GET /v1/country', [{ ...DUMMY_COUNTRIES[0], symbol: '' }]]
  ])('%s rejects malformed metadata case %#', async (method, route, body) => {
    const { protocol } = setup({}, { [route]: response(body) })
    await failure(protocol[method](), ProviderError, 'Unexpected DFX response', 'INTERNAL_SERVER_ERROR')
  })

  test.each([-1, 256, 1.5])('rejects invalid asset decimals %s', async decimals => {
    const { protocol } = setup({}, { 'GET /v1/asset': response([{ ...DUMMY_ASSETS[0], decimals }]) })
    await failure(protocol.getSupportedCryptoAssets(), ProviderError, 'Invalid asset decimals', 'INTERNAL_SERVER_ERROR')
  })

  test.each([0, -1, 1.5, '9007199254740992'])('rejects invalid provider identifiers %s', async id => {
    const { protocol } = setup({}, { 'GET /v1/fiat': response([{ ...DUMMY_FIAT[0], id }]) })
    await failure(protocol.getSupportedFiatCurrencies(), ProviderError, 'Invalid DFX identifier', 'INTERNAL_SERVER_ERROR')
  })

  test('excludes null decimals but keeps zero decimals and optional asset names', async () => {
    const { protocol } = setup({}, { 'GET /v1/asset': response([
      { ...DUMMY_ASSETS[0], decimals: null }, { ...DUMMY_ASSETS[4], decimals: 0, description: undefined }
    ]) })
    expect(await protocol.getSupportedCryptoAssets()).toEqual([{ code: 'BUY', networkCode: 'ethereum', decimals: 0, name: undefined }])
  })

  test.each(['', '   '])('rejects an empty transaction UID', async uid => {
    const { protocol, fetch } = setup()
    await failure(protocol.getTransactionDetail(uid), ValueError, 'txId must be a non-empty UID')
    expect(fetch.mock.calls).toEqual([])
  })

  test('requires authentication for details without misclassifying the UID', async () => {
    const protocol = new DfxProtocol()
    await failure(protocol.getTransactionDetail('123'), ProviderError, 'A signing account is required for transaction details', 'UNAUTHORIZED')
  })

  test.each([
    ['Completed', 'completed'], ['Failed', 'failed'], ['Returned', 'failed'], ['Stopped', 'failed'],
    ['LimitExceeded', 'failed'], ['FeeTooHigh', 'failed'], ['PriceUndeterminable', 'failed'],
    ['Created', 'in_progress'], ['Processing', 'in_progress'], ['LiquidityPending', 'in_progress'],
    ['CheckPending', 'in_progress'], ['KycRequired', 'in_progress'], ['PayoutInProgress', 'in_progress'],
    ['WaitingForPayment', 'in_progress'], ['Unassigned', 'in_progress'], ['ReturnPending', 'in_progress'], ['NewState', 'in_progress']
  ])('maps transaction state %s to %s', async (state, status) => {
    const { protocol, fetch, account } = setup({}, { 'GET /v1/transaction/detail/single?uid=123': response({ ...DUMMY_DETAIL, state }) })
    expect(await protocol.getTransactionDetail('123')).toEqual({ cryptoAsset: 'ETH', fiatCurrency: 'EUR', status })
    request(fetch, '/v1/transaction/detail/single?uid=123', 'GET', undefined, 'dummy-session')
    request(fetch, '/v1/auth', 'POST', `{"address":"${DUMMY_ADDRESS}","signature":"dummy-signature"}`)
    expect(account.getAddress).toHaveBeenCalledWith()
    expect(account.sign).toHaveBeenCalledWith('[dev]_Sign this exact message')
  })

  test('maps sell transaction IDs to the correct catalogs', async () => {
    const { protocol } = setup({}, { 'GET /v1/transaction/detail/single?uid=123': response({ uid: '123', type: 'Sell', state: 'Completed', inputAssetId: 1, outputAssetId: 12 }) })
    expect(await protocol.getTransactionDetail('123')).toEqual({ cryptoAsset: 'ETH', fiatCurrency: 'CHF', status: 'completed' })
  })

  test('encodes the transaction UID without converting it to an internal numeric ID', async () => {
    const { protocol, fetch } = setup({}, { 'GET /v1/transaction/detail/single?uid=123%2F%3F%26': response(DUMMY_DETAIL) })
    expect(await protocol.getTransactionDetail('123/?&')).toEqual({ cryptoAsset: 'ETH', fiatCurrency: 'EUR', status: 'completed' })
    request(fetch, '/v1/transaction/detail/single?uid=123%2F%3F%26', 'GET', undefined, 'dummy-session')
  })

  test.each(['Swap', 'Referral'])('rejects non-fiat transaction type %s', async type => {
    const { protocol } = setup({}, { 'GET /v1/transaction/detail/single?uid=123': response({ ...DUMMY_DETAIL, type }) })
    await failure(protocol.getTransactionDetail('123'), NoSuchElementError, 'Transaction is not a DFX fiat transaction')
  })

  test('rejects an unknown transaction type', async () => {
    const { protocol } = setup({}, { 'GET /v1/transaction/detail/single?uid=123': response({ ...DUMMY_DETAIL, type: 'Unknown' }) })
    await failure(protocol.getTransactionDetail('123'), ProviderError, 'Unknown DFX transaction type', 'INTERNAL_SERVER_ERROR')
  })

  test('maps transaction HTTP 404 to NoSuchElementError', async () => {
    const { protocol } = setup({}, { 'GET /v1/transaction/detail/single?uid=123': response({ message: 'Transaction not found' }, 404) })
    await failure(protocol.getTransactionDetail('123'), NoSuchElementError, 'Transaction not found')
  })

  test.each([
    { inputAssetId: undefined, outputAssetId: undefined },
    { inputAssetId: 999, outputAssetId: 999 },
    { inputAssetId: null, outputAssetId: null, outputAsset: 'ETH' }
  ])('uses unambiguous string fallback when catalog IDs cannot resolve', async override => {
    const { protocol } = setup({}, { 'GET /v1/transaction/detail/single?uid=123': response({ ...DUMMY_DETAIL, ...override }) })
    expect(await protocol.getTransactionDetail('123')).toEqual({ cryptoAsset: 'ETH', fiatCurrency: 'EUR', status: 'completed' })
  })

  test.each([
    { outputAsset: 'USDT' }, { inputAsset: 'CHF' }, { outputBlockchain: 'Tron' }
  ])('rejects contradictory ID and string metadata', async override => {
    const { protocol } = setup({}, { 'GET /v1/transaction/detail/single?uid=123': response({ ...DUMMY_DETAIL, ...override }) })
    await failure(protocol.getTransactionDetail('123'), ProviderError, 'Conflicting transaction asset metadata', 'INTERNAL_SERVER_ERROR')
  })

  test.each([
    { outputAssetId: undefined, outputAsset: undefined },
    { outputAssetId: undefined, outputAsset: 'USDT', outputBlockchain: undefined },
    { inputAssetId: undefined, inputAsset: 'ZZY' }
  ])('rejects unresolved or ambiguous transaction metadata', async override => {
    const { protocol } = setup({}, { 'GET /v1/transaction/detail/single?uid=123': response({ ...DUMMY_DETAIL, ...override }) })
    await failure(protocol.getTransactionDetail('123'), ProviderError, 'Unable to resolve transaction asset', 'INTERNAL_SERVER_ERROR')
  })

  test('reuses a session for later transaction detail calls', async () => {
    const { protocol, account } = setup()
    const expected = { cryptoAsset: 'ETH', fiatCurrency: 'EUR', status: 'completed' }
    expect(await protocol.getTransactionDetail('123')).toEqual(expected)
    expect(await protocol.getTransactionDetail('123')).toEqual(expected)
    expect(account.sign.mock.calls).toEqual([['[dev]_Sign this exact message']])
  })

  test('renews the session once after HTTP 401 and retries with the fresh token', async () => {
    let calls = 0
    let auth = 0
    const { protocol, fetch, account } = setup({}, {
      'POST /v1/auth': () => response({ accessToken: `dummy-${++auth}` }),
      'GET /v1/transaction/detail/single?uid=123': () => ++calls === 1 ? response({}, 401) : response(DUMMY_DETAIL)
    })
    expect(await protocol.getTransactionDetail('123')).toEqual({ cryptoAsset: 'ETH', fiatCurrency: 'EUR', status: 'completed' })
    request(fetch, '/v1/transaction/detail/single?uid=123', 'GET', undefined, 'dummy-1')
    const retry = fetch.mock.calls.filter(([url]) => url.endsWith('/detail/single?uid=123'))[1]
    expect(retry[1].headers).toEqual({ Accept: 'application/json', Authorization: 'Bearer dummy-2' })
    expect(account.sign.mock.calls).toEqual([['[dev]_Sign this exact message'], ['[dev]_Sign this exact message']])
    expect(calls).toBe(2)
  })

  test('stops after a second HTTP 401', async () => {
    const { protocol, fetch, account } = setup({}, { 'GET /v1/transaction/detail/single?uid=123': response({}, 401) })
    await failure(protocol.getTransactionDetail('123'), ProviderError, 'DFX HTTP 401', 'UNAUTHORIZED')
    expect(account.sign.mock.calls).toEqual([['[dev]_Sign this exact message'], ['[dev]_Sign this exact message']])
    expect(fetch.mock.calls.filter(([url]) => url.endsWith('/detail/single?uid=123')).length).toBe(2)
  })

  test('does not refresh an expired session when signing is no longer available', async () => {
    let calls = 0
    const { protocol, account } = setup({}, { 'GET /v1/transaction/detail/single?uid=123': () => ++calls === 1 ? response(DUMMY_DETAIL) : response({}, 401) })
    expect(await protocol.getTransactionDetail('123')).toEqual({ cryptoAsset: 'ETH', fiatCurrency: 'EUR', status: 'completed' })
    account.sign = undefined
    await failure(protocol.getTransactionDetail('123'), ProviderError, 'DFX HTTP 401', 'UNAUTHORIZED')
    expect(calls).toBe(2)
  })

  test('does not retry other provider errors on transaction details', async () => {
    const { protocol, account } = setup({}, { 'GET /v1/transaction/detail/single?uid=123': response({}, 503) })
    await failure(protocol.getTransactionDetail('123'), ProviderError, 'DFX HTTP 503', 'INTERNAL_SERVER_ERROR')
    expect(account.sign.mock.calls).toEqual([['[dev]_Sign this exact message']])
  })

  test.each([
    ['cardano', 'Cardano'], ['arweave', 'Arweave'], ['internetcomputer', 'InternetComputer'], ['binancesmartchain', 'BinanceSmartChain'], ['unknown', undefined]
  ])('auth maps network %s to its complete DFX enum value', async (network, blockchain) => {
    const { protocol, fetch } = setup({ network, publicKey: 'dummy-public-key' })
    expect(await protocol.getTransactionDetail('123')).toEqual({ cryptoAsset: 'ETH', fiatCurrency: 'EUR', status: 'completed' })
    const chain = blockchain === undefined ? '' : `,"blockchain":"${blockchain}"`
    request(fetch, '/v1/auth', 'POST', `{"address":"${DUMMY_ADDRESS}","signature":"dummy-signature"${chain},"key":"dummy-public-key"}`)
  })

  test.each(['buy', 'sell', 'getTransactionDetail'].flatMap(method => ['sign', 'getAddress'].map(operation => [method, operation])))('%s wraps non-allowlisted errors from %s with their cause', async (method, operation) => {
    const cause = new NotImplementedError('dummy-operation')
    const { protocol, account } = setup({ network: 'ethereum' })
    account[operation].mockRejectedValue(cause)
    const error = await failure(protocol[method](method === 'getTransactionDetail' ? '123' : OPTIONS), ProviderError, 'DFX account authentication failed', 'UNAUTHORIZED')
    expect(error.cause).toBe(cause)
    expect(account[operation]).toHaveBeenCalledWith(...(operation === 'sign' ? ['[dev]_Sign this exact message'] : []))
  })

  test.each([
    ['buy', new AccountRequiredError('dummy-allowed')],
    ['buy', new ValueError('dummy-allowed')],
    ['buy', new ProviderRequiredError('dummy-allowed')],
    ['buy', new ProviderError('dummy-allowed', { reason: 'NETWORK_ERROR' })],
    ['buy', new BuyError('dummy-allowed', { reason: 'INSUFFICIENT_FUNDS' })],
    ['buy', new MaximumFeeExceededError('dummy-allowed')],
    ['sell', new SellError('dummy-allowed', { reason: 'INSUFFICIENT_FUNDS' })],
    ['sell', new AccountRequiredError('dummy-allowed')],
    ['sell', new MaximumFeeExceededError('dummy-allowed')],
    ['sell', new ProviderRequiredError('dummy-allowed')],
    ['sell', new ProviderError('dummy-allowed', { reason: 'NETWORK_ERROR' })],
    ['sell', new ValueError('dummy-allowed')],
    ['getTransactionDetail', new ProviderRequiredError('dummy-allowed')],
    ['getTransactionDetail', new ProviderError('dummy-allowed', { reason: 'NETWORK_ERROR' })]
  ].flatMap(([method, cause]) => ['getAddress', 'sign'].map(operation => [method, cause, operation])))('%s preserves exact allowlisted error case %#', async (method, cause, operation) => {
    const { protocol, account } = setup({ network: 'ethereum' })
    account[operation].mockRejectedValue(cause)
    const error = await failure(protocol[method](method === 'getTransactionDetail' ? '123' : OPTIONS), cause.constructor, 'dummy-allowed', cause.reason)
    expect(error).toBe(cause)
  })

  test.each([
    ['buy', new SellError('dummy-disallowed', { reason: 'INSUFFICIENT_FUNDS' })],
    ['sell', new BuyError('dummy-disallowed', { reason: 'INSUFFICIENT_FUNDS' })],
    ['buy', new ReadOnlyAccountRequiredError('dummy-disallowed')],
    ['sell', new ReadOnlyAccountRequiredError('dummy-disallowed')],
    ['getTransactionDetail', new ReadOnlyAccountRequiredError('dummy-disallowed')],
    ['getTransactionDetail', new ValueError('dummy-disallowed')],
    ['getTransactionDetail', new NoSuchElementError('dummy-disallowed')],
    ['getTransactionDetail', null]
  ])('%s wraps WDK errors absent from its contract', async (method, cause) => {
    const { protocol, account } = setup({ network: 'ethereum' })
    account.sign.mockRejectedValue(cause)
    const error = await failure(protocol[method](method === 'getTransactionDetail' ? '123' : OPTIONS), ProviderError, 'DFX account authentication failed', 'UNAUTHORIZED')
    expect(error.cause).toBe(cause)
  })

  test('encodes address query parameters and signs only the returned message', async () => {
    const address = 'dummy/address?with&query=1'
    const { protocol, account, fetch } = setup({}, { 'GET /v1/auth/signMessage?address=dummy%2Faddress%3Fwith%26query%3D1': response({ message: 'Exact "message" 1e18 \\ 2' }) })
    account.getAddress.mockResolvedValue(address)
    expect(await protocol.getTransactionDetail('123')).toEqual({ cryptoAsset: 'ETH', fiatCurrency: 'EUR', status: 'completed' })
    expect(account.sign).toHaveBeenCalledWith('Exact "message" 1e18 \\ 2')
    request(fetch, '/v1/auth/signMessage?address=dummy%2Faddress%3Fwith%26query%3D1', 'GET')
  })

  test.each([
    ['POST /v1/auth', {}], ['POST /v1/auth', { accessToken: '' }],
    [`GET /v1/auth/signMessage?address=${DUMMY_ADDRESS}`, { message: '' }],
    ['GET /v1/transaction/detail/single?uid=123', null]
  ])('rejects malformed authenticated responses', async (route, body) => {
    const { protocol } = setup({}, { [route]: response(body) })
    await failure(protocol.getTransactionDetail('123'), ProviderError, 'Unexpected DFX response', 'INTERNAL_SERVER_ERROR')
  })

  test.each([
    ['JPY', 13, 100n, '100'],
    ['BHD', 14, 1234n, '1.234'],
    ['CLF', 17, 12345n, '1.2345']
  ])('uses ISO minor units for %s in quote requests and responses', async (name, id, amount, literal) => {
    const { protocol, fetch } = setup({}, {
      'GET /v1/fiat': response([{ id, name, buyable: true, sellable: true }]),
      'PUT /v1/buy/quote': response(`{"isValid":true,"amount":${literal},"estimatedAmount":1,"rate":${literal},"fees":{"total":0}}`)
    })
    expect(await protocol.quoteBuy({ cryptoAsset: 'ETH', fiatCurrency: name, fiatAmount: amount })).toEqual({
      cryptoAmount: 1000000000000000000n, fiatAmount: amount, fee: 0n, rate: literal
    })
    request(fetch, '/v1/buy/quote', 'PUT', `{"currency":{"name":"${name}"},"asset":{"id":1},"specialCode":"","paymentMethod":"Bank","amount":${literal}}`)
  })

  test('resolves historical transactions even when an asset has no decimals', async () => {
    const { protocol } = setup({}, {
      'GET /v1/transaction/detail/single?uid=123': response({
        uid: '123', type: 'Buy', state: 'Completed', inputAssetId: 11, outputAssetId: 4
      })
    })
    expect(await protocol.getTransactionDetail('123')).toEqual({ cryptoAsset: 'BTC', fiatCurrency: 'EUR', status: 'completed' })
  })

  test('uses the transaction blockchain to disambiguate ticker fallback', async () => {
    const { protocol } = setup({}, {
      'GET /v1/transaction/detail/single?uid=123': response({
        uid: '123', type: 'Buy', state: 'Completed', inputAssetId: 11, outputAsset: 'USDT', outputBlockchain: 'Tron'
      })
    })
    expect(await protocol.getTransactionDetail('123')).toEqual({ cryptoAsset: 'USDT', fiatCurrency: 'EUR', status: 'completed' })
  })

  test('encodes widget session and language values without adding query parameters', async () => {
    const { protocol } = setup({ network: 'ethereum', language: 'de&extra=1' }, {
      'POST /v1/auth': response({ accessToken: 'dummy+/=&token' })
    })
    expect(await protocol.buy(OPTIONS)).toEqual({
      buyUrl: 'https://app.dfx.swiss/buy?session=dummy%2B%2F%3D%26token&lang=de%26extra%3D1&asset-in=EUR&asset-out=ETH&blockchain=Ethereum&amount-in=100'
    })
  })


  test.each([
    { error: 'AmountTooLow', message: 'Quote input rejected' },
    { errors: [{ error: 'AmountTooHigh' }], message: 'Quote input rejected' },
    { error: 'Bad Request', message: 'amount must be positive' },
    { error: 'Unprocessable Entity', message: ['targetAmount must be positive'] }
  ])('attributes HTTP validation failures to input using codes or explicit fields', async body => {
    const { protocol } = setup({}, { 'PUT /v1/buy/quote': response(body, 400) })
    const message = typeof body.message === 'string' ? body.message : 'DFX HTTP 400'
    await failure(protocol.quoteBuy(OPTIONS), ValueError, message)
  })

  test.each([
    { error: 'KycRequired', message: 'KYC must be completed' },
    { error: 'BankTransactionMissing', message: 'Bank setup incomplete' },
    { message: 'Unclassified failure' },
    { message: [1] },
    {},
    null
  ])('does not attribute an unknown HTTP 422 failure to caller input', async body => {
    const { protocol } = setup({}, { 'PUT /v1/buy/quote': response(body, 422) })
    const message = typeof body?.message === 'string' ? body.message : 'DFX HTTP 422'
    await failure(protocol.quoteBuy(OPTIONS), ProviderError, message, 'INTERNAL_SERVER_ERROR')
  })

})
