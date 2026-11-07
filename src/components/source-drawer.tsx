import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { ArrowUpRight, FileText, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer'
import { AiNotice } from '@/components/ai-notice'
import { sourcePath, type Course, type Flashcard } from '@/lib/api'

const WIDE_SCREEN = '(min-width: 640px)'

function useDrawerDirection() {
  const [wide, setWide] = useState(() => matchMedia(WIDE_SCREEN).matches)
  useEffect(() => {
    const query = matchMedia(WIDE_SCREEN)
    const update = () => setWide(query.matches)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  return wide ? 'right' : 'bottom'
}

export function SourceDrawer({
  course,
  card,
  triggerVariant = 'ghost',
}: {
  course: Course
  card: Flashcard
  triggerVariant?: 'ghost' | 'outline'
}) {
  const direction = useDrawerDirection()
  const source = course.sources.find((item) => item.file === card.source.file)
  const page = card.source.page ? `Page ${card.source.page}` : ''
  const details = [source?.type.toUpperCase(), page].filter(Boolean).join(' · ')
  return (
    <Drawer direction={direction} autoFocus>
      <DrawerTrigger asChild>
        <Button variant={triggerVariant} size="sm">
          <FileText data-icon="inline-start" />
          View source
          {card.source.page ? ` · p. ${card.source.page}` : ''}
        </Button>
      </DrawerTrigger>
      <DrawerContent className="source-drawer">
        <DrawerHeader className="source-drawer-header">
          <div>
            <DrawerTitle>{source?.name ?? card.source.file}</DrawerTitle>
            <DrawerDescription>
              {details || 'Source for this flashcard'}
            </DrawerDescription>
          </div>
          <DrawerClose asChild>
            <Button variant="ghost" size="icon" aria-label="Close source">
              <X />
            </Button>
          </DrawerClose>
        </DrawerHeader>
        <div className="source-drawer-body" data-vaul-no-drag>
          <h3>Passage behind the answer</h3>
          <blockquote className="passage" lang="de">
            {card.source.quote}
          </blockquote>
          <h3>Flashcard</h3>
          <p className="drawer-question" lang="de">
            {card.question}
          </p>
          <p className="drawer-answer" lang="de">
            {card.answer}
          </p>
          <AiNotice />
        </div>
        <DrawerFooter className="source-drawer-footer">
          <Button variant="outline" asChild>
            <Link
              to={sourcePath(course.id, card.source.file, card.id)}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open full document
              <ArrowUpRight data-icon="inline-end" />
            </Link>
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}
