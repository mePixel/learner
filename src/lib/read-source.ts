import { originalPath, request, type Course, type Source } from './api'
import { readableSource, type SourceDocument } from './source-chat'

export async function readSource(
  course: Course,
  selected: Source,
  signal: AbortSignal,
): Promise<SourceDocument> {
  const source = readableSource(course, selected)
  if (!source)
    throw new Error(
      `No readable transcript is available for ${selected.name}. Choose another source.`,
    )
  const url = originalPath(course.id, source.file)
  if (source.type !== 'pdf') {
    const { text } = await request<{ text: string }>(`${url}&preview=1`, {
      signal,
    })
    if (!text.trim())
      throw new Error(
        `${source.name} has no readable text. Choose another source.`,
      )
    return { file: source.file, name: source.name, pages: [{ text }] }
  }
  const response = await fetch(url, { signal, credentials: 'omit' })
  if (!response.ok)
    throw new Error(
      `Could not read ${source.name}. Try again or choose another source.`,
    )
  const data = new Uint8Array(await response.arrayBuffer())
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = (
    await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
  ).default
  const task = pdfjs.getDocument({ data, useWorkerFetch: false })
  const cancel = () => {
    void task.destroy()
  }
  signal.addEventListener('abort', cancel, { once: true })
  try {
    signal.throwIfAborted()
    const pdf = await task.promise
    const pages = []
    for (let page = 1; page <= pdf.numPages; page++) {
      signal.throwIfAborted()
      const text = await (await pdf.getPage(page)).getTextContent()
      pages.push({
        page,
        text: text.items
          .map((item) =>
            'str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '',
          )
          .join(''),
      })
    }
    if (!pages.some(({ text }) => text.trim()))
      throw new Error(
        `${source.name} has no extractable text. Add an OCR or text version and select it instead.`,
      )
    return { file: source.file, name: source.name, pages }
  } catch (error) {
    if (signal.aborted) throw new DOMException('Stopped', 'AbortError')
    if (
      error instanceof Error &&
      error.message.includes('has no extractable text')
    )
      throw error
    throw new Error(
      `Could not extract text from ${source.name}. Check that it is not scanned or password-protected, or choose another source.`,
    )
  } finally {
    signal.removeEventListener('abort', cancel)
    await task.destroy()
  }
}
