// Copyright 2026 DFX AG
// SPDX-License-Identifier: Apache-2.0

export default {
  rootDir: '../..',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/tests/integration/module.test.js'],
  globalSetup: '<rootDir>/tests/integration/setup.js',
  globalTeardown: '<rootDir>/tests/integration/teardown.js',
  collectCoverage: false,
  testTimeout: 15000
}
