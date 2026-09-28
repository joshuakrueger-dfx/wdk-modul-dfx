// Copyright 2026 DFX AG
// SPDX-License-Identifier: Apache-2.0

import WDK from '@tetherto/wdk'
import WalletManagerEvm from '@tetherto/wdk-wallet-evm'
import Big from 'big.js'

export const CONFIG = { environment: 'sandbox', network: 'ethereum', timeout: 30000 }
export const PAIR = { cryptoAsset: 'USDT', fiatCurrency: 'CHF' }

export async function accountFixture () {
  const wallet = new WalletManagerEvm(WDK.getRandomSeedPhrase(), { provider: 'https://ethereum-sepolia-rpc.publicnode.com' })
  return wallet.getAccount(0)
}

// Preserve decimal JSON tokens independently of the protocol's parser. Quoted
// strings are consumed first, so digits inside messages and tokens stay intact.
function parseResponse (text) {
  return JSON.parse(text.replace(/"(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g,
    token => token.startsWith('"') ? token : `"${token}"`))
}

export function observeSandbox () {
  const responses = new Map()
  return {
    responses,
    async fetch (url, init) {
      const response = await globalThis.fetch(url, init)
      responses.set(new URL(url).pathname, parseResponse(await response.clone().text()))
      return response
    }
  }
}

export function expectedQuote (direction, response) {
  const Decimal = Big()
  Decimal.DP = 80
  const fiat = new Decimal(direction === 'buy' ? response.amount : response.estimatedAmount)
  const crypto = new Decimal(direction === 'buy' ? response.estimatedAmount : response.amount)
  const fee = new Decimal(direction === 'buy' ? response.fees.total : response.feesTarget.total)
  return {
    cryptoAmount: BigInt(crypto.times('1000000').toFixed(0)),
    fiatAmount: BigInt(fiat.times('100').toFixed(0)),
    fee: BigInt(fee.times('100').toFixed(0)),
    rate: fiat.div(crypto).prec(18, 1).toFixed()
  }
}
