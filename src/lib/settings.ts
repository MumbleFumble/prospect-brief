/**
 * User settings: Anthropic API key and model. Stored in
 * chrome.storage.local. The key is never hardcoded or committed.
 */

export const DEFAULT_MODEL = 'claude-sonnet-4-5';

export interface Settings {
  apiKey: string;
  model: string;
}

const DEFAULTS: Settings = { apiKey: '', model: DEFAULT_MODEL };

export async function getSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get(['apiKey', 'model']);
  return {
    apiKey: typeof stored.apiKey === 'string' ? stored.apiKey : DEFAULTS.apiKey,
    model: typeof stored.model === 'string' && stored.model ? stored.model : DEFAULTS.model,
  };
}

export async function saveSettings(settings: Settings): Promise<void> {
  await chrome.storage.local.set({ apiKey: settings.apiKey, model: settings.model });
}
