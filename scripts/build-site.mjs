// Assemble the static site for Vercel: legacy page at /, new SPA at /app/.
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'public')
const webDist = join(root, 'web', 'dist')

if (!existsSync(join(webDist, 'index.html'))) {
  console.error('web/dist/index.html not found. Run `npm --prefix web run build` first.')
  process.exit(1)
}

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
cpSync(join(root, 'index.html'), join(out, 'index.html'))
cpSync(join(root, 'icon.png'), join(out, 'icon.png'))
cpSync(webDist, join(out, 'app'), { recursive: true })
console.log('Assembled public/ (legacy at /, new app at /app/)')
