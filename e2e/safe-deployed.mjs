// Live DFX sandbox probe. Only wallet RPCs use the local Polygon fork.
// Creates sandbox authentication sessions; does not submit buy/sell payments.
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import { verifyMessage } from 'ethers'
import WDK from '@tetherto/wdk'
import WalletManagerEvmErc4337 from '@tetherto/wdk-wallet-evm-erc-4337'
import DfxProtocol from '@dfx.swiss/wdk-protocol-fiat-dfx'

const require = createRequire(import.meta.url)
const walletRequire = createRequire(require.resolve('@tetherto/wdk-wallet-evm-erc-4337'))
const { SafeAccountV0_3_0: SafeAccount030 } = walletRequire('abstractionkit')
const API = 'https://dev.api.dfx.swiss'
const MESSAGE = 'DFX deployed Safe owner-signature probe v1'
const results = []
const stop = new AbortController()
let child, childDone, childError, wdk, rpcUrl, account, fiat, safe, owner, signatureBefore
let rpcId = 0

class ProbeFailure extends Error {}
function check (condition, message) {
  if (!condition) throw new ProbeFailure(message)
}

async function step (name, fn) {
  const started = Date.now()
  try {
    stop.signal.throwIfAborted()
    const value = await fn()
    results.push({ chain: 'polygon-4337', name, ok: true, value })
    console.log(`  OK   ${name} (${Date.now() - started} ms)`)
    return value
  } catch (error) {
    // Third-party errors can contain signed requests, seeds or session URLs.
    // Only our own constant diagnostics are safe to persist or print.
    const diagnostic = error instanceof ProbeFailure ? error.message : 'Operation failed; sensitive error details omitted'
    results.push({ chain: 'polygon-4337', name, ok: false, error: diagnostic })
    console.log(`  FAIL ${name}: ${diagnostic}`)
    throw error
  }
}

async function rpc (method, params = []) {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
    signal: AbortSignal.any([stop.signal, AbortSignal.timeout(15000)])
  })
  check(response.ok, `RPC HTTP failure for ${method}`)
  const body = await response.json()
  check(!body.error && Object.hasOwn(body, 'result'), `RPC rejected ${method}`)
  return body.result
}

async function waitFor (fn, timeout, diagnostic) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    stop.signal.throwIfAborted()
    check(childError?.code !== 'ENOENT', 'Anvil executable not found; install anvil and add it to PATH')
    check(!childError && child.exitCode === null && child.signalCode === null, 'Anvil exited unexpectedly')
    const value = await fn()
    if (value) return value
    await delay(250, undefined, { signal: stop.signal })
  }
  throw new ProbeFailure(diagnostic)
}

async function stopAnvil () {
  if (!child || child.exitCode !== null || child.signalCode !== null || childError) return
  child.kill('SIGTERM')
  const exited = await Promise.race([childDone.then(() => true), delay(3000).then(() => false)])
  if (!exited) {
    child.kill('SIGKILL')
    await childDone
  }
}

const onSignal = () => stop.abort(new ProbeFailure('Interrupted'))
process.once('SIGINT', onSignal)
process.once('SIGTERM', onSignal)
// Bound library calls too, including calls that do not accept AbortSignal.
const watchdog = setTimeout(() => stop.abort(new ProbeFailure('Probe exceeded five minutes')), 300000)
const interrupted = new Promise((resolve, reject) => {
  stop.signal.addEventListener('abort', () => reject(stop.signal.reason), { once: true })
})

