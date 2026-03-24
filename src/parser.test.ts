import { describe, expect, test } from 'vitest'
import { extractKittyGraphics } from './parser.ts'

// Helper to build a Kitty Graphics escape sequence
function kittySeq(controlData: string, payload: string): string {
  return `\x1b_G${controlData};${payload}\x1b\\`
}

// Small valid base64 PNG header (not a real PNG, just for testing)
const FAKE_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUg=='
const FAKE_PNG_B64_CHUNK1 = 'iVBORw0KGg'
const FAKE_PNG_B64_CHUNK2 = 'oAAAANSUhEUg=='

describe('extractKittyGraphics', () => {
  test('no escape sequences returns input unchanged', () => {
    const result = extractKittyGraphics('hello world')
    expect(result).toMatchInlineSnapshot(`
      {
        "cleanedOutput": "hello world",
        "images": [],
      }
    `)
  })

  test('empty string', () => {
    const result = extractKittyGraphics('')
    expect(result).toMatchInlineSnapshot(`
      {
        "cleanedOutput": "",
        "images": [],
      }
    `)
  })

  test('single PNG image (f=100, non-chunked)', () => {
    const input = `before${kittySeq('f=100', FAKE_PNG_B64)}after`
    const result = extractKittyGraphics(input)
    expect(result).toMatchInlineSnapshot(`
      {
        "cleanedOutput": "beforeafter",
        "images": [
          {
            "data": "iVBORw0KGgoAAAANSUhEUg==",
            "mime": "image/png",
          },
        ],
      }
    `)
  })

  test('PNG image with transmit+display action (a=T)', () => {
    const input = kittySeq('a=T,f=100', FAKE_PNG_B64)
    const result = extractKittyGraphics(input)
    expect(result).toMatchInlineSnapshot(`
      {
        "cleanedOutput": "",
        "images": [
          {
            "data": "iVBORw0KGgoAAAANSUhEUg==",
            "mime": "image/png",
          },
        ],
      }
    `)
  })

  test('PNG image with width and height', () => {
    const input = kittySeq('f=100,s=640,v=480', FAKE_PNG_B64)
    const result = extractKittyGraphics(input)
    expect(result).toMatchInlineSnapshot(`
      {
        "cleanedOutput": "",
        "images": [
          {
            "data": "iVBORw0KGgoAAAANSUhEUg==",
            "height": 480,
            "mime": "image/png",
            "width": 640,
          },
        ],
      }
    `)
  })

  test('chunked PNG image (m=1 then m=0)', () => {
    const chunk1 = kittySeq('a=T,f=100,m=1', FAKE_PNG_B64_CHUNK1)
    const chunk2 = kittySeq('m=0', FAKE_PNG_B64_CHUNK2)
    const input = `start${chunk1}${chunk2}end`
    const result = extractKittyGraphics(input)
    expect(result).toMatchInlineSnapshot(`
      {
        "cleanedOutput": "startend",
        "images": [
          {
            "data": "iVBORw0KGgoAAAANSUhEUg==",
            "mime": "image/png",
          },
        ],
      }
    `)
  })

  test('three-chunk PNG image', () => {
    const chunk1 = kittySeq('a=T,f=100,s=100,v=50,m=1', 'AAAA')
    const chunk2 = kittySeq('m=1', 'BBBB')
    const chunk3 = kittySeq('m=0', 'CCCC')
    const input = `${chunk1}${chunk2}${chunk3}`
    const result = extractKittyGraphics(input)
    expect(result).toMatchInlineSnapshot(`
      {
        "cleanedOutput": "",
        "images": [
          {
            "data": "AAAABBBBCCCC",
            "height": 50,
            "mime": "image/png",
            "width": 100,
          },
        ],
      }
    `)
  })

  test('RGBA image (f=32) is stripped but not extracted', () => {
    const input = `text${kittySeq('f=32,s=10,v=10', 'RGBA_DATA')}more`
    const result = extractKittyGraphics(input)
    expect(result).toMatchInlineSnapshot(`
      {
        "cleanedOutput": "textmore",
        "images": [],
      }
    `)
  })

  test('RGB image (f=24) is stripped but not extracted', () => {
    const input = `x${kittySeq('f=24,s=5,v=5', 'RGB_DATA')}y`
    const result = extractKittyGraphics(input)
    expect(result).toMatchInlineSnapshot(`
      {
        "cleanedOutput": "xy",
        "images": [],
      }
    `)
  })

  test('default format (no f= key, defaults to 32) is stripped but not extracted', () => {
    const input = `a${kittySeq('s=10,v=10', 'SOME_DATA')}b`
    const result = extractKittyGraphics(input)
    expect(result).toMatchInlineSnapshot(`
      {
        "cleanedOutput": "ab",
        "images": [],
      }
    `)
  })

  test('multiple images in one output', () => {
    const img1 = kittySeq('f=100', 'IMAGE_ONE')
    const img2 = kittySeq('f=100,s=200,v=100', 'IMAGE_TWO')
    const input = `first${img1}middle${img2}last`
    const result = extractKittyGraphics(input)
    expect(result).toMatchInlineSnapshot(`
      {
        "cleanedOutput": "firstmiddlelast",
        "images": [
          {
            "data": "IMAGE_ONE",
            "mime": "image/png",
          },
          {
            "data": "IMAGE_TWO",
            "height": 100,
            "mime": "image/png",
            "width": 200,
          },
        ],
      }
    `)
  })

  test('mixed PNG and non-PNG: only PNG extracted', () => {
    const pngImg = kittySeq('f=100', 'PNG_DATA')
    const rgbaImg = kittySeq('f=32,s=10,v=10', 'RGBA_DATA')
    const input = `${pngImg}between${rgbaImg}`
    const result = extractKittyGraphics(input)
    expect(result).toMatchInlineSnapshot(`
      {
        "cleanedOutput": "between",
        "images": [
          {
            "data": "PNG_DATA",
            "mime": "image/png",
          },
        ],
      }
    `)
  })

  test('file-based transmission (t=f) is stripped but not extracted', () => {
    const input = `x${kittySeq('f=100,t=f', 'L3RtcC9pbWFnZS5wbmc=')}y`
    const result = extractKittyGraphics(input)
    expect(result).toMatchInlineSnapshot(`
      {
        "cleanedOutput": "xy",
        "images": [],
      }
    `)
  })

  test('image with suppress response (q=2)', () => {
    const input = kittySeq('f=100,q=2', FAKE_PNG_B64)
    const result = extractKittyGraphics(input)
    expect(result).toMatchInlineSnapshot(`
      {
        "cleanedOutput": "",
        "images": [
          {
            "data": "iVBORw0KGgoAAAANSUhEUg==",
            "mime": "image/png",
          },
        ],
      }
    `)
  })

  test('incomplete escape sequence at end is left in output', () => {
    const input = `hello\x1b_Gf=100;${FAKE_PNG_B64}`
    const result = extractKittyGraphics(input)
    expect(result).toMatchInlineSnapshot(`
      {
        "cleanedOutput": "hello_Gf=100;iVBORw0KGgoAAAANSUhEUg==",
        "images": [],
      }
    `)
  })

  test('text with ANSI color codes is not affected', () => {
    const input = '\x1b[31mred text\x1b[0m normal'
    const result = extractKittyGraphics(input)
    expect(result).toMatchInlineSnapshot(`
      {
        "cleanedOutput": "[31mred text[0m normal",
        "images": [],
      }
    `)
  })

  test('delete command (a=d) is stripped, no image extracted', () => {
    const input = `before\x1b_Ga=d\x1b\\after`
    const result = extractKittyGraphics(input)
    expect(result).toMatchInlineSnapshot(`
      {
        "cleanedOutput": "beforeafter",
        "images": [],
      }
    `)
  })

  test('escape sequence with no payload', () => {
    const input = `x\x1b_Ga=d,d=a;\x1b\\y`
    const result = extractKittyGraphics(input)
    expect(result).toMatchInlineSnapshot(`
      {
        "cleanedOutput": "xy",
        "images": [],
      }
    `)
  })

  test('malformed chunk: m=1 followed by fresh non-chunked image aborts partial', () => {
    // First chunk starts but then a fresh non-chunked image appears
    const brokenChunk = kittySeq('a=T,f=100,m=1', 'BROKEN_START')
    const freshImage = kittySeq('f=100', 'FRESH_IMAGE')
    const input = `${brokenChunk}${freshImage}`
    const result = extractKittyGraphics(input)
    expect(result).toMatchInlineSnapshot(`
      {
        "cleanedOutput": "",
        "images": [
          {
            "data": "FRESH_IMAGE",
            "mime": "image/png",
          },
        ],
      }
    `)
  })

  test('malformed chunk: m=1 never terminated, then later valid image', () => {
    const brokenChunk = kittySeq('a=T,f=100,m=1', 'ORPHAN')
    const validImage = kittySeq('a=T,f=100', 'VALID_IMAGE')
    const input = `before${brokenChunk}middle${validImage}after`
    const result = extractKittyGraphics(input)
    expect(result).toMatchInlineSnapshot(`
      {
        "cleanedOutput": "beforemiddleafter",
        "images": [
          {
            "data": "VALID_IMAGE",
            "mime": "image/png",
          },
        ],
      }
    `)
  })

  test('malformed chunk: m=1 then m=1 with fresh control keys resets', () => {
    // Two m=1 chunks but second has fresh f= key — should abort first, start new
    const chunk1 = kittySeq('a=T,f=100,m=1', 'FIRST')
    const chunk2 = kittySeq('f=100,m=1', 'SECOND')
    const chunk3 = kittySeq('m=0', 'THIRD')
    const input = `${chunk1}${chunk2}${chunk3}`
    const result = extractKittyGraphics(input)
    expect(result).toMatchInlineSnapshot(`
      {
        "cleanedOutput": "",
        "images": [
          {
            "data": "SECONDTHIRD",
            "mime": "image/png",
          },
        ],
      }
    `)
  })

  test('real-world: text with command output mixed with kitty image', () => {
    const lines = [
      '$ kitten icat image.png',
      kittySeq('a=T,f=100,q=2,m=1', FAKE_PNG_B64_CHUNK1),
      kittySeq('m=0', FAKE_PNG_B64_CHUNK2),
      '$ echo done',
      'done',
    ].join('\n')
    const result = extractKittyGraphics(lines)
    expect(result.cleanedOutput).toMatchInlineSnapshot(`
      "$ kitten icat image.png


      $ echo done
      done"
    `)
    expect(result.images).toMatchInlineSnapshot(`
      [
        {
          "data": "iVBORw0KGgoAAAANSUhEUg==",
          "mime": "image/png",
        },
      ]
    `)
  })
})
