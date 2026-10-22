import { build } from 'esbuild'
await build({ entryPoints: ['src/cli/index.ts'], outfile: 'out/cli/index.cjs', bundle: true, platform: 'node', target: 'node20', format: 'cjs' })
await build({ entryPoints: ['src/shared/client.ts'], outfile: 'out/sdk/index.cjs', bundle: true, platform: 'node', target: 'node20', format: 'cjs' })
