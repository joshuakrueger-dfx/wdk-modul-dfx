// Opens module-generated widget URLs in headless Chromium and records what a user would see.
import { mkdirSync, readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const ENV = process.env.DFX_ENV === 'production' ? 'production' : 'sandbox'
const OUT = new URL('./out/', import.meta.url)
mkdirSync(OUT, { recursive: true })
const source = process.env.URLS ?? fileURLToPath(new URL(`e2e-urls-${ENV}.json`, OUT))
const urls = JSON.parse(readFileSync(source, 'utf8'))
const sessions = Object.values(urls).map(url => new URL(url).searchParams.get('session')).filter(Boolean)
const masked = value => sessions.reduce((text, session) => text.split(session).join('[REDACTED]'), String(value)).replace(/([?&]session=)[^&\s"<>]+/g, '$1[REDACTED]')
  .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[REDACTED-JWT]')
const pick = (process.env.PICK ?? 'ethereum-buy,ethereum-sell,tron-buy,base-sell').split(',')
const browser = await chromium.launch()
for (const key of pick) {
  const url = urls[key]
  if (!url) { console.log(key, 'no url'); continue }
  if (new URL(url).origin === 'https://app.dfx.swiss' && ENV !== 'production') throw new Error('Production widget URLs require DFX_ENV=production')
  const page = await browser.newPage({ viewport: { width: 430, height: 932 } })
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 }).catch(e => console.log(key, 'goto', masked(e.message)))
  await page.waitForTimeout(6000)
  const text = (await page.innerText('body').catch(() => '')).replace(/\s+/g, ' ')
  const inputs = await page.$$eval('input', els => els.map(e => e.value).filter(Boolean)).catch(() => [])
  await page.screenshot({ path: fileURLToPath(new URL(`widget-${basename(source)}-${key.replace(/[^a-zA-Z0-9_-]/g, '_')}.png`, OUT)), fullPage: true })
  console.log(masked(`=== ${key}\n  final url: ${page.url().replace(/session=[^&]+/, 'session=…')}\n  inputs: ${JSON.stringify(inputs)}\n  text: ${text.slice(0, 700)}`))
  await page.close()
}
await browser.close()
