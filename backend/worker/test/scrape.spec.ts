import { scrapeUrl } from '../src/scrape';

const mockFetch = jest.fn();

jest.mock('undici', () => ({
  fetch: (...args: unknown[]) => mockFetch(...args),
}));

function mockHtmlResponse(html: string, status = 200) {
  mockFetch.mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: async () => html,
  });
}

describe('scrapeUrl', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('prefers Open Graph tags when present', async () => {
    mockHtmlResponse(`
      <html><head>
        <meta property="og:title" content="OG Title">
        <meta property="og:description" content="OG Description">
        <meta property="og:image" content="https://example.com/image.png">
        <title>Fallback Title</title>
        <meta name="description" content="Fallback description">
      </head></html>
    `);

    const result = await scrapeUrl('https://example.com/article');

    expect(result).toEqual({
      title: 'OG Title',
      description: 'OG Description',
      thumbnailUrl: 'https://example.com/image.png',
    });
  });

  it('falls back to <title>/<meta name="description"> when Open Graph tags are missing', async () => {
    mockHtmlResponse(`
      <html><head>
        <title>Plain Title</title>
        <meta name="description" content="Plain description">
      </head></html>
    `);

    const result = await scrapeUrl('https://example.com/article');

    expect(result).toEqual({
      title: 'Plain Title',
      description: 'Plain description',
      thumbnailUrl: null,
    });
  });

  it('returns all nulls when no metadata is present at all', async () => {
    mockHtmlResponse('<html><head></head><body>no metadata here</body></html>');

    const result = await scrapeUrl('https://example.com/article');

    expect(result).toEqual({ title: null, description: null, thumbnailUrl: null });
  });

  it('resolves a relative og:image URL against the page URL', async () => {
    mockHtmlResponse(`
      <html><head>
        <meta property="og:image" content="/static/thumb.png">
      </head></html>
    `);

    const result = await scrapeUrl('https://example.com/blog/post');

    expect(result.thumbnailUrl).toBe('https://example.com/static/thumb.png');
  });

  it('throws a descriptive error when the response status is not ok', async () => {
    mockHtmlResponse('<html></html>', 404);

    await expect(scrapeUrl('https://example.com/missing')).rejects.toThrow('Fetch failed with status 404');
  });

  it('sends a bot User-Agent and an HTML Accept header', async () => {
    mockHtmlResponse('<html></html>');

    await scrapeUrl('https://example.com');

    expect(mockFetch).toHaveBeenCalledWith(
      'https://example.com',
      expect.objectContaining({
        headers: expect.objectContaining({
          'User-Agent': expect.stringContaining('LinkArchiveBot'),
          Accept: 'text/html',
        }),
      }),
    );
  });
});
