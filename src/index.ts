// Root export: only the plugin initializer.
// OpenCode's plugin loader calls every export as a plugin function,
// so non-function exports here would crash the loader.
// Parser and constants are available via subpath imports:
//   import { extractKittyGraphics } from 'kitty-graphics-agent/parser'
//   import { AGENT_GRAPHICS_ENV } from 'kitty-graphics-agent/constants'
export { kittyGraphicsPlugin } from './plugin.ts'
