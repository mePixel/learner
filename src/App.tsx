import { lazy, Suspense, useEffect } from 'react'
import {
  Link,
  Navigate,
  NavLink,
  Route,
  Routes,
  useLocation,
} from 'react-router'
import { FileText, Home, Link2, MessageSquare } from 'lucide-react'
import { useWorkspace } from '@/lib/workspace'
import { cn } from '@/lib/utils'
import {
  Overview,
  CoursePage,
  SourcesPage,
  LearningLink,
  NotFound,
} from '@/pages/workspace'
import { StudyPage } from '@/pages/study'
import { SourcePage } from '@/pages/source'

const AskPage = lazy(() => import('@/pages/ask'))

const navigation = [
  { to: '/', label: 'Overview', short: 'Home', icon: Home },
  { to: '/sources', label: 'Sources', short: 'Sources', icon: FileText },
  {
    to: '/ask',
    label: 'Ask your sources',
    short: 'Ask AI',
    icon: MessageSquare,
  },
  { to: '/link', label: 'My learning link', short: 'My link', icon: Link2 },
]

function Logo() {
  return (
    <Link className="brand" to="/">
      Recall
    </Link>
  )
}

export function App() {
  const { learner } = useWorkspace()
  const location = useLocation()
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' })
  }, [location.pathname])
  // Class pages live under Overview, so it stays highlighted on them.
  const isActive = (to: string, matched: boolean) =>
    matched || (to === '/' && location.pathname.startsWith('/classes'))
  return (
    <div
      className="app-shell"
      data-studying={location.pathname.endsWith('/study')}
    >
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <aside className="sidebar">
        <Logo />
        <nav className="desktop-nav" aria-label="Main navigation">
          {navigation.map(({ to, label, icon: Icon }) => (
            <NavLink
              end={to === '/'}
              key={to}
              to={to}
              className={({ isActive: matched }) =>
                cn('nav-item', isActive(to, matched) && 'active')
              }
            >
              <Icon aria-hidden="true" />
              {label}
            </NavLink>
          ))}
        </nav>
        <Link className="profile-link" to="/link">
          <span className="avatar">
            {learner.name.slice(0, 1).toUpperCase()}
          </span>
          <strong>{learner.name}</strong>
        </Link>
      </aside>
      <header className="mobile-header">
        <Logo />
        <Link
          to="/link"
          className="avatar"
          aria-label={`Learning link for ${learner.name}`}
        >
          {learner.name.slice(0, 1).toUpperCase()}
        </Link>
      </header>
      <div className="workspace-shell">
        <main id="main" className="main-content">
          <Routes>
            <Route path="/" element={<Overview />} />
            <Route path="/classes" element={<Navigate to="/" replace />} />
            <Route path="/classes/:classId" element={<CoursePage />} />
            <Route path="/classes/:classId/study" element={<StudyPage />} />
            <Route path="/classes/:classId/source" element={<SourcePage />} />
            <Route path="/sources" element={<SourcesPage />} />
            <Route
              path="/ask"
              element={
                <Suspense fallback={<p role="status">Loading source chat…</p>}>
                  <AskPage />
                </Suspense>
              }
            />
            <Route path="/link" element={<LearningLink />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </main>
      </div>
      <nav className="mobile-nav" aria-label="Mobile navigation">
        {navigation.map(({ to, short, icon: Icon }) => (
          <NavLink
            end={to === '/'}
            key={to}
            to={to}
            className={({ isActive: matched }) =>
              cn('mobile-nav-item', isActive(to, matched) && 'active')
            }
          >
            <Icon aria-hidden="true" />
            <span>{short}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
