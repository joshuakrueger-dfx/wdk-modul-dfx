// Real funds on Arbitrum. Run from e2e/: node real-swap-send.mjs <command>.
// WDK Velora 1.0.0-beta.9 omits token decimals, causing Velora API quotes to fail.
// Call the Velora SDK directly with decimals; WDK still estimates fees and signs.
import { constants, openSync, closeSync, fstatSync, lstatSync, readFileSync, writeFileSync, fsyncSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { Contract, JsonRpcProvider, getAddress, ZeroAddress } from 'ethers'
import WalletManagerEvm from '@tetherto/wdk-wallet-evm'
import { constructSimpleSDK } from '@velora-dex/sdk'

const RPC = 'https://arbitrum-one-rpc.publicnode.com'
const WALLET = '0x463e558CC8842078CD1FeC6dF1Ff7F54058BE6C7'
const USDC = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831'
// @velora-dex/sdk/src/methods/delta/helpers/across.ts:86-93.
const ETH = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'
// Task-supplied Arbitrum v6.2 pin; the SDK has no static router table.
// Verify at runtime via @velora-dex/sdk/src/methods/swap/spender.ts:34-67:
// getAugustusSwapper() queries /adapters/contracts with network and version.
const AUGUSTUS_ARBITRUM = '0x6a000f20005980200259b80c5102003040001068'
const ORACLE = '0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612'
const stateDir = join(homedir(), '.wdk-dfx-real')
const record = { time: new Date().toISOString(), command: 'invalid', status: 'started', amounts: {}, hashes: [], fees: {} }
let logFd
let manager
let provider
let veloraSdk
let stage = 'Initialisierung'

class Stop extends Error {}
function check (condition, message) {
  if (!condition) throw new Stop(message)
}

function units (amount, decimals) {
  const sign = amount < 0n ? '-' : ''
  const digits = (amount < 0n ? -amount : amount).toString().padStart(decimals + 1, '0')
  return decimals === 0 ? `${sign}${digits}` : `${sign}${digits.slice(0, -decimals)}.${digits.slice(-decimals)}`
}

function integerEnv (name, fallback, minimum = 1n, maximum = (1n << 256n) - 1n) {
  const value = process.env[name] ?? fallback
  check(/^\d+$/.test(value), `${name} muss eine ganze Zahl sein`)
  const result = BigInt(value)
  check(result >= minimum && result <= maximum, `${name} außerhalb des erlaubten Bereichs`)
  return result
}

function deviationLimit () {
  const value = process.env.MAX_DEVIATION_PCT ?? '1.0'
  check(/^\d+(?:\.\d{1,6})?$/.test(value), 'MAX_DEVIATION_PCT: positive Dezimalzahl mit höchstens sechs Nachkommastellen erforderlich')
  const [whole, fraction = ''] = value.split('.')
  const result = BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, '0'))
  check(result <= 100000000n, 'MAX_DEVIATION_PCT darf höchstens 100 sein')
  return result
}

function privateFd (file, flags) {
  const fd = openSync(file, flags | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600)
  try {
    const stat = fstatSync(fd)
    check(stat.isFile() && stat.nlink === 1 && stat.uid === process.getuid() && (stat.mode & 0o777) === 0o600,
      'Zustandsdatei muss eine eigene reguläre Datei ohne Hardlinks mit Rechten 0600 sein')
    return fd
  } catch (error) {
    closeSync(fd)
    throw error
  }
}

function audit () {
  writeFileSync(logFd, JSON.stringify({ ...record, time: new Date().toISOString() }, (_, value) => typeof value === 'bigint' ? value.toString() : value) + '\n')
  fsyncSync(logFd)
}

function argumentsForRun () {
  const [command, ...args] = process.argv.slice(2)
  check(['plan', 'swap', 'send'].includes(command), 'Befehl muss plan, swap oder send sein')
  record.command = command
  let confirm = false
  let to
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--confirm' && !confirm) confirm = true
    else if (args[i] === '--to' && to === undefined && args[i + 1]) to = args[++i]
    else throw new Stop('Aufruf: node real-swap-send.mjs <plan|swap|send> --to <Prüfsummenadresse> [--confirm]')
  }
  return { command, confirm, to }
}

