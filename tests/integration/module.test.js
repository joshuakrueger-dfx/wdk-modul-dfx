// Copyright 2026 DFX AG
// SPDX-License-Identifier: Apache-2.0

// Named deviation from Integration Guide §4.6: these tests use the DFX sandbox.
// A HTTP fiat API has no blockchain state that Hardhat can fork or reset.
// Market data and session tokens are live; assertions use the independently
// observed provider response, with fixed expectations for deterministic fields.

import { describe, expect, test } from '@jest/globals'
import { NoSuchElementError } from '@tetherto/wdk-wallet/protocols'
import DfxProtocol from '../../index.js'
import { accountFixture, CONFIG, expectedQuote, observeSandbox, PAIR } from './helpers.js'

describe('@dfx.swiss/wdk-protocol-fiat-dfx', () => {
  describe('getSupportedCryptoAssets', () => {
    test('lists the sandbox Ethereum USDT asset with its API description', async () => {
      const observer = observeSandbox()
      const protocol = new DfxProtocol(undefined, { ...CONFIG, fetch: observer.fetch })

      const result = await protocol.getSupportedCryptoAssets()

      const asset = observer.responses.get('/v1/asset').find(row => row.name === 'USDT' && row.blockchain === 'Ethereum')
      expect(result.filter(row => row.code === 'USDT' && row.networkCode === 'ethereum')).toEqual([
        { code: 'USDT', networkCode: 'ethereum', decimals: 6, name: asset.description ?? undefined }
      ])
    }, 45000)
  })

  describe('getSupportedFiatCurrencies', () => {
    test('lists EUR with two decimal places', async () => {
      const protocol = new DfxProtocol(undefined, CONFIG)

      const result = await protocol.getSupportedFiatCurrencies()

      expect(result.filter(row => row.code === 'EUR')).toEqual([{ code: 'EUR', decimals: 2 }])
    }, 45000)
  })

  describe('getSupportedCountries', () => {
    test('lists Switzerland with the sandbox bank availability', async () => {
      const observer = observeSandbox()
      const protocol = new DfxProtocol(undefined, { ...CONFIG, fetch: observer.fetch })

      const result = await protocol.getSupportedCountries()

      const country = observer.responses.get('/v1/country').find(row => row.symbol === 'CH')
      expect(result.filter(row => row.code === 'CH')).toEqual([
        { code: 'CH', name: country.name, isBuyAllowed: country.bankAllowed, isSellAllowed: country.bankAllowed }
      ])
    }, 45000)
  })

  describe.each([['quoteBuy', 'buy'], ['quoteSell', 'sell']])('%s', (METHOD, DIRECTION) => {
    test.each([['fiatAmount', 10000n], ['cryptoAmount', 100000000n]])('quotes the sandbox pair for %s', async (FIELD, AMOUNT) => {
      const observer = observeSandbox()
      const protocol = new DfxProtocol(undefined, { ...CONFIG, fetch: observer.fetch })

      const result = await protocol[METHOD]({ ...PAIR, [FIELD]: AMOUNT })

      expect(result).toEqual(expectedQuote(DIRECTION, observer.responses.get(`/v1/${DIRECTION}/quote`)))
      expect(result[FIELD]).toBe(AMOUNT)
    }, 45000)
  })

  describe.each(['buy', 'sell'])('%s', METHOD => {
    test('returns the complete sandbox widget URL with the issued session', async () => {
      const account = await accountFixture()
      const observer = observeSandbox()
      const protocol = new DfxProtocol(account, { ...CONFIG, fetch: observer.fetch })
      const ASSETS = METHOD === 'buy' ? 'asset-in=CHF&asset-out=USDT' : 'asset-in=USDT&asset-out=CHF'
      const AMOUNT_FIELD = METHOD === 'buy' ? 'amount-in' : 'amount-out'

      const result = await protocol[METHOD]({ ...PAIR, fiatAmount: 10000n })

      const token = observer.responses.get('/v1/auth').accessToken
      expect(result).toEqual({
        [`${METHOD}Url`]: `https://dev.app.dfx.swiss/${METHOD}?session=${encodeURIComponent(token)}&lang=en&${ASSETS}&blockchain=Ethereum&${AMOUNT_FIELD}=100`
      })
    }, 90000)
  })

  describe('getTransactionDetail', () => {
    test('rejects an unregistered UID with NoSuchElementError', async () => {
      const UID = '00000000-0000-4000-8000-000000000000'
      const account = await accountFixture()
      const protocol = new DfxProtocol(account, CONFIG)

      const error = await protocol.getTransactionDetail(UID).then(() => undefined, error => error)

      expect(error?.constructor).toBe(NoSuchElementError)
      expect(error?.message).toBe('Transaction not found')
    }, 90000)

    test('rejects an unregistered external transaction ID with NoSuchElementError', async () => {
      const EXTERNAL_TRANSACTION_ID = 'wdk-integration-unregistered-00000000-0000-4000-8000-000000000000'
      const account = await accountFixture()
      const protocol = new DfxProtocol(account, CONFIG)

      const error = await protocol.getTransactionDetail(EXTERNAL_TRANSACTION_ID, { idType: 'externalTransactionId' })
        .then(() => undefined, error => error)

      expect(error?.constructor).toBe(NoSuchElementError)
      expect(error?.message).toBe('Transaction not found')
    }, 90000)
  })
})
