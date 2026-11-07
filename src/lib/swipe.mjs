const SWIPE_DISTANCE = 60

/** @param {number} deltaX @param {number} deltaY @returns {boolean} */
function isHorizontal(deltaX, deltaY) {
  return Math.abs(deltaX) > Math.abs(deltaY) * 1.4
}

/** @param {number} deltaX @param {number} deltaY @returns {'again' | 'known' | null} */
export function swipeRating(deltaX, deltaY) {
  if (Math.abs(deltaX) < SWIPE_DISTANCE || !isHorizontal(deltaX, deltaY))
    return null
  return deltaX > 0 ? 'known' : 'again'
}

/**
 * How close a drag is to committing, from 0 to 1.
 * @param {number} deltaX @param {number} deltaY @returns {number}
 */
export function swipeProgress(deltaX, deltaY) {
  if (!isHorizontal(deltaX, deltaY)) return 0
  return Math.min(1, Math.abs(deltaX) / SWIPE_DISTANCE)
}
