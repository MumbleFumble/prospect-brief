/**
 * User settings: Anthropic API key and model. Stored in
 * chrome.storage.local. The key is never hardcoded or committed.
 */

export const DEFAULT_MODEL = 'claude-sonnet-4-5';

export interface SellerProfile {
  /** One-liner: what you sell. */
  whatYouSell: string;
  /** Who your ideal customer is. */
  idealCustomer: string;
  /** 2-3 value props. */
  valueProps: string[];
}

export interface Settings {
  apiKey: string;
  model: string;
  sellerProfile: SellerProfile;
}

const DEFAULTS: Settings = {
  apiKey: '',
  model: DEFAULT_MODEL,
  sellerProfile: { whatYouSell: '', idealCustomer: '', valueProps: [] },
};

function readProfile(stored: Record<string, unknown>): SellerProfile {
  const p = stored.sellerProfile;
  if (p && typeof p === 'object') {
    const o = p as Record<string, unknown>;
    return {
      whatYouSell: typeof o.whatYouSell === 'string' ? o.whatYouSell : '',
      idealCustomer: typeof o.idealCustomer === 'string' ? o.idealCustomer : '',
      valueProps: Array.isArray(o.valueProps)
        ? o.valueProps.filter((v): v is string => typeof v === 'string').slice(0, 3)
        : [],
    };
  }
  return { ...DEFAULTS.sellerProfile };
}

export async function getSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get(['apiKey', 'model', 'sellerProfile']);
  return {
    apiKey: typeof stored.apiKey === 'string' ? stored.apiKey : DEFAULTS.apiKey,
    model: typeof stored.model === 'string' && stored.model ? stored.model : DEFAULTS.model,
    sellerProfile: readProfile(stored),
  };
}

export async function saveSettings(settings: Settings): Promise<void> {
  await chrome.storage.local.set({
    apiKey: settings.apiKey,
    model: settings.model,
    sellerProfile: settings.sellerProfile,
  });
}

/** True when the user has filled in at least what they sell. */
export function hasSellerProfile(s: Settings): boolean {
  return s.sellerProfile.whatYouSell.trim().length > 0;
}
