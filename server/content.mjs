import { readdir, readFile, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'

const sourceSchema = z.object({
  file: z.string().min(1),
  page: z.number().int().positive().optional(),
  quote: z.string().min(1),
})
const cardsSchema = z.array(
  z.object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    topic: z.string().min(1),
    question: z.string().min(1),
    answer: z.string().min(1),
    source: sourceSchema,
  }),
)
const metadataSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
})
const supportedSources = new Set([
  '.pdf',
  '.txt',
  '.docx',
  '.mp4',
  '.webm',
  '.md',
])

async function walk(directory, prefix = '') {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = await Promise.all(
    entries
      .filter((entry) => !entry.name.startsWith('.'))
      .map(async (entry) => {
        const relative = path.posix.join(prefix, entry.name)
        if (entry.isDirectory())
          return walk(path.join(directory, entry.name), relative)
        return entry.isFile() ? [relative] : []
      }),
  )
  return files.flat().sort()
}

export async function loadCatalog(classesRoot) {
  const folders = await readdir(classesRoot, { withFileTypes: true })
  return Promise.all(
    folders
      .filter((folder) => folder.isDirectory() && !folder.name.startsWith('.'))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(async (folder) => {
        const directory = path.join(classesRoot, folder.name)
        const files = await walk(directory)
        const errors = []
        let metadata = {
          title: folder.name.replace(/[-_]/g, ' '),
          description: '',
        }
        if (files.includes('class.json')) {
          try {
            metadata = metadataSchema.parse(
              JSON.parse(
                await readFile(path.join(directory, 'class.json'), 'utf8'),
              ),
            )
          } catch {
            errors.push(
              'class.json is invalid. The folder name is being used instead.',
            )
          }
        }
        const sources = await Promise.all(
          files
            .filter((file) =>
              supportedSources.has(path.extname(file).toLowerCase()),
            )
            .map(async (file) => ({
              file,
              name: path.basename(file),
              type: path.extname(file).slice(1).toLowerCase(),
              size: (await stat(path.join(directory, file))).size,
            })),
        )
        const cards = []
        const ids = new Set()
        for (const file of files.filter(
          (file) => file === 'flashcards.json' || file.endsWith('.cards.json'),
        )) {
          try {
            const parsed = cardsSchema.parse(
              JSON.parse(await readFile(path.join(directory, file), 'utf8')),
            )
            const newIds = new Set()
            for (const card of parsed) {
              if (ids.has(card.id) || newIds.has(card.id))
                throw new Error(`Duplicate card ID: ${card.id}`)
              if (!sources.some((source) => source.file === card.source.file))
                throw new Error(`Missing source: ${card.source.file}`)
              if (
                card.source.page &&
                !card.source.file.toLowerCase().endsWith('.pdf')
              )
                throw new Error('Page references require a PDF source')
              newIds.add(card.id)
            }
            parsed.forEach((card) => {
              ids.add(card.id)
              cards.push(card)
            })
          } catch (error) {
            errors.push(
              `${file}: ${error instanceof z.ZodError ? 'Invalid flashcard format' : error.message}`,
            )
          }
        }
        return { id: folder.name, ...metadata, cards, sources, errors }
      }),
  )
}

export async function resolveSource(classesRoot, classId, file) {
  const catalog = await loadCatalog(classesRoot)
  if (
    !catalog
      .find((course) => course.id === classId)
      ?.sources.some((source) => source.file === file)
  )
    return null
  const root = await realpath(classesRoot)
  const candidate = await realpath(path.join(root, classId, file))
  return candidate.startsWith(root + path.sep) ? candidate : null
}
