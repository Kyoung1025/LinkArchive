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
    return <p className="status-message">불러오는 중…</p>;
  }

  if (!loading && links.length === 0) {
    return <p className="status-message">아직 저장된 링크가 없습니다. 위에서 링크를 저장해보세요.</p>;
  }

  return (
    <div className="link-grid">
      {links.map((link) => (
        <LinkCard key={link.id} link={link} onChanged={onChanged} />
      ))}
    </div>
  );
}
