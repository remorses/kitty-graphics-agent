// Pure parser for Kitty Graphics Protocol (APC) escape sequences in strings.
// Extracts base64 image payloads from terminal output and returns cleaned text.
//
// Kitty Graphics Protocol format:
//   \x1b_G<control_data>;<payload>\x1b\\
//
// Where:
//   - \x1b_G is the APC (Application Program Command) start + 'G' for graphics
//   - control_data is comma-separated key=value pairs (e.g. f=100,m=1,a=T)
//   - ; separates control data from the base64-encoded payload
//   - \x1b\\ is the ST (String Terminator)
//
// Chunked transmission:
//   Large images are split across multiple escape sequences. The first chunk
//   has full control data + m=1, continuation chunks have only m=1, and the
//   last chunk has m=0. We reassemble all chunks into a single payload.
//
// Supported for extraction (v1):
//   - f=100 (PNG) — most common from CLIs
//   - Direct transmission only (t=d or no t key, which is the default)
//   - All other escape sequences are stripped but their payloads are ignored
//
// Uses a scanner (no regex) for correctness and performance with binary data.

// ESC character
const ESC = '\x1b'
// APC start for kitty graphics: ESC _ G
const APC_START = `${ESC}_G`
// String Terminator: ESC \
const ST = `${ESC}\\`

export type ExtractedImage = {
  /** MIME type derived from the format key (e.g. "image/png") */
  mime: string
  /** Reassembled base64 payload */
  data: string
  /** Image width in pixels from s= key, if provided */
  width?: number
  /** Image height in pixels from v= key, if provided */
  height?: number
}

export type ParseResult = {
  /** Output with all Kitty Graphics escape sequences removed */
  cleanedOutput: string
  /** Extracted images (only PNG/direct-transmission for now) */
  images: ExtractedImage[]
}

type ControlData = {
  /** f= format: 24 (RGB), 32 (RGBA, default), 100 (PNG) */
  format: number
  /** m= more chunks: 0 means last/only, 1 means more follow */
  more: number
  /** a= action: t (transmit), T (transmit+display), etc. */
  action: string
  /** s= width in pixels */
  width: number
  /** v= height in pixels */
  height: number
  /** t= transmission medium: d (direct, default) */
  medium: string
  /** i= image ID */
  imageId: number
}

/** State for reassembling a chunked image across multiple escape sequences */
type ChunkedState = {
  controlData: ControlData
  payloadChunks: string[]
}

function parseControlData(raw: string): ControlData {
  const result: ControlData = {
    format: 32,
    more: 0,
    action: '',
    width: 0,
    height: 0,
    medium: 'd',
    imageId: 0,
  }

  // Parse comma-separated key=value pairs using indexOf scanning
  let start = 0
  const len = raw.length
  while (start < len) {
    let commaIdx = raw.indexOf(',', start)
    if (commaIdx === -1) {
      commaIdx = len
    }
    const pair = raw.substring(start, commaIdx)
    const eqIdx = pair.indexOf('=')
    if (eqIdx !== -1) {
      const key = pair.substring(0, eqIdx)
      const value = pair.substring(eqIdx + 1)
      switch (key) {
        case 'f':
          result.format = parseInt(value, 10) || 32
          break
        case 'm':
          result.more = parseInt(value, 10) || 0
          break
        case 'a':
          result.action = value
          break
        case 's':
          result.width = parseInt(value, 10) || 0
          break
        case 'v':
          result.height = parseInt(value, 10) || 0
          break
        case 't':
          result.medium = value
          break
        case 'i':
          result.imageId = parseInt(value, 10) || 0
          break
      }
    }
    start = commaIdx + 1
  }

  return result
}

function formatToMime(format: number): string | undefined {
  switch (format) {
    case 100:
      return 'image/png'
    // v1: only PNG extraction is supported. RGB/RGBA would need conversion.
    default:
      return undefined
  }
}

/**
 * Scan a string for Kitty Graphics Protocol escape sequences.
 * Returns each sequence's position and parsed contents.
 */
