import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import { createApp } from './app.mjs'
import { loadCatalog, resolveSource } from './content.mjs'
import { swipeProgress, swipeRating } from '../src/lib/swipe.mjs'

const classesRoot = fileURLToPath(new URL('../Classes', import.meta.url))
test('swipe progress follows a horizontal drag and ignores vertical scrolling', () => {
  assert.equal(swipeProgress(30, 0), 0.5)
  assert.equal(swipeProgress(-30, 0), 0.5)
  assert.equal(swipeProgress(200, 0), 1)
  assert.equal(swipeProgress(70, 100), 0)
})

test('swipes distinguish left, right, accidental taps and vertical scrolling', () => {
  assert.equal(swipeRating(90, 10), 'known')
  assert.equal(swipeRating(-90, 10), 'again')
  assert.equal(swipeRating(59, 0), null)
  assert.equal(swipeRating(0, 150), null)
  assert.equal(swipeRating(70, 100), null)
  assert.equal(swipeRating(60, 0), 'known')
})
test('all supplied cards have unique IDs, source files, questions, answers and evidence', async () => {
  const catalog = await loadCatalog(classesRoot)
  const course = catalog.find((course) => course.id === 'Innovationsmanagment')
  assert.ok(course)
  assert.deepEqual(course.errors, [])
  assert.equal(course.cards.length, 48)
  assert.equal(course.sources.length, 7)
  assert.equal(new Set(course.cards.map((card) => card.id)).size, 48)
  for (const card of course.cards) {
    assert.ok(card.answer && card.question && card.source.quote)
    assert.ok(await resolveSource(classesRoot, course.id, card.source.file))
  }
})

test('new folders are discovered immediately; bad card files are reported; symlinks and traversal are rejected', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'recall-content-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(path.join(root, 'A/Sources'), { recursive: true })
  await writeFile(path.join(root, 'A/Sources/notes.txt'), 'Original material')
  assert.equal((await loadCatalog(root)).length, 1)
  await mkdir(path.join(root, 'B'))
  assert.equal((await loadCatalog(root)).length, 2)
  await writeFile(path.join(root, 'A/flashcards.json'), '{broken')
  assert.equal((await loadCatalog(root))[0].errors.length, 1)
  await symlink('/etc/hosts', path.join(root, 'A/Sources/secret.txt'))
  assert.equal(await resolveSource(root, 'A', 'Sources/secret.txt'), null)
  assert.equal(await resolveSource(root, 'A', '../../etc/hosts'), null)
  assert.equal(await resolveSource(root, '..', 'notes.txt'), null)
  const card = {
    id: 'one',
    question: 'Question?',
    answer: 'Answer',
    topic: 'Topic',
    source: { file: 'Sources/notes.txt', quote: 'Original material' },
  }
  await writeFile(
    path.join(root, 'A/flashcards.json'),
    JSON.stringify([card, card]),
  )
  assert.equal((await loadCatalog(root))[0].cards.length, 0)
  assert.match((await loadCatalog(root))[0].errors[0], /Duplicate/)
})

test('learner links isolate progress, persist across connections, validate reviews and make retries idempotent', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'recall-api-'))
  const { app, db } = createApp({
    classesRoot,
    databasePath: path.join(root, 'progress.sqlite'),
  })
  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve))
    db.close()
    await rm(root, { recursive: true, force: true })
  })
  const base = `http://127.0.0.1:${server.address().port}`
  async function call(route, { token, body, method } = {}) {
    const response = await fetch(base + route, {
      method: method || (body ? 'POST' : 'GET'),
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    return { status: response.status, data: await response.json() }
  }
  const a = (await call('/api/learners', { body: { name: 'Alex' } })).data
  const b = (await call('/api/learners', { body: { name: 'Sam' } })).data
  assert.notEqual(a.token, b.token)
  assert.equal(a.token.length, 43)
  assert.equal((await call('/api/me')).status, 401)
  assert.equal((await call('/api/me', { token: 'x'.repeat(43) })).status, 401)
  assert.equal(
    (await call('/api/learners', { body: { name: ' ' } })).status,
    400,
  )
  const review = {
    eventId: randomBytes(16).toString('hex'),
    classId: 'Innovationsmanagment',
    cardId: 'innovation-definition',
    rating: 'known',
  }
  assert.equal(
    (
      await call('/api/reviews', {
        token: a.token,
        body: { ...review, rating: 'invalid' },
      })
    ).status,
    400,
  )
  assert.equal(
    (
      await call('/api/reviews', {
        token: a.token,
        body: { ...review, cardId: 'missing' },
      })
    ).status,
    404,
  )
  const first = await call('/api/reviews', { token: a.token, body: review })
  assert.equal(first.status, 200)
  assert.equal(first.data.progress[0].seen, 1)
  assert.equal(first.data.progress[0].streak, 1)
  assert.ok(Date.parse(first.data.progress[0].dueAt) > Date.now() + 86000000)
  assert.equal(
    (await call('/api/reviews', { token: a.token, body: review })).data
      .progress[0].seen,
    1,
  )
  assert.equal(
    (
      await call('/api/reviews', {
        token: a.token,
        body: { ...review, rating: 'again' },
      })
    ).status,
    409,
  )
  assert.equal(
    (await call('/api/me', { token: b.token })).data.progress.length,
    0,
  )
  assert.equal(
    (await call('/api/me', { token: a.token })).data.progress[0].seen,
    1,
  )
  await call('/api/reviews', {
    token: a.token,
    body: {
      ...review,
      eventId: randomBytes(16).toString('hex'),
      rating: 'again',
    },
  })
  const again = (await call('/api/me', { token: a.token })).data.progress[0]
  assert.equal(again.streak, 0)
  assert.equal(again.seen, 2)
  assert.ok(Date.parse(again.dueAt) < Date.now() + 601000)
  assert.equal(
    (
      await call('/api/me', {
        token: a.token,
        method: 'PATCH',
        body: { name: 'Updated' },
      })
    ).status,
    200,
  )
  assert.equal((await call('/api/me', { token: a.token })).data.name, 'Updated')
  assert.equal(
    (await call('/api/source/Innovationsmanagment?file=../../package.json'))
      .status,
    404,
  )
  const source = await fetch(
    base +
      '/api/source/Innovationsmanagment?file=Sources%2FFoliensatz_1.%20LE%20TIM.pdf',
    { headers: { Range: 'bytes=0-9' } },
  )
  assert.equal(source.status, 206)
  assert.equal((await source.arrayBuffer()).byteLength, 10)
  const preview = await call(
    '/api/source/Innovationsmanagment?file=Sources%2FTechnologie.docx&preview=1',
  )
  assert.match(preview.data.text, /Produktlebenszyklus/)
  const stored = db.prepare('SELECT token_hash FROM learners').all()
  assert.ok(
    stored.every(
      (row) => row.token_hash !== a.token && row.token_hash !== b.token,
    ),
  )
})
