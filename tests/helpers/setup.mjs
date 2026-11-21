// Test bootstrap, loaded with `node --import` before any test file.
//
// The server code is written for Nitro: it imports through the `~/` alias,
// leaves `.ts` off relative imports, and leans on Nitro's auto-imports (h3's
// helpers plus everything exported from server/utils/*.ts). This file gives
// plain Node the same three things, so the route handlers run unmodified:
// no bundler and no extra dependency (h3 is the copy Nuxt already installs).
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

const [major, minor] = process.versions.node.split('.').map(Number)
if (major < 22 || (major === 22 && minor < 18)) {
  throw new Error(`The tests need Node 22.18 or newer (type stripping, node:sqlite); this is ${process.versions.node}.`)
}

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

function withTsExtension(file) {
  if (existsSync(file) && path.extname(file)) return file
  if (existsSync(`${file}.ts`)) return `${file}.ts`
  return null
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('~/')) {
      const file = withTsExtension(path.join(ROOT, specifier.slice(2)))
      if (file) return nextResolve(pathToFileURL(file).href, context)
    } else if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) {
      const parent = fileURLToPath(context.parentURL)
      if (parent.startsWith(ROOT) && !parent.includes(`${path.sep}node_modules${path.sep}`)) {
        const file = withTsExtension(path.resolve(path.dirname(parent), specifier))
        if (file) return nextResolve(pathToFileURL(file).href, context)
      }
    }
    return nextResolve(specifier, context)
  },
})

// Nitro auto-imports: h3's helpers...
const h3 = await import('h3')
for (const [name, value] of Object.entries(h3)) {
  if (!(name in globalThis)) globalThis[name] = value
}

// ...the runtime config (NUXT_ALLOWED_USER_EMAILS in production; tests set
// `testRuntimeConfig.allowedUserEmails`)...
export const testRuntimeConfig = { allowedUserEmails: '' }
globalThis.__tasteTestRuntimeConfig = testRuntimeConfig
globalThis.useRuntimeConfig = () => globalThis.__tasteTestRuntimeConfig

// ...and every export of server/utils/*.ts.
for (const file of ['cloudflare', 'readerSession', 'cors', 'tasteDb', 'embedding', 'refine']) {
  const mod = await import(pathToFileURL(path.join(ROOT, 'server', 'utils', `${file}.ts`)).href)
  for (const [name, value] of Object.entries(mod)) globalThis[name] = value
}
