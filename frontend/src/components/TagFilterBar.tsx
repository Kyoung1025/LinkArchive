import type { Tag } from '../api/types';

export function TagFilterBar({
  tags,
  selected,
  onSelect,
}: {
  tags: Tag[];
  selected: string | null;
  onSelect: (tagName: string | null) => void;
}) {
  if (tags.length === 0) return null;

  return (
    <div className="tag-filter-bar">
      <button
        type="button"
        className={selected === null ? 'tag-chip active' : 'tag-chip'}
        onClick={() => onSelect(null)}
      >
        전체
      </button>
      {tags.map((tag) => (
        <button
          key={tag.id}
          type="button"
          className={selected === tag.name ? 'tag-chip active' : 'tag-chip'}
          onClick={() => onSelect(tag.name)}
        >
          {tag.name}
        </button>
      ))}
    </div>
  );
}
