export const LINK_SCRAPE_QUEUE = 'link-scrape';

export interface LinkScrapeJobData {
  linkId: string;
  url: string;
}

export interface LinkScrapeResult {
  title: string | null;
  description: string | null;
  thumbnailUrl: string | null;
}
