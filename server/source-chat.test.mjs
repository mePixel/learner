import { test } from 'node:test'
import assert from 'node:assert/strict'
import { APICallError } from 'ai'
import {
  validateConnection,
  readableSource,
  relevantExcerpts,
  streamAnswer,
  chatError,
  geminiSuggested,
} from '../src/lib/source-chat.ts'

const connection = {
  baseURL: 'https://provider.example/v1',
  model: 'any-model',
  apiKey: 'test-secret-never-store',
}
const appOrigin = 'https://recall.example'
test('provider validation rejects Recall, credential URLs and insecure remote endpoints', () => {
  for (const baseURL of [
    appOrigin + '/api',
    'https://learner.xaxa.at/api',
    '/api',
    'http://provider.example/v1',
    'javascript:alert(1)',
    'https://user:secret@provider.example/v1',
    'https://provider.example/v1?key=secret',
    'https://provider.example/v1#secret',
  ])
    assert.throws(() =>
      validateConnection({ ...connection, baseURL }, appOrigin),
    )
  assert.throws(() =>
    validateConnection({ ...connection, model: ' ' }, appOrigin),
  )
  assert.throws(() =>
    validateConnection({ ...connection, apiKey: '' }, appOrigin),
  )
  assert.equal(
    validateConnection(
      {
        baseURL: 'http://localhost:11434/v1/',
        model: ' local-model ',
        apiKey: '',
      },
      appOrigin,
    ).baseURL,
    'http://localhost:11434/v1',
  )
  assert.equal(
    validateConnection({ ...geminiSuggested, apiKey: 'user-key' }, appOrigin)
      .baseURL,
    'https://generativelanguage.googleapis.com/v1beta/openai',
  )
})

test('videos use their real transcripts; retrieval stays bounded and preserves PDF page evidence', () => {
  const sources = [
    { file: 'Sources/Lecture.mp4', type: 'mp4' },
    { file: 'Sources/Lecture.txt', type: 'txt' },
  ]
  assert.equal(readableSource({ sources }, sources[0]).file, sources[1].file)
  assert.equal(readableSource({ sources: [sources[0]] }, sources[0]), undefined)
  const documents = [
    {
      file: 'book.pdf',
      name: 'Book',
      pages: [
        { page: 1, text: 'unrelated '.repeat(8000) },
        {
          page: 9,
          text: 'A technology lifecycle progresses through emergence, growth and maturity.',
        },
      ],
    },
  ]
  const excerpts = relevantExcerpts(
    documents,
    'Explain the technology lifecycle',
  )
  assert.equal(excerpts[0].page, 9)
  assert.equal(excerpts[0].id, 'S1')
  assert.ok(excerpts.length <= 12)
  assert.ok(
    excerpts.reduce((sum, excerpt) => sum + excerpt.text.length, 0) <= 21600,
  )
  const broad = relevantExcerpts(
    Array.from({ length: 6 }, (_, index) => ({
      file: `source-${index}.txt`,
      name: `Source ${index}`,
      pages: [{ text: 'Long source material. '.repeat(5000) }],
    })),
    'Summarize the main ideas',
  )
  assert.equal(new Set(broad.map((excerpt) => excerpt.file)).size, 6)
})

test('Vercel AI SDK streams directly to a custom provider without cookies, redirects, retries or key-bearing URLs', async () => {
  const calls = []
  const chunks = [
    {
      id: 'reply',
      object: 'chat.completion.chunk',
      created: 0,
      model: 'any-model',
      choices: [
        {
          index: 0,
          delta: { role: 'assistant', content: 'From the source ' },
          finish_reason: null,
        },
      ],
    },
    {
      id: 'reply',
      object: 'chat.completion.chunk',
      created: 0,
      model: 'any-model',
      choices: [
        { index: 0, delta: { content: '[S1, p. 9].' }, finish_reason: 'stop' },
      ],
    },
  ]
  const fetch = async (url, init) => {
    calls.push({ url: String(url), init })
    return new Response(
      chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('') +
        'data: [DONE]\n\n',
      { headers: { 'Content-Type': 'text/event-stream' } },
    )
  }
  let answer = ''
  for await (const text of streamAnswer({
    connection,
    appOrigin,
    excerpts: [
      {
        id: 'S1',
        file: 'book.pdf',
        name: 'Book',
        page: 9,
        text: 'Actual source passage.',
      },
    ],
    messages: [{ role: 'user', content: 'Explain it' }],
    signal: new AbortController().signal,
    fetch,
  }))
    answer += text
  assert.equal(answer, 'From the source [S1, p. 9].')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, 'https://provider.example/v1/chat/completions')
  assert.equal(calls[0].init.credentials, 'omit')
  assert.equal(calls[0].init.cache, 'no-store')
  assert.equal(calls[0].init.redirect, 'error')
  assert.equal(calls[0].init.referrerPolicy, 'no-referrer')
  assert.equal(
    new Headers(calls[0].init.headers).get('Authorization'),
    `Bearer ${connection.apiKey}`,
  )
  assert.ok(!calls[0].url.includes(connection.apiKey))
  assert.ok(!calls[0].init.body.includes(connection.apiKey))
  const body = JSON.parse(calls[0].init.body)
  assert.equal(body.model, 'any-model')
  assert.match(body.messages[0].content, /Actual source passage/)
})

test('provider failures do not echo keys or raw error bodies and are never automatically retried', async () => {
  let calls = 0
  const fetch = async () => {
    calls++
    return new Response(
      JSON.stringify({ error: { message: connection.apiKey } }),
      { status: 401, headers: { 'Content-Type': 'application/json' } },
    )
  }
  try {
    for await (const text of streamAnswer({
      connection,
      appOrigin,
      excerpts: [],
      messages: [{ role: 'user', content: 'Hello' }],
      signal: new AbortController().signal,
      fetch,
    }))
      assert.fail(text)
    assert.fail('Expected provider rejection')
  } catch (error) {
    assert.ok(APICallError.isInstance(error))
    assert.match(chatError(error), /rejected your key/)
    assert.ok(!chatError(error).includes(connection.apiKey))
  }
  assert.equal(calls, 1)
})

test('truncated model answers are reported as incomplete', async () => {
  const fetch = async () => new Response(`data: ${JSON.stringify({
    id: 'truncated', object: 'chat.completion.chunk', created: 0, model: 'any-model',
    choices: [{ index: 0, delta: { content: 'Partial answer' }, finish_reason: 'length' }],
  })}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } })
  let partial = ''
  await assert.rejects(async () => {
    for await (const text of streamAnswer({ connection, appOrigin, excerpts: [], messages: [{ role: 'user', content: 'Explain' }], signal: new AbortController().signal, fetch })) partial += text
  }, /ANSWER_LIMIT/)
  assert.equal(partial, 'Partial answer')
  assert.match(chatError(new Error('ANSWER_LIMIT')), /output limit/)
})