async function recipient (to) {
  let address
  try { address = getAddress(to) } catch { throw new Stop('--to muss eine gültige Prüfsummenadresse sein') }
  check(address === to, '--to muss exakt der ethers-Prüfsummenadresse entsprechen')
  check(address !== ZeroAddress && address !== WALLET && address !== USDC, 'Nulladresse, eigene Wallet und USDC-Vertrag sind keine erlaubten Empfänger')
  stage = 'Empfänger-Code lesen'
  const code = await provider.getCode(address)
  check(/^0x(?:[a-fA-F0-9]{2})*$/.test(code), 'Ungültige eth_getCode-Antwort')
  const type = code === '0x' ? 'EOA' : 'Contract'
  record.recipient = address
  record.recipientType = type
  console.log(`Empfänger: ${address}; eth_getCode: ${type}`)
  return address
}

async function balances (account) {
  const [eth, usdc] = await Promise.all([account.getBalance(), account.getTokenBalance(USDC)])
  return { eth, usdc }
}

async function quoteSwap (account, tokenInAmount, config) {
  const priceRoute = await veloraSdk.swap.getRate({
    srcToken: ETH, destToken: USDC, amount: tokenInAmount.toString(),
    side: 'SELL', srcDecimals: 18, destDecimals: 6
  })
  check(priceRoute.srcToken?.toLowerCase() === ETH.toLowerCase() &&
    priceRoute.destToken?.toLowerCase() === USDC.toLowerCase() &&
    BigInt(priceRoute.srcAmount) === tokenInAmount && priceRoute.side === 'SELL' &&
    priceRoute.version === '6.2', 'Velora-Quote entspricht nicht dem angefragten Swap')
  const tokenOutAmount = BigInt(priceRoute.destAmount)
  const minAmountOut = tokenOutAmount * (10000n - config.slippageBps) / 10000n
  check(tokenOutAmount > 0n && minAmountOut > 0n, 'Ungültiger Swap-Ausgabebetrag')
  const tx = await veloraSdk.swap.buildTx({
    srcToken: ETH, destToken: USDC, srcAmount: priceRoute.srcAmount,
    destAmount: minAmountOut.toString(), userAddress: WALLET, priceRoute,
    partner: 'wdk', srcDecimals: 18, destDecimals: 6
  }, { ignoreChecks: true })
  const augustus = await veloraSdk.swap.getAugustusSwapper()
  check(augustus.toLowerCase() === AUGUSTUS_ARBITRUM &&
    tx.to?.toLowerCase() === AUGUSTUS_ARBITRUM &&
    tx.to.toLowerCase() === priceRoute.contractAddress?.toLowerCase(), 'Unerwarteter Augustus-Router auf Arbitrum')
  check(tx.value !== undefined && BigInt(tx.value) === tokenInAmount, 'Swap-Transaktionswert entspricht nicht dem ETH-Tauschbetrag')
  check(tx.chainId === undefined || BigInt(tx.chainId) === 42161n, 'Swap-Transaktion ist nicht für Arbitrum One')
  check(typeof tx.data === 'string' && /^0x(?:[a-fA-F0-9]{2})+$/.test(tx.data), 'Ungültige Swap-Transaktionsdaten')
  const transaction = { to: tx.to, value: tokenInAmount, data: tx.data }
  const { fee } = await account.quoteSendTransaction(transaction)
  check(fee >= 0n && fee < config.swapMaxFee, 'Swap-Gebühr erreicht SWAP_MAX_FEE_WEI oder ist ungültig')
  record.amounts.minUsdcOut = minAmountOut
  return { tokenOutAmount, fee, transaction }
}