async function run () {
  await step('single @tetherto/wdk-wallet copy', async () => {
    const dfxWalletPath = createRequire(require.resolve('@dfx.swiss/wdk-protocol-fiat-dfx')).resolve('@tetherto/wdk-wallet')
    const wdkWalletPath = createRequire(require.resolve('@tetherto/wdk')).resolve('@tetherto/wdk-wallet')
    check(dfxWalletPath === wdkWalletPath, 'Duplicate @tetherto/wdk-wallet copies; reinstall e2e dependencies with install-links=true')
    return { copies: 1 }
  })

  await step('start Polygon fork and await eth_chainId', async () => {
    const portText = process.env.ANVIL_PORT ?? '8547'
    check(/^\d+$/.test(portText), 'ANVIL_PORT must be an integer')
    const port = Number(portText)
    check(port > 0 && port <= 65535, 'ANVIL_PORT must be between 1 and 65535')
    rpcUrl = `http://127.0.0.1:${port}`
    // Refuse an occupied port instead of accidentally mutating another node.
    await new Promise((resolve, reject) => {
      const server = createServer()
      server.once('error', () => reject(new ProbeFailure('ANVIL_PORT is unavailable')))
      server.listen(port, '127.0.0.1', () => server.close(error => error ? reject(error) : resolve()))
    })
    child = spawn('anvil', [
      '--fork-url', 'https://polygon-bor-rpc.publicnode.com',
      '--chain-id', '137', '--host', '127.0.0.1', '--port', String(port), '--silent'
    ], { stdio: 'ignore' })
    childDone = new Promise(resolve => {
      child.once('error', error => { childError = error; resolve() })
      child.once('exit', resolve)
    })
    await waitFor(async () => {
      try { return await rpc('eth_chainId') === '0x89' } catch { return false }
    }, 60000, 'Anvil did not report Polygon chain ID 137')
    return { chainId: 137, port }
  })

  await step('register WDK and assert counterfactual Safe', async () => {
    wdk = new WDK(WDK.getRandomSeedPhrase())
      .registerWallet('polygon', WalletManagerEvmErc4337, {
        chainId: 137, provider: rpcUrl, bundlerUrl: 'https://bundler.invalid',
        safeModulesVersion: '0.3.0', useNativeCoins: true
      })
      .registerProtocol('polygon', 'dfx', DfxProtocol, { environment: 'sandbox', network: 'polygon' })
    account = await wdk.getAccount('polygon', 0)
    safe = await account.getAddress()
    fiat = account.getFiatProtocol('dfx')
    check(fiat instanceof DfxProtocol, 'DFX protocol registration failed')
    check(await rpc('eth_getCode', [safe, 'latest']) === '0x', 'Safe was already deployed')
    check(!await SafeAccount030.isDeployed(safe, rpcUrl), 'Package reports Safe already deployed')
    return { safe, deployed: false }
  })

  await step('sign before deployment and recover owner', async () => {
    signatureBefore = await account.sign(MESSAGE)
    owner = verifyMessage(MESSAGE, signatureBefore)
    check(owner.toLowerCase() !== safe.toLowerCase(), 'Recovered owner equals Safe')
    check(owner.toLowerCase() === (await account._ownerAccount.getAddress()).toLowerCase(), 'Signature does not recover package owner')
    return { owner, safe }
  })

  await step('deploy package factory transaction without bundler', async () => {
    // beta.20 uses AbstractionKit, not Relay Kit. _getSmartAccount preserves
    // the exact init-code overrides used by WDK to predict this Safe address.
    // Its factoryAddress + factoryData are the first UserOperation's initCode.
    const smartAccount = await account._getSmartAccount()
    check(smartAccount.accountAddress.toLowerCase() === safe.toLowerCase(), 'Factory account differs from WDK Safe')
    check(/^0x[0-9a-f]{40}$/i.test(smartAccount.factoryAddress ?? ''), 'Package returned no deployment factory')
    check(/^0x[0-9a-f]+$/i.test(smartAccount.factoryData ?? ''), 'Package returned no deployment calldata')
    await rpc('anvil_setBalance', [owner, '0x56bc75e2d63100000']) // 100 POL on fork only.
    await rpc('anvil_impersonateAccount', [owner])
    let hash
    try {
      hash = await rpc('eth_sendTransaction', [{ from: owner, to: smartAccount.factoryAddress, data: smartAccount.factoryData, value: '0x0', gas: '0x7a1200' }])
      const receipt = await waitFor(() => rpc('eth_getTransactionReceipt', [hash]), 60000, 'Deployment receipt timed out')
      check(receipt.status === '0x1', 'Safe deployment transaction reverted')
    } finally {
      await rpc('anvil_stopImpersonatingAccount', [owner])
    }
    check(await rpc('eth_getCode', [safe, 'latest']) !== '0x', 'Safe has no deployed bytecode')
    check(await SafeAccount030.isDeployed(safe, rpcUrl), 'Package does not recognize deployed Safe')
    const deployed = await account._getSmartAccount()
    check(deployed.factoryAddress === null && deployed.factoryData === null, 'WDK still builds a counterfactual account')
    return { safe, transactionHash: hash, deployed: true }
  })

  await step('sign after deployment: identical signature and owner', async () => {
    const signatureAfter = await account.sign(MESSAGE)
    check(signatureAfter === signatureBefore, 'Signature changed after deployment')
    check(verifyMessage(MESSAGE, signatureAfter).toLowerCase() === owner.toLowerCase(), 'Signer changed after deployment')
    return { identical: true, owner }
  })

  const asset = await step('find USDT on Polygon', async () => {
    const asset = (await fiat.getSupportedCryptoAssets()).find(a => a.code === 'USDT' && a.networkCode === 'polygon')
    check(asset && Number.isInteger(asset.decimals) && asset.decimals >= 0, 'USDT/Polygon missing or invalid decimals')
    return { code: asset.code, decimals: asset.decimals }
  })
  const buyOptions = { cryptoAsset: 'USDT', fiatCurrency: 'EUR', fiatAmount: 10000n }
  await step('quoteBuy EUR to USDT/Polygon', async () => {
    const quote = await fiat.quoteBuy(buyOptions)
    check(typeof quote?.cryptoAmount === 'bigint' && quote.cryptoAmount > 0n, 'quoteBuy returned no positive crypto amount')
    check(quote.fiatAmount === buyOptions.fiatAmount, 'quoteBuy changed requested fiat amount')
    return { quoted: true, cryptoAmount: String(quote.cryptoAmount), fiatAmount: String(quote.fiatAmount) }
  })
  for (const kind of ['buy', 'sell']) {
    // Session URLs stay in memory and never enter results or console output.
    let session
    await step(`${kind} with deployed Safe`, async () => {
      const response = await fiat[kind](kind === 'buy' ? buyOptions : {
        cryptoAsset: 'USDT', fiatCurrency: 'EUR', cryptoAmount: 50n * 10n ** BigInt(asset.decimals)
      })
      const url = new URL(response[`${kind}Url`])
      session = url.searchParams.get('session')
      check(url.protocol === 'https:' && session, 'Missing HTTPS widget URL or session')
      return { sessionPresent: true }
    })
    await step(`${kind} session: GET /v2/user is 200 and owner authenticated`, async () => {
      const response = await fetch(`${API}/v2/user`, {
        headers: { Authorization: `Bearer ${session}` },
        signal: AbortSignal.any([stop.signal, AbortSignal.timeout(30000)])
      })
      check(response.status === 200, 'Sandbox /v2/user did not return 200')
      const profile = await response.json()
      const profileAddress = profile.activeAddress?.address
      check(typeof profileAddress === 'string' && profileAddress.toLowerCase() === owner.toLowerCase(), 'Sandbox profile address is not signing owner')
      const jwtAddress = JSON.parse(Buffer.from(session.split('.')[1], 'base64url').toString('utf8')).address
      check(typeof jwtAddress === 'string' && jwtAddress.toLowerCase() === owner.toLowerCase(), 'Sandbox JWT address is not signing owner')
      return { status: response.status, address: owner, profileAddress, jwtAddress }
    })
    session = undefined
  }
  await step('Safe recipient rejected with ValueError and owner hint', async () => {
    let rejection
    try { await fiat.buy({ ...buyOptions, recipient: safe }) } catch (error) { rejection = error }
    check(rejection?.constructor?.name === 'ValueError', 'Safe recipient did not raise ValueError')
    check(/owner/i.test(rejection.message) && rejection.message.toLowerCase().includes(owner.toLowerCase()), 'ValueError lacks signing-owner address hint')
    return { rejected: true, ownerHint: true }
  })
}

try {
  await Promise.race([run(), interrupted])
} catch {
  if (!results.some(result => !result.ok)) {
    results.push({ chain: 'polygon-4337', name: 'probe interrupted', ok: false, error: 'Interrupted or overall timeout exceeded' })
  }
  process.exitCode = 1
} finally {
  stop.abort(new ProbeFailure('Probe finished'))
  clearTimeout(watchdog)
  try {
    await stopAnvil()
  } finally {
    try { wdk?.dispose() } finally {
      const out = new URL('./out/', import.meta.url)
      mkdirSync(out, { recursive: true })
      writeFileSync(new URL('safe-deployed.json', out), JSON.stringify(results, null, 2) + '\n', { mode: 0o600 })
      const failures = results.filter(result => !result.ok).length
      console.log(`SUMMARY: ${results.length - failures}/${results.length} steps OK`)
      // Pending SDK requests must not outlive the bounded probe and child cleanup.
      process.exit(failures || process.exitCode ? 1 : 0)
    }
  }
}
