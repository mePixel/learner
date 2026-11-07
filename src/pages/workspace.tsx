import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import {
  ArrowLeft,
  Check,
  ChevronRight,
  Copy,
  FileText,
  Search,
  Video,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { Progress } from '@/components/ui/progress'
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from '@/components/ui/empty'
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AiNotice } from '@/components/ai-notice'
import { SourceDrawer } from '@/components/source-drawer'
import { useWorkspace } from '@/lib/workspace'
import {
  coursePath,
  sourcePath,
  type Course,
  type Progress as CardProgress,
} from '@/lib/api'

const SEARCH_THRESHOLD = 5

export function EmptyState({
  title,
  description,
}: {
  title: string
  description: string
}) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}
export function NotFound() {
  return (
    <>
      <EmptyState
        title="Page not found"
        description="The class or page may have moved. Your progress is still saved."
      />
      <Button asChild>
        <Link to="/">Back to overview</Link>
      </Button>
    </>
  )
}

export function courseStats(course: Course, progress: CardProgress[]) {
  const cards = new Set(course.cards.map((card) => card.id))
  const entries = progress.filter(
    (p) => p.classId === course.id && cards.has(p.cardId),
  )
  const mastered = entries.filter((p) => p.streak >= 3).length
  const notDue = entries.filter((p) => Date.parse(p.dueAt) > Date.now()).length
  return {
    reviewed: entries.length,
    mastered,
    due: course.cards.length - notDue,
    percent: course.cards.length
      ? Math.round((mastered / course.cards.length) * 100)
      : 0,
  }
}

function count(value: number, noun: string) {
  return `${value} ${noun}${value === 1 ? '' : 's'}`
}

function ClassRow({ course }: { course: Course }) {
  const { learner } = useWorkspace()
  const stats = courseStats(course, learner.progress)
  return (
    <Link className="class-row" to={coursePath(course.id)}>
      <div className="class-description">
        <h3>{course.title}</h3>
        <p>
          {count(course.cards.length, 'card')} · {stats.due} due ·{' '}
          {count(course.sources.length, 'source')}
        </p>
      </div>
      <div className="class-progress">
        <Progress value={stats.percent} aria-hidden="true" />
        <span>{stats.percent}% mastered</span>
      </div>
      <ChevronRight aria-hidden="true" />
    </Link>
  )
}

export function useCopyLink() {
  const { token } = useWorkspace()
  const navigate = useNavigate()
  const [copied, setCopied] = useState(false)
  const link = `${window.location.origin}/#key=${token}`
  async function copy() {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      toast.success('Learning link copied. Keep it somewhere private.')
      window.setTimeout(() => setCopied(false), 2500)
    } catch {
      navigate('/link')
      toast.info('Select and copy your private link from the field below.')
    }
  }
  return { copied, copy, link }
}

function CopyLinkButton({ variant }: { variant?: 'ghost' }) {
  const { copied, copy } = useCopyLink()
  return (
    <Button
      variant={variant}
      size={variant ? 'sm' : undefined}
      onClick={() => void copy()}
    >
      {copied ? (
        <Check data-icon="inline-start" />
      ) : (
        <Copy data-icon="inline-start" />
      )}
      {copied ? 'Link copied' : 'Copy my link'}
    </Button>
  )
}

