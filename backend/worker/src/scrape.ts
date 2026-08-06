import * as cheerio from 'cheerio';
import { fetch } from 'undici';
import type { LinkScrapeResult } from '@linkarchive/shared';

const FETCH_TIMEOUT_MS = 10_000;
const USER_AGENT = 'LinkArchiveBot/0.1 (+https://github.com/linkarchive)';

function resolveUrl(maybeRelative: string | null, base: string): string | null {
  if (!maybeRelative) return null;
  try {
    return new URL(maybeRelative, base).toString();
  } catch {
    return null;
  }
}

export async function scrapeUrl(url: string): Promise<LinkScrapeResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
    });

    if (!response.ok) {
      throw new Error(`Fetch failed with status ${response.status}`);
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    const og = (property: string) => $(`meta[property="og:${property}"]`).attr('content')?.trim() || null;

    const title = og('title') || $('title').first().text().trim() || null;
    const description =
      og('description') || $('meta[name="description"]').attr('content')?.trim() || null;
    const thumbnailUrl = resolveUrl(og('image'), url);

    return { title, description, thumbnailUrl };
  } finally {
    clearTimeout(timeout);
  }
}
