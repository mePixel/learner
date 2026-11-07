import { z } from 'zod'

export const nameSchema = z.object({ name: z.string().trim().min(1).max(60) })
export const reviewSchema = z.object({
  eventId: z.string().regex(/^[a-f0-9]{32}$/),
  classId: z.string().min(1).max(255),
  cardId: z.string().min(1).max(100),
  rating: z.enum(['again', 'known']),
})
