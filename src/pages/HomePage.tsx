import { useEffect, useMemo, useState } from 'react';

type RoadmapRow = {
  product: string;
  productId: string;
  productQs: string;
  releaseItemId: string;
  featureName: string;
  releaseDate: string;
  releaseType: string;
  releaseTypeValue: string;
  releaseStatus: string;
  releaseStatusValue: string;
  releaseSemester: string;
  description: string;
  isPublishExternally: string;
  url: string;
};

type RoadmapItem = RoadmapRow & {
  rawReleaseType: string;
  rawReleaseStatus: string;
  normalizedReleaseType: string;
  normalizedReleaseStatus: string;
  lifecycleStage: string;
  featureNameNormalized: string;
  descriptionNormalized: string;
  productNormalized: string;
  compactText: string;
  searchText: string;
  tokens: string[];
};

type Category = {
  value: string;
  label: string;
  count: number;
};

type ScoredRoadmapItem = RoadmapItem & {
  score: number;
  tokenHits: number;
};

function normalize(value: string | null | undefined): string {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function normalizeReleaseType(value: string | null | undefined): string {
  const cleaned = normalize(value);
  if (!cleaned) return '';
  if (
    [
      'general availability',
      'generally available',
      'ga',
      'generally availabile',
      'generally availible',
      'general availibility',
    ].includes(cleaned)
  ) {
    return 'ga';
  }
  if (
    ['public preview', 'preview', 'private preview', 'publiew'].includes(cleaned) ||
    cleaned.includes('preview')
  ) {
    return 'preview';
  }
  return cleaned;
}

function normalizeReleaseStatus(value: string | null | undefined): string {
  const cleaned = normalize(value);
  if (!cleaned) return '';
  if (['shipped', 'released', 'available'].includes(cleaned)) return 'shipped';
  if (['planned', 'preview', 'in preview'].includes(cleaned)) return 'planned';
  return cleaned;
}

function tokenize(value: string): string[] {
  return normalize(value).split(/\s+/).filter(Boolean);
}

function stemToken(token: string): string {
  if (!token || token.length <= 3) return token;
  if (token.endsWith('ies')) return `${token.slice(0, -3)}y`;
  if (token.endsWith('s') && !token.endsWith('ss')) return token.slice(0, -1);
  return token;
}

function canonicalizeTokens(value: string): string[] {
  return tokenize(value).map(stemToken).filter(Boolean);
}

function tokenVariants(token: string): string[] {
  const variants = new Set([token]);
  if (!token) return [];
  if (token === 'gen2') {
    variants.add('gen 2');
    variants.add('generation 2');
  }
  if (token === 'migration' || token === 'migrations' || token === 'migrate') {
    variants.add('migration');
    variants.add('migrate');
  }
  if (token.endsWith('ies')) variants.add(`${token.slice(0, -3)}y`);
  if (token.endsWith('s') && !token.endsWith('ss')) variants.add(token.slice(0, -1));
  return [...variants].filter(Boolean);
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }

  return prev[b.length];
}

function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.95;
  const max = Math.max(a.length, b.length);
  return Math.max(0, 1 - levenshtein(a, b) / max);
}

