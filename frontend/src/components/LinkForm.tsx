import { useState, type FormEvent } from 'react';
import { createLink } from '../api/client';

export function LinkForm({ onCreated }: { onCreated: () => void }) {
  const [url, setUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await createLink(url);
      setUrl('');
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save link');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="link-form" onSubmit={handleSubmit}>
      <input
        type="url"
        placeholder="https://example.com/article"
        value={url}
        onChange={(event) => setUrl(event.target.value)}
        required
      />
      <button type="submit" disabled={submitting}>
        {submitting ? 'Saving…' : 'Save link'}
      </button>
      {error && <p className="form-error">{error}</p>}
    </form>
  );
}
