import { describe, expect, it } from 'vitest'
import { subjectColor, subjectKey } from '../src/renderer/subjectColor'

describe('fixed subject colors', () => {
  it('keeps course identity across case, spacing, deadlines and lecture sections', () => {
    expect(subjectKey('ＲＥＣＯ６０２２ 作业 · 11/13')).toBe('RECO6022')
    const titles = ['RECO6022 作业 · 11/13、11/30', 'reco 6022 网课', 'RECO6022-1A (LEC)', 'RECO6022 作业 · 12/15']
    expect(new Set(titles.map(subjectColor))).toEqual(new Set(['#8b743b']))
  })
  it('retains the established distinct inks for the four current courses', () => {
    expect(['RECO6022', 'RECO7097', 'GRSC6108', 'URBP8002'].map(subjectColor)).toEqual(['#8b743b', '#58784f', '#5d6e91', '#966274'])
  })
  it('normalizes fallback subjects without using dates, order or random identifiers', () => {
    expect(subjectKey('  HKU   Innovation · 10/13–10/14 ')).toBe('hku innovation')
    expect(subjectColor('HKU Innovation · 10/13–10/14')).toBe(subjectColor('hku innovation · 11/20'))
    expect(subjectColor('毕业报告')).toMatch(/^#[0-9a-f]{6}$/)
  })
})