function scanSequences(
  output: string,
): Array<{
  /** Start index of the escape sequence in the original string */
  start: number
  /** End index (exclusive) of the escape sequence */
  end: number
  /** Parsed control data */
  controlData: ControlData
  /** Base64 payload (may be one chunk of a multi-chunk image) */
  payload: string
}> {
  const sequences: Array<{
    start: number
    end: number
    controlData: ControlData
    payload: string
  }> = []

  let pos = 0
  const len = output.length

  while (pos < len) {
    // Find next APC start: \x1b_G
    const apcIdx = output.indexOf(APC_START, pos)
    if (apcIdx === -1) {
      break
    }

    // Find the ST terminator: \x1b\
    const stIdx = output.indexOf(ST, apcIdx + 3)
    if (stIdx === -1) {
      // Incomplete sequence at end of output, skip past the APC start
      break
    }

    // Extract the content between \x1b_G and \x1b\
    const content = output.substring(apcIdx + 3, stIdx)

    // Split on first ';' to separate control data from payload
    const semicolonIdx = content.indexOf(';')
    let controlRaw: string
    let payload: string
    if (semicolonIdx === -1) {
      controlRaw = content
      payload = ''
    } else {
      controlRaw = content.substring(0, semicolonIdx)
      payload = content.substring(semicolonIdx + 1)
    }

    const controlData = parseControlData(controlRaw)

    sequences.push({
      start: apcIdx,
      end: stIdx + ST.length,
      controlData,
      payload,
    })

    pos = stIdx + ST.length
  }

  return sequences
}

/**
 * Extract Kitty Graphics Protocol images from a string and return the
 * cleaned output with all graphics escape sequences removed.
 *
 * Only PNG images transmitted directly (t=d, f=100) are extracted.
 * All Kitty Graphics escape sequences are stripped regardless of format.
 */
export function extractKittyGraphics(output: string): ParseResult {
  // Fast bail: if no ESC_G in the string, nothing to do
  if (!output.includes(APC_START)) {
    return { cleanedOutput: output, images: [] }
  }

  const sequences = scanSequences(output)
  if (sequences.length === 0) {
    return { cleanedOutput: output, images: [] }
  }

  const images: ExtractedImage[] = []

  // Track chunked image state (only one chunked transfer can be active at a
  // time per the spec: "client must finish sending all chunks for a single
  // image before sending any other graphics related escape codes")
  let chunked: ChunkedState | undefined

  for (const seq of sequences) {
    const { controlData, payload } = seq

    if (chunked) {
      // We're in a chunked transfer — accumulate payload
      chunked.payloadChunks.push(payload)

      if (controlData.more === 0) {
        // Last chunk: finalize the image
        const mime = formatToMime(chunked.controlData.format)
        if (mime && chunked.controlData.medium === 'd') {
          const image: ExtractedImage = {
            mime,
            data: chunked.payloadChunks.join(''),
          }
          if (chunked.controlData.width > 0) {
            image.width = chunked.controlData.width
          }
          if (chunked.controlData.height > 0) {
            image.height = chunked.controlData.height
          }
          images.push(image)
        }
        chunked = undefined
      }
    } else if (controlData.more === 1) {
      // First chunk of a new chunked transfer
      chunked = {
        controlData,
        payloadChunks: [payload],
      }
    } else {
      // Single (non-chunked) image
      const mime = formatToMime(controlData.format)
      if (mime && controlData.medium === 'd') {
        const image: ExtractedImage = {
          mime,
          data: payload,
        }
        if (controlData.width > 0) {
          image.width = controlData.width
        }
        if (controlData.height > 0) {
          image.height = controlData.height
        }
        images.push(image)
      }
    }
  }

  // Build cleaned output by removing all escape sequences
  const parts: string[] = []
  let lastEnd = 0
  for (const seq of sequences) {
    if (seq.start > lastEnd) {
      parts.push(output.substring(lastEnd, seq.start))
    }
    lastEnd = seq.end
  }
  if (lastEnd < output.length) {
    parts.push(output.substring(lastEnd))
  }
  const cleanedOutput = parts.join('')

  return { cleanedOutput, images }
}
