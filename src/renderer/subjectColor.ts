// Fixed order: adding/removing other events must never change a subject's ink.
const inks = ['#39776c', '#4f6d8b', '#8a6651', '#7b638f', '#8b743b', '#58784f', '#966274', '#577f89', '#866b8b', '#8f654b', '#64794b', '#5d6e91']

export function subjectKey(title: string): string {
  const normalized = title.normalize('NFKC').trim()
  const course = normalized.match(/\b([a-z]{2,8})[\s_-]*(\d{3,5})\b/i)
  return course ? (course[1] + course[2]).toUpperCase() : normalized.split(/\s+·\s+/)[0].replace(/\s+/g, ' ').toLowerCase()
}

export function subjectColor(title: string): string {
  let hash = 2166136261
  for (const char of subjectKey(title)) hash = Math.imul(hash ^ char.codePointAt(0)!, 16777619) >>> 0
  return inks[hash % inks.length]
}
