import content from '../.cloudflare/content.json' with { type: 'json' }
import { nameSchema, reviewSchema } from '../server/validation.mjs'

const progressSQL = `SELECT class_id AS classId, card_id AS cardId, streak, seen,
  due_at AS dueAt, last_reviewed_at AS lastReviewedAt FROM progress WHERE learner_id = ?`
const json = (data, status = 200) => Response.json(data, { status })
const fail = (message, status) => { throw json({ error: message }, status) }
const invalidLink = 'This learning link is not valid. Open a saved link or create a new learner.'

async function hash(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function body(request, schema, message) {
  if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json'))
    fail('Use application/json.', 415)
  if (!request.body) fail(message, 400)
  const reader = request.body.getReader()
  const chunks = []
  let size = 0
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > 16384) {
      await reader.cancel()
      fail('Request is too large.', 413)
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  let value
  try { value = JSON.parse(new TextDecoder().decode(bytes)) }
  catch { fail('Invalid JSON.', 400) }
  const parsed = schema.safeParse(value)
  if (!parsed.success) fail(message, 400)
  return parsed.data
}

async function authenticate(request, db) {
  const token = request.headers.get('Authorization')?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1]
  if (!token) fail(invalidLink, 401)
  const learner = await db.prepare(
    'SELECT id, name, created_at AS createdAt FROM learners WHERE token_hash = ?',
  ).bind(await hash(token)).first()
  if (!learner) fail(invalidLink, 401)
  return learner
}

async function sourceResponse(request, env, url) {
  let classId
  try { classId = decodeURIComponent(url.pathname.slice('/api/source/'.length)) }
  catch { fail('Source not found.', 404) }
  const file = url.searchParams.get('file')
  if (!file) fail('A source file is required.', 400)
  const source = content.catalog.find((course) => course.id === classId)
    ?.sources.find((item) => item.file === file)
  if (!source) fail('Source not found.', 404)
  const key = `${classId}/${file}`
  if (url.searchParams.get('preview') === '1') {
    if (!Object.hasOwn(content.previews, key)) fail('Use the original file for this source.', 400)
    return json({ text: content.previews[key] })
  }
  let range
  const header = request.headers.get('Range')
  if (header) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(header)
    let start = match?.[1] ? Number(match[1]) : 0
    let end = match?.[2] ? Number(match[2]) : source.size - 1
    if (match && !match[1] && match[2]) {
      start = Math.max(0, source.size - Number(match[2]))
      end = source.size - 1
    }
    if (!match || (!match[1] && !match[2]) || !Number.isSafeInteger(start)
      || !Number.isSafeInteger(end) || start > end || start >= source.size) {
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${source.size}` } })
    }
    range = { offset: start, length: Math.min(end, source.size - 1) - start + 1 }
  }
  const object = request.method === 'HEAD'
    ? await env.SOURCES.head(key)
    : await env.SOURCES.get(key, range ? { range } : undefined)
  if (!object) fail('Source not uploaded. Upload course files to R2 and try again.', 404)
  const types = {
    pdf: 'application/pdf', txt: 'text/plain; charset=utf-8', md: 'text/plain; charset=utf-8',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    mp4: 'video/mp4', webm: 'video/webm',
  }
  const headers = new Headers({
    'Content-Type': types[source.type],
    'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(source.name)}`,
    'Accept-Ranges': 'bytes',
    'ETag': object.httpEtag,
    'Content-Length': String(range ? range.length : object.size),
  })
  if (range) headers.set('Content-Range', `bytes ${range.offset}-${range.offset + range.length - 1}/${object.size}`)
  return new Response(request.method === 'HEAD' ? null : object.body, { status: range ? 206 : 200, headers })
}

