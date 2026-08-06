import type { Link } from '../api/types';
import { LinkCard } from './LinkCard';

export function LinkList({
  links,
  loading,
  onChanged,
}: {
  links: Link[];
  loading: boolean;
  onChanged: () => void;
}) {
  if (loading && links.length === 0) {
    return <p className="status-message">Loading…</p>;
  }

  if (!loading && links.length === 0) {
    return <p className="status-message">No links yet. Save one above.</p>;
  }

  return (
    <div className="link-grid">
      {links.map((link) => (
        <LinkCard key={link.id} link={link} onChanged={onChanged} />
      ))}
    </div>
  );
}
