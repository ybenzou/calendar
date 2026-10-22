import { spawnSync } from 'node:child_process'
import path from 'node:path'
const result = spawnSync(path.resolve('node_modules/electron/dist/electron.exe'), [path.resolve('node_modules/vitest/vitest.mjs'), 'run', '--pool=forks', '--maxWorkers=1', '--no-file-parallelism'], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit', windowsHide: true })
if (result.status !== 0) console.error('Test runner exit:', result.status, result.signal, result.error?.message || '')
process.exit(result.status ?? 1)
