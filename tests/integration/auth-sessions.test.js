// Copyright 2026 DFX AG
// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, test } from '@jest/globals'
import { verifyMessage } from 'ethers'
import DfxProtocol, { NoSuchElementError, ProviderError, ValueError } from '../../index.js'
import { failure } from '../helpers.js'
import {
  accountFixture, challengeMessage, DummyFirstSignature, DummySmartAccount,
  DUMMY_TOKEN, LOCAL_CONFIG, NEXT_SMART_ADDRESS, PAIR, resetServer,
  serverControl, SMART_ADDRESS, UID
} from './helpers.js'

describe('@dfx.swiss/wdk-protocol-fiat-dfx authentication sessions', () => {
  const accounts = []
  const OPTIONS = { ...PAIR, fiatAmount: 10000n }
  const BUY_URL = `https://dev.app.dfx.swiss/buy?session=${DUMMY_TOKEN}&lang=en&asset-in=CHF&asset-out=USDT&blockchain=Ethereum&amount-in=100`
  const BUY_URL_2 = `https://dev.app.dfx.swiss/buy?session=${DUMMY_TOKEN}.2&lang=en&asset-in=CHF&asset-out=USDT&blockchain=Ethereum&amount-in=100`
  const SELL_URL_2 = `https://dev.app.dfx.swiss/sell?session=${DUMMY_TOKEN}.2&lang=en&asset-in=USDT&asset-out=CHF&blockchain=Ethereum&amount-out=100`
  const DETAIL_EVENT = `detail:/v1/transaction/detail/single?uid=${UID}:Bearer ${DUMMY_TOKEN}`
  const DETAIL_EVENT_2 = `detail:/v1/transaction/detail/single?uid=${UID}:Bearer ${DUMMY_TOKEN}.2`

  async function freshAccount (index = 0) {
    const account = await accountFixture(index)
    accounts.push(account)
    return account
  }

  beforeEach(async () => { await resetServer() })

  afterEach(() => {
    for (const account of accounts.splice(0)) account.dispose()
  })

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
    expect(smart.messages).toEqual([challengeMessage(SMART_ADDRESS), challengeMessage(OWNER), challengeMessage(OWNER)])
    expect(await serverControl('/__events')).toEqual([
      `challenge:${SMART_ADDRESS}`, `challenge:${OWNER}`, `login:${OWNER}`,
      `challenge:${OWNER}`, `login:${OWNER}`
    ])
  })

  test.each([['buy', 'recipient'], ['sell', 'refundAddress']])('%s rejects a cached smart-account delivery before signing or login', async (METHOD, FIELD) => {
    const account = await freshAccount()
    const OWNER = (await account.getAddress()).toLowerCase()
    const smart = new DummySmartAccount(account)
    const protocol = new DfxProtocol(smart, LOCAL_CONFIG)

    const initialError = await protocol.getTransactionDetail(UID).catch(error => error)
    const error = await protocol[METHOD]({ ...OPTIONS, [FIELD]: SMART_ADDRESS }).catch(error => error)

    expect(initialError.constructor).toBe(NoSuchElementError)
    expect(initialError.message).toBe('Transaction not found')
    expect(initialError.reason).toBeUndefined()
    expect(error.constructor).toBe(ValueError)
    expect(error.message).toBe(`DFX delivers to the signing owner address ${OWNER} for this account; ${FIELD} must match it and the smart-account address cannot be used as ${FIELD}`)
    expect(error.reason).toBeUndefined()
    expect(smart.messages).toEqual([challengeMessage(SMART_ADDRESS), challengeMessage(OWNER)])
    expect(await serverControl('/__events')).toEqual([
      `challenge:${SMART_ADDRESS}`, `challenge:${OWNER}`, `login:${OWNER}`, DETAIL_EVENT
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

    const initialError = await protocol.getTransactionDetail(UID).catch(error => error)
    const result = await protocol[METHOD]({ ...OPTIONS, [FIELD]: ADDRESS })

    expect(initialError.constructor).toBe(NoSuchElementError)
    expect(initialError.message).toBe('Transaction not found')
    expect(initialError.reason).toBeUndefined()
    expect(result).toEqual(EXPECTED_RESULT)
    expect(tracked.messages).toEqual([challengeMessage(ADDRESS), challengeMessage(ADDRESS)])
    expect(await serverControl('/__events')).toEqual([
      `challenge:${ADDRESS}`, `login:${ADDRESS}`, DETAIL_EVENT,
      `challenge:${ADDRESS}`, `login:${ADDRESS}`
    ])
  })

  test.each([
    ['unauthorized', { auth: 'unauthorized' }, 'Invalid signature', 'UNAUTHORIZED', BUY_URL_2, 2],
    ['missing token', { auth: 'missing token' }, 'Unexpected DFX response', 'INTERNAL_SERVER_ERROR', BUY_URL_2, 2],
    ['owner challenge failure', { ownerChallenge: true }, 'Invalid signature', 'UNAUTHORIZED', BUY_URL, 1]
  ])('repeats owner recovery after %s', async (MODE, FAULTS, EXPECTED_MESSAGE, EXPECTED_REASON, EXPECTED_URL, FIRST_SIGNATURES) => {
    await resetServer(FAULTS)
    const account = await freshAccount()
    const OWNER = (await account.getAddress()).toLowerCase()
    const smart = new DummySmartAccount(account)
    const protocol = new DfxProtocol(smart, LOCAL_CONFIG)
    const FIRST_MESSAGES = [challengeMessage(SMART_ADDRESS), challengeMessage(OWNER)].slice(0, FIRST_SIGNATURES)
    const FIRST_EVENTS = {
      unauthorized: [`challenge:${SMART_ADDRESS}`, `challenge:${OWNER}`, `login:${OWNER}`],
      'missing token': [`challenge:${SMART_ADDRESS}`, `challenge:${OWNER}`, `login:${OWNER}`],
      'owner challenge failure': [`challenge:${SMART_ADDRESS}`, `challenge:${OWNER}`]
    }

    const initialError = await protocol.sell(OPTIONS).catch(error => error)
    const result = await protocol.buy(OPTIONS)

    expect(initialError.constructor).toBe(ProviderError)
    expect(initialError.message).toBe(EXPECTED_MESSAGE)
    expect(initialError.reason).toBe(EXPECTED_REASON)
    expect(result).toEqual({ buyUrl: EXPECTED_URL })
    expect(smart.messages).toEqual([...FIRST_MESSAGES, challengeMessage(SMART_ADDRESS), challengeMessage(OWNER)])
    expect(await serverControl('/__events')).toEqual([
      ...FIRST_EVENTS[MODE], `challenge:${SMART_ADDRESS}`, `challenge:${OWNER}`, `login:${OWNER}`
    ])
  })

  test('does not cache a signer recovered from a signature over a foreign message', async () => {
    const account = await freshAccount()
    const OWNER = (await account.getAddress()).toLowerCase()
    const FOREIGN_SIGNATURE = await account.sign('A different message, not the DFX challenge')
    // Independent SDK oracle for the wrong owner implied by this foreign signature.
    const FOREIGN_OWNER = verifyMessage(challengeMessage(SMART_ADDRESS), FOREIGN_SIGNATURE).toLowerCase()
    const smart = new DummyFirstSignature(account, FOREIGN_SIGNATURE)
    const protocol = new DfxProtocol(smart, LOCAL_CONFIG)

    const initialError = await protocol.sell(OPTIONS).catch(error => error)
    const result = await protocol.buy(OPTIONS)

    expect(initialError.constructor).toBe(ProviderError)
    expect(initialError.message).toBe('Invalid signature')
    expect(initialError.reason).toBe('UNAUTHORIZED')
    expect(result).toEqual({ buyUrl: BUY_URL })
    expect(smart.messages).toEqual([
      challengeMessage(SMART_ADDRESS), challengeMessage(FOREIGN_OWNER),
      challengeMessage(SMART_ADDRESS), challengeMessage(OWNER)
    ])
    expect(await serverControl('/__events')).toEqual([
      `challenge:${SMART_ADDRESS}`, `challenge:${FOREIGN_OWNER}`, `login:${FOREIGN_OWNER}`,
      `challenge:${SMART_ADDRESS}`, `challenge:${OWNER}`, `login:${OWNER}`
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
    const account = await freshAccount()
    const OWNER = (await account.getAddress()).toLowerCase()
    const smart = new DummySmartAccount(account)
    const protocol = new DfxProtocol(smart, LOCAL_CONFIG)

    await protocol.sell(OPTIONS)
    smart.address = NEXT_SMART_ADDRESS
    const result = await protocol.buy(OPTIONS)

    expect(result).toEqual({ buyUrl: BUY_URL_2 })
    expect(smart.messages).toEqual([
      challengeMessage(SMART_ADDRESS), challengeMessage(OWNER), challengeMessage(NEXT_SMART_ADDRESS), challengeMessage(OWNER)
    ])
    expect(await serverControl('/__events')).toEqual([
      `challenge:${SMART_ADDRESS}`, `challenge:${OWNER}`, `login:${OWNER}`,
      `challenge:${NEXT_SMART_ADDRESS}`, `challenge:${OWNER}`, `login:${OWNER}`
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
      challengeMessage(SMART_ADDRESS), challengeMessage(OWNER), challengeMessage(SMART_ADDRESS), challengeMessage(OWNER)
    ])
    expect(await serverControl('/__events')).toEqual([
      `challenge:${SMART_ADDRESS}`, `challenge:${OWNER}`, `login:${OWNER}`,
      `challenge:${SMART_ADDRESS}`, `challenge:${OWNER}`, `login:${OWNER}`
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
    expect(smart.messages).toEqual([challengeMessage(SMART_ADDRESS), challengeMessage(SMART_ADDRESS), challengeMessage(OWNER)])
    expect(await serverControl('/__events')).toEqual([
      `challenge:${SMART_ADDRESS}`, `login:${SMART_ADDRESS}`,
      `challenge:${SMART_ADDRESS}`, `challenge:${OWNER}`, `login:${OWNER}`
    ])
  })

  test('transaction details reuse the widget session', async () => {
    const account = await freshAccount()
    const ADDRESS = await account.getAddress()
    const tracked = new DummySmartAccount(account, ADDRESS)
    const protocol = new DfxProtocol(tracked, LOCAL_CONFIG)

    await protocol.buy(OPTIONS)
    const result = protocol.getTransactionDetail(UID)

    await failure(result, NoSuchElementError, 'Transaction not found')
    expect(tracked.messages).toEqual([challengeMessage(ADDRESS)])
    expect(await serverControl('/__events')).toEqual([`challenge:${ADDRESS}`, `login:${ADDRESS}`, DETAIL_EVENT])
  })

  test('transaction details renew an expired widget session with the cached owner', async () => {
    await resetServer({ expireDetails: 1 })
    const account = await freshAccount()
    const OWNER = (await account.getAddress()).toLowerCase()
    const smart = new DummySmartAccount(account)
    const protocol = new DfxProtocol(smart, LOCAL_CONFIG)

    await protocol.buy(OPTIONS)
    const result = protocol.getTransactionDetail(UID)

    await failure(result, NoSuchElementError, 'Transaction not found')
    expect(smart.messages).toEqual([challengeMessage(SMART_ADDRESS), challengeMessage(OWNER), challengeMessage(OWNER)])
    expect(await serverControl('/__events')).toEqual([
      `challenge:${SMART_ADDRESS}`, `challenge:${OWNER}`, `login:${OWNER}`, DETAIL_EVENT,
      `challenge:${OWNER}`, `login:${OWNER}`, DETAIL_EVENT_2
    ])
  })
})
