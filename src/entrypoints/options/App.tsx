import { useEffect, useState } from 'react';
import { DEFAULT_MODEL, getSettings, saveSettings } from '../../lib/settings';

export default function App() {
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [saved, setSaved] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    getSettings().then((s) => {
      setApiKey(s.apiKey);
      setModel(s.model);
      setLoaded(true);
    });
  }, []);

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    await saveSettings({ apiKey: apiKey.trim(), model: model.trim() || DEFAULT_MODEL });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  if (!loaded)
    return (
      <main>
        <p>Loading…</p>
      </main>
    );

  return (
    <main>
      <h1>Prospect Brief — Options</h1>
      <form onSubmit={onSave}>
        <label>
          Anthropic API key
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-ant-…"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <p className="hint">
          Your key is stored only in this browser (chrome.storage.local). It is never sent anywhere
          except api.anthropic.com.
        </p>
        <label>
          Model
          <input
            type="text"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            spellCheck={false}
          />
        </label>
        <p className="hint">Default: {DEFAULT_MODEL}</p>
        <button type="submit">Save</button>
        {saved && <span className="saved">Saved ✓</span>}
      </form>
    </main>
  );
}
