// Copyright 2026 DFX AG
// SPDX-License-Identifier: Apache-2.0

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

function base58 (hex) {
  let value = BigInt(`0x${hex}`)
  let encoded = ''
  while (value > 0n) {
    encoded = BASE58[Number(value % 58n)] + encoded
    value /= 58n
  }
  for (let offset = 0; offset < hex.length && hex.slice(offset, offset + 2) === '00'; offset += 2) encoded = '1' + encoded
  return encoded
}

function compactDer (hex) {
  const bytes = hex.match(/../g).map(byte => parseInt(byte, 16))
  // Both scalars fit in 32 bytes plus a possible sign byte: DER lengths are short form.
  if (bytes[0] !== 0x30 || bytes[1] !== bytes.length - 2 || bytes[1] >= 0x80) return hex
  let offset = 2
  const scalars = []
  for (let index = 0; index < 2; index++) {
    if (bytes[offset++] !== 0x02) return hex
    const length = bytes[offset++]
    if (!length || length > 33 || offset + length > bytes.length) return hex
    const scalar = bytes.slice(offset, offset + length)
    offset += length
    // DER INTEGERs must be nonnegative and minimally encoded.
    if (scalar[0] >= 0x80) return hex
    if (scalar[0] === 0 && scalar.length > 1) {
      if (scalar[1] < 0x80) return hex
      scalar.shift()
    }
    if (scalar.length > 32) return hex
    scalars.push(scalar.map(byte => byte.toString(16).padStart(2, '0')).join('').padStart(64, '0'))
  }
  return offset === bytes.length ? scalars.join('') : hex
}

/** Internal format conversion only; never signs or accesses account keys. */
export function normalizeSignature (network, signature) {
  if (network === 'solana' && /^[0-9a-f]{128}$/i.test(signature)) return base58(signature)
  if (network === 'spark' && /^(?:[0-9a-f]{2}){4,}$/i.test(signature)) return compactDer(signature)
  return signature
}
