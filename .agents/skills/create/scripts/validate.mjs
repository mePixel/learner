import assert from 'node:assert/strict'
import { readFile, realpath } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import mammoth from 'mammoth'
import { loadCatalog, resolveSource } from '../../../../server/content.mjs'

const root = fileURLToPath(new URL('../../../../', import.meta.url))
const classesRoot = path.join(root, 'Classes')
const normalize = (text) => text.normalize('NFKC').replace(/\s+/gu, ' ').trim()
const catalog = await loadCatalog(classesRoot)
for (const course of catalog)
  assert.deepEqual(course.errors, [], `${course.id}: ${course.errors.join('; ')}`)
const sources = new Map()
let checked = 0

try {
  for (const argument of process.argv.slice(2)) {
    const file = await realpath(path.resolve(argument))
    const relative = path.relative(classesRoot, file)
    assert.ok(!relative.startsWith('..') && !path.isAbsolute(relative), 'Card files must be inside Classes/')
    assert.ok(path.basename(file) === 'flashcards.json' || file.endsWith('.cards.json'), 'Use flashcards.json or *.cards.json')
    const classId = relative.split(path.sep)[0]
    const course = catalog.find((item) => item.id === classId)
    assert.ok(course, `Class not discovered: ${classId}`)
    const cards = JSON.parse(await readFile(file, 'utf8'))
    assert.ok(Array.isArray(cards) && cards.length, `No cards in ${argument}`)
    for (const card of cards) {
      assert.ok(course.cards.some((item) => item.id === card.id), `Card not loaded: ${card.id}`)
      const sourcePath = await resolveSource(classesRoot, classId, card.source.file)
      assert.ok(sourcePath, `${card.id}: missing or unsafe source`)
      const extension = path.extname(sourcePath).toLowerCase()
      if (!sources.has(sourcePath)) {
        if (extension === '.pdf') {
          const task = getDocument({ data: new Uint8Array(await readFile(sourcePath)), useSystemFonts: true })
          const source = { task, pages: new Map() }
          sources.set(sourcePath, source)
          source.document = await task.promise
        } else {
          assert.ok(['.txt', '.md', '.docx'].includes(extension), `${card.id}: cite a readable document or transcript`)
          const text = extension === '.docx'
            ? (await mammoth.extractRawText({ path: sourcePath })).value
            : await readFile(sourcePath, 'utf8')
          sources.set(sourcePath, { text })
        }
      }
      const source = sources.get(sourcePath)
      let text = source.text
      if (source.document) {
        const page = card.source.page
        assert.ok(Number.isInteger(page) && page >= 1 && page <= source.document.numPages, `${card.id}: invalid physical PDF page ${page}`)
        if (!source.pages.has(page)) {
          const content = await (await source.document.getPage(page)).getTextContent()
          source.pages.set(page, content.items.map((item) => 'str' in item ? item.str + ' ' : '').join(''))
        }
        text = source.pages.get(page)
      }
      const quote = normalize(card.source.quote)
      assert.ok(quote && normalize(text).includes(quote), `${card.id}: quote not found in its cited source/page`)
      checked++
    }
  }
  console.log(`Catalog valid: ${catalog.length} classes, ${catalog.reduce((sum, course) => sum + course.cards.length, 0)} cards. Verified ${checked} source quotes.`)
} finally {
  for (const source of sources.values()) if (source.task) await source.task.destroy()
}
