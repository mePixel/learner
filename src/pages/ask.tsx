import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router'
import {
  ArrowUp,
  ExternalLink,
  LoaderCircle,
  ShieldCheck,
  Square,
  Trash2,
} from 'lucide-react'
import Markdown from 'react-markdown'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { Checkbox } from '@/components/ui/checkbox'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty'
import { Message, MessageContent, MessageHeader } from '@/components/ui/message'
import { Bubble, BubbleContent } from '@/components/ui/bubble'
import {
  MessageScrollerProvider,
  MessageScroller,
  MessageScrollerViewport,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerButton,
} from '@/components/ui/message-scroller'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupTextarea,
} from '@/components/ui/input-group'
import { AiNotice } from '@/components/ai-notice'
import { useWorkspace } from '@/lib/workspace'
import { originalPath, sourcePath, type Course } from '@/lib/api'
import { readSource } from '@/lib/read-source'
import {
  chatError,
  geminiSuggested,
  readableSource,
  relevantExcerpts,
  streamAnswer,
  validateConnection,
  type Connection,
  type Excerpt,
  type SourceDocument,
} from '@/lib/source-chat'

type Turn = {
  id: string
  role: 'user' | 'assistant'
  text: string
  excerpts?: Excerpt[]
  incomplete?: boolean
}

function GeminiGuide({
  useSuggestedModel,
  disabled,
}: {
  useSuggestedModel: () => void
  disabled: boolean
}) {
  return (
    <details className="provider-guide">
      <summary>Get a Gemini developer API key</summary>
      <ol>
        <li>
          Sign in to{' '}
          <a
            href="https://aistudio.google.com/"
            target="_blank"
            rel="noreferrer"
          >
            Google AI Studio
          </a>{' '}
          with your Google account and complete its first-time setup.
        </li>
        <li>
          Open{' '}
          <a
            href="https://aistudio.google.com/api-keys"
            target="_blank"
            rel="noreferrer"
          >
            API keys
          </a>
          . Copy the default key, or choose <strong>Create API key</strong> and
          select or create a Google Cloud project.
        </li>
        <li>
          <Button
            type="button"
            variant="link"
            onClick={useSuggestedModel}
            disabled={disabled}
          >
            Use Gemini settings
          </Button>{' '}
          to fill the base URL and model below.
        </li>
        <li>
          Paste the developer key into <strong>API key</strong>, select your
          sources, and ask a question. A Gemini chat subscription is not an API
          key.
        </li>
      </ol>
      <p>
        Suggested model: <code>{geminiSuggested.model}</code>. You can change
        the model or use another compatible provider.
      </p>
      <p>
        Google offers a limited free tier for eligible models and accounts.
        Check your project’s quota in AI Studio and{' '}
        <a
          href="https://ai.google.dev/gemini-api/docs/pricing"
          target="_blank"
          rel="noreferrer"
        >
          current pricing
        </a>
        . Leave billing disabled if you want to stay on the free tier.
      </p>
      <p>
        Google receives your questions and source excerpts. Free-tier content
        may be used to improve Google’s products.{' '}
        <a
          href="https://ai.google.dev/gemini-api/docs/api-key"
          target="_blank"
          rel="noreferrer"
        >
          Key setup and troubleshooting
        </a>
        .
      </p>
    </details>
  )
}