export function Overview() {
  const { courses, learner, refresh } = useWorkspace()
  const [query, setQuery] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const stats = courses.map((course) => courseStats(course, learner.progress))
  const total = courses.reduce((sum, course) => sum + course.cards.length, 0)
  const reviewed = stats.reduce((sum, item) => sum + item.reviewed, 0)
  const mastered = stats.reduce((sum, item) => sum + item.mastered, 0)
  const due = stats.reduce((sum, item) => sum + item.due, 0)
  const next = courses.find((_, index) => stats[index].due > 0)
  const filtered = courses.filter((course) =>
    `${course.title} ${course.description || ''}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  )
  return (
    <>
      <div className="page-heading page-heading-action">
        <div>
          <h1>
            {!total
              ? 'No flashcards yet'
              : due
                ? `${count(due, 'card')} due`
                : 'All caught up'}
          </h1>
          {total > 0 && (
            <p>
              {reviewed} of {total} reviewed ·{' '}
              {Math.round((mastered / total) * 100)}% mastered
            </p>
          )}
        </div>
        {next && (
          <Button size="lg" asChild>
            <Link to={`${coursePath(next.id)}/study`}>Start review</Link>
          </Button>
        )}
      </div>
      <section className="classes-section">
        <h2>Classes</h2>
        {courses.length > SEARCH_THRESHOLD && (
          <div className="search-field list-search">
            <Search aria-hidden="true" />
            <Input
              aria-label="Search classes"
              placeholder="Search classes"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
        )}
        {filtered.length ? (
          <div className="class-list">
            {filtered.map((course) => (
              <ClassRow key={course.id} course={course} />
            ))}
          </div>
        ) : (
          <EmptyState
            title={query ? 'No matching classes' : 'No classes yet'}
            description={
              query
                ? 'Try a different name or clear your search.'
                : 'Add a folder inside Classes and it will appear here automatically.'
            }
          />
        )}
        {courses.some((course) => course.errors.length) && (
          <Alert variant="destructive">
            <AlertTitle>Some content needs attention</AlertTitle>
            <AlertDescription>
              Open the affected class to see which content files need fixing.
            </AlertDescription>
          </Alert>
        )}
      </section>
      <div className="overview-footer">
        <p>
          Progress is saved to your private link. Anyone who has it can open and
          change your progress.
        </p>
        <div>
          <CopyLinkButton variant="ghost" />
          <Button
            variant="ghost"
            size="sm"
            disabled={refreshing}
            onClick={async () => {
              setRefreshing(true)
              try {
                await refresh()
                toast.success('Classes are up to date.')
              } catch (err) {
                toast.error((err as Error).message)
              } finally {
                setRefreshing(false)
              }
            }}
          >
            {refreshing ? 'Refreshing…' : 'Refresh classes'}
          </Button>
        </div>
      </div>
    </>
  )
}

export function SourceRows({ course }: { course: Course }) {
  return (
    <div className="source-list">
      {course.sources.map((source) => (
        <Link
          className="source-row"
          key={source.file}
          to={sourcePath(course.id, source.file)}
        >
          {source.type === 'mp4' || source.type === 'webm' ? (
            <Video aria-hidden="true" />
          ) : (
            <FileText aria-hidden="true" />
          )}
          <strong>{source.name}</strong>
          <span>
            {source.type.toUpperCase()} ·{' '}
            {source.size < 1000000
              ? `${Math.round(source.size / 1000)} KB`
              : `${(source.size / 1000000).toFixed(1)} MB`}
          </span>
        </Link>
      ))}
    </div>
  )
}

export function CoursePage() {
  const { classId } = useParams()
  const { courses, learner } = useWorkspace()
  const [query, setQuery] = useState('')
  const course = courses.find((c) => c.id === classId)
  if (!course) return <NotFound />
  const stats = courseStats(course, learner.progress)
  const filtered = course.cards.filter((card) =>
    `${card.question} ${card.answer} ${card.topic}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  )
  return (
    <>
      <Link className="back-link" to="/">
        <ArrowLeft aria-hidden="true" />
        Overview
      </Link>
      <div className="page-heading page-heading-action">
        <div>
          <h1>{course.title}</h1>
          {course.description && <p>{course.description}</p>}
          <p>
            {stats.due} due · {stats.reviewed} reviewed · {stats.mastered}{' '}
            mastered (three correct recalls in a row)
          </p>
        </div>
        {course.cards.length > 0 && (
          <Button size="lg" asChild>
            <Link to={`${coursePath(course.id)}/study`}>Start review</Link>
          </Button>
        )}
      </div>
      {course.errors.map((error) => (
        <Alert key={error} variant="destructive">
          <AlertTitle>Content file needs attention</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ))}
      <Tabs defaultValue="cards" className="course-tabs">
        <TabsList>
          <TabsTrigger value="cards">
            Flashcards <Badge variant="secondary">{course.cards.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="sources">
            Sources <Badge variant="secondary">{course.sources.length}</Badge>
          </TabsTrigger>
        </TabsList>
        <TabsContent value="cards">
          <div className="cards-toolbar">
            <div className="search-field">
              <Search aria-hidden="true" />
              <Input
                aria-label="Search flashcards"
                placeholder="Search questions, answers, topics"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <AiNotice />
          </div>
          {filtered.length ? (
            <div className="flashcard-list">
              {filtered.map((card) => (
                <details className="flashcard-preview" key={card.id}>
                  <summary>
                    <div lang="de">
                      <h3>{card.question}</h3>
                      <p className="card-topic">{card.topic}</p>
                    </div>
                    <ChevronRight aria-hidden="true" />
                  </summary>
                  <div className="preview-answer" lang="de">
                    <p>{card.answer}</p>
                    <SourceDrawer
                      course={course}
                      card={card}
                      triggerVariant="outline"
                    />
                  </div>
                </details>
              ))}
            </div>
          ) : (
            <EmptyState
              title={query ? 'No matching flashcards' : 'No flashcards yet'}
              description={
                query
                  ? 'Try another question or topic.'
                  : 'Add flashcards.json to this class folder. You can browse the sources in the meantime.'
              }
            />
          )}
        </TabsContent>
        <TabsContent value="sources">
          {course.sources.length ? (
            <SourceRows course={course} />
          ) : (
            <EmptyState
              title="No source files yet"
              description="Add original documents to the Sources folder inside this class."
            />
          )}
        </TabsContent>
      </Tabs>
    </>
  )
}

export function SourcesPage() {
  const { courses } = useWorkspace()
  const [query, setQuery] = useState('')
  const matching = courses
    .map((course) => ({
      ...course,
      sources: course.sources.filter((source) =>
        `${source.name} ${course.title}`
          .toLowerCase()
          .includes(query.toLowerCase()),
      ),
    }))
    .filter((course) => course.sources.length)
  return (
    <>
      <div className="page-heading">
        <h1>Sources</h1>
        <p>Flashcard answers are generated from these files.</p>
      </div>
      <div className="list-search search-field">
        <Search aria-hidden="true" />
        <Input
          aria-label="Search sources"
          placeholder="Search source files"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      {matching.map((course) => (
        <section className="source-group" key={course.id}>
          <h2>{course.title}</h2>
          <SourceRows course={course} />
        </section>
      ))}
      {!matching.length && (
        <EmptyState
          title="No sources found"
          description="Try a different search or add source files to a class folder."
        />
      )}
    </>
  )
}

export function LearningLink() {
  const { learner, token, saved, rename, newLearner, switchLearner } =
    useWorkspace()
  const { link } = useCopyLink()
  const [name, setName] = useState(learner.name)
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(
    event: FormEvent,
    operation: () => Promise<void>,
    message: string,
  ) {
    event.preventDefault()
    setBusy(true)
    try {
      await operation()
      toast.success(message)
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="link-page">
      <div className="page-heading">
        <h1>My learning link</h1>
        <p>
          Open this link on another device to continue with the same progress.
          There is no password or recovery email, so keep a copy somewhere
          private.
        </p>
      </div>
      <section className="settings-section">
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="private-link">Private link</FieldLabel>
            <Input
              id="private-link"
              readOnly
              value={link}
              onFocus={(event) => event.target.select()}
            />
            <FieldDescription>
              Anyone with this link can view and change your progress.
            </FieldDescription>
          </Field>
          <CopyLinkButton />
        </FieldGroup>
      </section>
      <section className="settings-section">
        <h2>Display name</h2>
        <form
          onSubmit={(event) =>
            void submit(event, () => rename(name.trim()), 'Name saved.')
          }
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="learner-name" className="sr-only">
                Display name
              </FieldLabel>
              <Input
                id="learner-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                maxLength={60}
              />
            </Field>
            <Button
              variant="outline"
              disabled={busy || !name.trim()}
              type="submit"
            >
              Save name
            </Button>
          </FieldGroup>
        </form>
      </section>
      <section className="settings-section">
        <h2>Add a learner</h2>
        <p className="section-description">
          Creates a separate link with its own progress. Your current link keeps
          working.
        </p>
        <form
          onSubmit={(event) =>
            void submit(
              event,
              async () => {
                await newLearner(newName.trim())
                setName(newName.trim())
                setNewName('')
              },
              'New learner created. Copy their link above.',
            )
          }
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="new-learner-name">Name</FieldLabel>
              <Input
                id="new-learner-name"
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                required
                maxLength={60}
              />
            </Field>
            <Button
              variant="outline"
              disabled={busy || !newName.trim()}
              type="submit"
            >
              Create learner
            </Button>
          </FieldGroup>
        </form>
      </section>
      {saved.length > 1 && (
        <section className="settings-section saved-learners">
          <h2>Learners on this browser</h2>
          {saved.map((profile) => (
            <div key={profile.token}>
              <span className="avatar">
                {profile.name.slice(0, 1).toUpperCase()}
              </span>
              <strong>{profile.name}</strong>
              {token === profile.token ? (
                <Badge variant="secondary">Current</Badge>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true)
                    try {
                      await switchLearner(profile.token)
                      setName(profile.name)
                      toast.success(`Switched to ${profile.name}.`)
                    } catch (err) {
                      toast.error((err as Error).message)
                    } finally {
                      setBusy(false)
                    }
                  }}
                >
                  Switch
                </Button>
              )}
            </div>
          ))}
        </section>
      )}
    </div>
  )
}
