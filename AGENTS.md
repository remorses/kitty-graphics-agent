# kitty-graphics-agent

OpenCode plugin that intercepts Kitty Graphics Protocol images from bash tool
output and injects them into LLM context as image attachments.

## Key references

**Kitty Graphics Protocol spec:**
https://sw.kovidgoyal.net/kitty/graphics-protocol/

**OpenCode plugin docs:**
https://opencode.ai/docs/plugins

**OpenCode plugin SDK types:**
- `node_modules/@opencode-ai/plugin/dist/index.d.ts` — Plugin type, hooks
- `node_modules/@opencode-ai/plugin/dist/tool.d.ts` — tool helper
- `node_modules/@opencode-ai/plugin/dist/shell.d.ts` — shell.env hook types

Also available at: `/Users/morse/.cache/opencode/node_modules/@opencode-ai/plugin/dist/`

**OpenCode prompt.ts (how tool results flow):**
`opensrc/repos/github.com/anomalyco/opencode/packages/opencode/src/session/prompt.ts`

Lines 816-835: built-in tool execution, attachment mapping, then
`tool.execute.after` hook fires. Plugin-added attachments must include
`id` (prt_ prefix), `sessionID`, `messageID` (msg_ prefix) because
opencode maps these BEFORE the hook.

**OpenCode message-v2.ts (how attachments become LLM media parts):**
`opensrc/repos/github.com/anomalyco/opencode/packages/opencode/src/session/message-v2.ts`

Lines 597-614: tool result attachments are converted to `{ type: "media" }`
parts. Lines 575-585: for providers that don't support media in tool
results, attachments are extracted as separate user messages.

## Architecture

```
src/
  constants.ts  — AGENT_GRAPHICS env var name and value
  parser.ts     — Pure scanner for Kitty Graphics APC escape sequences (no regex)
  plugin.ts     — OpenCode plugin: shell.env + tool.execute.after hooks
  index.ts      — Re-exports everything
```

## Escape sequence format

```
\x1b_G<control_data>;<base64_payload>\x1b\\
```

- `\x1b_G` — APC start + 'G' for graphics
- control_data — comma-separated key=value (f=100, m=1, a=T, s=width, v=height)
- `;` — separates control data from payload
- `\x1b\\` — String Terminator

Key fields: `f` (format: 100=PNG, 24=RGB, 32=RGBA), `m` (0=last chunk, 1=more),
`t` (medium: d=direct), `s`/`v` (width/height pixels).

Chunked: first chunk has full control + m=1, continuations have only m=1,
last has m=0. Only one chunked transfer at a time per spec.

## What we extract

Only PNG (f=100) with direct transmission (t=d). RGB/RGBA stripped but not
extracted (would need pixel-to-PNG conversion). All escape sequences are
always stripped from the output text.
