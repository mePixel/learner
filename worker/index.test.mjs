import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { getPlatformProxy } from 'wrangler'
import worker from './index.mjs'
import content from '../.cloudflare/content.json' with { type: 'json' }

test('Worker preserves learner isolation, atomic review retries, validation and source streaming', async (t) => {
  const platform = await getPlatformProxy({ persist: false, remoteBindings: false })
  t.after(() => platform.dispose())
  const { env } = platform
  const schema = await readFile(new URL('../migrations/0001_learners.sql', import.meta.url), 'utf8')
  await env.DB.batch(schema.split(';').map((sql) => sql.trim()).filter(Boolean).map((sql) => env.DB.prepare(sql)))
  async function call(route, { token, body, method, raw, headers = {}, ip = '127.0.0.1' } = {}) {
    const response = await worker.fetch(new Request(`https://learner.test${route}`, {
      method: method || (body || raw ? 'POST' : 'GET'),
      headers: {
        'Content-Type': 'application/json', 'CF-Connecting-IP': ip,
        ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers,
      },
      ...(body || raw ? { body: raw || JSON.stringify(body) } : {}),
    }), env)
    const text = await response.text()
    return { status: response.status, headers: response.headers, data: text ? JSON.parse(text) : null }
  }
  const course = content.catalog.find((course) => course.id === 'Innovationsmanagment')
  assert.ok(course)
  const cardId = course.cards[0].id
  assert.deepEqual((await call('/api/catalog')).data, content.catalog)
  const a = (await call('/api/learners', { body: { name: 'Alex' } })).data
  const b = (await call('/api/learners', { body: { name: 'Sam' } })).data
  assert.match(a.token, /^[A-Za-z0-9_-]{43}$/)
  assert.notEqual(a.token, b.token)
  assert.equal((await call('/api/me')).status, 401)
  assert.equal((await call('/api/me', { token: 'x'.repeat(43) })).status, 401)
  assert.equal((await call('/api/learners', { body: { name: ' ' } })).status, 400)
  assert.equal((await call('/api/learners', { raw: '{broken' })).status, 400)
  assert.equal((await call('/api/learners', { body: { name: 'x'.repeat(17000) } })).status, 413)
  assert.equal((await call('/api/learners', { body: { name: 'X' }, headers: { 'Content-Type': 'text/plain' } })).status, 415)
  const review = { classId: course.id, cardId, eventId: crypto.randomUUID().replaceAll('-', ''), rating: 'known' }
  const send = (body) => call('/api/reviews', { token: a.token, body })
  assert.equal((await send({ ...review, rating: 'bad' })).status, 400)
  assert.equal((await send({ ...review, cardId: 'missing' })).status, 404)
  const retries = await Promise.all(Array.from({ length: 5 }, () => send(review)))
  for (const result of retries) {
    assert.equal(result.status, 200)
    assert.equal(result.data.progress[0].seen, 1)
    assert.equal(result.data.progress[0].streak, 1)
  }
  assert.equal((await send({ ...review, rating: 'again' })).status, 409)
  assert.equal((await send({ ...review, cardId: course.cards[1].id })).status, 409)
  assert.equal((await call('/api/me', { token: a.token })).data.progress.length, 1)
  assert.equal((await call('/api/me', { token: b.token })).data.progress.length, 0)
  for (const days of [3, 7, 14, 30, 30]) {
    const result = await send({ ...review, eventId: crypto.randomUUID().replaceAll('-', '') })
    assert.equal(result.status, 200)
    const interval = Date.parse(result.data.progress[0].dueAt) - Date.now()
    assert.ok(Math.abs(interval - days * 86400000) < 10000, `Expected ${days} days, got ${interval}ms`)
  }
  const again = await send({ ...review, eventId: crypto.randomUUID().replaceAll('-', ''), rating: 'again' })
  assert.equal(again.data.progress[0].streak, 0)
  assert.equal(again.data.progress[0].seen, 7)
  assert.ok(Math.abs(Date.parse(again.data.progress[0].dueAt) - Date.now() - 600000) < 10000)
  await call('/api/me', { token: a.token, method: 'PATCH', body: { name: ' Updated ' } })
  const restored = await call('/api/me', { token: a.token })
  assert.equal(restored.data.name, 'Updated')
  assert.equal(restored.data.progress[0].seen, 7)
  assert.equal(restored.headers.get('Cache-Control'), 'no-store')
  assert.equal((await call('/api/missing')).status, 404)
  assert.equal((await call(`/api/source/${course.id}?file=../../package.json`)).status, 404)
  const preview = await call(`/api/source/${course.id}?file=${encodeURIComponent('Sources/Technologie.docx')}&preview=1`)
  assert.match(preview.data.text, /Produktlebenszyklus/)
  const pdf = course.sources.find((source) => source.type === 'pdf')
  const pdfBytes = await readFile(new URL(`../Classes/${course.id}/${pdf.file}`, import.meta.url))
  await env.SOURCES.put(`${course.id}/${pdf.file}`, pdfBytes)
  const sourceURL = `https://learner.test/api/source/${course.id}?file=${encodeURIComponent(pdf.file)}`
  for (const [range, offset, length] of [['bytes=0-9', 0, 10], ['bytes=-10', pdfBytes.length - 10, 10], [`bytes=${pdfBytes.length - 5}-`, pdfBytes.length - 5, 5]]) {
    const response = await worker.fetch(new Request(sourceURL, { headers: { Range: range } }), env)
    assert.equal(response.status, 206)
    assert.equal(response.headers.get('Content-Range'), `bytes ${offset}-${offset + length - 1}/${pdfBytes.length}`)
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), pdfBytes.subarray(offset, offset + length))
  }
  for (const range of ['bytes=-0', `bytes=${pdfBytes.length}-`, 'bytes=20-10', 'bytes=bad']) {
    const response = await worker.fetch(new Request(sourceURL, { headers: { Range: range } }), env)
    assert.equal(response.status, 416)
  }
  const head = await worker.fetch(new Request(sourceURL, { method: 'HEAD' }), env)
  assert.equal(head.status, 200)
  assert.equal(head.headers.get('Content-Length'), String(pdfBytes.length))
  assert.equal(await head.text(), '')
  const video = course.sources.find((source) => source.type === 'mp4')
  const videoURL = `https://learner.test/api/source/${course.id}?file=${encodeURIComponent(video.file)}`
  assert.equal((await worker.fetch(new Request(videoURL), env)).status, 404)
  await env.SOURCES.put(`${course.id}/${video.file}`, new Uint8Array(32))
  const videoResponse = await worker.fetch(new Request(videoURL, { headers: { Range: 'bytes=0-9' } }), env)
  assert.equal(videoResponse.status, 206)
  assert.equal(videoResponse.headers.get('Content-Type'), 'video/mp4')
  assert.equal((await videoResponse.arrayBuffer()).byteLength, 10)
  const stored = await env.DB.prepare('SELECT token_hash FROM learners').all()
  assert.ok(stored.results.every((row) => row.token_hash !== a.token && row.token_hash !== b.token))
  for (let i = 0; i < 60; i++)
    assert.equal((await call('/api/learners', { body: { name: 'Limit test' }, ip: '192.0.2.1' })).status, 201)
  assert.equal((await call('/api/learners', { body: { name: 'Limit test' }, ip: '192.0.2.1' })).status, 429)
})
