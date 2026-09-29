// Copyright 2026 DFX AG
// SPDX-License-Identifier: Apache-2.0

import { readFile } from 'node:fs/promises'
import { afterEach, beforeAll, beforeEach, describe, expect, test } from '@jest/globals'
import { NoSuchElementError, ProviderError, ValueError } from '@tetherto/wdk-wallet/protocols'
import { verifyMessage } from 'ethers'
import DfxProtocol from '../../index.js'
import {
  accountFixture, challengeMessage, DummyFirstSignature, DummySmartAccount,
  DUMMY_SMART_ADDRESS, DUMMY_TOKEN, EXTERNAL_TRANSACTION_ID, LOCAL_CONFIG, PAIR,
  resetServer, serverControl, UID
} from './helpers.js'

describe('@dfx.swiss/wdk-protocol-fiat-dfx', () => {
  const accounts = []
  let expectedCatalog

  beforeAll(async () => {
    expectedCatalog = JSON.parse(await readFile(new URL('./fixtures/expected-catalog.json', import.meta.url), 'utf8'))
  })

  beforeEach(async () => { await resetServer() })

  async function freshAccount (index = 0) {
    const account = await accountFixture(index)
    accounts.push(account)
    return account
  }

  afterEach(() => {
    for (const account of accounts.splice(0)) account.dispose()
  })

  describe('getSupportedCryptoAssets', () => {
    test('lists the complete recorded crypto catalog in API order', async () => {
      const protocol = new DfxProtocol(undefined, LOCAL_CONFIG)

      const result = await protocol.getSupportedCryptoAssets()

      expect(result).toEqual(expectedCatalog.assets)
    })
  })

  describe('getSupportedFiatCurrencies', () => {
    test('lists the complete recorded fiat catalog in API order', async () => {
      const protocol = new DfxProtocol(undefined, LOCAL_CONFIG)

      const result = await protocol.getSupportedFiatCurrencies()

      expect(result).toEqual(expectedCatalog.currencies)
    })
  })

  describe('getSupportedCountries', () => {
    test('lists the complete recorded country catalog in API order', async () => {
      const protocol = new DfxProtocol(undefined, LOCAL_CONFIG)

      const result = await protocol.getSupportedCountries()

      expect(result).toEqual(expectedCatalog.countries)
    })
  })

  describe('quoteBuy', () => {
    test('quotes a buy for 100 CHF', async () => {
      const EXPECTED_FIAT_QUOTE = { cryptoAmount: 118700000n, fiatAmount: 10000n, fee: 149n, rate: '0.842459983150800337' }
      const protocol = new DfxProtocol(undefined, LOCAL_CONFIG)

      const result = await protocol.quoteBuy({ ...PAIR, fiatAmount: 10000n })

      expect(result).toEqual(EXPECTED_FIAT_QUOTE)
    })

    test('quotes a buy for 100 USDT', async () => {
      const EXPECTED_CRYPTO_QUOTE = { cryptoAmount: 100000000n, fiatAmount: 8424n, fee: 126n, rate: '0.8424' }
      const protocol = new DfxProtocol(undefined, LOCAL_CONFIG)

      const result = await protocol.quoteBuy({ ...PAIR, cryptoAmount: 100000000n })

      expect(result).toEqual(EXPECTED_CRYPTO_QUOTE)
    })
  })

  describe('quoteSell', () => {
    test('quotes a sale for 100 CHF', async () => {
      const EXPECTED_FIAT_QUOTE = { cryptoAmount: 122940000n, fiatAmount: 10000n, fee: 204n, rate: '0.813404912965674313' }
      const protocol = new DfxProtocol(undefined, LOCAL_CONFIG)

      const result = await protocol.quoteSell({ ...PAIR, fiatAmount: 10000n })

      expect(result).toEqual(EXPECTED_FIAT_QUOTE)
    })

    test('quotes a sale for 100 USDT', async () => {
      const EXPECTED_CRYPTO_QUOTE = { cryptoAmount: 100000000n, fiatAmount: 8134n, fee: 166n, rate: '0.8134' }
      const protocol = new DfxProtocol(undefined, LOCAL_CONFIG)

      const result = await protocol.quoteSell({ ...PAIR, cryptoAmount: 100000000n })

      expect(result).toEqual(EXPECTED_CRYPTO_QUOTE)
    })
  })

  describe('buy', () => {
    test('returns the complete widget URL after authenticating a fresh account', async () => {
      const EXPECTED_URL = 'https://dev.app.dfx.swiss/buy?session=eyJhbGciOiJub25lIn0.eyJzdWIiOiJkdW1teS1sb2NhbC11c2VyIn0.ZHVtbXktc2lnbmF0dXJl&lang=en&asset-in=CHF&asset-out=USDT&blockchain=Ethereum&amount-in=100'
      const account = await freshAccount()
      const protocol = new DfxProtocol(account, LOCAL_CONFIG)

      const result = await protocol.buy({ ...PAIR, fiatAmount: 10000n })

      expect(result).toEqual({ buyUrl: EXPECTED_URL })
    })
  })

  describe('sell', () => {
    test('returns the complete widget URL after authenticating a fresh account', async () => {
      const EXPECTED_URL = 'https://dev.app.dfx.swiss/sell?session=eyJhbGciOiJub25lIn0.eyJzdWIiOiJkdW1teS1sb2NhbC11c2VyIn0.ZHVtbXktc2lnbmF0dXJl&lang=en&asset-in=USDT&asset-out=CHF&blockchain=Ethereum&amount-out=100'
      const account = await freshAccount()
      const protocol = new DfxProtocol(account, LOCAL_CONFIG)

      const result = await protocol.sell({ ...PAIR, fiatAmount: 10000n })

      expect(result).toEqual({ sellUrl: EXPECTED_URL })
    })
  })

  describe('getTransactionDetail', () => {
    test('rejects an unregistered UID with the recorded NoSuchElementError', async () => {
      const EXPECTED_UID_MESSAGE = 'Transaction not found'
      const account = await freshAccount()
      const protocol = new DfxProtocol(account, LOCAL_CONFIG)

      const error = await protocol.getTransactionDetail(UID).then(() => undefined, error => error)

      expect(error?.constructor).toBe(NoSuchElementError)
      expect(error?.message).toBe(EXPECTED_UID_MESSAGE)
      expect(error?.reason).toBeUndefined()
    })

    test('rejects an unregistered external ID with the recorded NoSuchElementError', async () => {
      const EXPECTED_EXTERNAL_MESSAGE = 'Transaction not found'
      const account = await freshAccount()
      const protocol = new DfxProtocol(account, LOCAL_CONFIG)

      const error = await protocol.getTransactionDetail(EXTERNAL_TRANSACTION_ID, { idType: 'externalTransactionId' })
        .then(() => undefined, error => error)

      expect(error?.constructor).toBe(NoSuchElementError)
      expect(error?.message).toBe(EXPECTED_EXTERNAL_MESSAGE)
    })
  })

  describe('authentication sessions', () => {
    const OPTIONS = { ...PAIR, fiatAmount: 10000n }
    const BUY_URL = `https://dev.app.dfx.swiss/buy?session=${DUMMY_TOKEN}&lang=en&asset-in=CHF&asset-out=USDT&blockchain=Ethereum&amount-in=100`
    const BUY_URL_2 = `https://dev.app.dfx.swiss/buy?session=${DUMMY_TOKEN}.2&lang=en&asset-in=CHF&asset-out=USDT&blockchain=Ethereum&amount-in=100`
    const SELL_URL_2 = `https://dev.app.dfx.swiss/sell?session=${DUMMY_TOKEN}.2&lang=en&asset-in=USDT&asset-out=CHF&blockchain=Ethereum&amount-out=100`
    const DETAIL_EVENT = `detail:/v1/transaction/detail/single?uid=${UID}:Bearer ${DUMMY_TOKEN}`

    test.each([
      ['buy', 'sell', { buyUrl: BUY_URL_2 }],
      ['sell', 'buy', { sellUrl: SELL_URL_2 }]
    ])('%s authenticates the cached owner with one signature on the next login', async (METHOD, FIRST_METHOD, EXPECTED_RESULT) => {
      const account = await freshAccount()
      const OWNER = (await account.getAddress()).toLowerCase()
      const smart = new DummySmartAccount(account)
      const protocol = new DfxProtocol(smart, LOCAL_CONFIG)

      await protocol[FIRST_METHOD](OPTIONS)
      const result = await protocol[METHOD](OPTIONS)

      expect(result).toEqual(EXPECTED_RESULT)
      expect(smart.messages).toEqual([challengeMessage(DUMMY_SMART_ADDRESS), challengeMessage(OWNER), challengeMessage(OWNER)])
      expect(await serverControl('/__events')).toEqual([
        `challenge:${DUMMY_SMART_ADDRESS}`, `challenge:${OWNER}`, `login:${OWNER}`,
        `challenge:${OWNER}`, `login:${OWNER}`
      ])
    })

    test.each([['buy', 'recipient'], ['sell', 'refundAddress']])('%s rejects a cached smart-account delivery before signing or login', async (METHOD, FIELD) => {
      const account = await freshAccount()
      const OWNER = (await account.getAddress()).toLowerCase()
      const smart = new DummySmartAccount(account)
      const protocol = new DfxProtocol(smart, LOCAL_CONFIG)

      await protocol.getTransactionDetail(UID).catch(() => {})
      const error = await protocol[METHOD]({ ...OPTIONS, [FIELD]: DUMMY_SMART_ADDRESS }).catch(error => error)

      expect(error.constructor).toBe(ValueError)
      expect(error.message).toBe(`DFX delivers to the signing owner address ${OWNER} for this account; ${FIELD} must match it and the smart-account address cannot be used as ${FIELD}`)
      expect(error.reason).toBeUndefined()
      expect(smart.messages).toEqual([challengeMessage(DUMMY_SMART_ADDRESS), challengeMessage(OWNER)])
      expect(await serverControl('/__events')).toEqual([
        `challenge:${DUMMY_SMART_ADDRESS}`, `challenge:${OWNER}`, `login:${OWNER}`, DETAIL_EVENT
      ])
    })

    test.each([
      ['buy', 'recipient', { buyUrl: BUY_URL_2 }],
      ['sell', 'refundAddress', { sellUrl: SELL_URL_2 }]
    ])('%s opens a fresh session after transaction lookup', async (METHOD, FIELD, EXPECTED_RESULT) => {
      const account = await freshAccount()
      const ADDRESS = await account.getAddress()
      const tracked = new DummySmartAccount(account, ADDRESS)
      const protocol = new DfxProtocol(tracked, LOCAL_CONFIG)

      await protocol.getTransactionDetail(UID).catch(() => {})
      const result = await protocol[METHOD]({ ...OPTIONS, [FIELD]: ADDRESS })

      expect(result).toEqual(EXPECTED_RESULT)
      expect(tracked.messages).toEqual([challengeMessage(ADDRESS), challengeMessage(ADDRESS)])
      expect(await serverControl('/__events')).toEqual([
        `challenge:${ADDRESS}`, `login:${ADDRESS}`, DETAIL_EVENT,
        `challenge:${ADDRESS}`, `login:${ADDRESS}`
      ])
    })

    test.each([
      ['unauthorized', { auth: 'unauthorized' }, BUY_URL_2, 2],
      ['missing token', { auth: 'missing token' }, BUY_URL_2, 2],
      ['owner challenge failure', { ownerChallenge: true }, BUY_URL, 1]
    ])('repeats owner recovery after %s', async (MODE, FAULTS, EXPECTED_URL, FIRST_SIGNATURES) => {
      await resetServer(FAULTS)
      const account = await freshAccount()
      const OWNER = (await account.getAddress()).toLowerCase()
      const smart = new DummySmartAccount(account)
      const protocol = new DfxProtocol(smart, LOCAL_CONFIG)
      const FIRST_MESSAGES = [challengeMessage(DUMMY_SMART_ADDRESS), challengeMessage(OWNER)].slice(0, FIRST_SIGNATURES)
      const FIRST_EVENTS = {
        unauthorized: [`challenge:${DUMMY_SMART_ADDRESS}`, `challenge:${OWNER}`, `login:${OWNER}`],
        'missing token': [`challenge:${DUMMY_SMART_ADDRESS}`, `challenge:${OWNER}`, `login:${OWNER}`],
        'owner challenge failure': [`challenge:${DUMMY_SMART_ADDRESS}`, `challenge:${OWNER}`]
      }

      await protocol.sell(OPTIONS).catch(() => {})
      const result = await protocol.buy(OPTIONS)

      expect(result).toEqual({ buyUrl: EXPECTED_URL })
      expect(smart.messages).toEqual([...FIRST_MESSAGES, challengeMessage(DUMMY_SMART_ADDRESS), challengeMessage(OWNER)])
      expect(await serverControl('/__events')).toEqual([
        ...FIRST_EVENTS[MODE], `challenge:${DUMMY_SMART_ADDRESS}`, `challenge:${OWNER}`, `login:${OWNER}`
      ])
    })

    test('does not cache a signer recovered from a signature over a foreign message', async () => {
      const account = await freshAccount()
      const OWNER = (await account.getAddress()).toLowerCase()
      const DUMMY_FOREIGN_SIGNATURE = await account.sign('A different message, not the DFX challenge')
      // Independent SDK oracle for the wrong owner implied by this foreign signature.
      const FOREIGN_OWNER = verifyMessage(challengeMessage(DUMMY_SMART_ADDRESS), DUMMY_FOREIGN_SIGNATURE).toLowerCase()
      const smart = new DummyFirstSignature(account, DUMMY_FOREIGN_SIGNATURE)
      const protocol = new DfxProtocol(smart, LOCAL_CONFIG)

      const initialError = await protocol.sell(OPTIONS).catch(error => error)
      const result = await protocol.buy(OPTIONS)

      expect(initialError.constructor).toBe(ProviderError)
      expect(initialError.message).toBe('Invalid signature')
      expect(initialError.reason).toBe('UNAUTHORIZED')
      expect(result).toEqual({ buyUrl: BUY_URL })
      expect(smart.messages).toEqual([
        challengeMessage(DUMMY_SMART_ADDRESS), challengeMessage(FOREIGN_OWNER),
        challengeMessage(DUMMY_SMART_ADDRESS), challengeMessage(OWNER)
      ])
      expect(await serverControl('/__events')).toEqual([
        `challenge:${DUMMY_SMART_ADDRESS}`, `challenge:${FOREIGN_OWNER}`, `login:${FOREIGN_OWNER}`,
        `challenge:${DUMMY_SMART_ADDRESS}`, `challenge:${OWNER}`, `login:${OWNER}`
      ])
    })

    test('EOA needs one signature for each fresh login', async () => {
      const account = await freshAccount()
      const ADDRESS = await account.getAddress()
      const tracked = new DummySmartAccount(account, ADDRESS)
      const protocol = new DfxProtocol(tracked, LOCAL_CONFIG)

      await protocol.sell(OPTIONS)
      const result = await protocol.buy({ ...OPTIONS, recipient: ADDRESS })

      expect(result).toEqual({ buyUrl: BUY_URL_2 })
      expect(tracked.messages).toEqual([challengeMessage(ADDRESS), challengeMessage(ADDRESS)])
      expect(await serverControl('/__events')).toEqual([
        `challenge:${ADDRESS}`, `login:${ADDRESS}`, `challenge:${ADDRESS}`, `login:${ADDRESS}`
      ])
    })

    test('a changed account address does not borrow the previous owner cache', async () => {
      const DUMMY_NEXT_SMART_ADDRESS = '0x0000000000000000000000000000000000000002'
      const account = await freshAccount()
      const OWNER = (await account.getAddress()).toLowerCase()
      const smart = new DummySmartAccount(account)
      const protocol = new DfxProtocol(smart, LOCAL_CONFIG)

      await protocol.sell(OPTIONS)
      smart.address = DUMMY_NEXT_SMART_ADDRESS
      const result = await protocol.buy(OPTIONS)

      expect(result).toEqual({ buyUrl: BUY_URL_2 })
      expect(smart.messages).toEqual([
        challengeMessage(DUMMY_SMART_ADDRESS), challengeMessage(OWNER), challengeMessage(DUMMY_NEXT_SMART_ADDRESS), challengeMessage(OWNER)
      ])
      expect(await serverControl('/__events')).toEqual([
        `challenge:${DUMMY_SMART_ADDRESS}`, `challenge:${OWNER}`, `login:${OWNER}`,
        `challenge:${DUMMY_NEXT_SMART_ADDRESS}`, `challenge:${OWNER}`, `login:${OWNER}`
      ])
    })

    test('a fresh protocol does not borrow another instance owner cache', async () => {
      const account = await freshAccount()
      const OWNER = (await account.getAddress()).toLowerCase()
      const smart = new DummySmartAccount(account)
      const protocol = new DfxProtocol(smart, LOCAL_CONFIG)
      const fresh = new DfxProtocol(smart, LOCAL_CONFIG)

      await protocol.sell(OPTIONS)
      const result = await fresh.buy(OPTIONS)

      expect(result).toEqual({ buyUrl: BUY_URL_2 })
      expect(smart.messages).toEqual([
        challengeMessage(DUMMY_SMART_ADDRESS), challengeMessage(OWNER), challengeMessage(DUMMY_SMART_ADDRESS), challengeMessage(OWNER)
      ])
      expect(await serverControl('/__events')).toEqual([
        `challenge:${DUMMY_SMART_ADDRESS}`, `challenge:${OWNER}`, `login:${OWNER}`,
        `challenge:${DUMMY_SMART_ADDRESS}`, `challenge:${OWNER}`, `login:${OWNER}`
      ])
    })

    test('an unrecoverable signature does not block owner recovery on a later login', async () => {
      const account = await freshAccount()
      const OWNER = (await account.getAddress()).toLowerCase()
      const smart = new DummyFirstSignature(account, 'invalid-signature')
      const protocol = new DfxProtocol(smart, LOCAL_CONFIG)

      const initialError = await protocol.sell(OPTIONS).catch(error => error)
      const result = await protocol.buy(OPTIONS)

      expect(initialError.constructor).toBe(ProviderError)
      expect(initialError.message).toBe('Invalid signature')
      expect(initialError.reason).toBe('UNAUTHORIZED')
      expect(result).toEqual({ buyUrl: BUY_URL })
      expect(smart.messages).toEqual([challengeMessage(DUMMY_SMART_ADDRESS), challengeMessage(DUMMY_SMART_ADDRESS), challengeMessage(OWNER)])
      expect(await serverControl('/__events')).toEqual([
        `challenge:${DUMMY_SMART_ADDRESS}`, `login:${DUMMY_SMART_ADDRESS}`,
        `challenge:${DUMMY_SMART_ADDRESS}`, `challenge:${OWNER}`, `login:${OWNER}`
      ])
    })

    test('transaction details reuse the widget session', async () => {
      const account = await freshAccount()
      const ADDRESS = await account.getAddress()
      const tracked = new DummySmartAccount(account, ADDRESS)
      const protocol = new DfxProtocol(tracked, LOCAL_CONFIG)

      await protocol.buy(OPTIONS)
      await protocol.getTransactionDetail(UID).catch(() => {})

      expect(tracked.messages).toEqual([challengeMessage(ADDRESS)])
      expect(await serverControl('/__events')).toEqual([`challenge:${ADDRESS}`, `login:${ADDRESS}`, DETAIL_EVENT])
    })

    test('transaction details renew an expired widget session with the cached owner', async () => {
      const DETAIL_EVENT_2 = `detail:/v1/transaction/detail/single?uid=${UID}:Bearer ${DUMMY_TOKEN}.2`
      await resetServer({ expireDetails: 1 })
      const account = await freshAccount()
      const OWNER = (await account.getAddress()).toLowerCase()
      const smart = new DummySmartAccount(account)
      const protocol = new DfxProtocol(smart, LOCAL_CONFIG)

      await protocol.buy(OPTIONS)
      await protocol.getTransactionDetail(UID).catch(() => {})

      expect(smart.messages).toEqual([challengeMessage(DUMMY_SMART_ADDRESS), challengeMessage(OWNER), challengeMessage(OWNER)])
      expect(await serverControl('/__events')).toEqual([
        `challenge:${DUMMY_SMART_ADDRESS}`, `challenge:${OWNER}`, `login:${OWNER}`, DETAIL_EVENT,
        `challenge:${OWNER}`, `login:${OWNER}`, DETAIL_EVENT_2
      ])
    })
  })
})
