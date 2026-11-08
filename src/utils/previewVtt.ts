export interface SpriteCue {
  start: number
  end: number
  url: string
  x: number
  y: number
  w: number
  h: number
}

function parseTs(s: string): number {
  const p = s.trim().split(':').map(Number)
  return p.reduce((acc, n) => acc * 60 + n, 0)
}

/** Parse a WebVTT thumbnail sprite map (`img.jpg#xywh=x,y,w,h` cues). Image URLs resolve against `baseUrl`. */
export function parseSpriteVtt(text: string, baseUrl: string): SpriteCue[] {
  const cues: SpriteCue[] = []
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*([\d:.]+)\s+-->\s+([\d:.]+)/)
    if (!m) continue
    const target = (lines[i + 1] ?? '').trim()
    const [path, frag] = target.split('#xywh=')
    const box = frag?.split(',').map(Number)
    if (!path || !box || box.length !== 4 || box.some(Number.isNaN)) continue
    cues.push({
      start: parseTs(m[1]),
      end: parseTs(m[2]),
      url: new URL(path, baseUrl).href,
      x: box[0],
      y: box[1],
      w: box[2],
      h: box[3],
    })
  }
  return cues
}

export function findSpriteCue(cues: SpriteCue[], t: number): SpriteCue | null {
  if (!cues.length) return null
  return cues.find((c) => t >= c.start && t < c.end) ?? cues[cues.length - 1]
}
