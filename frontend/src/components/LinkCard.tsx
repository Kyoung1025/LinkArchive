import { useState, type FormEvent } from 'react';
import type { Link } from '../api/types';
import { addTag, deleteLink, removeTag } from '../api/client';
import { StatusBadge } from './StatusBadge';

export function LinkCard({ link, onChanged }: { link: Link; onChanged: () => void }) {
  const [tagInput, setTagInput] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleDelete() {
    if (!confirm('Delete this link?')) return;
    setBusy(true);
    try {
      await deleteLink(link.id);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function handleAddTag(event: FormEvent) {
    event.preventDefault();
    const name = tagInput.trim();
    if (!name) return;
    setBusy(true);
    try {
      await addTag(link.id, name);
      setTagInput('');
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function handleRemoveTag(tagId: string) {
    setBusy(true);
    try {
      await removeTag(link.id, tagId);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="link-card">
      {link.thumbnailUrl && <img className="link-thumbnail" src={link.thumbnailUrl} alt="" />}
      <div className="link-body">
        <div className="link-header">
          <StatusBadge status={link.status} />
          <time dateTime={link.createdAt}>{new Date(link.createdAt).toLocaleDateString()}</time>
        </div>

        <a className="link-title" href={link.url} target="_blank" rel="noreferrer">
          {link.title || link.url}
        </a>

        {link.description && <p className="link-description">{link.description}</p>}

        {link.status === 'failed' && link.errorMessage && (
          <p className="link-error">Error: {link.errorMessage}</p>
        )}

        <div className="link-tags">
          {link.tags.map((tag) => (
            <span key={tag.id} className="tag-chip removable">
              {tag.name}
              <button
                type="button"
                onClick={() => handleRemoveTag(tag.id)}
                disabled={busy}
                aria-label={`Remove tag ${tag.name}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>

        <form className="add-tag-form" onSubmit={handleAddTag}>
          <input
            type="text"
            placeholder="Add tag"
            value={tagInput}
            onChange={(event) => setTagInput(event.target.value)}
            disabled={busy}
          />
          <button type="submit" disabled={busy}>
            Add
          </button>
        </form>

        <button type="button" className="delete-button" onClick={handleDelete} disabled={busy}>
          Delete
        </button>
      </div>
    </article>
  );
}
