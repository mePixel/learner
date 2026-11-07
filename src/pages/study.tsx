import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { AiNotice } from '@/components/ai-notice'
import { SourceDrawer } from '@/components/source-drawer'
import { useWorkspace } from '@/lib/workspace'
import { coursePath, progressKey, type Course } from '@/lib/api'
import { swipeProgress, swipeRating } from '@/lib/swipe.mjs'
import { EmptyState, NotFound } from './workspace'

const EXIT_MS = 240
const MAX_TILT_DEG = 18

export function StudyPage() {
  const { classId } = useParams()
  const { courses } = useWorkspace()
  const [search] = useSearchParams()
  const [session, setSession] = useState(0)
  const course = courses.find((item) => item.id === classId)
  if (!course) return <NotFound />
  return (
    <StudySession
      key={`${course.id}-${session}-${search.get('practice')}`}
      course={course}
      practice={search.get('practice') === '1'}
      restart={() => setSession((value) => value + 1)}
    />
  )
}

function StudySession({
  course,
  practice,
  restart,
}: {
  course: Course
  practice: boolean
  restart: () => void
}) {
  const { learner, review } = useWorkspace()
  const [queue] = useState(() => {
    const entries = new Map(
      learner.progress.map((p) => [progressKey(p.classId, p.cardId), p]),
    )
    const due = course.cards.filter((card) => {
      const previous = entries.get(progressKey(course.id, card.id))
      return !previous || Date.parse(previous.dueAt) <= Date.now()
    })
    return (practice ? course.cards : due).slice(0, 10)
  })
  const [index, setIndex] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [known, setKnown] = useState(0)
  const [attempt, setAttempt] = useState<{
    eventId: string
    rating: 'again' | 'known'
  } | null>(null)
  const gesture = useRef<{ x: number; y: number } | null>(null)
  const suppressClick = useRef(false)
  const stack = useRef<HTMLDivElement>(null)
  const [exit, setExit] = useState<'again' | 'known' | null>(null)
  const card = queue[index]
  const nextCard = queue[index + 1]

  // Written straight to the DOM so a drag doesn't re-render on every pointer move.
  function showDrag(dx: number, dy: number) {
    const style = stack.current?.style
    if (!style) return
    const progress = swipeProgress(dx, dy)
    const tilt = Math.max(-MAX_TILT_DEG, Math.min(MAX_TILT_DEG, dx / 18))
    stack.current!.dataset.dragging = 'true'
    style.setProperty('--dx', `${dx}px`)
    style.setProperty('--dy', `${dy * 0.3}px`)
    style.setProperty('--tilt', `${tilt}deg`)
    style.setProperty('--lift', String(progress))
    style.setProperty('--swipe-known', String(dx > 0 ? progress : 0))
    style.setProperty('--swipe-again', String(dx < 0 ? progress : 0))
  }
  function clearDrag() {
    const element = stack.current
    if (!element) return
    delete element.dataset.dragging
    for (const name of [
      '--dx',
      '--dy',
      '--tilt',
      '--lift',
      '--swipe-known',
      '--swipe-again',
    ])
      element.style.removeProperty(name)
  }

  async function rate(rating: 'again' | 'known') {
    if (!card || busy || !flipped || (attempt && attempt.rating !== rating))
      return
    const current = attempt || {
      eventId: Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
        byte.toString(16).padStart(2, '0'),
      ).join(''),
      rating,
    }
    setAttempt(current)
    setBusy(true)
    setError('')
    setExit(rating)
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches
    try {
      await Promise.all([
        review(course.id, card.id, current.rating, current.eventId),
        new Promise((resolve) =>
          setTimeout(resolve, reducedMotion ? 0 : EXIT_MS),
        ),
      ])
      if (rating === 'known') setKnown((value) => value + 1)
      setFlipped(false)
      setIndex((value) => value + 1)
      setAttempt(null)
      setExit(null)
    } catch (err) {
      setExit(null)
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  function pointerDown(event: PointerEvent<HTMLButtonElement>) {
    if (busy || (event.pointerType === 'mouse' && event.button !== 0)) return
    gesture.current = { x: event.clientX, y: event.clientY }
    suppressClick.current = false
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  function pointerMove(event: PointerEvent<HTMLButtonElement>) {
    if (gesture.current && flipped)
      showDrag(
        event.clientX - gesture.current.x,
        event.clientY - gesture.current.y,
      )
  }
  function pointerUp(event: PointerEvent<HTMLButtonElement>) {
    const start = gesture.current
    gesture.current = null
    clearDrag()
    if (!start) return
    const dx = event.clientX - start.x
    const dy = event.clientY - start.y
    suppressClick.current = Math.abs(dx) > 12 || Math.abs(dy) > 12
    const rating = swipeRating(dx, dy)
    if (flipped && rating) void rate(rating)
  }
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (
        event.repeat ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        document.querySelector('[data-slot="drawer-content"]') ||
        (event.target instanceof HTMLElement &&
          event.target.closest(
            'input, textarea, select, [contenteditable="true"]',
          ))
      )
        return
      if (
        event.code === 'Space' &&
        !flipped &&
        card &&
        !(
          event.target instanceof HTMLElement &&
          event.target.closest('button, a')
        )
      ) {
        event.preventDefault()
        setFlipped(true)
      }
      if (flipped && event.key === '1') void rate('again')
      if (flipped && event.key === '2') void rate('known')
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [flipped, busy, index, attempt])

  if (!queue.length)
    return (
      <div className="study-page">
        <Link className="back-link" to={coursePath(course.id)}>
          <ArrowLeft aria-hidden="true" />
          {course.title}
        </Link>
        <EmptyState
          title={course.cards.length ? 'All caught up' : 'No flashcards yet'}
          description={
            course.cards.length
              ? 'Your next reviews are scheduled. You can practice the cards again now.'
              : 'Add flashcards.json to this class folder to begin.'
          }
        />
        {course.cards.length > 0 && (
          <Button asChild>
            <Link to={`${coursePath(course.id)}/study?practice=1`}>
              Practice again
            </Link>
          </Button>
        )}
      </div>
    )
  if (!card)
    return (
      <div className="session-complete">
        <h1>Session complete</h1>
        <dl className="session-results">
          <div>
            <dt>Got it</dt>
            <dd>{known}</dd>
          </div>
          <div>
            <dt>Again</dt>
            <dd>{queue.length - known}</dd>
          </div>
        </dl>
        <p>
          “Again” cards return in 10 minutes. Correct recalls return in 1, 3, 7,
          14, then 30 days.
        </p>
        <div className="completion-actions">
          <Button size="lg" onClick={restart}>
            Next session
          </Button>
          <Button variant="outline" size="lg" asChild>
            <Link to={coursePath(course.id)}>Back to class</Link>
          </Button>
        </div>
      </div>
    )

  return (
    <div className="study-page">
      <div className="study-topbar">
        <Link className="back-link" to={coursePath(course.id)}>
          <ArrowLeft aria-hidden="true" />
          {course.title}
        </Link>
        <span aria-live="polite">
          {practice ? 'Practice · ' : ''}
          {index + 1} of {queue.length}
        </span>
      </div>
      <Progress
        value={(index / queue.length) * 100}
        aria-label="Session progress"
      />
      <div className="card-stack" ref={stack} data-exit={exit || undefined}>
        {nextCard && (
          <Card
            className="study-card next-card"
            key={`next-${nextCard.id}`}
            inert
            aria-hidden="true"
          >
            <CardHeader>
              <p className="card-topic">{nextCard.topic}</p>
            </CardHeader>
            <CardContent className="study-card-content">
              <div className="question-content" lang="de">
                <h2>{nextCard.question}</h2>
              </div>
            </CardContent>
            <CardFooter className="study-card-footer">
              <SourceDrawer course={course} card={nextCard} />
              <AiNotice />
            </CardFooter>
          </Card>
        )}
        <Card className="study-card" key={card.id} data-flipped={flipped}>
          <span className="swipe-stamp stamp-known" aria-hidden="true">
            Got it
          </span>
          <span className="swipe-stamp stamp-again" aria-hidden="true">
            Again
          </span>
          <button
            type="button"
            className="card-flip-hitarea"
            aria-label={flipped ? 'Show question' : 'Flip card to reveal answer'}
            aria-pressed={flipped}
            disabled={busy || attempt !== null}
            onClick={() => {
              if (suppressClick.current) {
                suppressClick.current = false
                return
              }
              setFlipped((value) => !value)
            }}
            onPointerDown={pointerDown}
            onPointerMove={pointerMove}
            onPointerUp={pointerUp}
            onPointerCancel={() => {
              gesture.current = null
              clearDrag()
              suppressClick.current = true
            }}
          />
          <CardHeader>
            <p className="card-topic" lang="de">
              {card.topic}
            </p>
            <CardTitle className="sr-only">Flashcard {index + 1}</CardTitle>
          </CardHeader>
          <CardContent className="study-card-content">
            <div className="flip-deck">
              <div
                className="flip-face question-content"
                lang="de"
                aria-hidden={flipped}
              >
                <h2>{card.question}</h2>
              </div>
              <div
                className="flip-face flip-back question-content"
                lang="de"
                aria-hidden={!flipped}
              >
                <h2>{card.question}</h2>
                <p className="answer-text">{card.answer}</p>
              </div>
            </div>
          </CardContent>
          <CardFooter className="study-card-footer">
            <SourceDrawer course={course} card={card} />
            <AiNotice />
          </CardFooter>
        </Card>
      </div>
      {error && (
        <Alert variant="destructive">
          <AlertTitle>Your answer hasn’t been confirmed as saved</AlertTitle>
          <AlertDescription>
            {error}
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => attempt && void rate(attempt.rating)}
            >
              Retry saving answer
            </Button>
          </AlertDescription>
        </Alert>
      )}
      <div className="study-controls">
        {flipped ? (
          <>
            <div className="rating-buttons">
              <Button
                variant="outline"
                size="lg"
                disabled={
                  busy || (attempt !== null && attempt.rating !== 'again')
                }
                onClick={() => void rate('again')}
              >
                {busy && attempt?.rating === 'again' ? 'Saving…' : 'Again'}
                <kbd>1</kbd>
              </Button>
              <Button
                size="lg"
                disabled={
                  busy || (attempt !== null && attempt.rating !== 'known')
                }
                onClick={() => void rate('known')}
              >
                {busy && attempt?.rating === 'known' ? 'Saving…' : 'Got it'}
                <kbd>2</kbd>
              </Button>
            </div>
            <p className="touch-hint">Or swipe left for Again, right for Got it</p>
          </>
        ) : (
          <>
            <Button
              size="lg"
              className="reveal-button"
              onClick={() => setFlipped(true)}
            >
              Reveal answer
              <kbd>space</kbd>
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
