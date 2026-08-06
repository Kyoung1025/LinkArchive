import type { LinkStatus } from '../api/types';

const LABELS: Record<LinkStatus, string> = {
  pending: 'Pending',
  processing: 'Processing',
  completed: 'Completed',
  failed: 'Failed',
};

export function StatusBadge({ status }: { status: LinkStatus }) {
  return <span className={`status-badge status-${status}`}>{LABELS[status]}</span>;
}
