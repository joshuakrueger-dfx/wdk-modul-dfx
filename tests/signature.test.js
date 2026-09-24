// Copyright 2026 DFX AG
// SPDX-License-Identifier: Apache-2.0

import { expect, test } from '@jest/globals'
import { normalizeSignature } from '../src/signature.js'

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
