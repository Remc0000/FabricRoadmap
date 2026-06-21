(async () => {
  const els = {
    query: document.getElementById("query"),
    searchBtn: document.getElementById("searchBtn"),
    clearBtn: document.getElementById("clearBtn"),
    results: document.getElementById("results"),
    resultsHint: document.getElementById("resultsHint"),
    itemCount: document.getElementById("itemCount"),
    matchCount: document.getElementById("matchCount"),
    visitorBadge: document.getElementById("visitorBadge"),
  };

  const state = { items: [], query: "" };

  const SESSION_KEY = "fabricroadmap.session.id";
  const SESSION_COUNTED_KEY = "fabricroadmap.session.counted";
  const SESSION_TOTAL_KEY = "fabricroadmap.session.total";
  const COUNTER_ENDPOINT = "https://fabricroadmapcounter.azurewebsites.net/api/counter";

  const ensureSession = () => {
    let id = sessionStorage.getItem(SESSION_KEY);
    if (!id) {
      id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      sessionStorage.setItem(SESSION_KEY, id);
    }
    return id;
  };

  const updateGlobalSessionBadge = async () => {
    if (!els.visitorBadge) return;
    const sessionId = ensureSession();
    let counted = sessionStorage.getItem(SESSION_COUNTED_KEY) === "1";

    try {
      const readCounter = async () => {
        const response = await fetch(COUNTER_ENDPOINT, { cache: "no-store" });
        if (!response.ok) throw new Error(`Counter request failed: ${response.status}`);
        const payload = await response.json();
        return Number(payload && payload.total);
      };

      const registerSession = async () => {
        const response = await fetch(COUNTER_ENDPOINT, {
          method: "POST",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId }),
        });
        if (!response.ok) throw new Error(`Counter request failed: ${response.status}`);
        const payload = await response.json();
        return Number(payload && payload.total);
      };

      let total = counted ? await readCounter() : await registerSession();

      if (!Number.isFinite(total) || total < 0) {
        total = await readCounter();
      }

      if (!Number.isFinite(total) || total < 0) throw new Error("Invalid counter payload");

      if (!counted) sessionStorage.setItem(SESSION_COUNTED_KEY, "1");
      sessionStorage.setItem(SESSION_TOTAL_KEY, String(total));
      els.visitorBadge.textContent = `${total} total sessions`;
    } catch {
      const fallback = Number(sessionStorage.getItem(SESSION_TOTAL_KEY));
      els.visitorBadge.textContent = Number.isFinite(fallback) && fallback >= 0
        ? `${fallback} total sessions`
        : "sessions unavailable";
    }
  };

  const normalize = (value) =>
    String(value || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/['’]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();

  const tokenize = (value) => normalize(value).split(/\s+/).filter(Boolean);

  const stemToken = (token) => {
    if (!token || token.length <= 3) return token;
    if (token.endsWith("ies")) return token.slice(0, -3) + "y";
    if (token.endsWith("s") && !token.endsWith("ss")) return token.slice(0, -1);
    return token;
  };

  const canonicalizeTokens = (value) => tokenize(value).map(stemToken).filter(Boolean);

  const tokenVariants = (token) => {
    const variants = new Set([token]);
    if (!token) return [];
    if (token === "gen2") {
      variants.add("gen 2");
      variants.add("generation 2");
    }
    if (token === "migration" || token === "migrations" || token === "migrate") {
      variants.add("migration");
      variants.add("migrate");
    }
    if (token.endsWith("ies")) variants.add(`${token.slice(0, -3)}y`);
    if (token.endsWith("s") && !token.endsWith("ss")) variants.add(token.slice(0, -1));
    return [...variants].filter(Boolean);
  };

  const levenshtein = (a, b) => {
    if (a === b) return 0;
    if (!a) return b.length;
    if (!b) return a.length;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    let curr = new Array(b.length + 1);
    for (let i = 1; i <= a.length; i++) {
      curr[0] = i;
      for (let j = 1; j <= b.length; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      }
      [prev, curr] = [curr, prev];
    }
    return prev[b.length];
  };

  const similarity = (a, b) => {
    if (!a || !b) return 0;
    if (a === b) return 1;
    if (a.includes(b) || b.includes(a)) return 0.95;
    return Math.max(0, 1 - levenshtein(a, b) / Math.max(a.length, b.length));
  };

  const escapeHtml = (value) =>
    String(value || "").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));

  const highlight = (text, tokens) => {
    const raw = String(text || "");
    if (!tokens.length) return escapeHtml(raw);
    let html = escapeHtml(raw);
    for (const token of [...tokens].sort((a, b) => b.length - a.length)) {
      const re = new RegExp(`(${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "ig");
      html = html.replace(re, "<span class=\"highlight\">$1</span>");
    }
    return html;
  };

  const urlForItem = (item) => item.url || `https://roadmap.fabric.microsoft.com/?product=${item.productQs}#plan-${item.releaseItemId}`;

  const scoreItem = (item, queryTokens, queryText, queryCompact) => {
    if (!queryTokens.length) return 0;
    let score = 0;
    let tokenHits = 0;
    const hay = item.searchText;

    if (hay.includes(queryText)) score += 220;
    if (item.compactText.includes(queryCompact)) score += 180;
    if (item.featureNameNormalized.includes(queryText)) score += 120;
    if (item.productNormalized.includes(queryText)) score += 30;
    if (item.featureNameNormalized.startsWith(queryText)) score += 40;
    if (queryTokens.length > 1 && item.featureNameNormalized.includes(queryTokens.join(" "))) score += 35;

    let matchedTokens = 0;
    for (const token of queryTokens) {
      const variants = tokenVariants(token);
      if (variants.some((variant) => item.featureNameNormalized.includes(variant))) {
        score += 52; matchedTokens += 1; tokenHits += 1; continue;
      }
      if (variants.some((variant) => item.descriptionNormalized.includes(variant))) {
        score += 28; matchedTokens += 1; tokenHits += 1; continue;
      }
      if (variants.some((variant) => item.productNormalized.includes(variant))) {
        score += 16; matchedTokens += 1; tokenHits += 1; continue;
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
        score += 32; matchedTokens += 1; tokenHits += 1;
      } else if (best >= 0.8) {
        score += 22;
      } else if (best >= 0.68) {
        score += 10;
      }
    }

    if (matchedTokens === queryTokens.length) score += 40;
    if (item.featureNameNormalized.startsWith(queryTokens[0])) score += 16;
    if (item.featureNameNormalized.includes(queryTokens.join(" "))) score += 18;
    score += matchedTokens * 12;
    return { score, tokenHits };
  };

  const renderResults = (matches) => {
    els.results.innerHTML = "";
    const groups = [];
    const byKey = new Map();
    for (const item of matches) {
      const key = `${item.productQs}|${item.featureNameNormalized}`;
      if (!byKey.has(key)) {
        const group = { ...item, variants: [item] };
        byKey.set(key, group);
        groups.push(group);
      } else {
        const group = byKey.get(key);
        group.variants.push(item);
        if (item.score > group.score) Object.assign(group, item);
      }
    }
    for (const group of groups) {
      group.variants.sort((a, b) => b.score - a.score || a.releaseType.localeCompare(b.releaseType) || a.releaseDate.localeCompare(b.releaseDate));
      group.variantCount = group.variants.length;
    }

    els.matchCount.textContent = `${groups.length} ${groups.length === 1 ? "match" : "matches"}`;
    els.resultsHint.textContent = groups.length
      ? groups.length === 1
        ? "One result found."
        : `Showing the top ${Math.min(groups.length, 5)} results.`
      : "No matches yet.";

    if (!groups.length) {
      els.results.innerHTML = `<div class="empty"><strong>No matches</strong>Try a broader term, or search by product names like IQ, Power BI, or Data Engineering.</div>`;
      return;
    }

    for (const item of groups.slice(0, 5)) {
      const card = document.createElement("article");
      card.className = "result";
      card.innerHTML = `
        <div class="result-top">
          <div>
            <h3>${highlight(item.featureName, tokenize(state.query))}</h3>
            <div class="meta">${escapeHtml(item.product)} · ${escapeHtml(item.releaseStatus)} · ${escapeHtml(item.releaseType)} · ${escapeHtml(item.releaseDate)}</div>
          </div>
          <div class="meta">${Math.round(item.score)}${item.variantCount > 1 ? ` · ${item.variantCount} entries` : ""}</div>
        </div>
        <div class="pill-row">
          <span class="pill">${escapeHtml(item.product)}</span>
          <span class="pill">${escapeHtml(item.normalizedReleaseType || item.rawReleaseType || item.releaseType || "unknown")}</span>
          <span class="pill">${escapeHtml(item.normalizedReleaseStatus || item.rawReleaseStatus || item.releaseStatus || "unknown")}</span>
        </div>
        <div class="snippet">${highlight(snippet(item.description, tokenize(state.query)), tokenize(state.query))}</div>
        <div class="path">${escapeHtml(item.url)}</div>
        <div class="variant-list">${item.variants.map((variant, idx) => `<button class="variant-pill${idx === 0 ? " primary" : ""}" data-variant-open="${variant.releaseItemId}">${escapeHtml(variant.releaseType)} · ${escapeHtml(variant.releaseDate)}</button>`).join("")}</div>
        <div class="result-actions">
          <button class="btn tiny primary" data-open>Open</button>
        </div>
      `;
      card.querySelector("[data-open]").addEventListener("click", (event) => {
        event.stopPropagation();
        window.open(urlForItem(item), "_blank", "noopener,noreferrer");
      });
      card.querySelectorAll("[data-variant-open]").forEach((button) => {
        button.addEventListener("click", (event) => {
          event.stopPropagation();
          const variant = item.variants.find((entry) => entry.releaseItemId === button.dataset.variantOpen);
          if (variant) window.open(urlForItem(variant), "_blank", "noopener,noreferrer");
        });
      });
      els.results.appendChild(card);
    }
  };

  const snippet = (text, tokens) => {
    const raw = String(text || "");
    const lower = normalize(raw);
    const hit = tokens.find((t) => lower.includes(t));
    if (!hit) return raw.slice(0, 180);
    const index = lower.indexOf(hit);
    const start = Math.max(0, index - 50);
    return raw.slice(start, start + 180).trim();
  };

  const loadData = async () => {
    const response = await fetch("./data/roadmap-data.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`Failed to load roadmap data: ${response.status}`);
    const raw = await response.json();
    state.items = raw.map((item) => {
      const rawReleaseType = item.releaseType ?? "";
      const rawReleaseStatus = item.releaseStatus ?? "";
      const normalizedReleaseType = normalizeReleaseType(rawReleaseType);
      const normalizedReleaseStatus = normalizeReleaseStatus(rawReleaseStatus);
      const featureNameNormalized = normalize(item.featureName);
      const descriptionNormalized = normalize(item.description);
      const productNormalized = normalize(item.product);
      const compactText = canonicalizeTokens(`${item.featureName} ${item.description} ${item.product} ${rawReleaseType} ${rawReleaseStatus} ${normalizedReleaseType} ${normalizedReleaseStatus} ${item.releaseDate}`).join("");
      const searchText = normalize(`${item.featureName} ${item.description} ${item.product} ${rawReleaseType} ${rawReleaseStatus} ${normalizedReleaseType} ${normalizedReleaseStatus} ${item.releaseDate}`);
      return {
        ...item,
        rawReleaseType,
        rawReleaseStatus,
        normalizedReleaseType,
        normalizedReleaseStatus,
        featureNameNormalized,
        descriptionNormalized,
        productNormalized,
        compactText,
        searchText,
        tokens: canonicalizeTokens(`${item.featureName} ${item.description} ${item.product} ${rawReleaseType} ${normalizedReleaseType}`),
      };
    });
    const grouped = new Set(state.items.map((item) => `${item.productQs}|${item.featureNameNormalized}`));
    els.itemCount.textContent = `${grouped.size} items`;
  };

  const runSearch = () => {
    state.query = els.query.value.trim();
    const queryTokens = canonicalizeTokens(els.query.value);
    const queryText = normalize(els.query.value);
    const queryCompact = queryTokens.join("");

    const matches = queryTokens.length
      ? state.items
          .map((item) => ({ ...item, ...scoreItem(item, queryTokens, queryText, queryCompact) }))
          .filter((item) => item.score > 0)
          .filter((item) => queryTokens.length <= 1 || item.tokenHits >= queryTokens.length)
          .sort((a, b) => b.score - a.score || a.product.localeCompare(b.product) || a.featureName.localeCompare(b.featureName))
      : state.items.map((item) => ({ ...item, score: 0 })).sort((a, b) => a.product.localeCompare(b.product) || a.featureName.localeCompare(b.featureName));

    const filteredMatches = queryTokens.length > 1 && matches.length
      ? matches
          .filter((item) => item.score >= Math.max(100, matches[0].score * 0.8))
          .slice(0, 3)
      : matches;

    renderResults(filteredMatches);

    if (!queryTokens.length) {
      els.resultsHint.textContent = "Type to search the roadmap index.";
    }
  };

  const normalizeReleaseType = (value) => {
    const cleaned = normalize(value);
    if (!cleaned) return "";
    if (["general availability", "generally available", "ga", "generally availabile", "generally availible", "general availibility"].includes(cleaned)) return "ga";
    if (["public preview", "preview", "private preview", "publiew"].includes(cleaned) || cleaned.includes("preview")) return "preview";
    return cleaned;
  };

  const normalizeReleaseStatus = (value) => {
    const cleaned = normalize(value);
    if (!cleaned) return "";
    if (["shipped", "released", "available"].includes(cleaned)) return "shipped";
    if (["planned", "preview", "in preview"].includes(cleaned)) return "planned";
    return cleaned;
  };

  await loadData();
  await updateGlobalSessionBadge();
  els.query.addEventListener("input", runSearch);
  els.searchBtn.addEventListener("click", runSearch);
  els.clearBtn.addEventListener("click", () => {
    els.query.value = "";
    state.query = "";
    els.results.innerHTML = "";
    els.resultsHint.textContent = "Type to search the roadmap index.";
    els.matchCount.textContent = "0 matches";
    els.query.focus();
  });
  els.query.addEventListener("keydown", (event) => {
    if (event.key === "Enter") runSearch();
  });
  runSearch();
})();
