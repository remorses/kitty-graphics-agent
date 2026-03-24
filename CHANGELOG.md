## 0.0.3

1. **Fixed messageID prefix validation** — `messageID` now uses the correct `msg_` prefix instead of reusing the tool `callID`. Resolves `must start with "msg"` schema errors.

## 0.0.2

1. **Fixed schema validation errors** — plugin-added attachments now include `id`, `sessionID`, and `messageID` fields required by opencode's part state schema. Previously these were missing because opencode maps them before the `tool.execute.after` hook fires.

## 0.0.1

1. **Initial release** — intercept Kitty Graphics Protocol images from CLI bash output and inject them into LLM context automatically.

   Add to your `opencode.json` and any CLI that emits Kitty Graphics will have its images passed to the model:

   ```json
   {
     "plugin": ["kitty-graphics-agent"]
   }
   ```

2. **`AGENT_GRAPHICS=kitty` env var** — injected into every shell session so CLIs know they can emit Kitty Graphics even when stdout is not a TTY. Check it in your CLI:

   ```ts
   const canEmit = process.stdout.isTTY || process.env.AGENT_GRAPHICS?.includes('kitty')
   ```

3. **`extractKittyGraphics` parser** — standalone parser for use outside OpenCode. Scans bash output for `\x1b_G...\x1b\\` sequences, strips them from text, and returns extracted PNG images as base64 data URIs.
