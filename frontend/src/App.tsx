import { useState } from 'react';
import './App.css';
import { LinkForm } from './components/LinkForm';
import { LinkList } from './components/LinkList';
import { SearchBar } from './components/SearchBar';
import { TagFilterBar } from './components/TagFilterBar';
import { useLinks } from './hooks/useLinks';
import { useTags } from './hooks/useTags';

function App() {
  const [search, setSearch] = useState('');
  const [tag, setTag] = useState<string | null>(null);

  const { links, loading, error, refresh } = useLinks({
    search: search || undefined,
    tag: tag || undefined,
  });
  const { tags, refresh: refreshTags } = useTags();

  function handleChanged() {
    refresh();
    refreshTags();
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>LinkArchive</h1>
        <p className="app-subtitle">링크를 저장하면 메타데이터를 백그라운드에서 자동으로 가져옵니다.</p>
      </header>

      <LinkForm onCreated={handleChanged} />

      <div className="toolbar">
        <SearchBar value={search} onChange={setSearch} />
        <TagFilterBar tags={tags} selected={tag} onSelect={setTag} />
      </div>

      {error && <p className="form-error">{error}</p>}

      <LinkList links={links} loading={loading} onChanged={handleChanged} />
    </div>
  );
}

export default App;
