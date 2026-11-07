import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import { createApp } from './app.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const dataRoot = path.resolve(process.env.DATA_DIR || path.join(root, 'data'))
await mkdir(dataRoot, { recursive: true, mode: 0o700 })
const { app, db } = createApp({
  classesRoot: path.join(root, 'Classes'),
  databasePath: path.join(dataRoot, 'recall.sqlite'),
})
const dev = process.argv.includes('--dev')
let vite
if (dev) {
  const { createServer } = await import('vite')
  vite = await createServer({
    server: { middlewareMode: true },
    appType: 'spa',
  })
  app.use(vite.middlewares)
} else {
  app.use((_req, res, next) => {
    res.set(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-src 'self'; object-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'",
    )
    next()
  })
  app.use(express.static(path.join(root, 'dist')))
  app.get('/{*path}', (_req, res) =>
    res.sendFile(path.join(root, 'dist/index.html')),
  )
}
const port = Number(process.env.PORT || 3000)
const server = app.listen(port, process.env.HOST || '0.0.0.0', () =>
  console.log(`Recall is ready at http://localhost:${port}`),
)
async function shutdown() {
  server.close()
  await vite?.close()
  db.close()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
