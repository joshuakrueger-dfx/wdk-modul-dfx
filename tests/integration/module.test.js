// Copyright 2026 DFX AG
// SPDX-License-Identifier: Apache-2.0

import { readFile } from 'node:fs/promises'
import { afterEach, beforeAll, beforeEach, describe, expect, test } from '@jest/globals'
import { NoSuchElementError, ProviderError, ValueError } from '@tetherto/wdk-wallet/protocols'
import DfxProtocol from '../../index.js'
import { expectRequests, failure, httpRequest, response } from '../helpers.js'
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

      await failure(Promise.reject(error), NoSuchElementError, EXPECTED_UID_MESSAGE)
    })

    test('rejects an unregistered external ID with the recorded NoSuchElementError', async () => {
      const EXPECTED_EXTERNAL_MESSAGE = 'Transaction not found'
      const account = await freshAccount()
      const protocol = new DfxProtocol(account, LOCAL_CONFIG)

      const error = await protocol.getTransactionDetail(EXTERNAL_TRANSACTION_ID, { idType: 'externalTransactionId' })
        .then(() => undefined, error => error)

      await failure(Promise.reject(error), NoSuchElementError, EXPECTED_EXTERNAL_MESSAGE)
    })
  })

  describe('authentication sessions', () => {
    // Fixed ethers HDNodeWallet vectors for the public fixture mnemonic, path m/44'/60'/0'/0/0.
    const OWNER = '0x405005c7c4422390f4b334f64cf20e0b767131d0'
    const MESSAGE = challengeMessage(OWNER)
    const SIGNATURE = '0xf422b86a971338356e72f01f5e21456c8013321d5f6e23d08d344f2537bdc51f7a4ef5258e2684fdd5ec49c43a3576c2683bec8ab3d5e072484d53c9c1674aa41c'
    const OPTIONS = { ...PAIR, fiatAmount: 10000n }
    const BUY_URL = `https://dev.app.dfx.swiss/buy?session=${DUMMY_TOKEN}&lang=en&asset-in=CHF&asset-out=USDT&blockchain=Ethereum&amount-in=100`
    const BUY_URL_2 = `https://dev.app.dfx.swiss/buy?session=${DUMMY_TOKEN}.2&lang=en&asset-in=CHF&asset-out=USDT&blockchain=Ethereum&amount-in=100`
    const SELL_URL_2 = `https://dev.app.dfx.swiss/sell?session=${DUMMY_TOKEN}.2&lang=en&asset-in=USDT&asset-out=CHF&blockchain=Ethereum&amount-out=100`
    const DETAIL_EVENT = `detail:/v1/transaction/detail/single?uid=${UID}:Bearer ${DUMMY_TOKEN}`
    const CHALLENGE = httpRequest(`/v1/auth/signMessage?address=${OWNER}`, 'GET', undefined, undefined, 'sandbox')
    const AUTH = httpRequest('/v1/auth', 'POST', JSON.stringify({ address: OWNER, signature: SIGNATURE, blockchain: 'Ethereum' }), undefined, 'sandbox')
    const DETAIL = httpRequest(`/v1/transaction/detail/single?uid=${UID}`, 'GET', undefined, DUMMY_TOKEN, 'sandbox')
    const DETAIL_2 = httpRequest(`/v1/transaction/detail/single?uid=${UID}`, 'GET', undefined, `${DUMMY_TOKEN}.2`, 'sandbox')
    const CATALOG = [
      httpRequest('/v1/asset', 'GET', undefined, undefined, 'sandbox'),
      httpRequest('/v1/fiat', 'GET', undefined, undefined, 'sandbox')
    ]
    const EXPECTED_DETAIL = { cryptoAsset: 'USDT', fiatCurrency: 'CHF', status: 'completed' }

    test('parallel first lookups share one signature and keep their token for the next lookup', async () => {
      await resetServer({ completedDetail: true })
      const EXPECTED_REQUESTS = [CHALLENGE, AUTH, DETAIL, DETAIL, ...CATALOG, ...CATALOG, DETAIL, ...CATALOG]
      const tracked = new DummySmartAccount(await freshAccount(), OWNER)
      const requests = []
      const protocol = new DfxProtocol(tracked, {
        ...LOCAL_CONFIG,
        fetch: (url, init) => {
          requests.push([url, init])
          return LOCAL_CONFIG.fetch(url, init)
        }
      })

      const results = await Promise.all([protocol.getTransactionDetail(UID), protocol.getTransactionDetail(UID)])
      const cached = await protocol.getTransactionDetail(UID)

      expect(results).toEqual([EXPECTED_DETAIL, EXPECTED_DETAIL])
      expect(cached).toEqual(EXPECTED_DETAIL)
      expect(tracked.messages).toEqual([MESSAGE])
      expectRequests(requests, EXPECTED_REQUESTS)
    })

    test('parallel 401 responses share one renewal and retain its token for the next lookup', async () => {
      await resetServer({ completedDetail: true })
      const EXPECTED_REQUESTS = [
        CHALLENGE, AUTH, DETAIL, ...CATALOG,
        DETAIL, DETAIL, CHALLENGE, AUTH, DETAIL_2, DETAIL_2, ...CATALOG, ...CATALOG,
        DETAIL_2, ...CATALOG
      ]
      const tracked = new DummySmartAccount(await freshAccount(), OWNER)
      const requests = []
      let rejectOld = false
      let rejected = 0
      let release
      const bothRejected = new Promise(resolve => { release = resolve })
      const protocol = new DfxProtocol(tracked, {
        ...LOCAL_CONFIG,
        fetch: async (url, init) => {
          requests.push([url, init])
          if (rejectOld && new URL(url).pathname === '/v1/transaction/detail/single' && init.headers.Authorization === `Bearer ${DUMMY_TOKEN}`) {
            if (++rejected === 2) release()
            await bothRejected
            return response({ message: 'Expired detail session' }, 401)
          }
          return LOCAL_CONFIG.fetch(url, init)
        }
      })

      const initial = await protocol.getTransactionDetail(UID)
      rejectOld = true
      const results = await Promise.all([protocol.getTransactionDetail(UID), protocol.getTransactionDetail(UID)])
      const cached = await protocol.getTransactionDetail(UID)

      expect(initial).toEqual(EXPECTED_DETAIL)
      expect(results).toEqual([EXPECTED_DETAIL, EXPECTED_DETAIL])
      expect(cached).toEqual(EXPECTED_DETAIL)
      expect(tracked.messages).toEqual([MESSAGE, MESSAGE])
      expectRequests(requests, EXPECTED_REQUESTS)
    })

    test('a failed shared login rejects every waiter with the same error and releases the next login', async () => {
      await resetServer({ auth: 'unauthorized', completedDetail: true })
      const EXPECTED_REQUESTS = [CHALLENGE, AUTH, CHALLENGE, AUTH, DETAIL_2, ...CATALOG, DETAIL_2, ...CATALOG]
      const tracked = new DummySmartAccount(await freshAccount(), OWNER)
      const requests = []
      const protocol = new DfxProtocol(tracked, {
        ...LOCAL_CONFIG,
        fetch: (url, init) => {
          requests.push([url, init])
          return LOCAL_CONFIG.fetch(url, init)
        }
      })

      const errors = await Promise.all([
        protocol.getTransactionDetail(UID).catch(error => error),
        protocol.getTransactionDetail(UID).catch(error => error)
      ])
      const next = await protocol.getTransactionDetail(UID)
      const cached = await protocol.getTransactionDetail(UID)

      await failure(Promise.reject(errors[0]), ProviderError, 'Invalid signature', 'UNAUTHORIZED')
      expect(errors[1]).toBe(errors[0])
      expect(next).toEqual(EXPECTED_DETAIL)
      expect(cached).toEqual(EXPECTED_DETAIL)
      expect(tracked.messages).toEqual([MESSAGE, MESSAGE])
      expectRequests(requests, EXPECTED_REQUESTS)
    })

    test('a two-generations-old caller spends its only retry on the current expired token', async () => {
      const DETAIL_3 = httpRequest(`/v1/transaction/detail/single?uid=${UID}`, 'GET', undefined, `${DUMMY_TOKEN}.3`, 'sandbox')
      const DETAIL_4 = httpRequest(`/v1/transaction/detail/single?uid=${UID}`, 'GET', undefined, `${DUMMY_TOKEN}.4`, 'sandbox')
      await resetServer({ completedDetail: true })
      const EXPECTED_REQUESTS = [
        CHALLENGE, AUTH, DETAIL, ...CATALOG, DETAIL,
        DETAIL, CHALLENGE, AUTH, DETAIL_2, ...CATALOG,
        DETAIL_2, CHALLENGE, AUTH, DETAIL_3, ...CATALOG,
        DETAIL_3, CHALLENGE, AUTH, DETAIL_4, ...CATALOG
      ]
      const tracked = new DummySmartAccount(await freshAccount(), OWNER)
      const requests = []
      let rejectedToken
      let hold = false
      let signalHeld
      let release
      const held = new Promise(resolve => { signalHeld = resolve })
      const released = new Promise(resolve => { release = resolve })
      const protocol = new DfxProtocol(tracked, {
        ...LOCAL_CONFIG,
        fetch: async (url, init) => {
          requests.push([url, init])
          if (new URL(url).pathname === '/v1/transaction/detail/single' && init.headers.Authorization === rejectedToken) {
            if (hold) {
              hold = false
              signalHeld()
              await released
            }
            return response({ message: 'Expired detail session' }, 401)
          }
          return LOCAL_CONFIG.fetch(url, init)
        }
      })

      const initial = await protocol.getTransactionDetail(UID)
      rejectedToken = `Bearer ${DUMMY_TOKEN}`
      hold = true
      const late = protocol.getTransactionDetail(UID).catch(error => error)
      await held
      let second
      let third
      try {
        second = await protocol.getTransactionDetail(UID)
        rejectedToken = `Bearer ${DUMMY_TOKEN}.2`
        third = await protocol.getTransactionDetail(UID)
        rejectedToken = `Bearer ${DUMMY_TOKEN}.3`
      } finally {
        release()
      }
      const error = await late
      const next = await protocol.getTransactionDetail(UID)

      expect(initial).toEqual(EXPECTED_DETAIL)
      expect(second).toEqual(EXPECTED_DETAIL)
      expect(third).toEqual(EXPECTED_DETAIL)
      await failure(Promise.reject(error), ProviderError, 'Expired detail session', 'UNAUTHORIZED')
      expect(next).toEqual(EXPECTED_DETAIL)
      expect(tracked.messages).toEqual([MESSAGE, MESSAGE, MESSAGE, MESSAGE])
      expectRequests(requests, EXPECTED_REQUESTS)
    })

    test.each([
      ['buy', false, { buyUrl: BUY_URL_2 }],
      ['sell', false, { sellUrl: SELL_URL_2 }],
      ['buy', true, undefined]
    ])('a fresh %s login with failure %s leaves the detail token unchanged', async (METHOD, FAIL, EXPECTED_WIDGET) => {
      await resetServer({ completedDetail: true })
      const EXPECTED_REQUESTS = [CHALLENGE, AUTH, DETAIL, ...CATALOG, ...CATALOG, CHALLENGE, AUTH, DETAIL, ...CATALOG]
      const tracked = new DummySmartAccount(await freshAccount(), OWNER)
      const requests = []
      let logins = 0
      const protocol = new DfxProtocol(tracked, {
        ...LOCAL_CONFIG,
        fetch: (url, init) => {
          requests.push([url, init])
          if (new URL(url).pathname === '/v1/auth' && ++logins === 2 && FAIL) {
            return response({ message: 'Widget login failed' }, 401)
          }
          return LOCAL_CONFIG.fetch(url, init)
        }
      })

      const initial = await protocol.getTransactionDetail(UID)
      const widget = await protocol[METHOD](OPTIONS).catch(error => error)
      const cached = await protocol.getTransactionDetail(UID)

      expect(initial).toEqual(EXPECTED_DETAIL)
      if (FAIL) await failure(Promise.reject(widget), ProviderError, 'Widget login failed', 'UNAUTHORIZED')
      else expect(widget).toEqual(EXPECTED_WIDGET)
      expect(cached).toEqual(EXPECTED_DETAIL)
      expect(tracked.messages).toEqual([MESSAGE, MESSAGE])
      expectRequests(requests, EXPECTED_REQUESTS)
    })

    test.each([
      [1, `${DUMMY_TOKEN}.2`],
      [2, `${DUMMY_TOKEN}.3`]
    ])('preserves another call\'s renewed session after a delayed HTTP 401 on attempt %s', async (ATTEMPT, EXPECTED_TOKEN) => {
      await resetServer({ expireDetails: ATTEMPT, completedDetail: true })
      const account = await freshAccount()
      const tracked = new DummySmartAccount(account, OWNER)
      const requests = []
      let signalDelayed
      let releaseDelayed
      const delayed = new Promise(resolve => { signalDelayed = resolve })
      const released = new Promise(resolve => { releaseDelayed = resolve })
      let detailCalls = 0
      const protocol = new DfxProtocol(tracked, {
        ...LOCAL_CONFIG,
        fetch: async (url, init) => {
          requests.push([url, init])
          const path = new URL(url).pathname
          const hold = path === '/v1/transaction/detail/single' && ++detailCalls === ATTEMPT
          const response = await LOCAL_CONFIG.fetch(url, init)
          if (hold) {
            signalDelayed()
            await released
          }
          return response
        }
      })

      const FRESH_DETAIL = httpRequest(`/v1/transaction/detail/single?uid=${UID}`, 'GET', undefined, EXPECTED_TOKEN, 'sandbox')
      const BEFORE_RENEWAL = ATTEMPT === 1 ? [DETAIL, DETAIL] : [DETAIL, CHALLENGE, AUTH, DETAIL_2, DETAIL_2]
      const AFTER_RENEWAL = ATTEMPT === 1 ? [FRESH_DETAIL, ...CATALOG] : []

      const lateCall = protocol.getTransactionDetail(UID).catch(error => error)
      await delayed
      let renewed
      try {
        renewed = await protocol.getTransactionDetail(UID)
      } finally {
        releaseDelayed()
      }
      const error = await lateCall
      const cached = await protocol.getTransactionDetail(UID)

      expect(renewed).toEqual(EXPECTED_DETAIL)
      if (ATTEMPT === 1) expect(error).toEqual(EXPECTED_DETAIL)
      else await failure(Promise.reject(error), ProviderError, 'Unauthorized', 'UNAUTHORIZED')
      expect(cached).toEqual(EXPECTED_DETAIL)
      expect(tracked.messages).toEqual(Array.from({ length: ATTEMPT + 1 }, () => MESSAGE))
      expectRequests(requests, [
        CHALLENGE, AUTH, ...BEFORE_RENEWAL,
        CHALLENGE, AUTH, FRESH_DETAIL, ...CATALOG, ...AFTER_RENEWAL, FRESH_DETAIL, ...CATALOG
      ])
    })

    test('authenticates again on the next lookup after the renewed token also receives HTTP 401', async () => {
      await resetServer({ expireDetails: 2, completedDetail: true })
      const account = await freshAccount()
      const tracked = new DummySmartAccount(account, OWNER)
      const requests = []
      const protocol = new DfxProtocol(tracked, {
        ...LOCAL_CONFIG,
        fetch: (url, init) => {
          requests.push([url, init])
          return LOCAL_CONFIG.fetch(url, init)
        }
      })

      const error = await protocol.getTransactionDetail(UID).catch(error => error)
      const result = await protocol.getTransactionDetail(UID)

      await failure(Promise.reject(error), ProviderError, 'Unauthorized', 'UNAUTHORIZED')
      expect(result).toEqual({ cryptoAsset: 'USDT', fiatCurrency: 'CHF', status: 'completed' })
      expect(tracked.messages).toEqual([MESSAGE, MESSAGE, MESSAGE])
      expectRequests(requests, [
        CHALLENGE, AUTH, httpRequest(`/v1/transaction/detail/single?uid=${UID}`, 'GET', undefined, DUMMY_TOKEN, 'sandbox'),
        CHALLENGE, AUTH, httpRequest(`/v1/transaction/detail/single?uid=${UID}`, 'GET', undefined, `${DUMMY_TOKEN}.2`, 'sandbox'),
        CHALLENGE, AUTH, httpRequest(`/v1/transaction/detail/single?uid=${UID}`, 'GET', undefined, `${DUMMY_TOKEN}.3`, 'sandbox'),
        httpRequest('/v1/asset', 'GET', undefined, undefined, 'sandbox'),
        httpRequest('/v1/fiat', 'GET', undefined, undefined, 'sandbox')
      ])
    })

    test('reuses the renewed token without another login after its detail request receives HTTP 500', async () => {
      await resetServer({ expireDetails: 1 })
      // An unrecorded UID makes the replay server return HTTP 500 after authentication.
      const UNRECORDED_UID = '00000000-0000-4000-8000-000000000001'
      const FAILED_PATH = `/v1/transaction/detail/single?uid=${UNRECORDED_UID}`
      const account = await freshAccount()
      const tracked = new DummySmartAccount(account, OWNER)
      const requests = []
      const protocol = new DfxProtocol(tracked, {
        ...LOCAL_CONFIG,
        fetch: (url, init) => {
          requests.push([url, init])
          return LOCAL_CONFIG.fetch(url, init)
        }
      })

      const error = await protocol.getTransactionDetail(UNRECORDED_UID).catch(error => error)
      const nextError = await protocol.getTransactionDetail(UID).catch(error => error)

      await failure(Promise.reject(error), ProviderError, `Unrecorded DFX request: GET ${FAILED_PATH} body=null`, 'INTERNAL_SERVER_ERROR')
      await failure(Promise.reject(nextError), NoSuchElementError, 'Transaction not found')
      expect(tracked.messages).toEqual([MESSAGE, MESSAGE])
      expectRequests(requests, [
        CHALLENGE, AUTH, httpRequest(FAILED_PATH, 'GET', undefined, DUMMY_TOKEN, 'sandbox'),
        CHALLENGE, AUTH, httpRequest(FAILED_PATH, 'GET', undefined, `${DUMMY_TOKEN}.2`, 'sandbox'),
        httpRequest(`/v1/transaction/detail/single?uid=${UID}`, 'GET', undefined, `${DUMMY_TOKEN}.2`, 'sandbox')
      ])
    })

    test.each([
      ['buy', 'sell', { buyUrl: BUY_URL_2 }],
      ['sell', 'buy', { sellUrl: SELL_URL_2 }]
    ])('%s authenticates the cached owner with one signature on the next login', async (METHOD, FIRST_METHOD, EXPECTED_RESULT) => {
      const account = await freshAccount()
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

    test('accepts the new owner as recipient on the login after a cached-owner signature is rejected', async () => {
      const NEXT_OWNER = '0xcc81e04bada16def9e1afb027b859bec42be49db'
      const account = await freshAccount()
      const nextAccount = await freshAccount(1)
      const smart = new DummySmartAccount(account)
      const protocol = new DfxProtocol(smart, LOCAL_CONFIG)

      await protocol.sell(OPTIONS)
      smart.account = nextAccount
      const error = await protocol.buy({ ...OPTIONS, recipient: NEXT_OWNER }).catch(error => error)
      const result = await protocol.buy({ ...OPTIONS, recipient: NEXT_OWNER })

      await failure(Promise.reject(error), ProviderError, 'Invalid credentials', 'UNAUTHORIZED')
      expect(result).toEqual({ buyUrl: BUY_URL_2 })
      expect(smart.messages).toEqual([
        challengeMessage(DUMMY_SMART_ADDRESS), challengeMessage(OWNER), challengeMessage(OWNER),
        challengeMessage(DUMMY_SMART_ADDRESS), challengeMessage(NEXT_OWNER)
      ])
      expect(await serverControl('/__events')).toEqual([
        `challenge:${DUMMY_SMART_ADDRESS}`, `challenge:${OWNER}`, `login:${OWNER}`,
        `challenge:${OWNER}`, `login:${OWNER}`,
        `challenge:${DUMMY_SMART_ADDRESS}`, `challenge:${NEXT_OWNER}`, `login:${NEXT_OWNER}`
      ])
    })

    test('a failed buy login leaves the existing detail session intact', async () => {
      await resetServer({ completedDetail: true })
      const account = await freshAccount()
      const nextAccount = await freshAccount(1)
      const authResponses = []
      const smart = new DummySmartAccount(account)
      const protocol = new DfxProtocol(smart, {
        ...LOCAL_CONFIG,
        fetch: async (url, init) => {
          const response = await LOCAL_CONFIG.fetch(url, init)
          if (init.method === 'POST' && new URL(url).pathname === '/v1/auth') {
            authResponses.push({ status: response.status, body: await response.clone().json() })
          }
          return response
        }
      })

      const initialDetail = await protocol.getTransactionDetail(UID)
      smart.account = nextAccount
      const error = await protocol.buy(OPTIONS).catch(error => error)
      const result = await protocol.getTransactionDetail(UID)

      expect(initialDetail).toEqual(EXPECTED_DETAIL)
      await failure(Promise.reject(error), ProviderError, 'Invalid credentials', 'UNAUTHORIZED')
      expect(result).toEqual(EXPECTED_DETAIL)
      expect(authResponses).toEqual([
        { status: 201, body: { accessToken: DUMMY_TOKEN } },
        { status: 401, body: { statusCode: 401, message: 'Invalid credentials', error: 'Unauthorized' } }
      ])
      expect(smart.messages).toEqual([
        challengeMessage(DUMMY_SMART_ADDRESS), challengeMessage(OWNER), challengeMessage(OWNER)
      ])
      expect(await serverControl('/__events')).toEqual([
        `challenge:${DUMMY_SMART_ADDRESS}`, `challenge:${OWNER}`, `login:${OWNER}`, DETAIL_EVENT,
        `challenge:${OWNER}`, `login:${OWNER}`, DETAIL_EVENT
      ])
    })

    test.each([
      ['unauthorized', true, 'Invalid credentials', 'UNAUTHORIZED', { status: 401, body: { statusCode: 401, message: 'Invalid credentials', error: 'Unauthorized' } }],
      ['unauthorized', false, 'Invalid signature', 'UNAUTHORIZED', { status: 400, body: { statusCode: 400, message: 'Invalid signature', error: 'Bad Request' } }],
      ['missing token', true, 'Unexpected DFX response', 'INTERNAL_SERVER_ERROR', { status: 201, body: {} }]
    ])('discards a previously cached owner after %s with preserved registrations %s without retrying that login', async (MODE, PRESERVE_REGISTRATIONS, EXPECTED_MESSAGE, EXPECTED_REASON, EXPECTED_AUTH_FAILURE) => {
      const account = await freshAccount()
      const smart = new DummySmartAccount(account)
      const authResponses = []
      const protocol = new DfxProtocol(smart, {
        ...LOCAL_CONFIG,
        fetch: async (url, init) => {
          const response = await LOCAL_CONFIG.fetch(url, init)
          if (init.method === 'POST' && new URL(url).pathname === '/v1/auth') {
            authResponses.push({ status: response.status, body: await response.clone().json() })
          }
          return response
        }
      })

      await protocol.sell(OPTIONS)
      const initialEvents = await serverControl('/__events')
      await resetServer({ auth: MODE }, { preserveRegistrations: PRESERVE_REGISTRATIONS })
      const error = await protocol.buy(OPTIONS).catch(error => error)
      const result = await protocol.buy(OPTIONS)

      await failure(Promise.reject(error), ProviderError, EXPECTED_MESSAGE, EXPECTED_REASON)
      expect(result).toEqual({ buyUrl: BUY_URL_2 })
      expect(authResponses).toEqual([
        { status: 201, body: { accessToken: DUMMY_TOKEN } },
        EXPECTED_AUTH_FAILURE,
        { status: 201, body: { accessToken: `${DUMMY_TOKEN}.2` } }
      ])
      expect(smart.messages).toEqual([
        challengeMessage(DUMMY_SMART_ADDRESS), challengeMessage(OWNER), challengeMessage(OWNER),
        challengeMessage(DUMMY_SMART_ADDRESS), challengeMessage(OWNER)
      ])
      expect([...initialEvents, ...await serverControl('/__events')]).toEqual([
        `challenge:${DUMMY_SMART_ADDRESS}`, `challenge:${OWNER}`, `login:${OWNER}`,
        `challenge:${OWNER}`, `login:${OWNER}`,
        `challenge:${DUMMY_SMART_ADDRESS}`, `challenge:${OWNER}`, `login:${OWNER}`
      ])
    })

    test.each([['buy', 'recipient'], ['sell', 'refundAddress']])('%s rejects a cached smart-account delivery after owner authentication', async (METHOD, FIELD) => {
      const account = await freshAccount()
      const smart = new DummySmartAccount(account)
      const protocol = new DfxProtocol(smart, LOCAL_CONFIG)

      await protocol.getTransactionDetail(UID).catch(() => {})
      const error = await protocol[METHOD]({ ...OPTIONS, [FIELD]: DUMMY_SMART_ADDRESS }).catch(error => error)

      await failure(Promise.reject(error), ValueError, `DFX delivers to the signing owner address ${OWNER} for this account; ${FIELD} must match it and the smart-account address cannot be used as ${FIELD}`)
      expect(smart.messages).toEqual([challengeMessage(DUMMY_SMART_ADDRESS), challengeMessage(OWNER), challengeMessage(OWNER)])
      expect(await serverControl('/__events')).toEqual([
        `challenge:${DUMMY_SMART_ADDRESS}`, `challenge:${OWNER}`, `login:${OWNER}`, DETAIL_EVENT,
        `challenge:${OWNER}`, `login:${OWNER}`
      ])
    })

    test.each([
      ['buy', 'recipient', { buyUrl: BUY_URL_2 }],
      ['sell', 'refundAddress', { sellUrl: SELL_URL_2 }]
    ])('%s opens a fresh session after transaction lookup', async (METHOD, FIELD, EXPECTED_RESULT) => {
      const account = await freshAccount()
      const ADDRESS = OWNER
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
      const DUMMY_FOREIGN_SIGNATURE = '0x04fbc3f306f2462bc37c9e69e37139d1a4e1fd5c42e46dae5f28d9b48cb1552b583a9e21996b76d8065c700fccb2e27d40d7207c715c0a2a1a950fc43f5865911b'
      const FOREIGN_RECOVERED_OWNER = '0x1960575f8e1f1399853ca5d7e2f917613c29e0b0'
      const account = await freshAccount()
      const smart = new DummyFirstSignature(account, DUMMY_FOREIGN_SIGNATURE)
      const protocol = new DfxProtocol(smart, LOCAL_CONFIG)

      const initialError = await protocol.sell(OPTIONS).catch(error => error)
      const result = await protocol.buy(OPTIONS)

      await failure(Promise.reject(initialError), ProviderError, 'Invalid signature', 'UNAUTHORIZED')
      expect(result).toEqual({ buyUrl: BUY_URL })
      expect(smart.messages).toEqual([
        challengeMessage(DUMMY_SMART_ADDRESS), challengeMessage(FOREIGN_RECOVERED_OWNER),
        challengeMessage(DUMMY_SMART_ADDRESS), challengeMessage(OWNER)
      ])
      expect(await serverControl('/__events')).toEqual([
        `challenge:${DUMMY_SMART_ADDRESS}`, `challenge:${FOREIGN_RECOVERED_OWNER}`, `login:${FOREIGN_RECOVERED_OWNER}`,
        `challenge:${DUMMY_SMART_ADDRESS}`, `challenge:${OWNER}`, `login:${OWNER}`
      ])
    })

    test.each([['buy', 'recipient'], ['sell', 'refundAddress']])('%s rejects mismatched delivery for a cached EOA before signing or login', async (METHOD, FIELD) => {
      const account = await freshAccount()
      const ADDRESS = OWNER
      const tracked = new DummySmartAccount(account, ADDRESS)
      const protocol = new DfxProtocol(tracked, LOCAL_CONFIG)

      await protocol.getTransactionDetail(UID).catch(() => {})
      const error = await protocol[METHOD]({ ...OPTIONS, [FIELD]: DUMMY_SMART_ADDRESS }).catch(error => error)

      await failure(Promise.reject(error), ValueError, `${FIELD} must match the account address`)
      expect(tracked.messages).toEqual([challengeMessage(ADDRESS)])
      expect(await serverControl('/__events')).toEqual([
        `challenge:${ADDRESS}`, `login:${ADDRESS}`, DETAIL_EVENT
      ])
    })

    test('EOA needs one signature for each fresh login', async () => {
      const account = await freshAccount()
      const ADDRESS = OWNER
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
      const smart = new DummyFirstSignature(account, 'invalid-signature')
      const authResponses = []
      const protocol = new DfxProtocol(smart, {
        ...LOCAL_CONFIG,
        fetch: async (url, init) => {
          const response = await LOCAL_CONFIG.fetch(url, init)
          if (init.method === 'POST' && new URL(url).pathname === '/v1/auth') {
            authResponses.push({ status: response.status, body: await response.clone().json() })
          }
          return response
        }
      })

      const initialError = await protocol.sell(OPTIONS).catch(error => error)
      const result = await protocol.buy(OPTIONS)

      await failure(Promise.reject(initialError), ProviderError, 'Invalid signature', 'UNAUTHORIZED')
      expect(result).toEqual({ buyUrl: BUY_URL })
      expect(authResponses).toEqual([
        { status: 400, body: { statusCode: 400, message: 'Invalid signature', error: 'Bad Request' } },
        { status: 201, body: { accessToken: DUMMY_TOKEN } }
      ])
      expect(smart.messages).toEqual([challengeMessage(DUMMY_SMART_ADDRESS), challengeMessage(DUMMY_SMART_ADDRESS), challengeMessage(OWNER)])
      expect(await serverControl('/__events')).toEqual([
        `challenge:${DUMMY_SMART_ADDRESS}`, `login:${DUMMY_SMART_ADDRESS}`,
        `challenge:${DUMMY_SMART_ADDRESS}`, `challenge:${OWNER}`, `login:${OWNER}`
      ])
    })

    test('transaction details establish their own session after a widget login', async () => {
      const account = await freshAccount()
      const ADDRESS = OWNER
      const tracked = new DummySmartAccount(account, ADDRESS)
      const protocol = new DfxProtocol(tracked, LOCAL_CONFIG)

      await protocol.buy(OPTIONS)
      await protocol.getTransactionDetail(UID).catch(() => {})

      expect(tracked.messages).toEqual([challengeMessage(ADDRESS), challengeMessage(ADDRESS)])
      expect(await serverControl('/__events')).toEqual([
        `challenge:${ADDRESS}`, `login:${ADDRESS}`, `challenge:${ADDRESS}`, `login:${ADDRESS}`,
        `detail:/v1/transaction/detail/single?uid=${UID}:Bearer ${DUMMY_TOKEN}.2`
      ])
    })

    test('transaction details renew their own expired session with the cached owner', async () => {
      const DETAIL_EVENT_2 = `detail:/v1/transaction/detail/single?uid=${UID}:Bearer ${DUMMY_TOKEN}.2`
      const DETAIL_EVENT_3 = `detail:/v1/transaction/detail/single?uid=${UID}:Bearer ${DUMMY_TOKEN}.3`
      await resetServer({ expireDetails: 1 })
      const account = await freshAccount()
      const smart = new DummySmartAccount(account)
      const protocol = new DfxProtocol(smart, LOCAL_CONFIG)

      await protocol.buy(OPTIONS)
      await protocol.getTransactionDetail(UID).catch(() => {})

      expect(smart.messages).toEqual([challengeMessage(DUMMY_SMART_ADDRESS), challengeMessage(OWNER), challengeMessage(OWNER), challengeMessage(OWNER)])
      expect(await serverControl('/__events')).toEqual([
        `challenge:${DUMMY_SMART_ADDRESS}`, `challenge:${OWNER}`, `login:${OWNER}`,
        `challenge:${OWNER}`, `login:${OWNER}`, DETAIL_EVENT_2,
        `challenge:${OWNER}`, `login:${OWNER}`, DETAIL_EVENT_3
      ])
    })
  })
})
