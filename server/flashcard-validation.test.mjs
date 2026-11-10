import { test } from 'node:test'
import assert from 'node:assert/strict'
import { copyFile, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

test('create-skill validator accepts evidence and rejects fabricated quotes, bad PDF pages and duplicate IDs', async (t) => {
  const repository = fileURLToPath(new URL('../', import.meta.url))
  const root = await mkdtemp(path.join(tmpdir(), 'recall-create-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const script = path.join(root, '.agents/skills/create/scripts/validate.mjs')
  const classRoot = path.join(root, 'Classes/New class')
  const cardsFile = path.join(classRoot, 'sample.cards.json')
  await mkdir(path.dirname(script), { recursive: true })
  await mkdir(path.join(root, 'server'))
  await mkdir(path.join(classRoot, 'Sources'), { recursive: true })
  await symlink(path.join(repository, 'node_modules'), path.join(root, 'node_modules'))
  await copyFile(path.join(repository, '.agents/skills/create/scripts/validate.mjs'), script)
  await copyFile(path.join(repository, 'server/content.mjs'), path.join(root, 'server/content.mjs'))
  await writeFile(path.join(classRoot, 'Sources/notes.txt'), 'Original evidence with\n whitespace.')
  const card = { id: 'sample', topic: 'Topic', question: 'Question?', answer: 'Answer.', source: { file: 'Sources/notes.txt', quote: 'Original evidence with whitespace.' } }
  const run = () => spawnSync(process.execPath, [script, cardsFile], { cwd: root, encoding: 'utf8' })
  await writeFile(cardsFile, JSON.stringify([card]))
  let result = run()
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /Verified 1 source quotes/)
  await writeFile(cardsFile, JSON.stringify([{ ...card, source: { ...card.source, quote: 'Fabricated evidence.' } }]))
  result = run()
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /quote not found/)
  await copyFile(path.join(repository, 'Classes/Innovationsmanagment/Sources/The Nature of Technology.pdf'), path.join(classRoot, 'Sources/sample.pdf'))
  await writeFile(cardsFile, JSON.stringify([{ ...card, source: { file: 'Sources/sample.pdf', page: 9999, quote: 'Evidence' } }]))
  result = run()
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /invalid physical PDF page 9999/)
  await writeFile(cardsFile, JSON.stringify([card]))
  await writeFile(path.join(classRoot, 'duplicate.cards.json'), JSON.stringify([card]))
  result = run()
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /Duplicate card ID/)
})
