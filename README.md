# kitty-graphics-agent

CLIs can't pass images to LLMs without an extra tool call. This specification fixes that.

## OpenCode plugin

Add `kitty-graphics-agent` to your `opencode.json`:

```json
{
  "plugin": ["kitty-graphics-agent"]
}
```

That's it. OpenCode installs the package automatically at startup. Any CLI that emits [Kitty Graphics Protocol](https://sw.kovidgoyal.net/kitty/graphics-protocol/) images will have them extracted and passed to the model — no file writing, no extra tool calls.

The plugin:
1. Sets `AGENT_GRAPHICS=kitty` in the shell environment so CLIs know they can emit images
2. Intercepts bash tool output, strips escape sequences, extracts PNG images
3. Injects images as attachments on the tool result — the LLM sees them as media parts

## The problem

When an AI coding agent runs a CLI tool via its bash/shell tool, the tool's stdout is captured as plain text and fed back to the model. If that CLI generates an image (a chart, a screenshot, a diagram), there's no standard way to get that image into the LLM's context. Today you have to:

1. Write the image to a file
2. Hope the agent calls a separate `read` tool on that file
3. Hope the agent knows the file contains an image

This is two extra round trips and requires the agent to know about your CLI's file output convention. Most of the time the image just gets lost.

MCP solves this for tool servers, but not for plain CLI tools that just print to stdout.

## The solution

Use the [Kitty Graphics Protocol](https://sw.kovidgoyal.net/kitty/graphics-protocol/) — an existing standard for rendering images in terminals. CLIs emit escape sequences containing base64-encoded image data to stdout. An agent plugin intercepts these sequences, strips them from the text output, and injects the images as attachments that the LLM can see.

No new protocol. No file writing. No extra tool calls. Just print to stdout.

```
CLI prints image            Agent intercepts              LLM sees image
via Kitty Graphics    ->    bash tool output        ->    as a media part
escape sequences            strips escapes,               in its context
to stdout                   extracts base64 PNG           window
```

## The `AGENT_GRAPHICS` environment variable

CLIs normally only emit Kitty Graphics when stdout is a TTY connected to a supported terminal. Since agent tool execution pipes stdout, CLIs need a signal that an agent is listening.

This package defines `AGENT_GRAPHICS` — an environment variable that agents set to tell CLIs they can emit graphics:

```bash
AGENT_GRAPHICS=kitty
```

**For CLI authors**: check this env var before emitting Kitty Graphics on a non-TTY stdout:

```ts
const canEmitGraphics =
  process.stdout.isTTY ||
  process.env.AGENT_GRAPHICS?.includes('kitty')

if (canEmitGraphics) {
  // emit Kitty Graphics Protocol escape sequences
  process.stdout.write('\x1b_Ga=T,f=100;' + pngBase64 + '\x1b\\')
}
```

```python
import os, sys

can_emit = sys.stdout.isatty() or 'kitty' in os.environ.get('AGENT_GRAPHICS', '')

if can_emit:
    sys.stdout.write(f'\x1b_Ga=T,f=100;{png_base64}\x1b\\')
```

```go
canEmit := term.IsTerminal(int(os.Stdout.Fd())) ||
    strings.Contains(os.Getenv("AGENT_GRAPHICS"), "kitty")
```

The value is extensible. Future protocols can be comma-separated: `AGENT_GRAPHICS=kitty,iterm2`.

## How it works

The Kitty Graphics Protocol encodes images as APC (Application Program Command) escape sequences:

```
\x1b_G<control_data>;<base64_payload>\x1b\\
```

Where:
- `\x1b_G` starts the graphics command
- Control data is comma-separated `key=value` pairs (e.g. `f=100,a=T`)
- `;` separates control data from the base64-encoded image payload
- `\x1b\\` terminates the sequence

Key control data fields:

| Key | Values | Description |
|-----|--------|-------------|
| `f` | `100` (PNG), `24` (RGB), `32` (RGBA) | Image format |
| `m` | `0` (last/only chunk), `1` (more chunks) | Chunked transfer |
| `a` | `T` (transmit+display), `t` (transmit) | Action |
| `s` | positive integer | Width in pixels |
| `v` | positive integer | Height in pixels |
| `t` | `d` (direct, default) | Transmission medium |

Large images are split across multiple escape sequences using chunked transfer (`m=1` for continuation chunks, `m=0` for the last chunk).

This package parses these sequences from bash tool output using a fast scanner (no regex), reassembles chunked transfers, and extracts the base64 image data.

## Supported formats

| Format | Extracted | Stripped from output |
|--------|-----------|---------------------|
| PNG (`f=100`) | Yes | Yes |
| RGBA (`f=32`) | No (needs conversion) | Yes |
| RGB (`f=24`) | No (needs conversion) | Yes |

Only direct transmission (`t=d`) is supported. File-based and shared memory transmission are stripped but not extracted.

## Parser library

You can also use the parser standalone in any Node.js/Bun project:

```bash
npm install kitty-graphics-agent
```

```ts
import { extractKittyGraphics } from 'kitty-graphics-agent/parser'

const result = extractKittyGraphics(bashOutput)

// result.cleanedOutput — text with escape sequences removed
// result.images — array of { mime, data, width?, height? }

for (const image of result.images) {
  console.log(image.mime)  // "image/png"
  console.log(image.data)  // base64-encoded PNG data
}
```

## Who should adopt `AGENT_GRAPHICS`

**CLI tool authors** — if your tool generates images (charts, screenshots, plots, diagrams), check `AGENT_GRAPHICS` and emit Kitty Graphics when it's set. Your tool will automatically work with any agent that supports this spec.

**Agent/framework authors** — set `AGENT_GRAPHICS=kitty` in the shell environment and parse Kitty Graphics from tool output. Use this package or implement your own parser following the spec above.

**Tools that already support Kitty Graphics** — chafa, timg, viu, kitten icat, matplotlib (with kitty backend), plotly, and many others. These tools already emit the right escape sequences — they just need to check `AGENT_GRAPHICS` to know they can do it on non-TTY stdout.

## License

MIT
