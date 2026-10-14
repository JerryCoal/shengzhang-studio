// Remove derived workflow metadata, never rewrite the user's current instructions.
export function previousStrategyContext(strategy) {
  if (!strategy) return undefined;
  return Object.fromEntries(['id', 'version', 'status', 'title', 'core', 'direction', 'prompt'].filter(key => strategy[key] !== undefined).map(key => [key, strategy[key]]));
}
export function taskPromptContext(taskPrompt, strategyPrompt) {
  if (typeof taskPrompt !== 'string' || !strategyPrompt) return taskPrompt;
  // Only the exact generated prefix is redundant: the full strategy is a sibling input.
  const prefix = `${strategyPrompt}\n\n`;
  return taskPrompt.startsWith(prefix) && taskPrompt.length > prefix.length ? taskPrompt.slice(prefix.length) : taskPrompt;
}
