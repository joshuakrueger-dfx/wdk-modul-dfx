// Read-only: list + quotes for chains without a WDK wallet package (Lightning, Arkade, Firo), via the module.
import DfxProtocol from '@dfx.swiss/wdk-protocol-fiat-dfx'

const j = v => JSON.stringify(v, (_, x) => typeof x === 'bigint' ? `${x}n` : x)
const err = e => `${e?.constructor?.name} ${e?.reason ?? ''} ${e?.message}`.replace(/\s+/g, ' ')
for (const environment of [process.env.DFX_ENV === 'production' ? 'production' : 'sandbox']) {
  const p = new DfxProtocol(undefined, { environment })
  const assets = await p.getSupportedCryptoAssets()
  for (const network of ['lightning', 'arkade', 'firo']) {
    const list = assets.filter(a => a.networkCode === network)
    console.log(`${environment} ${network} list: ${j(list)}`)
    for (const a of list) {
      for (const [m, opts] of [
        ['quoteBuy', { fiatAmount: 10000n }],
        ['quoteSell', { cryptoAmount: 10n ** BigInt(a.decimals) / 100n }]
      ]) {
        try {
          console.log(`  ${m} ${a.code}/${network}: ${j(await p[m]({ cryptoAsset: a.code, fiatCurrency: 'EUR', config: { network }, ...opts }))}`)
        } catch (e) { console.log(`  ${m} ${a.code}/${network}: ERR ${err(e)}`) }
      }
    }
  }
}
