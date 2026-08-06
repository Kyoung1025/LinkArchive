import type { Link, LinksQuery, Tag } from './types';

const API_BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const message = Array.isArray(body.message) ? body.message.join(', ') : body.message;
    throw new Error(message || `요청이 실패했습니다 (상태 코드: ${response.status})`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

export function fetchLinks(query: LinksQuery): Promise<Link[]> {
  const params = new URLSearchParams();
  if (query.status) params.set('status', query.status);
  if (query.tag) params.set('tag', query.tag);
  if (query.search) params.set('search', query.search);
  const qs = params.toString();
  return request<Link[]>(`/links${qs ? `?${qs}` : ''}`);
}

export function createLink(url: string): Promise<Link> {
  return request<Link>('/links', { method: 'POST', body: JSON.stringify({ url }) });
}

export function deleteLink(id: string): Promise<void> {
  return request<void>(`/links/${id}`, { method: 'DELETE' });
}

export function addTag(linkId: string, name: string): Promise<Tag> {
  return request<Tag>(`/links/${linkId}/tags`, { method: 'POST', body: JSON.stringify({ name }) });
}

export function removeTag(linkId: string, tagId: string): Promise<void> {
  return request<void>(`/links/${linkId}/tags/${tagId}`, { method: 'DELETE' });
}

export function fetchTags(): Promise<Tag[]> {
  return request<Tag[]>('/tags');
}