function escapeHtml(value: string): string {
  return String(value || '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch] as string));
}

function escapeRegExp(value: string): string {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function highlight(text: string, tokens: string[]): string {
  const raw = String(text || '');
  if (!tokens.length) return escapeHtml(raw);
  const sorted = [...tokens].sort((a, b) => b.length - a.length);
  let html = escapeHtml(raw);
  for (const token of sorted) {
    if (!token) continue;
    const re = new RegExp(`(${escapeRegExp(token)})`, 'ig');
    html = html.replace(re, '<span class="highlight">$1</span>');
  }
  return html;
}

function snippet(text: string, tokens: string[]): string {
  const raw = String(text || '');
  const lower = normalize(raw);
  const hit = tokens.find((token) => lower.includes(token));
  if (!hit) return raw.slice(0, 180);
  const index = lower.indexOf(hit);
  const start = Math.max(0, index - 50);
  return raw.slice(start, start + 180).trim();
}

function urlForItem(item: RoadmapItem): string {
  return item.url || `https://roadmap.fabric.microsoft.com/?product=${item.productQs}#plan-${item.releaseItemId}`;
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const fallback = document.createElement('textarea');
    fallback.value = text;
    document.body.appendChild(fallback);
    fallback.select();
    document.execCommand('copy');
    fallback.remove();
  }
}

function scoreItem(
  item: RoadmapItem,
  queryTokens: string[],
  queryText: string,
  queryCompact: string
): { score: number; tokenHits: number } {
  if (!queryTokens.length) return { score: 0, tokenHits: 0 };

  let score = 0;
  let tokenHits = 0;

  if (item.searchText.includes(queryText)) score += 220;
  if (item.compactText.includes(queryCompact)) score += 180;
  if (item.featureNameNormalized.includes(queryText)) score += 120;
  if (item.productNormalized.includes(queryText)) score += 30;
  if (item.featureNameNormalized.startsWith(queryText)) score += 40;
  if (queryTokens.length > 1 && item.featureNameNormalized.includes(queryTokens.join(' '))) score += 35;

  let matchedTokens = 0;
  for (const token of queryTokens) {
    const variants = tokenVariants(token);
    if (variants.some((variant) => item.featureNameNormalized.includes(variant))) {
      score += 52;
      matchedTokens += 1;
      tokenHits += 1;
      continue;
    }
    if (variants.some((variant) => item.descriptionNormalized.includes(variant))) {
      score += 28;
      matchedTokens += 1;
      tokenHits += 1;
      continue;
    }
    if (variants.some((variant) => item.productNormalized.includes(variant))) {
      score += 16;
      matchedTokens += 1;
      tokenHits += 1;
      continue;
    }

    let best = 0;
    for (const candidate of item.tokens) {
      for (const variant of variants) {
        const s = similarity(variant, candidate);
        if (s > best) best = s;
        if (best >= 0.92) break;
      }
      if (best >= 0.92) break;
    }

    if (best >= 0.92) {
      score += 32;
      matchedTokens += 1;
      tokenHits += 1;
    } else if (best >= 0.8) {
      score += 22;
    } else if (best >= 0.68) {
      score += 10;
    }
  }

  if (matchedTokens === queryTokens.length) score += 40;
  if (item.featureNameNormalized.startsWith(queryTokens[0])) score += 16;
  if (item.featureNameNormalized.includes(queryTokens.join(' '))) score += 18;
  score += matchedTokens * 12;
  return { score, tokenHits };
}

function makeRoadmapItem(raw: RoadmapRow): RoadmapItem {
  const rawReleaseType = raw.releaseType ?? '';
  const rawReleaseStatus = raw.releaseStatus ?? '';
  const normalizedReleaseType = normalizeReleaseType(rawReleaseType);
  const normalizedReleaseStatus = normalizeReleaseStatus(rawReleaseStatus);
  const lifecycleStage =
    normalizedReleaseType === 'ga'
      ? 'ga'
      : normalizedReleaseType === 'preview'
        ? 'preview'
        : normalizedReleaseType || '';
  const featureNameNormalized = normalize(raw.featureName);
  const descriptionNormalized = normalize(raw.description);
  const productNormalized = normalize(raw.product);
  const compactText = canonicalizeTokens(
    `${raw.featureName} ${raw.description} ${raw.product} ${rawReleaseType} ${rawReleaseStatus} ${normalizedReleaseType} ${normalizedReleaseStatus} ${raw.releaseDate}`
  ).join('');
  const searchText = normalize(
    `${raw.featureName} ${raw.description} ${raw.product} ${rawReleaseType} ${rawReleaseStatus} ${normalizedReleaseType} ${normalizedReleaseStatus} ${raw.releaseDate}`
  );

  return {
    ...raw,
    rawReleaseType,
    rawReleaseStatus,
    normalizedReleaseType,
    normalizedReleaseStatus,
    lifecycleStage,
    featureNameNormalized,
    descriptionNormalized,
    productNormalized,
    compactText,
    searchText,
    tokens: canonicalizeTokens(`${raw.featureName} ${raw.description} ${raw.product} ${rawReleaseType} ${normalizedReleaseType}`),
  };
}

export function HomePage() {
  const [items, setItems] = useState<RoadmapItem[]>([]);
  const [query, setQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copyHint, setCopyHint] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      try {
        const response = await fetch('/data/roadmap-data.json', { cache: 'no-store' });
        if (!response.ok) {
          throw new Error(`Failed to load roadmap data: ${response.status}`);
        }
        const raw = (await response.json()) as RoadmapRow[];
        if (cancelled) return;
        setItems(raw.map(makeRoadmapItem));
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : 'Failed to load roadmap data');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadData();
    return () => {
      cancelled = true;
    };
  }, []);

  const categories = useMemo<Category[]>(() => {
    const counts = new Map<string, number>();
    for (const item of items) {
      counts.set(item.product, (counts.get(item.product) || 0) + 1);
    }
    return [...counts.entries()]
      .map(([label, count]) => ({ value: label, label, count }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [items]);

  useEffect(() => {
    if (selectedCategory !== 'all' && !categories.some((entry) => entry.value === selectedCategory)) {
      setSelectedCategory('all');
    }
  }, [categories, selectedCategory]);

  const queryTokens = canonicalizeTokens(query);
  const queryText = normalize(query);
  const queryCompact = queryTokens.join('');
  const scopedItems = selectedCategory === 'all' ? items : items.filter((item) => item.product === selectedCategory);

  const matches = useMemo<ScoredRoadmapItem[]>(() => {
    if (!queryTokens.length) {
      return scopedItems
        .map((item) => ({ ...item, score: 0, tokenHits: 0 }))
        .sort((a, b) => a.product.localeCompare(b.product) || a.featureName.localeCompare(b.featureName));
    }

    const scored = scopedItems
      .map((item) => ({ ...item, ...scoreItem(item, queryTokens, queryText, queryCompact) }))
      .filter((item) => item.score > 0)
      .filter((item) => queryTokens.length <= 1 || item.tokenHits >= queryTokens.length)
      .sort(
        (a, b) =>
          b.score - a.score ||
          a.product.localeCompare(b.product) ||
          a.featureName.localeCompare(b.featureName)
      );

    return queryTokens.length > 1 && scored.length
      ? scored.filter((item) => item.score >= Math.max(75, scored[0].score * 0.6))
      : scored;
  }, [queryTokens, queryText, queryCompact, scopedItems]);

  const selectedItem = useMemo(() => {
    return (
      matches.find((item) => item.releaseItemId === selectedId) ??
      matches[0] ??
      items.find((item) => item.releaseItemId === selectedId) ??
      items[0] ??
      null
    );
  }, [matches, selectedId, items]);

  useEffect(() => {
    if (!selectedItem) return;
    if (selectedItem.releaseItemId !== selectedId) {
      setSelectedId(selectedItem.releaseItemId);
    }
  }, [selectedItem, selectedId]);

  const displayedItems = matches.slice(0, 5);
  const itemCount = items.length;
  const matchCount = matches.length;
  const categorySummary =
    selectedCategory === 'all'
      ? 'All categories'
      : `${selectedCategory} · ${categories.find((entry) => entry.value === selectedCategory)?.count || 0} items`;
  const resultsHint = loading
    ? 'Loading roadmap items...'
    : error
      ? 'Data load failed.'
      : !queryTokens.length
        ? selectedCategory === 'all'
          ? 'Type to search the roadmap index.'
          : `Browsing ${selectedCategory}. Type to search within this category.`
        : matchCount === 1
          ? 'One result found.'
          : `Showing the top ${Math.min(matchCount, 5)} results.`;

  const handleOpen = (item: RoadmapItem) => {
    setSelectedId(item.releaseItemId);
    window.open(urlForItem(item), '_blank', 'noopener,noreferrer');
  };

  const handleCopy = async (item: RoadmapItem) => {
    await copyText(urlForItem(item));
    setCopyHint('URL copied');
    window.setTimeout(() => setCopyHint(null), 1200);
  };

  const handleClear = () => {
    setQuery('');
    setSelectedCategory('all');
    setSelectedId(null);
  };

  return (
    <div className="app-shell">
      <section className="hero">
        <div className="hero-top">
          <div>
            <p className="eyebrow">Rayfin-style public roadmap explorer</p>
            <h1>Fabric Roadmap</h1>
            <p className="subtitle">
              Search the public roadmap with fuzzy matching, browse by category first, and jump to exact roadmap entries.
            </p>
          </div>

          <div className="stats">
            <span className="badge">{loading ? 'Loading data…' : `${itemCount} items · ${categories.length} categories`}</span>
            <span className="badge">{`${matchCount} ${matchCount === 1 ? 'match' : 'matches'}`}</span>
          </div>
        </div>
      </section>

      <section className="search-panel">
        <form
          className="search-form"
          onSubmit={(event) => {
            event.preventDefault();
          }}
        >
          <input
            className="search-input"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search for an item, e.g. gen2 migration"
            autoComplete="off"
            spellCheck={false}
          />
          <button type="submit" className="btn primary">
            Search
          </button>
          <button type="button" className="btn" onClick={handleClear}>
            Clear
          </button>
        </form>
        <div className="footer-note">
          Fuzzy matching understands plurals and close variants, so a search like “gen2 migration” also finds related migration or migrations text.
          {copyHint ? ` · ${copyHint}` : ''}
        </div>
      </section>

      <div className="workspace">
        <aside className="panel">
          <div className="panel-header">
            <h2>Categories</h2>
            <p>{categorySummary}</p>
          </div>
          <div className="sidebar-body">
            <div className="category-group">
              <label htmlFor="categorySelect">Category</label>
              <select
                id="categorySelect"
                className="category-select"
                value={selectedCategory}
                onChange={(event) => setSelectedCategory(event.target.value)}
              >
                <option value="all">All categories</option>
                {categories.map((category) => (
                  <option key={category.value} value={category.value}>
                    {category.label} ({category.count})
                  </option>
                ))}
              </select>
            </div>

            <div className="section-label">Products</div>
            <div className="category-list">
              <button
                type="button"
                className={`category-item${selectedCategory === 'all' ? ' active' : ''}`}
                onClick={() => setSelectedCategory('all')}
              >
                <span className="category-name">All categories</span>
                <span className="category-count">{items.length}</span>
              </button>
              {categories.map((category) => (
                <button
                  key={category.value}
                  type="button"
                  className={`category-item${selectedCategory === category.value ? ' active' : ''}`}
                  onClick={() => setSelectedCategory(category.value)}
                >
                  <span className="category-name">{category.label}</span>
                  <span className="category-count">{category.count}</span>
                </button>
              ))}
            </div>
          </div>
        </aside>

        <section className="panel">
          <div className="panel-header">
            <h2>Matches</h2>
            <p>{resultsHint}</p>
          </div>

          <div className="results">
            {error ? (
              <div className="empty">
                <strong>Could not load the roadmap data.</strong>
                {error}
              </div>
            ) : !displayedItems.length ? (
              <div className="empty">
                <strong>No matches</strong>
                Try a broader term, or search by product names like IQ, Power BI, or Data Engineering.
              </div>
            ) : (
              displayedItems.map((item) => {
                const variants =
                  item.releaseItemId === selectedItem?.releaseItemId && item.normalizedReleaseType
                    ? item.normalizedReleaseType
                    : item.releaseType;
                return (
                  <article
                    key={item.releaseItemId}
                    className={`result-card${selectedItem?.releaseItemId === item.releaseItemId ? ' active' : ''}`}
                    role="button"
                    tabIndex={0}
                    aria-label={`${item.featureName} in ${item.product}`}
                    onClick={() => setSelectedId(item.releaseItemId)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        setSelectedId(item.releaseItemId);
                      }
                    }}
                  >
                    <div className="result-top">
                      <div>
                        <h3 dangerouslySetInnerHTML={{ __html: highlight(item.featureName, queryTokens) }} />
                        <div className="meta">
                          {item.product} · {item.releaseStatus} · {item.releaseType} · {item.releaseDate}
                        </div>
                      </div>
                      <div className="meta">
                        {item.score ?? 0}
                        {displayedItems.length > 1 ? ` · ${displayedItems.length} entries` : ''}
                      </div>
                    </div>

                    <div className="pill-row">
                      <span className="pill">{item.product}</span>
                      <span className="pill">{item.normalizedReleaseType || item.rawReleaseType || item.releaseType || 'unknown'}</span>
                      <span className="pill">{item.normalizedReleaseStatus || item.rawReleaseStatus || item.releaseStatus || 'unknown'}</span>
                      <span className="pill">{variants}</span>
                    </div>

                    <div className="snippet" dangerouslySetInnerHTML={{ __html: highlight(snippet(item.description, queryTokens), queryTokens) }} />
                    <div className="path">{item.url}</div>

                    <div className="variant-list">
                      <button
                        type="button"
                        className="variant-pill primary"
                        onClick={(event) => {
                          event.stopPropagation();
                          handleOpen(item);
                        }}
                      >
                        Open
                      </button>
                      <button
                        type="button"
                        className="variant-pill"
                        onClick={(event) => {
                          event.stopPropagation();
                          void handleCopy(item);
                        }}
                      >
                        Copy URL
                      </button>
                    </div>
                  </article>
                );
              })
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
