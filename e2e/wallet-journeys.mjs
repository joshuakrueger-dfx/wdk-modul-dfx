// User-journey simulation through the wallet simulator: a wallet user buys/sells via DFX.
import { chromium } from 'playwright'
import { fork } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const PORT = process.env.WALLET_SIM_PORT ?? '4748'
const OUT = new URL('./out/', import.meta.url)
mkdirSync(OUT, { recursive: true })
let server
const stopOnExit = () => server?.kill('SIGKILL')
process.once('exit', stopOnExit)
process.once('SIGINT', () => process.exit(130))
process.once('SIGTERM', () => process.exit(143))
async function startServer () {
  const env = { ...process.env, PORT, WALLET_SIM_ENV: 'sandbox' }
  delete env.WALLET_SIM_SEED_FILE
  delete env.WALLET_SIM_ORDERS_FILE
  server = fork(new URL('./wallet-sim/server.mjs', import.meta.url), [], {
    env, stdio: ['ignore', 'ignore', 'ignore', 'ipc']
  })
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error('Wallet server startup timed out')), 30000)
    const exited = () => finish(new Error('Wallet server exited before readiness (check port 4748)'))
    const ready = message => { if (message === 'ready') finish() }
    function finish (error) {
      clearTimeout(timer)
      server.off('error', finish)
      server.off('exit', exited)
      server.off('message', ready)
      if (error) reject(error)
      else resolve()
    }
    server.once('error', finish)
    server.once('exit', exited)
    server.on('message', ready)
  })
}
async function stopServer () {
  const child = server
  if (!child) return
  if (child.exitCode === null && child.signalCode === null) {
    await new Promise(resolve => {
      const timer = setTimeout(() => child.kill('SIGKILL'), 5000)
      child.once('exit', () => { clearTimeout(timer); resolve() })
      child.kill('SIGTERM')
    })
  }
  server = undefined
}

const BASE = `http://localhost:${PORT}`
const JOURNEYS = [
  { name: 'eth-eoa-buy-usdt', smart: false, direction: 'buy', asset: /USDT.*ethereum/i, fiat: 'EUR', amount: '100' },
  { name: 'eth-4337-buy-usdt', smart: true, direction: 'buy', asset: /USDT.*ethereum/i, fiat: 'EUR', amount: '100' },
  { name: 'tron-buy-usdt', smart: false, direction: 'buy', asset: /USDT.*tron/i, fiat: 'CHF', amount: '100' },
  { name: 'solana-sell-usdt', smart: false, direction: 'sell', asset: /USDT.*solana/i, fiat: 'EUR', amount: '50' },
  { name: 'bitcoin-buy-btc', smart: false, direction: 'buy', asset: /BTC.*bitcoin/i, fiat: 'EUR', amount: '100' },
  { name: 'spark-sell-btc', smart: false, direction: 'sell', asset: /BTC.*spark/i, fiat: 'EUR', amount: '0.001', crypto: true },
  { name: 'eth-too-low', smart: false, direction: 'buy', asset: /USDT.*ethereum/i, fiat: 'EUR', amount: '1' }
]
const tid = id => `[data-testid="${id}"], #${id}`
const masked = s => String(s ?? '').replace(/([?&]session=)[^&\s"<>]+/g, '$1[REDACTED]').replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[REDACTED-JWT]')
const clean = s => masked(s).replace(/\s+/g, ' ').trim().slice(0, 300)

const browser = await chromium.launch()
try {
  for (const j of JOURNEYS.filter(j => !process.argv[2] || j.name === process.argv[2])) {
    try {
      await startServer()
      const page = await browser.newPage({ viewport: { width: 900, height: 1000 } })
      const timeout = setTimeout(() => { page.close().catch(() => {}) }, 200000)
      try {
        const errors = []
        page.on('pageerror', e => errors.push(String(e)))
        const shot = async step => page.screenshot({ path: fileURLToPath(new URL(`sim-${j.name}-${step}.png`, OUT)) })
        const out = { journey: j.name }
        try {
          await page.goto(BASE, { waitUntil: 'networkidle' })
          if (j.smart) await page.locator(tid('smart-account')).check().catch(() => page.locator(tid('smart-account')).click())
          await page.locator(tid('create-wallet')).click()
          await page.waitForTimeout(4000)
          out.home = clean(await page.locator('body').innerText())
          await shot('1-home')

          await page.locator(tid(j.direction === 'buy' ? 'btn-buy' : 'btn-sell')).click()
          await page.waitForTimeout(1500)
          const select = page.locator(tid('asset-select'))
          const options = await select.locator('option').allTextContents()
          const pick = options.find(o => j.asset.test(o))
          out.assetOptions = options.length
          if (!pick) throw new Error(`asset not offered: ${j.asset} in [${options.slice(0, 12).join(' | ')}]`)
          await select.selectOption({ label: pick })
          await page.locator(tid('fiat-select')).selectOption(j.fiat).catch(() => {})
          if (j.crypto) await page.locator(tid('amount-mode')).selectOption('crypto').catch(() => page.locator(tid('amount-mode')).click())
          await page.locator(tid('amount')).fill(j.amount)
          await page.waitForTimeout(3500)
          out.offer = clean(await page.locator(tid('offer')).innerText())
          await shot('2-offer')

          const cont = page.locator(tid('continue-dfx'))
          if (await cont.isDisabled().catch(() => true)) { out.continue = 'disabled'; throw new Error('continue disabled (expected for error cases)') }
          await cont.click()
          await page.waitForSelector(tid('browser-frame'), { timeout: 20000 })
          const frame = page.frameLocator(tid('browser-frame'))
          await page.waitForTimeout(9000)
          out.dfx = clean(await frame.locator('body').innerText().catch(e => 'frame read failed: ' + e.message))
          await shot('3-dfx')

          await page.locator(tid('browser-close')).click()
          await page.waitForTimeout(800)
          await page.locator(tid('orders')).click().catch(() => {})
          await page.waitForTimeout(800)
          await page.locator(tid('order-item')).first().click()
          await page.waitForTimeout(3000)
          out.status = clean(await page.locator(tid('order-status')).first().innerText().catch(() => ''))
          await shot('4-orders')
        } catch (e) {
          out.stop = masked(e.message).slice(0, 200)
          await shot('x-stop').catch(() => {})
        }
        out.pageErrors = errors.length
        console.log(JSON.stringify(out, null, 1))
      } finally {
        clearTimeout(timeout)
        await page.close()
      }
    } finally {
      await stopServer()
    }
  }
} finally {
  await stopServer()
  await browser.close()
}
