import { describe, expect, it } from 'vitest'
import { requestDetailIntent, takeDetailIntent } from './intent'

describe('detail intent', () => {
  it('is taken once, and only by the matching media', () => {
    requestDetailIntent({ mediaId: '52991', selectEpisodes: true })
    expect(takeDetailIntent('21')).toBeNull()
    expect(takeDetailIntent('52991')).toEqual({ mediaId: '52991', selectEpisodes: true })
    expect(takeDetailIntent('52991')).toBeNull()
  })
})
