// OpenCode plugin that intercepts bash tool output to extract Kitty Graphics
// Protocol images and inject them as LLM-visible attachments.
//
// Any CLI that renders images using the Kitty Graphics Protocol (kitten icat,
// chafa, timg, viu, etc.) will have its images automatically extracted from
// the bash output and passed to the model as image parts — no extra tool call
// needed by the CLI.
//
// How it works:
//   1. shell.env injects AGENT_GRAPHICS=kitty into bash environment so CLIs
//      know they can emit Kitty Graphics even on a non-TTY stdout
//   2. tool.execute.after fires for the bash tool
//   3. We parse the output for \x1b_G<control>;<base64>\x1b\ sequences
//   4. Strip the escape sequences from the text output
//   5. Add extracted PNG images as FilePart attachments on the tool result
//   6. OpenCode's message-v2.ts converts these attachments into media parts
//      sent to the LLM (with provider-specific handling for tool results)
//
// Only PNG images (f=100) transmitted directly (t=d) are extracted. Other
// formats (RGB/RGBA raw pixels) would need conversion and are stripped but
// not extracted in this version.

import crypto from 'node:crypto'
import type { Plugin } from '@opencode-ai/plugin'
import { AGENT_GRAPHICS_ENV, AGENT_GRAPHICS_VALUE } from './constants.ts'
import { extractKittyGraphics } from './parser.ts'

// The APC start sequence for Kitty Graphics — used as a fast bail check
const APC_START = '\x1b_G'

// Generate an opencode-compatible part ID (prt_ + hex timestamp + random).
// opencode maps attachments with id/sessionID/messageID before the hook
// fires, so plugin-added attachments must include these fields to satisfy
// the part state schema validation.
let idCounter = 0
function generateId(prefix: string): string {
  const now = BigInt(Date.now()) * BigInt(0x1000) + BigInt(++idCounter)
  const buf = Buffer.alloc(6)
  for (let i = 0; i < 6; i++) {
    buf[i] = Number((now >> BigInt(40 - 8 * i)) & BigInt(0xff))
  }
  return prefix + '_' + buf.toString('hex') + crypto.randomBytes(7).toString('hex')
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const kittyGraphicsPlugin: any = async () => {
  return {
    'shell.env': async (
      _input: { cwd: string; sessionID?: string; callID?: string },
      output: { env: Record<string, string> },
    ) => {
      output.env[AGENT_GRAPHICS_ENV] = AGENT_GRAPHICS_VALUE
    },

    'tool.execute.after': async (
      input: { tool: string; sessionID: string; callID: string; args: unknown },
      output: {
        title: string
        output: string
        metadata: unknown
        // attachments is not in the Plugin type declaration but exists at
        // runtime on the result object — opencode's prompt.ts reads it after
        // the hook fires to populate tool part attachments for the LLM
        attachments?: Array<{
          type: 'file'
          mime: string
          url: string
          filename?: string
        }>
      },
    ) => {
      if (input.tool !== 'bash') {
        return
      }
      // Skip if already processed by another instance of this plugin
      // (e.g. loaded from both global and project config). The APC_START
      // check alone would also catch this since we strip all sequences,
      // but an explicit marker is more robust if the output gets cloned.
      const meta = output.metadata as
        | (Record<string, unknown> & { output?: string })
        | undefined
      if (meta?.['__kittyGraphicsProcessed']) {
        return
      }
      if (!output.output.includes(APC_START)) {
        return
      }

      const result = extractKittyGraphics(output.output)
      if (meta) {
        meta['__kittyGraphicsProcessed'] = true
      }

      // Always strip escape sequences from the output text
      output.output = result.cleanedOutput

      // Also strip from metadata.output if it exists (shown in Discord
      // during tool execution as a live preview)
      if (meta?.output && meta.output.includes(APC_START)) {
        const metaResult = extractKittyGraphics(meta.output)
        meta.output = metaResult.cleanedOutput
      }

      if (result.images.length > 0) {
        // Each attachment needs id/sessionID/messageID to satisfy opencode's
        // part state schema. opencode normally adds these when mapping
        // tool result attachments (prompt.ts line 818-823), but that mapping
        // runs before tool.execute.after — so plugin-added attachments must
        // include them manually. We generate a msg_-prefixed messageID since
        // the actual assistant message ID isn't available in the hook.
        const attachments = result.images.map((img) => ({
          type: 'file' as const,
          mime: img.mime,
          url: `data:${img.mime};base64,${img.data}`,
          id: generateId('prt'),
          sessionID: input.sessionID,
          messageID: generateId('msg'),
        }))

        // Append to existing attachments if any, otherwise create the array
        if (output.attachments) {
          output.attachments.push(...attachments)
        } else {
          output.attachments = attachments
        }
      }
    },
  }
}

export { kittyGraphicsPlugin }
