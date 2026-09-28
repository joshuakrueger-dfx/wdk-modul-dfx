// Copyright 2026 DFX AG
// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, jest, test } from '@jest/globals'
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { keccak_256 as keccak256 } from '@noble/hashes/sha3.js'
import DfxProtocol, { ProviderError, ProviderErrorReason } from '../index.js'
import { expectRequests, failure, httpRequest, response } from './helpers.js'

const fetchMock = jest.fn()
const getAddressMock = jest.fn()
const signMock = jest.fn()

class DummyAccount {
  async getAddress () { return getAddressMock() }
  async sign (message) { return signMock(message) }
}

describe('@dfx.swiss/wdk-protocol-fiat-dfx', () => {
  describe('getTransactionDetail', () => {
    const DUMMY_ADDRESS = '0x0000000000000000000000000000000000000001'
    const DUMMY_MESSAGE = 'Grüezi 👋\nAuthenticate this exact message'
    const DUMMY_SOLANA = '00'.repeat(62) + '0d24'
    const DUMMY_DER = '304402210080' + '00'.repeat(31) + '021f01' + '00'.repeat(30)
    const DUMMY_COMPACT = '80' + '00'.repeat(31) + '0001' + '00'.repeat(30)

    beforeEach(() => {
      fetchMock.mockReset()
      getAddressMock.mockReset().mockResolvedValue(DUMMY_ADDRESS)
      signMock.mockReset()
    })

    // A denied login terminates this public operation immediately after the
    // observable auth request, without requiring unrelated catalog fixtures.
    test.each([
      ['solana', 'Solana', DUMMY_SOLANA, '1'.repeat(62) + '211'],
      ['solana', 'Solana', DUMMY_SOLANA.toUpperCase(), '1'.repeat(62) + '211'],
      ['solana', 'Solana', '00'.repeat(64), '1'.repeat(64)],
      ['solana', 'Solana', '00'.repeat(63) + '39', '1'.repeat(63) + 'z'],
      ['solana', 'Solana', '00'.repeat(63) + '3a', '1'.repeat(63) + '21'],
      ['spark', 'Spark', DUMMY_DER, DUMMY_COMPACT],
      ['spark', 'Spark', DUMMY_DER.toUpperCase(), DUMMY_COMPACT],
      ['spark', 'Spark', '3044021f01' + '00'.repeat(30) + '02210080' + '00'.repeat(31), '0001' + '00'.repeat(30) + '80' + '00'.repeat(31)],
      ['spark', 'Spark', '30440220' + '7f'.repeat(32) + '0220' + '01'.repeat(32), '7f'.repeat(32) + '01'.repeat(32)],
      ['spark', 'Spark', '3006020101020102', '00'.repeat(31) + '01' + '00'.repeat(31) + '02'],
      ['spark', 'Spark', '3006020100020100', '00'.repeat(64)],
      ...[
        '', 'xyz', '300', '0x3006020101020102',
        '3106020101020102', '3007020101020102',
        '3006030101020102', '3006020101030102',
        '3006020001020102', '3006022201020102',
        '3006020701020102', '3006020180020102',
        '300702020001020102', '300702020000020102',
        '3006020101020180', '300702010102020001',
        '300702010102010200', '30020201',
        '30260221' + '01'.repeat(33) + '020101',
        '30260201010221' + '01'.repeat(33),
        '3080' + '00'.repeat(128), DUMMY_COMPACT
      ].map(signature => ['spark', 'Spark', signature, signature]),
      ...[
        ['solana', 'Solana', 'ab'.repeat(63)], ['solana', 'Solana', 'ab'.repeat(65)],
        ['solana', 'Solana', 'gg'.repeat(64)], ['solana', 'Solana', '1'.repeat(64)],
        ['solana', 'Solana', '0x' + DUMMY_SOLANA], ['spark', 'Spark', DUMMY_SOLANA],
        ['ethereum', 'Ethereum', DUMMY_SOLANA], ['tron', 'Tron', DUMMY_DER],
        [undefined, undefined, DUMMY_SOLANA]
      ].map(([network, blockchain, signature]) => [network, blockchain, signature, signature]),
      // Constructor network names are case-insensitive at the public boundary.
      ['SOLANA', 'Solana', DUMMY_SOLANA, '1'.repeat(62) + '211'],
      ['SoLaNa', 'Solana', DUMMY_SOLANA, '1'.repeat(62) + '211'],
      ['SPARK', 'Spark', DUMMY_DER, DUMMY_COMPACT]
    ])('submits the exact %s authentication signature for format %#', async (NETWORK, BLOCKCHAIN, DUMMY_SIGNATURE, EXPECTED_SIGNATURE) => {
      signMock.mockResolvedValue(DUMMY_SIGNATURE)
      fetchMock.mockResolvedValueOnce(response({ message: DUMMY_MESSAGE }))
        .mockResolvedValueOnce(response({ message: 'Invalid signature' }, 401))
      const protocol = new DfxProtocol(new DummyAccount(), { network: NETWORK, fetch: fetchMock })

      const result = protocol.getTransactionDetail('123')

      await failure(result, ProviderError, 'Invalid signature', ProviderErrorReason.UNAUTHORIZED)
      expect(getAddressMock.mock.calls).toEqual([[]])
      expect(signMock.mock.calls).toEqual([[DUMMY_MESSAGE]])
      expectRequests(fetchMock.mock.calls, [
        httpRequest(`/v1/auth/signMessage?address=${DUMMY_ADDRESS}`),
        httpRequest('/v1/auth', 'POST', JSON.stringify({ address: DUMMY_ADDRESS, signature: EXPECTED_SIGNATURE, blockchain: BLOCKCHAIN }))
      ])
    })

    test.each([
      '', 'invalid', '0x' + '11'.repeat(64), '0x' + 'gg'.repeat(65),
      ...[26, 29, 35, 255].map(v => '0x' + '11'.repeat(64) + v.toString(16).padStart(2, '0')),
      '0x' + '00'.repeat(64) + '1b', '0x' + 'ff'.repeat(64) + '1c'
    ])('forwards malformed EVM recovery input %# for backend rejection', async DUMMY_SIGNATURE => {
      signMock.mockResolvedValue(DUMMY_SIGNATURE)
      fetchMock.mockResolvedValueOnce(response({ message: DUMMY_MESSAGE }))
        .mockResolvedValueOnce(response({ message: 'Invalid signature' }, 401))
      const protocol = new DfxProtocol(new DummyAccount(), { network: 'ethereum', fetch: fetchMock })

      const result = protocol.getTransactionDetail('123')

      await failure(result, ProviderError, 'Invalid signature', ProviderErrorReason.UNAUTHORIZED)
      expect(getAddressMock.mock.calls).toEqual([[]])
      expect(signMock.mock.calls).toEqual([[DUMMY_MESSAGE]])
      expectRequests(fetchMock.mock.calls, [
        httpRequest(`/v1/auth/signMessage?address=${DUMMY_ADDRESS}`),
        httpRequest('/v1/auth', 'POST', JSON.stringify({ address: DUMMY_ADDRESS, signature: DUMMY_SIGNATURE, blockchain: 'Ethereum' }))
      ])
    })

    test.each([0, 27].flatMap(offset => [false, true].flatMap(highS => ['', '0x', '0X'].map(prefix =>
      [offset, highS, prefix]
    ))))('authenticates the EIP-191 owner with v offset %s, high-s %s and prefix %s', async (OFFSET, HIGH_S, PREFIX) => {
      const OWNER_ADDRESS = '0x7e5f4552091a69125d5dfcb7b8c2659029395bdf'
      const KEY = Uint8Array.from([...new Array(31).fill(0), 1])
      const PAYLOAD = Buffer.from(DUMMY_MESSAGE, 'utf8')
      const DIGEST = keccak256(Buffer.concat([Buffer.from(`\x19Ethereum Signed Message:\n${PAYLOAD.length}`), PAYLOAD]))
      let signature = secp256k1.Signature.fromBytes(secp256k1.sign(DIGEST, KEY, { prehash: false, format: 'recovered' }), 'recovered')
      if (HIGH_S) {
        const ORDER = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n
        signature = new secp256k1.Signature(signature.r, ORDER - signature.s, signature.recovery ^ 1)
      }
      const DUMMY_SIGNATURE = PREFIX + signature.toHex('compact').toUpperCase() + (signature.recovery + OFFSET).toString(16).padStart(2, '0')
      signMock.mockResolvedValue(DUMMY_SIGNATURE)
      fetchMock.mockResolvedValueOnce(response({ message: DUMMY_MESSAGE }))
        .mockResolvedValueOnce(response({ message: DUMMY_MESSAGE }))
        .mockResolvedValueOnce(response({ message: 'Invalid signature' }, 401))
      const protocol = new DfxProtocol(new DummyAccount(), { network: 'ethereum', fetch: fetchMock })

      const result = protocol.getTransactionDetail('123')

      await failure(result, ProviderError, 'Invalid signature', ProviderErrorReason.UNAUTHORIZED)
      expect(getAddressMock.mock.calls).toEqual([[]])
      expect(signMock.mock.calls).toEqual([[DUMMY_MESSAGE], [DUMMY_MESSAGE]])
      expectRequests(fetchMock.mock.calls, [
        httpRequest(`/v1/auth/signMessage?address=${DUMMY_ADDRESS}`),
        httpRequest(`/v1/auth/signMessage?address=${OWNER_ADDRESS}`),
        httpRequest('/v1/auth', 'POST', JSON.stringify({ address: OWNER_ADDRESS, signature: DUMMY_SIGNATURE, blockchain: 'Ethereum' }))
      ])
    })
  })
})
