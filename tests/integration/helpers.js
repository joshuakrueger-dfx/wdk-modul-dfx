// Copyright 2026 DFX AG
// SPDX-License-Identifier: Apache-2.0

import WDK from '@tetherto/wdk'
import WalletManagerEvm from '@tetherto/wdk-wallet-evm'

export const CONFIG = { environment: 'sandbox', network: 'ethereum', timeout: 5000 }
export const PAIR = { cryptoAsset: 'USDT', fiatCurrency: 'CHF' }
export const UID = '00000000-0000-4000-8000-000000000000'
export const EXTERNAL_TRANSACTION_ID = 'wdk-integration-unregistered-00000000-0000-4000-8000-000000000000'
export const ADDRESS_PLACEHOLDER = '{{ADDRESS}}'
export const DUMMY_TOKEN = 'eyJhbGciOiJub25lIn0.eyJzdWIiOiJkdW1teS1sb2NhbC11c2VyIn0.ZHVtbXktc2lnbmF0dXJl'

export async function accountFixture () {
  // Signing is local; an accidental RPC request must never reach a public node.
  const wallet = new WalletManagerEvm(WDK.getRandomSeedPhrase(), { provider: 'http://127.0.0.1:1' })
  return wallet.getAccount(0)
}

export function localFetch (url, init) {
  const target = new URL(url)
  if (target.origin !== 'https://dev.api.dfx.swiss') throw new Error(`Unexpected API origin: ${target.origin}`)
  const origin = process.env.DFX_INTEGRATION_ORIGIN
  if (!origin || !/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) throw new Error('Missing local DFX server; use test:integration')
  return globalThis.fetch(`${origin}${target.pathname}${target.search}`, { ...init, redirect: 'error' })
}

export const LOCAL_CONFIG = { ...CONFIG, fetch: localFetch }

export class DummyChangingSigner {
  constructor (account, otherAccount) {
    this.account = account
    this.otherAccount = otherAccount
    this.calls = 0
  }

  getAddress () {
    return this.account.getAddress()
  }

  sign (message) {
    // The protocol retries with the recovered owner after the first signature.
    // Switching keys then makes the POST signature invalid for its address.
    return (this.calls++ === 0 ? this.otherAccount : this.account).sign(message)
  }
}
