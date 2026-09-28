// Copyright 2026 DFX AG
// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, test } from '@jest/globals'
import { NoSuchElementError, ProviderError } from '@tetherto/wdk-wallet/protocols'
import { ProviderErrorReason } from '@tetherto/wdk-wallet'
import DfxProtocol from '../../index.js'
import { accountFixture, DummyChangingSigner, EXTERNAL_TRANSACTION_ID, LOCAL_CONFIG, PAIR, UID } from './helpers.js'

describe('@dfx.swiss/wdk-protocol-fiat-dfx', () => {
  const accounts = []

  async function freshAccount () {
    const account = await accountFixture()
    accounts.push(account)
    return account
  }

  afterEach(() => {
    for (const account of accounts.splice(0)) account.dispose()
  })

  describe('getSupportedCryptoAssets', () => {
    const EXPECTED_ASSETS = [{ code: 'USDT', networkCode: 'ethereum', decimals: 6, name: 'Tether' }]

    test('lists the recorded Ethereum USDT asset', async () => {
      const protocol = new DfxProtocol(undefined, LOCAL_CONFIG)

      const result = await protocol.getSupportedCryptoAssets()

      expect(result.filter(row => row.code === 'USDT' && row.networkCode === 'ethereum')).toEqual(EXPECTED_ASSETS)
    })
  })

  describe('getSupportedFiatCurrencies', () => {
    const EXPECTED_CURRENCIES = [{ code: 'EUR', decimals: 2 }]

    test('lists the recorded EUR currency', async () => {
      const protocol = new DfxProtocol(undefined, LOCAL_CONFIG)

      const result = await protocol.getSupportedFiatCurrencies()

      expect(result.filter(row => row.code === 'EUR')).toEqual(EXPECTED_CURRENCIES)
    })
  })

  describe('getSupportedCountries', () => {
    const EXPECTED_COUNTRIES = [{ code: 'CH', name: 'Switzerland', isBuyAllowed: true, isSellAllowed: true }]

    test('lists Switzerland with recorded bank availability', async () => {
      const protocol = new DfxProtocol(undefined, LOCAL_CONFIG)

      const result = await protocol.getSupportedCountries()

      expect(result.filter(row => row.code === 'CH')).toEqual(EXPECTED_COUNTRIES)
    })
  })

  describe('quoteBuy', () => {
    const EXPECTED_FIAT_QUOTE = { cryptoAmount: 118700000n, fiatAmount: 10000n, fee: 149n, rate: '0.842459983150800337' }
    const EXPECTED_CRYPTO_QUOTE = { cryptoAmount: 100000000n, fiatAmount: 8424n, fee: 126n, rate: '0.8424' }

    test('quotes a buy for 100 CHF', async () => {
      const protocol = new DfxProtocol(undefined, LOCAL_CONFIG)

      const result = await protocol.quoteBuy({ ...PAIR, fiatAmount: 10000n })

      expect(result).toEqual(EXPECTED_FIAT_QUOTE)
    })

    test('quotes a buy for 100 USDT', async () => {
      const protocol = new DfxProtocol(undefined, LOCAL_CONFIG)

      const result = await protocol.quoteBuy({ ...PAIR, cryptoAmount: 100000000n })

      expect(result).toEqual(EXPECTED_CRYPTO_QUOTE)
    })
  })

  describe('quoteSell', () => {
    const EXPECTED_FIAT_QUOTE = { cryptoAmount: 122940000n, fiatAmount: 10000n, fee: 204n, rate: '0.813404912965674313' }
    const EXPECTED_CRYPTO_QUOTE = { cryptoAmount: 100000000n, fiatAmount: 8134n, fee: 166n, rate: '0.8134' }

    test('quotes a sale for 100 CHF', async () => {
      const protocol = new DfxProtocol(undefined, LOCAL_CONFIG)

      const result = await protocol.quoteSell({ ...PAIR, fiatAmount: 10000n })

      expect(result).toEqual(EXPECTED_FIAT_QUOTE)
    })

    test('quotes a sale for 100 USDT', async () => {
      const protocol = new DfxProtocol(undefined, LOCAL_CONFIG)

      const result = await protocol.quoteSell({ ...PAIR, cryptoAmount: 100000000n })

      expect(result).toEqual(EXPECTED_CRYPTO_QUOTE)
    })
  })

  describe('buy', () => {
    const EXPECTED_URL = 'https://dev.app.dfx.swiss/buy?session=eyJhbGciOiJub25lIn0.eyJzdWIiOiJkdW1teS1sb2NhbC11c2VyIn0.ZHVtbXktc2lnbmF0dXJl&lang=en&asset-in=CHF&asset-out=USDT&blockchain=Ethereum&amount-in=100'

    test('returns the complete widget URL after authenticating a fresh account', async () => {
      const account = await freshAccount()
      const protocol = new DfxProtocol(account, LOCAL_CONFIG)

      const result = await protocol.buy({ ...PAIR, fiatAmount: 10000n })

      expect(result).toEqual({ buyUrl: EXPECTED_URL })
    })

    test('rejects a signature from a different key than the challenged owner', async () => {
      const account = await freshAccount()
      const otherAccount = await freshAccount()
      const protocol = new DfxProtocol(new DummyChangingSigner(account, otherAccount), LOCAL_CONFIG)

      const error = await protocol.buy({ ...PAIR, fiatAmount: 10000n }).then(() => undefined, error => error)

      expect(error?.constructor).toBe(ProviderError)
      expect(error?.message).toBe('Invalid signature')
      expect(error?.reason).toBe(ProviderErrorReason.UNAUTHORIZED)
    })
  })

  describe('sell', () => {
    const EXPECTED_URL = 'https://dev.app.dfx.swiss/sell?session=eyJhbGciOiJub25lIn0.eyJzdWIiOiJkdW1teS1sb2NhbC11c2VyIn0.ZHVtbXktc2lnbmF0dXJl&lang=en&asset-in=USDT&asset-out=CHF&blockchain=Ethereum&amount-out=100'

    test('returns the complete widget URL after authenticating a fresh account', async () => {
      const account = await freshAccount()
      const protocol = new DfxProtocol(account, LOCAL_CONFIG)

      const result = await protocol.sell({ ...PAIR, fiatAmount: 10000n })

      expect(result).toEqual({ sellUrl: EXPECTED_URL })
    })
  })

  describe('getTransactionDetail', () => {
    const EXPECTED_UID_MESSAGE = 'Transaction not found'
    const EXPECTED_EXTERNAL_MESSAGE = 'Transaction not found'

    test('rejects an unregistered UID with the recorded NoSuchElementError', async () => {
      const account = await freshAccount()
      const protocol = new DfxProtocol(account, LOCAL_CONFIG)

      const error = await protocol.getTransactionDetail(UID).then(() => undefined, error => error)

      expect(error?.constructor).toBe(NoSuchElementError)
      expect(error?.message).toBe(EXPECTED_UID_MESSAGE)
    })

    test('rejects an unregistered external ID with the recorded NoSuchElementError', async () => {
      const account = await freshAccount()
      const protocol = new DfxProtocol(account, LOCAL_CONFIG)

      const error = await protocol.getTransactionDetail(EXTERNAL_TRANSACTION_ID, { idType: 'externalTransactionId' })
        .then(() => undefined, error => error)

      expect(error?.constructor).toBe(NoSuchElementError)
      expect(error?.message).toBe(EXPECTED_EXTERNAL_MESSAGE)
    })
  })
})
