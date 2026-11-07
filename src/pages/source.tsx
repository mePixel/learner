import { useEffect, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { ArrowLeft, ArrowUpRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Skeleton } from '@/components/ui/skeleton'
import { AiNotice } from '@/components/ai-notice'
import { useWorkspace } from '@/lib/workspace'
import { askPath, coursePath, originalPath, request } from '@/lib/api'
import { NotFound } from './workspace'

const normalize = (text: string) => text.replace(/\s+/g, ' ').trim()

export function SourcePage() {
  const { classId } = useParams()
  const [search] = useSearchParams()
  const { courses } = useWorkspace()
  const course = courses.find((item) => item.id === classId)
  const source = course?.sources.find(
    (item) => item.file === search.get('file'),
  )
  const card = course?.cards.find(
    (item) =>
      item.id === search.get('card') && item.source.file === source?.file,
  )
  const [text, setText] = useState<string>()
  const [error, setError] = useState('')
  const highlight = useRef<HTMLElement>(null)
  const isText = source && ['txt', 'md', 'docx'].includes(source.type)
  const original = course && source ? originalPath(course.id, source.file) : ''
  useEffect(() => {
    setText(undefined)
    setError('')
    const controller = new AbortController()
    if (isText)
      request<{ text: string }>(`${original}&preview=1`, {
        signal: controller.signal,
      })
        .then((result) => setText(result.text))
        .catch((err) => {
          if (err.name !== 'AbortError') setError(err.message)
        })
    return () => controller.abort()
  }, [original, isText])
  useEffect(() => {
    if (text && card)
      highlight.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      })
  }, [text, card?.id])
  if (!course || !source) return <NotFound />
  const fullOriginal =
    original + (card?.source.page ? `#page=${card.source.page}` : '')
  const paragraphs = text?.split(/\n\s*\n/).filter(Boolean)
  const quote = card ? normalize(card.source.quote) : ''
  const matchingParagraph = paragraphs?.findIndex((paragraph) =>
    normalize(paragraph).includes(quote),
  )
  return (
    <div className="source-page">
      <Link className="back-link" to={coursePath(course.id)}>
        <ArrowLeft aria-hidden="true" />
        {course.title}
      </Link>
      <div className="page-heading page-heading-action">
        <div>
          <h1 className="source-title">{source.name}</h1>
          <p>
            {source.type.toUpperCase()}
            {card?.source.page ? ` · Page ${card.source.page}` : ''}
          </p>
        </div>
        <div className="source-page-actions">
          <Button asChild>
            <Link to={askPath(course.id, source.file)}>
              Ask about this source
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <a href={fullOriginal} target="_blank" rel="noopener noreferrer">
              Open original
              <ArrowUpRight data-icon="inline-end" />
            </a>
          </Button>
        </div>
      </div>
      {card && (
        <aside className="source-evidence">
          <h2>Passage behind the answer</h2>
          <p className="drawer-question" lang="de">
            {card.question}
          </p>
          <blockquote className="passage" lang="de">
            {card.source.quote}
          </blockquote>
          <AiNotice />
        </aside>
      )}
      {error && (
        <Alert variant="destructive">
          <AlertTitle>Preview unavailable</AlertTitle>
          <AlertDescription>
            {error} You can still open the original file above.
          </AlertDescription>
        </Alert>
      )}
      {isText && !error && (
        <article className="document-reader" lang="de">
          {text === undefined ? (
            <>
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-48 w-full" />
            </>
          ) : (
            paragraphs?.map((paragraph, index) => {
              const isMatch = Boolean(quote && index === matchingParagraph)
              return (
                <p
                  className={isMatch ? 'highlighted-passage' : undefined}
                  key={index}
                  ref={
                    isMatch
                      ? (element) => {
                          highlight.current = element
                        }
                      : undefined
                  }
                >
                  {isMatch ? <mark>{paragraph}</mark> : paragraph}
                </p>
              )
            })
          )}
        </article>
      )}
      {source.type === 'pdf' && (
        <>
          <p className="touch-hint pdf-mobile-note">
            On a phone, “Open original” may give you a better PDF view.
            {card?.source.page ? ` Go to page ${card.source.page}.` : ''}
          </p>
          <iframe
            className="pdf-reader"
            src={fullOriginal}
            title={`${source.name}${card?.source.page ? `, page ${card.source.page}` : ''}`}
          />
        </>
      )}
      {['mp4', 'webm'].includes(source.type) && (
        <video
          className="video-reader"
          controls
          preload="metadata"
          src={original}
        >
          <a href={original}>Download video</a>
        </video>
      )}
    </div>
  )
}
