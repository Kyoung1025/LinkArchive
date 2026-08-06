export type LinkStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface Tag {
  id: string;
  name: string;
}

export interface Link {
  id: string;
  url: string;
  title: string | null;
  description: string | null;
  thumbnailUrl: string | null;
  status: LinkStatus;
  errorMessage: string | null;
  retryCount: number;
  createdAt: string;
  updatedAt: string;
  tags: Tag[];
}

export interface LinksQuery {
  status?: LinkStatus;
  tag?: string;
  search?: string;
}
