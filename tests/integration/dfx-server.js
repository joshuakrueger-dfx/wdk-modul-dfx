// Copyright 2026 DFX AG
// SPDX-License-Identifier: Apache-2.0

import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { keccak_256 as keccak256 } from '@noble/hashes/sha3.js'
import { ADDRESS_PLACEHOLDER, DUMMY_TOKEN } from './helpers.js'

function validSignature (message, signature, address) {
  if (typeof signature !== 'string' || !/^0x[0-9a-f]{130}$/i.test(signature)) return false
  try {
    const bytes = Buffer.from(signature.slice(2), 'hex')
    const recovery = bytes[64] >= 27 ? bytes[64] - 27 : bytes[64]
    if (recovery !== 0 && recovery !== 1) return false
    const payload = Buffer.from(message, 'utf8')
    const digest = keccak256(Buffer.concat([Buffer.from(`\x19Ethereum Signed Message:\n${payload.length}`), payload]))
    const recovered = Uint8Array.from([recovery, ...bytes.subarray(0, 64)])
    const publicKey = secp256k1.recoverPublicKey(recovered, digest, { prehash: false })
    const uncompressed = secp256k1.Point.fromBytes(publicKey).toBytes(false)
    const recoveredAddress = '0x' + Buffer.from(keccak256(uncompressed.subarray(1))).subarray(12).toString('hex')
    return recoveredAddress === address.toLowerCase()
  } catch {
    return false
  }
}

export async function startServer () {
  let fixture
  try {
    fixture = JSON.parse(await readFile(new URL('./fixtures/sandbox.json', import.meta.url), 'utf8'))
  } catch (cause) {
    throw new Error('Missing or invalid sandbox recording. Run node tests/integration/record.js manually first.', { cause })
  }
  const { responses } = fixture
  for (const key of ['asset', 'fiat', 'country', 'quoteBuy_fiatAmount', 'quoteBuy_cryptoAmount', 'quoteSell_fiatAmount', 'quoteSell_cryptoAmount', 'challenge', 'detail_uid', 'detail_external']) {
    if (!responses?.[key]) throw new Error(`Missing fixture: ${key}`)
  }
  const challenges = new Map()
  const server = createServer(async (request, response) => {
    const send = (status, raw) => {
      response.writeHead(status, { 'Content-Type': 'application/json' })
      response.end(raw)
    }
    try {
      const chunks = []
      for await (const chunk of request) chunks.push(chunk)
      const body = Buffer.concat(chunks).toString('utf8') || null
      const url = new URL(request.url, 'http://127.0.0.1')
      if (request.method === 'GET' && url.pathname === '/v1/auth/signMessage' && body === null &&
          [...url.searchParams.keys()].join() === 'address' && /^0x[0-9a-f]{40}$/i.test(url.searchParams.get('address'))) {
        const address = url.searchParams.get('address')
        const raw = responses.challenge.raw.replaceAll(ADDRESS_PLACEHOLDER, address)
        challenges.set(address.toLowerCase(), JSON.parse(raw).message)
        send(responses.challenge.status, raw)
        return
      }
      if (request.method === 'POST' && request.url === '/v1/auth') {
        const auth = JSON.parse(body)
        if (!auth || Object.keys(auth).sort().join() !== 'address,blockchain,signature' || auth.blockchain !== 'Ethereum') {
          throw new Error('Unrecorded DFX auth request: expected address, signature and blockchain Ethereum')
        }
        const address = typeof auth.address === 'string' ? auth.address.toLowerCase() : ''
        const message = challenges.get(address)
        if (!message || !validSignature(message, auth.signature, address)) {
          send(401, JSON.stringify({ message: 'Invalid signature' }))
          return
        }
        challenges.delete(address)
        send(200, JSON.stringify({ accessToken: DUMMY_TOKEN }))
        return
      }
      if (request.method === 'GET' && url.pathname === '/v1/transaction/detail/single' &&
          request.headers.authorization !== `Bearer ${DUMMY_TOKEN}`) {
        send(401, JSON.stringify({ message: 'Unauthorized' }))
        return
      }
      const entry = Object.values(responses).find(entry => entry.request &&
        entry.request.method === request.method && entry.request.path === request.url && entry.request.body === body)
      if (!entry) throw new Error(`Unrecorded DFX request: ${request.method} ${request.url} body=${body}`)
      send(entry.status, entry.raw)
    } catch (error) {
      send(500, JSON.stringify({ message: error.message }))
    }
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  return server
}
