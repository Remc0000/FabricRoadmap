(async () => {
  const els = {
    query: document.getElementById("query"),
    searchBtn: document.getElementById("searchBtn"),
    clearBtn: document.getElementById("clearBtn"),
    results: document.getElementById("results"),
    resultsHint: document.getElementById("resultsHint"),
    itemCount: document.getElementById("itemCount"),
    matchCount: document.getElementById("matchCount"),
  };

  const state = {
    items: [],
    selected: null,
    query: "",
  };

  const normalize = (value) =>
    String(value || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/['’]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();

  const normalizeReleaseType = (value) => {
    const cleaned = normalize(value);
    if (!cleaned) return "";
    if (
      [
        "general availability",
        "generally available",
        "ga",
        "generally availabile",
        "generally availible",
        "general availibility",
      ].includes(cleaned)
    ) return "ga";
    if (
      [
        "public preview",
        "preview",
        "private preview",
        "publiew",
      ].includes(cleaned) || cleaned.includes("preview")
    ) return "preview";
    return cleaned;
  };

  const normalizeReleaseStatus = (value) => {
    const cleaned = normalize(value);
    if (!cleaned) return "";
    if (["shipped", "released", "available"].includes(cleaned)) return "shipped";
    if (["planned", "preview", "in preview"].includes(cleaned)) return "planned";
    return cleaned;
  };

  const tokenize = (value) => normalize(value).split(/\s+/).filter(Boolean);

  const stemToken = (token) => {
    if (!token || token.length <= 3) return token;
    if (token.endsWith("ies")) return token.slice(0, -3) + "y";
    if (token.endsWith("s") && !token.endsWith("ss")) return token.slice(0, -1);
    return token;
  };

  const canonicalizeTokens = (value) => tokenize(value).map(stemToken).filter(Boolean);

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
        curr[j] = Math.min(
          prev[j] + 1,
          curr[j - 1] + 1,
          prev[j - 1] + cost
        );
      }
      [prev, curr] = [curr, prev];
    }
    return prev[b.length];
  };

  const similarity = (a, b) => {
    if (!a || !b) return 0;
    if (a === b) return 1;
    if (a.includes(b) || b.includes(a)) return 0.95;
    const max = Math.max(a.length, b.length);
    return Math.max(0, 1 - levenshtein(a, b) / max);
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

  const scoreItem = (item, queryTokens, queryText, queryCompact) => {
    if (!queryTokens.length) return 0;
    const hay = item.searchText;
    let score = 0;
    let tokenHits = 0;

    if (hay.includes(queryText)) score += 220;
    if (item.compactText.includes(queryCompact)) score += 180;
    if (item.featureNameNormalized.includes(queryText)) score += 120;
    if (item.productNormalized.includes(queryText)) score += 30;
    if (item.featureNameNormalized.startsWith(queryText)) score += 40;
    if (queryTokens.length > 1 && item.featureNameNormalized.includes(queryTokens.join(" "))) score += 35;

    let matchedTokens = 0;
    for (const token of queryTokens) {
      if (item.featureNameNormalized.includes(token)) {
        score += 52;
        matchedTokens += 1;
        tokenHits += 1;
        continue;
      }
      if (item.descriptionNormalized.includes(token)) {
        score += 28;
        matchedTokens += 1;
        tokenHits += 1;
        continue;
      }
      if (item.productNormalized.includes(token)) {
        score += 16;
        matchedTokens += 1;
        tokenHits += 1;
        continue;
      }

      let best = 0;
      for (const candidate of item.tokens) {
        const s = similarity(token, candidate);
        if (s > best) best = s;
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
    if (item.featureNameNormalized.includes(queryTokens.join(" "))) score += 18;
    score += matchedTokens * 12;
    return { score, tokenHits };
  };

  const highlight = (text, tokens) => {
    const raw = String(text || "");
    if (!tokens.length) return raw;
    const sorted = [...tokens].sort((a, b) => b.length - a.length);
    let html = raw.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
    for (const token of sorted) {
      if (!token) continue;
      const re = new RegExp(`(${escapeRegExp(token)})`, "ig");
      html = html.replace(re, "<span class=\"highlight\">$1</span>");
    }
    return html;
  };

  const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const urlForItem = (item) => item.url || `https://roadmap.fabric.microsoft.com/?product=${item.productQs}#plan-${item.releaseItemId}`;

  const readUrlState = () => {
    const params = new URLSearchParams(window.location.search);
    return {
      q: params.get("q") || "",
      item: params.get("item") || "",
    };
  };

  const writeUrlState = (q, itemId) => {
    const url = new URL(window.location.href);
    if (q) url.searchParams.set("q", q);
    else url.searchParams.delete("q");
    if (itemId) url.searchParams.set("item", itemId);
    else url.searchParams.delete("item");
    window.history.replaceState({}, "", url);
  };

  const updateSelection = (item, { focus = false } = {}) => {
    state.selected = item;
    const url = urlForItem(item);
    writeUrlState(state.query, item.releaseItemId);
    if (focus) {
      document.title = `${item.featureName} · Fabric Roadmap Search`;
    }
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
      group.variants.sort((a, b) =>
        b.score - a.score ||
        a.releaseType.localeCompare(b.releaseType) ||
        a.releaseDate.localeCompare(b.releaseDate)
      );
      group.variantCount = group.variants.length;
    }

    els.matchCount.textContent = `${groups.length} ${groups.length === 1 ? "match" : "matches"}`;
    els.resultsHint.textContent = groups.length
      ? groups.length === 1
        ? "One result found."
        : `Showing the top ${Math.min(groups.length, 5)} results.`
      : "No matches yet.";

    if (!groups.length) {
      els.results.innerHTML = `
        <div class="empty">
          <strong>No matches</strong>
          Try a broader term, or search by product names like IQ, Power BI, or Data Engineering.
        </div>`;
      return;
    }

    const top = groups.slice(0, 5);
    for (const item of top) {
      const card = document.createElement("article");
      card.className = `result${state.selected && state.selected.releaseItemId === item.releaseItemId ? " active" : ""}`;
      card.tabIndex = 0;
      card.setAttribute("role", "button");
      card.setAttribute("aria-label", `${item.featureName} in ${item.product}`);
      const variantsHtml = item.variantCount > 1
        ? `<div class="variant-list">
            ${item.variants.map((variant, idx) => `
              <button class="variant-pill${idx === 0 ? " primary" : ""}" data-variant-open="${variant.releaseItemId}">
                ${variant.releaseType} · ${variant.releaseDate}
              </button>
            `).join("")}
           </div>`
        : "";
      card.innerHTML = `
        <div class="result-top">
          <div>
            <h3>${highlight(item.featureName, tokenize(state.query))}</h3>
            <div class="meta">${item.product} · ${item.releaseStatus} · ${item.releaseType} · ${item.releaseDate}</div>
          </div>
          <div class="meta">${Math.round(item.score)}${item.variantCount > 1 ? ` · ${item.variantCount} entries` : ""}</div>
        </div>
        <div class="snippet">${highlight(snippet(item.description, tokenize(state.query)), tokenize(state.query))}</div>
        <div class="path">${item.url}</div>
        ${variantsHtml}
        <div class="result-actions">
          <button class="btn tiny primary" data-open>Open</button>
          <button class="btn tiny" data-copy>Copy URL</button>
        </div>
      `;
      card.addEventListener("click", (event) => {
        const target = event.target;
        if (target && target.matches("[data-copy]")) {
          copyText(urlForItem(item));
          return;
        }
        if (target && target.matches("[data-variant-open]")) {
          const variant = item.variants.find((entry) => entry.releaseItemId === target.dataset.variantOpen);
          if (variant) {
            updateSelection(variant, { focus: true });
            window.open(urlForItem(variant), "_blank", "noopener,noreferrer");
          }
          return;
        }
        updateSelection(item, { focus: true });
        [...els.results.children].forEach((el) => el.classList.remove("active"));
        card.classList.add("active");
      });
      card.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          updateSelection(item, { focus: true });
        }
      });
      card.querySelector("[data-open]").addEventListener("click", (event) => {
        event.stopPropagation();
        updateSelection(item, { focus: true });
        window.open(urlForItem(item), "_blank", "noopener,noreferrer");
      });
      card.querySelector("[data-copy]").addEventListener("click", (event) => {
        event.stopPropagation();
        copyText(urlForItem(item));
      });
      card.querySelectorAll("[data-variant-open]").forEach((button) => {
        button.addEventListener("click", (event) => {
          event.stopPropagation();
          const variant = item.variants.find((entry) => entry.releaseItemId === button.dataset.variantOpen);
          if (!variant) return;
          updateSelection(variant, { focus: true });
          window.open(urlForItem(variant), "_blank", "noopener,noreferrer");
        });
      });
      els.results.appendChild(card);
    }
  };

  const copyText = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const fallback = document.createElement("textarea");
      fallback.value = text;
      document.body.appendChild(fallback);
      fallback.select();
      document.execCommand("copy");
      fallback.remove();
    }
  };

  const runSearch = () => {
    const query = normalize(els.query.value);
    state.query = els.query.value.trim();
    const queryTokens = canonicalizeTokens(els.query.value);
    const queryText = normalize(els.query.value);
    const queryCompact = queryTokens.join("");
    const scopedItems = state.items;

    const matches = queryTokens.length
      ? scopedItems
          .map((item) => ({ ...item, ...scoreItem(item, queryTokens, queryText, queryCompact) }))
          .filter((item) => item.score > 0)
          .filter((item) => queryTokens.length <= 1 || item.tokenHits >= queryTokens.length)
          .sort((a, b) =>
            b.score - a.score ||
            a.product.localeCompare(b.product) ||
            a.featureName.localeCompare(b.featureName)
          )
      : scopedItems
          .map((item) => ({ ...item, score: 0 }))
          .sort((a, b) =>
            a.product.localeCompare(b.product) ||
            a.featureName.localeCompare(b.featureName)
          );

    const filteredMatches =
      queryTokens.length > 1 && matches.length
        ? matches.filter((item) => item.score >= Math.max(75, matches[0].score * 0.6))
        : matches;

    renderResults(filteredMatches);
    writeUrlState(state.query, state.selected ? state.selected.releaseItemId : "");

    if (!queryTokens.length) {
      els.resultsHint.textContent = "Type to search the roadmap index.";
      return;
    }

    if (filteredMatches.length === 1) {
      updateSelection(filteredMatches[0], { focus: true });
    } else if (filteredMatches.length && (!state.selected || !filteredMatches.some((m) => m.releaseItemId === state.selected.releaseItemId))) {
      updateSelection(filteredMatches[0], { focus: false });
    }
  };

  const loadData = async () => {
    let raw = null;
    const sources = ["/api/roadmap-data", "./data/roadmap-data.json"];
    let lastError = null;
    for (const source of sources) {
      try {
        const response = await fetch(source, { cache: "no-store" });
        if (!response.ok) {
          throw new Error(`Failed to load roadmap data from ${source}: ${response.status}`);
        }
        raw = await response.json();
        break;
      } catch (error) {
        lastError = error;
      }
    }
    if (!raw) throw lastError || new Error("Failed to load roadmap data.");
    state.items = raw.map((item) => {
      const rawReleaseType = item.releaseType ?? "";
      const rawReleaseStatus = item.releaseStatus ?? "";
      const normalizedReleaseType = normalizeReleaseType(rawReleaseType);
      const normalizedReleaseStatus = normalizeReleaseStatus(rawReleaseStatus);
      const lifecycleStage =
        normalizedReleaseType === "ga" ? "ga" :
        normalizedReleaseType === "preview" ? "preview" :
        normalizedReleaseType || "";
      const featureNameNormalized = normalize(item.featureName);
      const descriptionNormalized = normalize(item.description);
      const productNormalized = normalize(item.product);
      const compactText = canonicalizeTokens(
        `${item.featureName} ${item.description} ${item.product} ${rawReleaseType} ${rawReleaseStatus} ${normalizedReleaseType} ${normalizedReleaseStatus} ${item.releaseDate}`
      ).join("");
      const searchText = normalize(
        `${item.featureName} ${item.description} ${item.product} ${rawReleaseType} ${rawReleaseStatus} ${normalizedReleaseType} ${normalizedReleaseStatus} ${item.releaseDate}`
      );
      return {
        ...item,
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
        tokens: canonicalizeTokens(`${item.featureName} ${item.description} ${item.product} ${rawReleaseType} ${normalizedReleaseType}`),
      };
    });
    els.itemCount.textContent = `${state.items.length} roadmap items`;
  };

  const init = async () => {
    await loadData();

    const urlState = readUrlState();
    if (urlState.q) els.query.value = urlState.q;

    els.query.addEventListener("input", runSearch);
    els.searchBtn.addEventListener("click", runSearch);
    els.clearBtn.addEventListener("click", () => {
      els.query.value = "";
      state.query = "";
      state.selected = null;
      els.results.innerHTML = "";
      els.resultsHint.textContent = "Type to search the roadmap index.";
      els.matchCount.textContent = "0 matches";
      writeUrlState("", "");
      els.query.focus();
    });
    els.query.addEventListener("keydown", (event) => {
      if (event.key === "Enter") runSearch();
    });

    runSearch();

    if (urlState.item) {
      const item = state.items.find((entry) => entry.releaseItemId === urlState.item);
      if (item) updateSelection(item, { focus: true });
    } else if (!state.selected && state.items.length) {
      const defaultItem = state.items.find((entry) => entry.product === "IQ") || state.items[0];
      updateSelection(defaultItem);
    }
  };

  try {
    await init();
  } catch (error) {
    els.results.innerHTML = `<div class="empty"><strong>Could not load the roadmap data.</strong>${String(error.message || error)}</div>`;
    els.itemCount.textContent = "Data load failed";
  }
})();
