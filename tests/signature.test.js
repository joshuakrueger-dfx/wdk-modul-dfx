// Copyright 2026 DFX AG
// SPDX-License-Identifier: Apache-2.0

import { expect, test } from '@jest/globals'
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { keccak_256 } from '@noble/hashes/sha3.js'
import { normalizeSignature, recoverEvmAddress } from '../src/signature.js'

// Independent ethers Wallet.signMessage vector, public private-key scalar 2.
const ETHERS_MESSAGE = 'By_signing_this_message,_you_confirm_that_you_are_the_sole_owner_of_the_provided_Blockchain_address. Grüße ✓ 0xabc'
const ETHERS_SIGNATURE = '0x97ef3091c721f0afe35f3211adf256f2ce0231a7f7efebee90bce4ce43ffe0c84ca2dba2bb88d3e89b561d9b4c9d79a929e2d896cdbc65f5e1556dbd9ef20ae21c'

test('recovers the ethers EIP-191 UTF-8 reference signer', () => {
  expect(recoverEvmAddress(ETHERS_MESSAGE, ETHERS_SIGNATURE)).toBe('0x2b5ad5c4795c026514f8317c7a215e218dccd6cf')
})

test.each([0, 27].flatMap(offset => [false, true].flatMap(highS => ['', '0x', '0X'].map(prefix =>
  [offset, highS, prefix]
))))('recovers real personal-sign bytes with v offset %s, high-s %s and prefix %s', (offset, highS, prefix) => {
  const message = 'Grüezi 👋\nAuthenticate this exact message'
  const payload = Buffer.from(message, 'utf8')
  const digest = keccak_256(Buffer.concat([Buffer.from(`\x19Ethereum Signed Message:\n${payload.length}`), payload]))
  const key = Uint8Array.from([...new Array(31).fill(0), 1])
  let signature = secp256k1.Signature.fromBytes(secp256k1.sign(digest, key, { prehash: false, format: 'recovered' }), 'recovered')
  if (highS) {
    const order = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n
    signature = new secp256k1.Signature(signature.r, order - signature.s, signature.recovery ^ 1)
  }
  const wire = prefix + signature.toHex('compact').toUpperCase() + (signature.recovery + offset).toString(16).padStart(2, '0')
  expect(recoverEvmAddress(message, wire)).toBe('0x7e5f4552091a69125d5dfcb7b8c2659029395bdf')
  expect(recoverEvmAddress(message + '!', wire)).not.toBe('0x7e5f4552091a69125d5dfcb7b8c2659029395bdf')
})

test.each([
  '', 'invalid', '0xsig', '0x' + '11'.repeat(64), '0x' + 'gg'.repeat(65),
  ...[2, 26, 29, 35, 255].map(v => '0x' + '11'.repeat(64) + v.toString(16).padStart(2, '0')),
  '0x' + '00'.repeat(64) + '1b', '0x' + 'ff'.repeat(64) + '1c'
])('leaves malformed recovery input %# to the backend', signature => {
  expect(recoverEvmAddress('message', signature)).toBeUndefined()
})

// Hand-checkable bytes, not cryptographic validity fixtures:
// 00 repeated 62 times followed by 0d24 = 3364 = 58 squared -> base58 "211".
const SOLANA = '00'.repeat(62) + '0d24'
// Sequence payload 68 bytes: INTEGER r (33 bytes, sign pad + 80 + 31 zeroes),
// INTEGER s (31 bytes, 01 + 30 zeroes).
const DER = '304402210080' + '00'.repeat(31) + '021f01' + '00'.repeat(30)
const COMPACT = '80' + '00'.repeat(31) + '0001' + '00'.repeat(30)

test.each([
  [SOLANA, '1'.repeat(62) + '211'],
  [SOLANA.toUpperCase(), '1'.repeat(62) + '211'],
  ['00'.repeat(64), '1'.repeat(64)],
  ['00'.repeat(63) + '39', '1'.repeat(63) + 'z'],
  ['00'.repeat(63) + '3a', '1'.repeat(63) + '21']
])('encodes fixed Solana bytes %#', (hex, expected) => {
  expect(normalizeSignature('solana', hex)).toBe(expected)
})

test.each([
  [DER, COMPACT],
  [DER.toUpperCase(), COMPACT],
  ['3044021f01' + '00'.repeat(30) + '02210080' + '00'.repeat(31), '0001' + '00'.repeat(30) + '80' + '00'.repeat(31)],
  ['30440220' + '7f'.repeat(32) + '0220' + '01'.repeat(32), '7f'.repeat(32) + '01'.repeat(32)],
  ['3006020101020102', '00'.repeat(31) + '01' + '00'.repeat(31) + '02'],
  ['3006020100020100', '00'.repeat(64)]
])('decodes DER scalars without signing %#', (hex, expected) => {
  expect(normalizeSignature('spark', hex)).toBe(expected)
})

test.each([
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
  '3080' + '00'.repeat(128), COMPACT
])('preserves malformed or non-DER Spark signatures %#', signature => {
  expect(normalizeSignature('spark', signature)).toBe(signature)
})

test.each([
  ['solana', 'ab'.repeat(63)], ['solana', 'ab'.repeat(65)],
  ['solana', 'gg'.repeat(64)], ['solana', '1'.repeat(64)],
  ['solana', '0x' + SOLANA], ['spark', SOLANA],
  ['ethereum', SOLANA], ['tron', DER], [undefined, SOLANA],
  ['SOLANA', SOLANA], ['SPARK', DER]
])('only converts recognized formats on the selected network %#', (network, signature) => {
  expect(normalizeSignature(network, signature)).toBe(signature)
})
