import express from 'express'
import { DatabaseSync } from 'node:sqlite'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import mammoth from 'mammoth'
import { loadCatalog, resolveSource } from './content.mjs'
import { nameSchema, reviewSchema } from './validation.mjs'

const hash = (token) => createHash('sha256').update(token).digest('hex')

export function createApp({ classesRoot, databasePath = ':memory:' }) {
  const app = express()
  app.disable('x-powered-by')
  app.use(express.json({ limit: '16kb' }))
  app.use((req, res, next) => {
    res.set({
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'SAMEORIGIN',
    })
    if (req.path.startsWith('/api/')) res.set('Cache-Control', 'no-store')
    next()
  })
  const db = new DatabaseSync(databasePath)
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS learners (
      id TEXT PRIMARY KEY, token_hash TEXT UNIQUE NOT NULL, name TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS progress (
      learner_id TEXT NOT NULL REFERENCES learners(id), class_id TEXT NOT NULL, card_id TEXT NOT NULL,
      streak INTEGER NOT NULL, seen INTEGER NOT NULL, due_at TEXT NOT NULL, last_reviewed_at TEXT NOT NULL,
      PRIMARY KEY (learner_id, class_id, card_id)
    );
    CREATE TABLE IF NOT EXISTS reviews (
      learner_id TEXT NOT NULL REFERENCES learners(id), event_id TEXT NOT NULL,
      class_id TEXT NOT NULL, card_id TEXT NOT NULL, rating TEXT NOT NULL,
      PRIMARY KEY (learner_id, event_id)
    );
  `)
  const progress = (id) =>
    db
      .prepare(
        `SELECT class_id AS classId, card_id AS cardId, streak, seen,
    due_at AS dueAt, last_reviewed_at AS lastReviewedAt FROM progress WHERE learner_id = ?`,
      )
      .all(id)

  function authenticate(req, res, next) {
    const token = req.headers.authorization?.match(
      /^Bearer ([A-Za-z0-9_-]{43})$/,
    )?.[1]
    const learner =
      token &&
      db
        .prepare(
          'SELECT id, name, created_at AS createdAt FROM learners WHERE token_hash = ?',
        )
        .get(hash(token))
    if (!learner)
      return res
        .status(401)
        .json({
          error:
            'This learning link is not valid. Open a saved link or create a new learner.',
        })
    req.learner = learner
    next()
  }

  app.get('/api/catalog', async (_req, res) =>
    res.json(await loadCatalog(classesRoot)),
  )
  // Limit anonymous profile creation without keeping an unbounded list of client addresses.
  const attempts = new Map()
  app.post('/api/learners', (req, res) => {
    const parsed = nameSchema.safeParse(req.body)
    if (!parsed.success)
      return res
        .status(400)
        .json({ error: 'Use a name between 1 and 60 characters.' })
    const now = Date.now()
    for (const [key, entry] of attempts)
      if (entry.until < now) attempts.delete(key)
    const attempt = attempts.get(req.ip) ?? { count: 0, until: now + 3600000 }
    if (attempt.count >= 60 || attempts.size > 10000)
      return res
        .status(429)
        .json({ error: 'Too many new learners. Please try again later.' })
    attempt.count++
    attempts.set(req.ip, attempt)
    const token = randomBytes(32).toString('base64url')
    const learner = {
      id: randomUUID(),
      name: parsed.data.name,
      createdAt: new Date().toISOString(),
    }
    db.prepare('INSERT INTO learners VALUES (?, ?, ?, ?)').run(
      learner.id,
      hash(token),
      learner.name,
      learner.createdAt,
    )
    res
      .status(201)
      .json({
        token,
        name: learner.name,
        createdAt: learner.createdAt,
        progress: [],
      })
  })
  app.get('/api/me', authenticate, (req, res) =>
    res.json({
      name: req.learner.name,
      createdAt: req.learner.createdAt,
      progress: progress(req.learner.id),
    }),
  )
  app.patch('/api/me', authenticate, (req, res) => {
    const parsed = nameSchema.safeParse(req.body)
    if (!parsed.success)
      return res
        .status(400)
        .json({ error: 'Use a name between 1 and 60 characters.' })
    db.prepare('UPDATE learners SET name = ? WHERE id = ?').run(
      parsed.data.name,
      req.learner.id,
    )
    res.json({ name: parsed.data.name })
  })
  app.post('/api/reviews', authenticate, async (req, res) => {
    const parsed = reviewSchema.safeParse(req.body)
    if (!parsed.success)
      return res.status(400).json({ error: 'Invalid review.' })
    const { eventId, classId, cardId, rating } = parsed.data
    const catalog = await loadCatalog(classesRoot)
    if (
      !catalog
        .find((course) => course.id === classId)
        ?.cards.some((card) => card.id === cardId)
    )
      return res
        .status(404)
        .json({ error: 'This flashcard is no longer available.' })
    const learnerId = req.learner.id
    db.exec('BEGIN IMMEDIATE')
    try {
      const duplicate = db
        .prepare(
          'SELECT class_id, card_id, rating FROM reviews WHERE learner_id = ? AND event_id = ?',
        )
        .get(learnerId, eventId)
      if (
        duplicate &&
        (duplicate.class_id !== classId ||
          duplicate.card_id !== cardId ||
          duplicate.rating !== rating)
      ) {
        db.exec('ROLLBACK')
        return res
          .status(409)
          .json({
            error: 'This review ID was already used for another answer.',
          })
      }
      if (!duplicate) {
        const previous = db
          .prepare(
            'SELECT streak, seen FROM progress WHERE learner_id = ? AND class_id = ? AND card_id = ?',
          )
          .get(learnerId, classId, cardId)
        const streak = rating === 'known' ? (previous?.streak ?? 0) + 1 : 0
        const interval =
          rating === 'again'
            ? 600000
            : [1, 3, 7, 14, 30][Math.min(streak - 1, 4)] * 86400000
        const reviewedAt = new Date().toISOString()
        db.prepare(
          `INSERT INTO progress VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(learner_id, class_id, card_id) DO UPDATE SET
          streak = excluded.streak, seen = excluded.seen, due_at = excluded.due_at, last_reviewed_at = excluded.last_reviewed_at`,
        ).run(
          learnerId,
          classId,
          cardId,
          streak,
          (previous?.seen ?? 0) + 1,
          new Date(Date.now() + interval).toISOString(),
          reviewedAt,
        )
        db.prepare('INSERT INTO reviews VALUES (?, ?, ?, ?, ?)').run(
          learnerId,
          eventId,
          classId,
          cardId,
          rating,
        )
      }
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
    res.json({ progress: progress(learnerId) })
  })
  app.get('/api/source/:classId', async (req, res) => {
    if (typeof req.query.file !== 'string')
      return res.status(400).json({ error: 'A source file is required.' })
    const file = await resolveSource(
      classesRoot,
      req.params.classId,
      req.query.file,
    )
    if (!file) return res.status(404).json({ error: 'Source not found.' })
    if (req.query.preview === '1') {
      const extension = path.extname(file).toLowerCase()
      if (extension === '.docx')
        return res.json({
          text: (await mammoth.extractRawText({ path: file })).value,
        })
      if (extension === '.txt' || extension === '.md')
        return res.json({ text: await readFile(file, 'utf8') })
      return res
        .status(400)
        .json({ error: 'Use the original file for this source.' })
    }
    res.set(
      'Content-Disposition',
      `inline; filename*=UTF-8''${encodeURIComponent(path.basename(file))}`,
    )
    res.sendFile(file)
  })
  app.use('/api', (_req, res) =>
    res.status(404).json({ error: 'API route not found.' }),
  )
  app.use((error, _req, res, _next) => {
    if (error.type === 'entity.parse.failed')
      return res.status(400).json({ error: 'Invalid JSON.' })
    if (error.type === 'entity.too.large')
      return res.status(413).json({ error: 'Request is too large.' })
    console.error(error)
    res
      .status(500)
      .json({
        error:
          'Something went wrong. Your last answer may not have been saved. Please retry.',
      })
  })
  return { app, db }
}
