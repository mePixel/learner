import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Skeleton } from '@/components/ui/skeleton'
import { request, type Course, type Learner, type SavedLearner } from './api'

type Workspace = {
  courses: Course[]
  learner: Learner
  token: string
  saved: SavedLearner[]
  refresh: () => Promise<void>
  rename: (name: string) => Promise<void>
  newLearner: (name: string) => Promise<void>
  switchLearner: (token: string) => Promise<void>
  review: (
    classId: string,
    cardId: string,
    rating: 'again' | 'known',
    eventId: string,
  ) => Promise<void>
}
const Context = createContext<Workspace | null>(null)

function readSaved(): SavedLearner[] {
  try {
    const value = JSON.parse(localStorage.getItem('recall.learners.v1') || '[]')
    return Array.isArray(value)
      ? value.filter(
          (v): v is SavedLearner =>
            typeof v?.name === 'string' &&
            typeof v?.token === 'string' &&
            /^[A-Za-z0-9_-]{43}$/.test(v.token),
        )
      : []
  } catch {
    return []
  }
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [courses, setCourses] = useState<Course[]>([])
  const [learner, setLearner] = useState<Learner>()
  const [token, setToken] = useState('')
  const activeToken = useRef('')
  const [saved, setSaved] = useState(readSaved)
  const [error, setError] = useState('')

  function activate(key: string, user: Learner) {
    activeToken.current = key
    setToken(key)
    setLearner(user)
    setError('')
    setSaved((previous) => {
      const next = [
        ...previous.filter((profile) => profile.token !== key),
        { token: key, name: user.name },
      ]
      try {
        localStorage.setItem('recall.learners.v1', JSON.stringify(next))
        localStorage.setItem('recall.active.v1', key)
      } catch {
        toast.error(
          'This browser could not remember your link. Copy it from My learning link before leaving.',
        )
      }
      return next
    })
    if (window.location.hash.startsWith('#key='))
      window.history.replaceState(
        null,
        '',
        window.location.pathname + window.location.search,
      )
  }

  async function newLearner(name: string) {
    const user = await request<Learner & { token: string }>('/api/learners', {
      method: 'POST',
      body: JSON.stringify({ name }),
    })
    activate(user.token, user)
  }
  async function switchLearner(key: string) {
    activate(key, await request<Learner>('/api/me', {}, key))
  }
  async function refresh() {
    const [catalog, user] = await Promise.all([
      request<Course[]>('/api/catalog'),
      request<Learner>('/api/me', {}, token),
    ])
    if (activeToken.current !== token) return
    setCourses(catalog)
    setLearner(user)
  }
  useEffect(() => {
    let generation = 0
    async function boot() {
      const current = ++generation
      try {
        const keyFromLink = new URLSearchParams(
          window.location.hash.slice(1),
        ).get('key')
        if (keyFromLink !== null && !/^[A-Za-z0-9_-]{43}$/.test(keyFromLink))
          throw new Error(
            'This learning link is not valid. Open a saved link or create a separate learner.',
          )
        let key = keyFromLink
        if (key === null) {
          try {
            key = localStorage.getItem('recall.active.v1')
          } catch {
            /* Private browsing can disable storage. */
          }
        }
        const catalogPromise = request<Course[]>('/api/catalog')
        const userPromise = key
          ? request<Learner>('/api/me', {}, key)
          : request<Learner & { token: string }>('/api/learners', {
              method: 'POST',
              body: JSON.stringify({ name: 'Learner' }),
            })
        const [catalog, user] = await Promise.all([catalogPromise, userPromise])
        if (current !== generation) return
        setCourses(catalog)
        activate(key || (user as Learner & { token: string }).token, user)
      } catch (err) {
        if (current === generation)
          setError(
            err instanceof Error
              ? err.message
              : 'Unable to open your workspace.',
          )
      }
    }
    const openLink = () => {
      if (new URLSearchParams(window.location.hash.slice(1)).has('key'))
        void boot()
    }
    window.addEventListener('hashchange', openLink)
    void boot()
    return () => {
      generation++
      window.removeEventListener('hashchange', openLink)
    }
  }, [])

  useEffect(() => {
    if (!token) return
    const update = () => {
      if (document.visibilityState === 'visible')
        void refresh().catch(() => {
          /* Keep the last successful data; writes still report errors. */
        })
    }
    const timer = window.setInterval(update, 30000)
    window.addEventListener('focus', update)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', update)
    }
  }, [token])

  if (error)
    return (
      <main className="startup">
        <Alert variant="destructive">
          <AlertTitle>We couldn’t open your workspace</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
        <Button onClick={() => window.location.reload()}>Try again</Button>
        <Button
          variant="outline"
          onClick={() => {
            void newLearner('Learner')
              .then(() => request<Course[]>('/api/catalog'))
              .then(setCourses)
              .catch((err) => setError(err.message))
          }}
        >
          Create a separate learner
        </Button>
        <p>Your previous progress stays with its original learning link.</p>
      </main>
    )
  if (!learner)
    return (
      <main className="startup" aria-label="Loading workspace">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-56 w-full" />
        <p>Loading…</p>
      </main>
    )

  const value: Workspace = {
    courses,
    learner,
    token,
    saved,
    refresh,
    newLearner,
    switchLearner,
    async rename(name) {
      await request(
        '/api/me',
        { method: 'PATCH', body: JSON.stringify({ name }) },
        token,
      )
      if (activeToken.current === token) activate(token, { ...learner, name })
    },
    async review(classId, cardId, rating, eventId) {
      const result = await request<Pick<Learner, 'progress'>>(
        '/api/reviews',
        {
          method: 'POST',
          body: JSON.stringify({ classId, cardId, rating, eventId }),
        },
        token,
      )
      if (activeToken.current === token)
        setLearner((previous) =>
          previous ? { ...previous, progress: result.progress } : previous,
        )
    },
  }
  return <Context.Provider value={value}>{children}</Context.Provider>
}

export function useWorkspace() {
  const value = useContext(Context)
  if (!value) throw new Error('WorkspaceProvider is required')
  return value
}
