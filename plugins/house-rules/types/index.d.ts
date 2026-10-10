export type ChecklistActive = boolean

declare module 'claude-code' {
  interface PluginState {
    'house-rules': { isChecklistActive: ChecklistActive }
  }
}
