import { mkdir, open, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import mammoth from 'mammoth'
import { loadCatalog, resolveSource } from '../server/content.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const classesRoot = path.join(root, 'Classes')
const catalog = await loadCatalog(classesRoot)
const previews = {}
const upload = process.argv.includes('--upload')
const config = JSON.parse(await readFile(path.join(root, 'wrangler.json'), 'utf8'))

for (const course of catalog) {
  for (const source of course.sources) {
    const file = await resolveSource(classesRoot, course.id, source.file)
    if (!file) throw new Error(`Source not found: ${course.id}/${source.file}`)
    const handle = await open(file)
    try {
      const { buffer } = await handle.read(Buffer.alloc(128), 0, 128, 0)
      if (buffer.toString().startsWith('version https://git-lfs.github.com/spec/v1'))
        throw new Error(`Missing LFS content: ${file}. Run git lfs pull before building.`)
    } finally {
      await handle.close()
    }
    const key = `${course.id}/${source.file}`
    if (source.type === 'docx')
      previews[key] = (await mammoth.extractRawText({ path: file })).value
    else if (['txt', 'md'].includes(source.type))
      previews[key] = await readFile(file, 'utf8')
    if (upload) {
      const result = spawnSync(process.execPath, [
        path.join(root, 'node_modules/wrangler/bin/wrangler.js'),
        'r2', 'object', 'put', `${config.r2_buckets[0].bucket_name}/${key}`,
        '--file', file, '--remote',
      ], { cwd: root, stdio: 'inherit' })
      if (result.error) throw result.error
      if (result.status !== 0) process.exit(result.status || 1)
    }
  }
}
await mkdir(path.join(root, '.cloudflare'), { recursive: true })
await writeFile(path.join(root, '.cloudflare/content.json'), JSON.stringify({ catalog, previews }))
console.log(`Prepared ${catalog.length} classes for Cloudflare${upload ? ' and uploaded their sources' : ''}.`)
