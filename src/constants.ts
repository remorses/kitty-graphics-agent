/**
 * Environment variable name that signals to CLIs that an agent is
 * intercepting Kitty Graphics Protocol output. CLIs should check
 * `process.env.AGENT_GRAPHICS` — if it contains "kitty", they can
 * emit Kitty Graphics escape sequences to stdout even when stdout
 * is not a TTY, and an agent will extract the images.
 *
 * The value is extensible: future protocols can be comma-separated
 * (e.g. "kitty,iterm2").
 */
export const AGENT_GRAPHICS_ENV = 'AGENT_GRAPHICS'

/**
 * The value set for AGENT_GRAPHICS when this plugin is active.
 */
export const AGENT_GRAPHICS_VALUE = 'kitty'