export default function AskPage() {
  const { courses } = useWorkspace()
  const [search, setSearch] = useSearchParams()
  const course =
    courses.find((item) => item.id === search.get('class')) || courses[0]
  const [connection, setConnection] = useState<Connection>({
    ...geminiSuggested,
    apiKey: '',
  })
  const [busy, setBusy] = useState(false)
  const [reset, setReset] = useState(0)
  const connectionPanel = useRef<HTMLDetailsElement>(null)
  return (
    <div className="ask-page">
      <div className="page-heading">
        <h1>Ask your sources</h1>
        <p>
          Explore an idea, compare concepts, or find the passage behind an
          answer.
        </p>
      </div>
      <details className="connection-panel" open ref={connectionPanel}>
        <summary>
          <span>Model connection</span>
          <span className="connection-privacy">
            <ShieldCheck aria-hidden="true" /> Only on this page
          </span>
        </summary>
        <div className="connection-content">
          <p>
            Use any OpenAI-compatible provider that allows browser requests.
            Your API key goes directly to that provider and never to Recall.
            Settings and chat clear when you leave this area or reload.
          </p>
          <GeminiGuide
            disabled={busy}
            useSuggestedModel={() =>
              setConnection((previous) => ({ ...previous, ...geminiSuggested }))
            }
          />
          <FieldGroup className="connection-fields">
            <Field>
              <FieldLabel htmlFor="ai-base-url">Base URL</FieldLabel>
              <Input
                id="ai-base-url"
                type="url"
                autoComplete="off"
                spellCheck={false}
                placeholder={geminiSuggested.baseURL}
                value={connection.baseURL}
                disabled={busy}
                onChange={(event) =>
                  setConnection({ ...connection, baseURL: event.target.value })
                }
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="ai-model">Model ID</FieldLabel>
              <Input
                id="ai-model"
                autoComplete="off"
                spellCheck={false}
                placeholder={geminiSuggested.model}
                value={connection.model}
                disabled={busy}
                onChange={(event) =>
                  setConnection({ ...connection, model: event.target.value })
                }
              />
            </Field>
            <Field className="connection-key">
              <FieldLabel htmlFor="ai-key">API key</FieldLabel>
              <Input
                id="ai-key"
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder="Paste your provider’s key"
                value={connection.apiKey}
                disabled={busy}
                onChange={(event) =>
                  setConnection({ ...connection, apiKey: event.target.value })
                }
                aria-describedby="key-help"
              />
              <FieldDescription id="key-help">
                Kept in this page’s memory only. Optional for a local model that
                does not require a key.
              </FieldDescription>
            </Field>
          </FieldGroup>
          <Button
            variant="ghost"
            size="sm"
            disabled={
              busy ||
              (!connection.apiKey && !connection.baseURL && !connection.model)
            }
            onClick={() => {
              setConnection({ baseURL: '', model: '', apiKey: '' })
              setReset((value) => value + 1)
            }}
          >
            Forget settings and chat
          </Button>
        </div>
      </details>
      {course ? (
        <>
          <Field className="chat-class-field">
            <FieldLabel htmlFor="chat-class">Class</FieldLabel>
            <NativeSelect
              id="chat-class"
              value={course.id}
              disabled={busy}
              onChange={(event) => setSearch({ class: event.target.value })}
            >
              {courses.map((item) => (
                <NativeSelectOption key={item.id} value={item.id}>
                  {item.title}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <SourceChat
            key={`${course.id}:${search.get('file') || ''}:${reset}`}
            course={course}
            initialFile={search.get('file')}
            connection={connection}
            onBusy={setBusy}
            onConnected={() => {
              if (connectionPanel.current) connectionPanel.current.open = false
            }}
          />
        </>
      ) : (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No sources yet</EmptyTitle>
            <EmptyDescription>
              Add a class with source documents to start a conversation.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </div>
  )
}

function SourceChat({
  course,
  initialFile,
  connection,
  onBusy,
  onConnected,
}: {
  course: Course
  initialFile: string | null
  connection: Connection
  onBusy: (busy: boolean) => void
  onConnected: () => void
}) {
  const [selected, setSelected] = useState(() =>
    initialFile && course.sources.some((source) => source.file === initialFile)
      ? [initialFile]
      : course.sources
          .filter((source) => readableSource(course, source))
          .map((source) => source.file),
  )
  const [question, setQuestion] = useState('')
  const [turns, setTurns] = useState<Turn[]>([])
  const [phase, setPhase] = useState('')
  const [error, setError] = useState('')
  const active = useRef<AbortController | null>(null)
  const documents = useRef(new Map<string, SourceDocument>())
  const input = useRef<HTMLTextAreaElement>(null)
  const busy = Boolean(phase)
  useEffect(
    () => () => {
      active.current?.abort()
    },
    [],
  )

  function changeSelection(files: string[]) {
    setSelected(files)
    setTurns([])
    setError('')
  }

  async function ask(event: FormEvent) {
    event.preventDefault()
    const text = question.trim()
    if (!text || active.current) return
    try {
      validateConnection(connection, window.location.origin)
      if (!selected.length)
        throw new Error('Select at least one source to ask about.')
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Check your connection settings.',
      )
      return
    }
    const controller = new AbortController()
    active.current = controller
    const user: Turn = { id: crypto.randomUUID(), role: 'user', text }
    const answerId = crypto.randomUUID()
    const history = turns.filter((turn) => !turn.incomplete && turn.text.trim())
    setTurns((previous) => [...previous, user])
    setQuestion('')
    setError('')
    setPhase('Reading selected sources…')
    onBusy(true)
    let reading = true
    try {
      const sources = [
        ...new Map(
          selected.map((file) => {
            const source = course.sources.find((item) => item.file === file)!
            return [readableSource(course, source)?.file || source.file, source]
          }),
        ).values(),
      ]
      const loaded = await Promise.all(
        sources.map(async (source) => {
          const file = readableSource(course, source)?.file || source.file
          const cached = documents.current.get(file)
          if (cached) return cached
          const document = await readSource(course, source, controller.signal)
          documents.current.set(file, document)
          return document
        }),
      )
      controller.signal.throwIfAborted()
      const excerpts = relevantExcerpts(
        loaded,
        [
          ...history
            .filter((turn) => turn.role === 'user')
            .slice(-2)
            .map((turn) => turn.text),
          text,
        ].join('\n'),
      )
      if (!excerpts.length)
        throw new Error(
          'No readable passages were found. Choose a text-based source or transcript.',
        )
      setTurns((previous) => [
        ...previous,
        { id: answerId, role: 'assistant', text: '', excerpts },
      ])
      setPhase('Waiting for your model…')
      reading = false
      let answer = ''
      for await (const delta of streamAnswer({
        connection,
        appOrigin: window.location.origin,
        excerpts,
        messages: [...history, user].map((turn) => ({
          role: turn.role,
          content: turn.text,
        })),
        signal: controller.signal,
      })) {
        answer += delta
        setPhase('Writing answer…')
        setTurns((previous) =>
          previous.map((turn) =>
            turn.id === answerId ? { ...turn, text: answer } : turn,
          ),
        )
      }
      controller.signal.throwIfAborted()
      if (!answer.trim()) throw new Error('No text response')
      onConnected()
    } catch (err) {
      const stopped = controller.signal.aborted
      controller.abort()
      setTurns((previous) =>
        previous.map((turn) =>
          turn.id === user.id || turn.id === answerId
            ? { ...turn, incomplete: true }
            : turn,
        ),
      )
      setQuestion(text)
      if (!stopped)
        setError(reading && err instanceof Error ? err.message : chatError(err))
    } finally {
      active.current = null
      setPhase('')
      onBusy(false)
    }
  }

  return (
    <section className="source-chat" aria-label="Source conversation">
      <details className="chat-source-picker">
        <summary>
          Sources <span>{selected.length} selected</span>
        </summary>
        <p>
          Only relevant excerpts from these sources are sent. Changing the
          selection starts a new chat.
        </p>
        <div className="chat-source-actions">
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() =>
              changeSelection(
                course.sources
                  .filter((source) => readableSource(course, source))
                  .map((source) => source.file),
              )
            }
          >
            Select all
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => changeSelection([])}
          >
            Clear selection
          </Button>
        </div>
        <FieldGroup className="chat-source-options">
          {course.sources.map((source, index) => {
            const readable = readableSource(course, source)
            return (
              <Field
                orientation="horizontal"
                key={source.file}
                data-disabled={!readable || busy}
              >
                <Checkbox
                  id={`chat-source-${index}`}
                  checked={selected.includes(source.file)}
                  disabled={!readable || busy}
                  onCheckedChange={(checked) =>
                    changeSelection(
                      checked
                        ? [...selected, source.file]
                        : selected.filter((file) => file !== source.file),
                    )
                  }
                />
                <FieldLabel htmlFor={`chat-source-${index}`}>
                  {source.name}
                  {['mp4', 'webm'].includes(source.type) && (
                    <span>
                      {readable
                        ? ' · uses transcript'
                        : ' · transcript required'}
                    </span>
                  )}
                </FieldLabel>
              </Field>
            )
          })}
        </FieldGroup>
      </details>
      <div className="chat-toolbar">
        <span>Conversation</span>
        <Button
          variant="ghost"
          size="sm"
          disabled={busy || !turns.length}
          onClick={() => {
            setTurns([])
            setError('')
          }}
        >
          <Trash2 data-icon="inline-start" />
          New chat
        </Button>
      </div>
      <MessageScrollerProvider autoScroll>
        <MessageScroller className="chat-thread">
          <MessageScrollerViewport aria-label="Conversation messages">
            <MessageScrollerContent>
              {!turns.length && (
                <Empty>
                  <EmptyHeader>
                    <EmptyTitle>What would you like to understand?</EmptyTitle>
                    <EmptyDescription>
                      Ask about the selected sources. Answers will link back to
                      the passages used.
                    </EmptyDescription>
                  </EmptyHeader>
                  <div className="chat-starters">
                    {[
                      'Summarize the main ideas',
                      'Compare the key concepts',
                    ].map((prompt) => (
                      <Button
                        key={prompt}
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setQuestion(prompt)
                          input.current?.focus()
                        }}
                      >
                        {prompt}
                      </Button>
                    ))}
                  </div>
                </Empty>
              )}
              {turns.map((turn) => (
                <MessageScrollerItem
                  key={turn.id}
                  messageId={turn.id}
                  scrollAnchor={turn.role === 'user'}
                >
                  <ChatTurn turn={turn} course={course} />
                </MessageScrollerItem>
              ))}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton />
        </MessageScroller>
      </MessageScrollerProvider>
      <div role="status" aria-live="polite" className="chat-status">
        {busy && (
          <>
            <LoaderCircle className="chat-spinner" aria-hidden="true" />
            {phase}
          </>
        )}
      </div>
      {error && (
        <Alert variant="destructive">
          <AlertTitle>Couldn’t answer yet</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <form onSubmit={(event) => void ask(event)} className="chat-composer">
        <Field>
          <FieldLabel className="sr-only" htmlFor="source-question">
            Ask a question about your sources
          </FieldLabel>
          <InputGroup>
            <InputGroupTextarea
              id="source-question"
              ref={input}
              placeholder="Ask a question about your sources…"
              value={question}
              maxLength={4000}
              rows={3}
              disabled={busy}
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={(event) => {
                if (
                  event.key === 'Enter' &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault()
                  event.currentTarget.form?.requestSubmit()
                }
              }}
            />
            <InputGroupAddon
              align="block-end"
              className="chat-composer-actions"
            >
              <span>Enter to send · Shift + Enter for a new line</span>
              {busy ? (
                <Button
                  key="stop"
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={(event) => {
                    event.preventDefault()
                    active.current?.abort()
                  }}
                >
                  <Square data-icon="inline-start" />
                  Stop
                </Button>
              ) : (
                <Button
                  key="send"
                  type="submit"
                  size="sm"
                  disabled={!question.trim() || !selected.length}
                >
                  <ArrowUp data-icon="inline-start" />
                  Ask
                </Button>
              )}
            </InputGroupAddon>
          </InputGroup>
        </Field>
      </form>
      <AiNotice />
    </section>
  )
}

function ChatTurn({ turn, course }: { turn: Turn; course: Course }) {
  const citations = turn.excerpts?.filter(
    (excerpt, index, all) =>
      all.findIndex(
        (item) => item.file === excerpt.file && item.page === excerpt.page,
      ) === index,
  )
  return (
    <Message align={turn.role === 'user' ? 'end' : 'start'}>
      <MessageContent>
        <MessageHeader>
          {turn.role === 'user' ? 'You' : 'Source assistant'}
        </MessageHeader>
        <Bubble
          variant={turn.role === 'user' ? 'muted' : 'ghost'}
          align={turn.role === 'user' ? 'end' : 'start'}
        >
          <BubbleContent>
            {turn.role === 'user' ? (
              <p className="chat-user-text">{turn.text}</p>
            ) : (
              <div className="chat-markdown">
                <Markdown
                  skipHtml
                  disallowedElements={['img']}
                  components={{
                    a: ({ children, href }) => (
                      <a href={href} target="_blank" rel="noreferrer">
                        {children}
                      </a>
                    ),
                  }}
                >
                  {turn.text ||
                    (turn.incomplete
                      ? 'No answer was completed.'
                      : 'Preparing an answer…')}
                </Markdown>
              </div>
            )}
          </BubbleContent>
        </Bubble>
        {turn.incomplete && turn.role === 'assistant' && (
          <p className="chat-incomplete">
            Response stopped or interrupted. This answer may be incomplete.
          </p>
        )}
        {turn.role === 'assistant' &&
          turn.text &&
          Boolean(citations?.length) && (
            <details className="chat-citations">
              <summary>Source excerpts used ({citations!.length})</summary>
              {citations!.map((excerpt) => (
                <div key={`${excerpt.file}:${excerpt.page}`}>
                  <a
                    href={
                      excerpt.page
                        ? `${originalPath(course.id, excerpt.file)}#page=${excerpt.page}`
                        : sourcePath(course.id, excerpt.file)
                    }
                    target="_blank"
                    rel="noreferrer"
                  >
                    [{excerpt.id}
                    {excerpt.page ? `, p. ${excerpt.page}` : ''}] {excerpt.name}
                    <ExternalLink aria-hidden="true" />
                  </a>
                  <p>
                    {excerpt.text.slice(0, 280)}
                    {excerpt.text.length > 280 ? '…' : ''}
                  </p>
                </div>
              ))}
            </details>
          )}
      </MessageContent>
    </Message>
  )
}
