// Copyright 2026 DFX AG
// SPDX-License-Identifier: Apache-2.0

// Tokenize strings before numbers so digits and escaped quotes inside strings stay intact.
export function parseNumbers (text) {
  return JSON.parse(text.replace(/"(?:[^"\\]|\\[\s\S])*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/g, (token, offset) => {
    // Do not repair invalid unquoted numeric object keys into valid JSON.
    const key = text.slice(offset + token.length).trimStart().startsWith(':')
    return token[0] === '"' || key ? token : JSON.stringify(token)
  }))
}
