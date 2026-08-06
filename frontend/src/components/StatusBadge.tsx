import type { LinkStatus } from '../api/types';

const LABELS: Record<LinkStatus, string> = {
  pending: '대기중',
  processing: '처리중',
  completed: '완료',
  failed: '실패',
};

export function StatusBadge({ status }: { status: LinkStatus }) {
  return <span className={`status-badge status-${status}`}>{LABELS[status]}</span>;
}