async function plan (account, to, config) {
  const recipientAddress = await recipient(to)
  stage = 'Guthaben lesen'
  const before = await balances(account)
  record.amounts.before = before
  const tokenInAmount = before.eth - config.reserve
  check(tokenInAmount > 0n, 'ETH-Guthaben reicht nicht für die Reserve')
  record.amounts.ethIn = tokenInAmount
  record.amounts.reserveWei = config.reserve
  stage = 'Velora-Swap quotieren'
  const quote = await quoteSwap(account, tokenInAmount, config)
  record.amounts.expectedUsdc = quote.tokenOutAmount
  record.fees.swapQuoteWei = quote.fee
  stage = 'Chainlink ETH/USD lesen'
  const oracle = new Contract(ORACLE, [
    'function decimals() view returns (uint8)',
    'function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)'
  ], provider)
  const [decimals, round] = await Promise.all([oracle.decimals(), oracle.latestRoundData()])
  const now = BigInt(Math.floor(Date.now() / 1000))
  check(decimals >= 0n && decimals <= 36n && round.answer > 0n && round.roundId > 0n &&
    round.updatedAt > 0n && round.updatedAt <= now && round.answeredInRound >= round.roundId, 'Ungültige Chainlink-Orakeldaten')
  const stale = now - round.updatedAt > 3600n
  if (stale) console.warn('Warnung: Chainlink ETH/USD ist älter als eine Stunde')
  // Compare rational values without floating-point rounding; USDC is assumed to equal USD.
  const quoted = quote.tokenOutAmount * 10n ** 18n * 10n ** decimals
  const reference = tokenInAmount * 10n ** 6n * round.answer
  const difference = quoted >= reference ? quoted - reference : reference - quoted
  const deviationScaled = difference * 100000000n / reference
  record.oracle = { answer: round.answer, decimals, updatedAt: round.updatedAt, stale, deviationPct: units(deviationScaled, 6) }
  console.log(`Guthaben: ${units(before.eth, 18)} ETH; ${units(before.usdc, 6)} USDC`)
  console.log(`Swap: ${units(tokenInAmount, 18)} ETH → erwartet ${units(quote.tokenOutAmount, 6)} USDC`)
  console.log(`Reserve: ${units(config.reserve, 18)} ETH; Swap-Gebühr: ${units(quote.fee, 18)} ETH`)
  console.log(`Impliziter Kurs: ${units(quote.tokenOutAmount * 10n ** 18n / tokenInAmount, 6)} USDC/ETH; Chainlink: ${units(round.answer, Number(decimals))} USD/ETH`)
  console.log(`Abweichung (Annahme 1 USDC = 1 USD): ${units(deviationScaled, 6)} %`)
  stage = 'Transfer quotieren'
  let transferQuote
  try {
    transferQuote = await account.quoteTransfer({ token: USDC, recipient: recipientAddress, amount: quote.tokenOutAmount })
  } catch (error) {
    // Only substitute for an explicit balance revert with an actually short balance.
    const reason = error.reason ?? error.info?.error?.message ?? ''
    if (before.usdc >= quote.tokenOutAmount || error.code !== 'CALL_EXCEPTION' ||
        !/transfer amount exceeds balance|insufficient (?:token )?balance|ERC20InsufficientBalance/i.test(reason)) throw error
    const feeData = await provider.getFeeData()
    const feeRate = feeData.maxFeePerGas ?? feeData.gasPrice
    check(typeof feeRate === 'bigint' && feeRate > 0n, 'Keine gültige Gasrate für die Transfer-Ersatzschätzung')
    transferQuote = { fee: 65000n * feeRate }
    record.fees.transferEstimate = { source: 'insufficient_usdc_balance', gas: 65000n, feeRate }
    console.warn('Transfer-Ersatzschätzung wegen fehlendem USDC-Guthaben: 65 000 Gas × aktuelle Provider-Gasrate')
  }
  check(transferQuote.fee >= 0n, 'Ungültige Transfer-Gebühr')
  record.fees.transferQuoteWei = transferQuote.fee
  console.log(`Transfer-Gebühr: ${units(transferQuote.fee, 18)} ETH`)
  check(config.reserve >= 3n * (quote.fee + transferQuote.fee), 'Reserve ist kleiner als 3 × (Swap-Gebühr + Transfer-Gebühr)')
  return { transaction: quote.transaction, transferFee: transferQuote.fee, deviationExceeded: difference * 100000000n > config.maxDeviation * reference }
}

