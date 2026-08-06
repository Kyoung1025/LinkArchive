import { useEffect, useState } from 'react';

export function SearchBar({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [text, setText] = useState(value);

  useEffect(() => {
    const timeout = setTimeout(() => onChange(text), 300);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  return (
    <input
      type="search"
      className="search-bar"
      placeholder="제목 또는 태그로 검색…"
      value={text}
      onChange={(event) => setText(event.target.value)}
    />
  );
}
