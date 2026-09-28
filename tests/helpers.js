// Copyright 2026 DFX AG
// SPDX-License-Identifier: Apache-2.0

import { expect } from '@jest/globals'

// AbortSignal identity is allocated by the runtime, not a deterministic fixture.
// All HTTP data is compared verbatim; the signal is checked separately.
export function expectRequests (calls, expected, aborted = false) {
  expect(calls.map(([url, { signal, ...init }]) => [url, init])).toEqual(expected)
  for (const [, { signal }] of calls) expect(signal.aborted).toBe(aborted)
}

export function httpRequest (path, method = 'GET', body, token, environment = 'production') {
  const headers = { Accept: 'application/json' }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (token !== undefined) headers.Authorization = `Bearer ${token}`
  const base = environment === 'sandbox' ? 'https://dev.api.dfx.swiss' : 'https://api.dfx.swiss'
  return [`${base}${path}`, { method, headers, body }]
}

export async function failure (promise, ErrorClass, message, reason) {
  const error = await promise.then(() => undefined, error => error)
  expect(error?.constructor).toBe(ErrorClass)
  expect(error?.message).toBe(message)
  expect(error?.reason).toBe(reason)
  return error
}