async function receiptFor (result) {
  check(/^0x[0-9a-fA-F]{64}$/.test(result.hash), 'SDK lieferte keinen gültigen Transaktionshash; vor erneutem Senden Wallet prüfen')
  record.hashes.push(result.hash)
  record.fees.submissionQuoteWei = result.fee
  record.status = 'submitted'
  audit()
  console.log(`Hash: ${result.hash}\nArbiscan: https://arbiscan.io/tx/${result.hash}`)
  stage = 'Quittung abwarten; bei Timeout vor erneutem Senden den Hash prüfen'
  const receipt = await provider.waitForTransaction(result.hash, 1, 180000)
  check(receipt !== null, 'Keine Quittung innerhalb von 180 Sekunden; vor erneutem Senden den Hash prüfen')
  record.receiptStatus = receipt.status
  record.fees.actualWei = receipt.fee
  check(receipt.status === 1, 'Transaktion fehlgeschlagen (receipt.status !== 1)')
  console.log(`Tatsächliche Gebühr: ${units(receipt.fee, 18)} ETH`)
  return receipt
}

async function main () {
  const dir = lstatSync(stateDir)
  check(dir.isDirectory() && !dir.isSymbolicLink() && dir.uid === process.getuid() && (dir.mode & 0o077) === 0,
    '~/.wdk-dfx-real muss ein eigenes privates Verzeichnis ohne Symlink sein')
  logFd = privateFd(join(stateDir, 'swap-send.jsonl'), constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT)
  const { command, confirm, to } = argumentsForRun()
  audit()
  if (command !== 'plan' && !confirm) {
    console.log('Nichts gesendet. Zum Ausführen --confirm und --to <Prüfsummenadresse> angeben.')
    record.status = 'confirmation_required'
    return
  }
  const config = {
    reserve: integerEnv('RESERVE_WEI', '300000000000000'),
    swapMaxFee: integerEnv('SWAP_MAX_FEE_WEI', '100000000000000'),
    transferMaxFee: integerEnv('TRANSFER_MAX_FEE_WEI', '50000000000000'),
    slippageBps: integerEnv('SLIPPAGE_BPS', '100', 0n, 9999n),
    maxDeviation: deviationLimit()
  }
  record.config = config
  stage = 'Seed-Datei prüfen und Konto ableiten'
  const seedFd = privateFd(join(stateDir, 'seed.txt'), constants.O_RDONLY)
  let seed
  try { seed = readFileSync(seedFd, 'utf8').trim() } finally { closeSync(seedFd) }
  check(/^[a-z]+(?: [a-z]+)*$/.test(seed), 'Ungültiges Seed-Dateiformat')
  provider = new JsonRpcProvider(RPC, undefined, { cacheTimeout: -1 })
  try {
    manager = new WalletManagerEvm(seed, {
      provider,
      transferMaxFee: config.transferMaxFee,
      transactionMaxFee: command === 'send' ? config.transferMaxFee : config.swapMaxFee - 1n
    })
  } finally { seed = undefined }
  const account = await manager.getAccount(0)
  check(await account.getAddress() === WALLET, 'Abgeleitete Adresse stimmt nicht exakt mit der erwarteten Test-Wallet überein')
  record.wallet = WALLET
  stage = 'Arbitrum-Netz prüfen'
  check((await provider.getNetwork()).chainId === 42161n, 'RPC ist nicht Arbitrum One (42161)')
  const token = new Contract(USDC, ['function balanceOf(address) view returns (uint256)'], provider)
  if (command === 'send') {
    const address = await recipient(to)
    stage = 'Transfer-Guthaben und Empfängerbestand lesen'
    const before = await balances(account)
    record.amounts.before = before
    const amount = before.usdc
    check(amount > 0n, 'Kein USDC-Guthaben zum Versenden')
    const recipientBefore = await token.balanceOf(address)
    record.amounts.sentUsdc = amount
    record.amounts.recipientBefore = recipientBefore
    const options = { token: USDC, recipient: address, amount }
    stage = 'USDC-Transfer quotieren'
    const quote = await account.quoteTransfer(options)
    record.fees.transferQuoteWei = quote.fee
    check(quote.fee >= 0n && quote.fee <= config.transferMaxFee, 'Transfer-Gebühr überschreitet TRANSFER_MAX_FEE_WEI oder ist ungültig')
    check(before.eth >= quote.fee, 'ETH-Guthaben reicht nicht für den Transfer')
    console.log(`Transfer: ${units(amount, 6)} USDC; Gebühr geschätzt: ${units(quote.fee, 18)} ETH`)
    stage = 'USDC-Transfer senden; bei RPC-Fehler vor Wiederholung Wallet prüfen'
    // beta.19: transfer(options) reads transferMaxFee from the manager/account config.
    await receiptFor(await account.transfer(options))
    stage = 'Transfer-Guthaben verifizieren'
    const after = await balances(account)
    const recipientAfter = await token.balanceOf(address)
    record.amounts.after = after
    record.amounts.recipientAfter = recipientAfter
    console.log(`Neue Guthaben: ${units(after.eth, 18)} ETH; ${units(after.usdc, 6)} USDC`)
    check(after.usdc === 0n, 'Wallet-USDC-Guthaben ist nach dem Transfer nicht null')
    check(recipientAfter - recipientBefore >= amount, 'USDC-Empfängerbestand ist nicht mindestens um den Transferbetrag gestiegen')
  } else {
    veloraSdk = constructSimpleSDK({ fetch, chainId: 42161, version: '6.2' })
    const prepared = await plan(account, to, config)
    if (command === 'plan') { record.status = 'planned'; return }
    check(!prepared.deviationExceeded, 'Orakel-Abweichung überschreitet MAX_DEVIATION_PCT')
    stage = 'Swap-Gebühr vor dem Senden prüfen'
    const { fee } = await account.quoteSendTransaction(prepared.transaction)
    check(fee >= 0n && fee < config.swapMaxFee, 'Swap-Gebühr erreicht SWAP_MAX_FEE_WEI oder ist ungültig')
    record.fees.swapQuoteWei = fee
    check(config.reserve >= 3n * (fee + prepared.transferFee), 'Reserve ist kleiner als 3 × (Swap-Gebühr + Transfer-Gebühr)')
    stage = 'ETH → USDC senden; bei RPC-Fehler vor Wiederholung Wallet prüfen'
    await receiptFor(await account.sendTransaction(prepared.transaction))
    stage = 'Neue Swap-Guthaben lesen'
    const after = await balances(account)
    record.amounts.after = after
    console.log(`Neue Guthaben: ${units(after.eth, 18)} ETH; ${units(after.usdc, 6)} USDC`)
  }
  record.status = 'confirmed'
}

try {
  await main()
} catch (error) {
  // Never print arbitrary SDK/RPC errors: they can contain signer inputs or raw transactions.
  const message = error instanceof Stop ? error.message : `Fehler bei: ${stage}. Externe Fehlerdetails werden aus Geheimnisschutz nicht ausgegeben.`
  record.status = record.hashes.length ? 'transaction_requires_inspection' : 'error'
  record.error = message
  console.error(message)
  process.exitCode = 1
} finally {
  try {
    manager?.dispose()
    provider?.destroy()
  } catch {
    record.cleanupError = true
    process.exitCode = 1
    console.error('Wallet/Provider konnten nicht vollständig geschlossen werden')
  }
  if (logFd !== undefined) {
    try { audit() } catch {
      console.error('Ergebnisprotokoll konnte nicht geschrieben werden; ausgegebene Transaktionshashes sichern')
      process.exitCode = 1
    } finally { closeSync(logFd) }
  } else {
    console.error('Ergebnisprotokoll nicht verfügbar; keine Transaktion ausgelöst')
    process.exitCode = 1
  }
}
