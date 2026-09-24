// Copyright 2026 DFX AG
// SPDX-License-Identifier: Apache-2.0

import { beforeAll, describe, expect, test } from '@jest/globals'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ValueError } from '@tetherto/wdk-wallet/protocols'
import DfxProtocol from '../index.js'

/**
 * A locally supplied sandbox account; the test never reads key material.
 * @typedef {Object} TestAccount
 * @property {() => Promise<string>} getAddress - Returns the account address.
 * @property {(message: string) => Promise<string>} sign - Signs the exact DFX challenge.
 */

const enabled = process.env.DFX_INTEGRATION === '1'
const sandbox = enabled ? describe : describe.skip
const authenticated = enabled && process.env.DFX_TEST_ACCOUNT_MODULE ? describe : describe.skip

function configuration () {
  return {
    environment: 'sandbox',
    network: process.env.DFX_NETWORK || 'ethereum',
    wallet: process.env.DFX_WALLET || undefined,
    timeout: 30000
  }
}

function pair () {
  return {
    cryptoAsset: process.env.DFX_TEST_CRYPTO_ASSET || 'USDT',
    fiatCurrency: process.env.DFX_TEST_FIAT_CURRENCY || 'CHF'
  }
}

function amount (field) {
  return BigInt(field === 'fiatAmount'
    ? process.env.DFX_TEST_FIAT_AMOUNT || '10000'
    : process.env.DFX_TEST_CRYPTO_AMOUNT || '100000000')
}

sandbox('public DFX sandbox integration', () => {
  test.each(['getSupportedCryptoAssets', 'getSupportedFiatCurrencies', 'getSupportedCountries'])('%s returns a nonempty live catalog', async method => {
    const result = await new DfxProtocol(undefined, configuration())[method]()
    expect(result.length).toBeGreaterThan(0)
    expect(new Set(result.map(row => row.code)).has(undefined)).toBe(false)
  }, 45000)

  test.each([
    ['quoteBuy', 'fiatAmount'], ['quoteBuy', 'cryptoAmount'],
    ['quoteSell', 'fiatAmount'], ['quoteSell', 'cryptoAmount']
  ])('%s supports live %s input', async (method, field) => {
    const requested = amount(field)
    const quote = await new DfxProtocol(undefined, configuration())[method]({ ...pair(), [field]: requested })
    expect(quote[field]).toBe(requested)
    expect(quote.cryptoAmount).toBeGreaterThan(0n)
    expect(quote.fiatAmount).toBeGreaterThan(0n)
    expect(quote.fee).toBeGreaterThanOrEqual(0n)
    expect(quote.rate).toMatch(/^\d+(?:\.\d+)?$/)
  }, 45000)
})

authenticated('authenticated DFX sandbox integration', () => {
  /** @type {TestAccount} */
  let account

  beforeAll(async () => {
    const moduleUrl = pathToFileURL(resolve(process.env.DFX_TEST_ACCOUNT_MODULE)).href
    account = (await import(moduleUrl)).default
    if (typeof account?.getAddress !== 'function' || typeof account?.sign !== 'function') {
      throw new ValueError('DFX_TEST_ACCOUNT_MODULE must default-export an object with getAddress and sign')
    }
  })

  test.each(['buy', 'sell'])('%s authenticates and returns a sandbox widget URL', async method => {
    const result = await new DfxProtocol(account, configuration())[method]({ ...pair(), fiatAmount: amount('fiatAmount') })
    const url = new URL(result[`${method}Url`])
    expect(url.origin).toBe('https://dev.app.dfx.swiss')
    expect(url.pathname).toBe(`/${method}`)
    expect(url.searchParams.get('session').length).toBeGreaterThan(0)
  }, 90000)

  test('getTransactionDetail resolves an existing sandbox fiat transaction', async () => {
    const uid = process.env.DFX_TEST_TRANSACTION_UID
    if (!uid) throw new ValueError('DFX_TEST_TRANSACTION_UID must identify a fiat transaction owned by the test account')
    const detail = await new DfxProtocol(account, configuration()).getTransactionDetail(uid)
    expect(['completed', 'failed', 'in_progress']).toContain(detail.status)
    expect(detail.cryptoAsset.length).toBeGreaterThan(0)
    expect(detail.fiatCurrency.length).toBeGreaterThan(0)
  }, 90000)
})