async function api(request, env, url) {
  const route = `${request.method} ${url.pathname}`
  if (route === 'GET /api/catalog') return json(content.catalog)
  if (['GET', 'HEAD'].includes(request.method) && url.pathname.startsWith('/api/source/'))
    return sourceResponse(request, env, url)
  if (!env.DB) fail('The workspace database is not configured.', 503)
  if (route === 'POST /api/learners') {
    const { name } = await body(request, nameSchema, 'Use a name between 1 and 60 characters.')
    const token = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
      .replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
    const id = crypto.randomUUID()
    const createdAt = new Date().toISOString()
    const hour = Math.floor(Date.now() / 3600000)
    const address = await hash(request.headers.get('CF-Connecting-IP') || 'local')
    const [, attempts] = await env.DB.batch([
      env.DB.prepare('DELETE FROM learner_attempts WHERE hour < ?').bind(hour - 1),
      env.DB.prepare(`INSERT INTO learner_attempts VALUES (?, ?, 1)
        ON CONFLICT(address_hash, hour) DO UPDATE SET count = MIN(count + 1, 61)
        RETURNING count`).bind(address, hour),
      env.DB.prepare(`INSERT INTO learners SELECT ?, ?, ?, ?
        WHERE (SELECT count FROM learner_attempts WHERE address_hash = ? AND hour = ?) <= 60`)
        .bind(id, await hash(token), name, createdAt, address, hour),
    ])
    if (attempts.results[0].count > 60) fail('Too many new learners. Please try again later.', 429)
    return json({ token, name, createdAt, progress: [] }, 201)
  }
  if (!['GET /api/me', 'PATCH /api/me', 'POST /api/reviews'].includes(route))
    fail('API route not found.', 404)
  const learner = await authenticate(request, env.DB)
  if (route === 'GET /api/me') {
    const { results } = await env.DB.prepare(progressSQL).bind(learner.id).all()
    return json({ name: learner.name, createdAt: learner.createdAt, progress: results })
  }
  if (route === 'PATCH /api/me') {
    const { name } = await body(request, nameSchema, 'Use a name between 1 and 60 characters.')
    await env.DB.prepare('UPDATE learners SET name = ? WHERE id = ?').bind(name, learner.id).run()
    return json({ name })
  }
  const { eventId, classId, cardId, rating } = await body(request, reviewSchema, 'Invalid review.')
  if (!content.catalog.find((course) => course.id === classId)?.cards.some((card) => card.id === cardId))
    fail('This flashcard is no longer available.', 404)
  const now = Date.now()
  // The batch checks the event and updates progress atomically, including concurrent retries.
  const [, , event, progress] = await env.DB.batch([
    env.DB.prepare(`INSERT INTO progress
      SELECT ?, ?, ?, ?, 1, ?, ? WHERE NOT EXISTS
      (SELECT 1 FROM reviews WHERE learner_id = ? AND event_id = ?)
      ON CONFLICT(learner_id, class_id, card_id) DO UPDATE SET
      streak = CASE WHEN ? = 'again' THEN 0 ELSE progress.streak + 1 END,
      seen = progress.seen + 1,
      due_at = strftime('%Y-%m-%dT%H:%M:%fZ', (? + CASE WHEN ? = 'again' THEN 600000
        ELSE CASE MIN(progress.streak, 4) WHEN 0 THEN 86400000 WHEN 1 THEN 259200000
        WHEN 2 THEN 604800000 WHEN 3 THEN 1209600000 ELSE 2592000000 END END) / 1000.0, 'unixepoch'),
      last_reviewed_at = excluded.last_reviewed_at`)
      .bind(learner.id, classId, cardId, rating === 'known' ? 1 : 0,
        new Date(now + (rating === 'again' ? 600000 : 86400000)).toISOString(),
        new Date(now).toISOString(), learner.id, eventId, rating, now, rating),
    env.DB.prepare('INSERT INTO reviews VALUES (?, ?, ?, ?, ?) ON CONFLICT(learner_id, event_id) DO NOTHING')
      .bind(learner.id, eventId, classId, cardId, rating),
    env.DB.prepare('SELECT class_id, card_id, rating FROM reviews WHERE learner_id = ? AND event_id = ?')
      .bind(learner.id, eventId),
    env.DB.prepare(progressSQL).bind(learner.id),
  ])
  const original = event.results[0]
  if (original.class_id !== classId || original.card_id !== cardId || original.rating !== rating)
    fail('This review ID was already used for another answer.', 409)
  return json({ progress: progress.results })
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request)
    let response
    try { response = await api(request, env, url) }
    catch (error) {
      if (error instanceof Response) response = error
      else {
        console.error(error)
        response = json({ error: 'Something went wrong. Your last answer may not have been saved. Please retry.' }, 500)
      }
    }
    const secured = new Response(response.body, response)
    secured.headers.set('Cache-Control', 'no-store')
    secured.headers.set('Referrer-Policy', 'no-referrer')
    secured.headers.set('X-Content-Type-Options', 'nosniff')
    secured.headers.set('X-Frame-Options', 'SAMEORIGIN')
    return secured
  },
}
