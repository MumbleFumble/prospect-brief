import { useEffect, useState } from 'react';
import { DEFAULT_MODEL, getSettings, saveSettings, type SellerProfile } from '../../lib/settings';

export default function App() {
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [whatYouSell, setWhatYouSell] = useState('');
  const [idealCustomer, setIdealCustomer] = useState('');
  const [valueProps, setValueProps] = useState<string[]>(['', '', '']);
  const [competitors, setCompetitors] = useState('');
  const [saved, setSaved] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    getSettings().then((s) => {
      setApiKey(s.apiKey);
      setModel(s.model);
      setWhatYouSell(s.sellerProfile.whatYouSell);
      setIdealCustomer(s.sellerProfile.idealCustomer);
      const vp = [...s.sellerProfile.valueProps];
      while (vp.length < 3) vp.push('');
      setValueProps(vp.slice(0, 3));
      setCompetitors(s.sellerProfile.competitors.join(', '));
      setLoaded(true);
    });
  }, []);

  function setValueProp(i: number, v: string) {
    setValueProps((prev) => prev.map((p, j) => (j === i ? v : p)));
  }

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    const profile: SellerProfile = {
      whatYouSell: whatYouSell.trim(),
      idealCustomer: idealCustomer.trim(),
      valueProps: valueProps.map((v) => v.trim()).filter(Boolean),
      competitors: competitors
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean),
    };
    await saveSettings({
      apiKey: apiKey.trim(),
      model: model.trim() || DEFAULT_MODEL,
      sellerProfile: profile,
    });
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

        <h2>Your seller profile</h2>
        <p className="hint">
          Optional. When set, talking points connect your product to each prospect&apos;s situation
          instead of staying generic.
        </p>
        <label>
          What you sell
          <input
            type="text"
            value={whatYouSell}
            onChange={(e) => setWhatYouSell(e.target.value)}
            placeholder="e.g. Checkout optimization for Shopify Plus stores"
            spellCheck={true}
          />
        </label>
        <label>
          Ideal customer
          <input
            type="text"
            value={idealCustomer}
            onChange={(e) => setIdealCustomer(e.target.value)}
            placeholder="e.g. Mid-market DTC brands doing $10M+ online"
            spellCheck={true}
          />
        </label>
        <label>
          Value prop 1
          <input
            type="text"
            value={valueProps[0] ?? ''}
            onChange={(e) => setValueProp(0, e.target.value)}
            placeholder="e.g. Lift checkout conversion by 12%"
            spellCheck={true}
          />
        </label>
        <label>
          Value prop 2
          <input
            type="text"
            value={valueProps[1] ?? ''}
            onChange={(e) => setValueProp(1, e.target.value)}
            spellCheck={true}
          />
        </label>
        <label>
          Competitors (comma-separated)
          <input
            type="text"
            value={competitors}
            onChange={(e) => setCompetitors(e.target.value)}
            placeholder="e.g. Segment, HubSpot, Salesforce"
            spellCheck={false}
          />
        </label>
        <p className="hint">
          If a prospect already uses one of these, the brief flags it and angles for displacement.
        </p>
        <label>
          Value prop 3
          <input
            type="text"
            value={valueProps[2] ?? ''}
            onChange={(e) => setValueProp(2, e.target.value)}
            spellCheck={true}
          />
        </label>

        <button type="submit">Save</button>
        {saved && <span className="saved">Saved ✓</span>}
      </form>
    </main>
  );
}
