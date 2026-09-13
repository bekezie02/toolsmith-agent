/**
 * Builds the tag-filtered scripts URL for the send-scene-study skill.
 *
 * Reads the base URL from sources/scene, and the tag pool from scene/tags
 * (raw strings like "age: adult", "cast: 1 man and 1 woman" — grouped by
 * the text before the ":"). Each run picks a random number of categories,
 * one random tag from each, slugifies them (lowercase, spaces -> hyphens),
 * and joins with "+" (matching the site's own multi-tag URL format).
 *
 * A rolling history (scene/tagHistory) prevents repeating the same group
 * within 5 executions; once 5 have accumulated, history resets so the
 * next run starts a fresh window.
 *
 * Not agent-callable directly — used internally by getNextSceneScript,
 * which also needs the group slug for cache lookups.
 */
function selectSceneTags() {
  try {
    const HISTORY_LIMIT = 5;
    const MAX_ATTEMPTS = 25;

    const sourceResult = lookupData({ name: "scene", table: "sources" });
    if (!sourceResult.success) return sourceResult;
    const source = Array.isArray(sourceResult.data) ? sourceResult.data[0] : null;
    if (!source) {
      return { success: false, error: "No 'scene' source configured in the sources table" };
    }

    const tagsResult = lookupData({ name: "tags", table: "scene" });
    if (!tagsResult.success) return tagsResult;
    const rawTags = Array.isArray(tagsResult.data) ? tagsResult.data : [];
    if (rawTags.length === 0) {
      return { success: false, error: "No tags found under scene/tags" };
    }

    // Group raw "category: label" strings by category. Every tag's slug
    // is built as "<category>-<label>" (e.g. "age-adult",
    // "content-no-sexual-themes") — the site requires the category prefix
    // on every tag, not just when combining multiple.
    const byCategory = {};
    rawTags.forEach(raw => {
      const parts = raw.split(":");
      const category = (parts.shift() || "").trim();
      const label = parts.join(":").trim();
      if (!category || !label) return;
      const categorySlug = category.toLowerCase().replace(/\s+/g, "-");
      const labelSlug = label.toLowerCase().replace(/\s+/g, "-");
      const slug = `${categorySlug}-${labelSlug}`;
      if (!byCategory[category]) byCategory[category] = [];
      byCategory[category].push(slug);
    });
    const categories = Object.keys(byCategory);
    if (categories.length === 0) {
      return { success: false, error: "Could not parse any categories from scene/tags" };
    }

    // History is best-effort — a missing/empty history table just means "no history yet".
    const historyResult = lookupData({ name: "tagHistory", table: "scene" });
    let history = (historyResult.success && Array.isArray(historyResult.data)) ? historyResult.data : [];

    if (history.length >= HISTORY_LIMIT) {
      history = [];
    }

    let groupSlug;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const categoryCount = 1 + Math.floor(Math.random() * categories.length);
      const shuffled = [...categories].sort(() => Math.random() - 0.5).slice(0, categoryCount);
      const chosenTags = shuffled.map(cat => {
        const options = byCategory[cat];
        return options[Math.floor(Math.random() * options.length)];
      });
      groupSlug = chosenTags.join("+");
      if (!history.includes(groupSlug)) break;
      // otherwise loop again and try a different random combo
    }

    history.push(groupSlug);
    const historyWrite = insertData({ name: "tagHistory", value: history, table: "scene" });
    if (!historyWrite.success) {
      console.warn("selectSceneTags: failed to persist tagHistory:", historyWrite.error);
    }

    const baseLink = (source.link || "").replace(/\/+$/, "");
    const fullLink = `${baseLink}/${groupSlug}`;

    return {
      success: true,
      data: [{
        name: source.name,
        link: fullLink,
        properties: source.properties,
        tags: groupSlug
      }]
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * Merges a freshly scraped script list with any existing cached list,
 * matched by whatever link-like field identifies each script (see
 * findEntryIdentifier — schemas vary, e.g. "link" vs "link to pdf").
 * Scripts that already existed keep their "sent" flag; genuinely new
 * scripts start unsent.
 */
function mergeScriptCache(oldList, freshList) {
  const oldById = {};
  (oldList || []).forEach(item => {
    const id = findEntryIdentifier(item);
    if (id) oldById[id] = item;
  });
  return (freshList || []).map(item => {
    const id = findEntryIdentifier(item);
    const prior = id ? oldById[id] : null;
    return { ...item, sent: prior ? !!prior.sent : false };
  });
}

/**
 * Builds the URL for a given page number of a tag-filtered listing.
 * Page 1 is the base tag URL itself; page 2+ appends "/page/<n>/".
 */
function buildScenePageUrl(baseLink, page) {
  const trimmed = (baseLink || "").replace(/\/+$/, "");
  return page > 1 ? `${trimmed}/page/${page}/` : `${trimmed}/`;
}

const SCENE_MAX_PAGES = 10;

/**
 * Returns exactly one scene script that hasn't already been emailed for
 * the current tag rotation — the send-scene-study skill's entire
 * "pick a source, get one unsent item, remember it" flow in a single tool.
 *
 * Per tag group (cached under "group:<slug>" in the scene table), it keeps
 * { page, scripts } — the highest page scraped so far, and the full script
 * list seen with a per-script "sent" flag:
 * - If the cache has an unsent script, use it — no new scrape needed.
 * - If everything cached (or nothing cached yet) is sent, scrape the next
 *   page for this tag group and merge it in (previously sent scripts stay
 *   marked sent; genuinely new scripts start unsent). This repeats — up to
 *   SCENE_MAX_PAGES as a safety cap — until either an unsent script is found
 *   or a page comes back with nothing new, meaning there's nothing left.
 * The chosen script is marked sent and the cache is saved back before
 * returning, so the same script won't be picked again for this group.
 *
 * Returns data in the same {source, entries} shape formatEmail produces,
 * so it can go straight to sendEmail — formatEmail isn't needed here since
 * there's only ever one entry.
 */
function getNextSceneScript() {
  try {
    const groupResult = selectSceneTags();
    if (!groupResult.success) return groupResult;
    const groupSource = groupResult.data[0];
    const cacheKey = `group:${groupSource.tags}`;

    const cacheLookup = lookupData({ name: cacheKey, table: "scene" });
    let cache;
    if (cacheLookup.success && Array.isArray(cacheLookup.data)) {
      // Migrate a pre-pagination cache (bare array) into the new shape.
      cache = { page: 1, scripts: cacheLookup.data };
    } else if (cacheLookup.success && cacheLookup.data && Array.isArray(cacheLookup.data.scripts)) {
      cache = cacheLookup.data;
    } else {
      cache = { page: 0, scripts: [] };
    }

    let unsent = cache.scripts.filter(s => !s.sent);

    while (unsent.length === 0 && cache.page < SCENE_MAX_PAGES) {
      const nextPage = cache.page + 1;
      const pageUrl = buildScenePageUrl(groupSource.link, nextPage);
      const pageSource = { name: groupSource.name, link: pageUrl, properties: groupSource.properties };

      const scrapeResult = webScraper({ content: [pageSource] });
      if (!scrapeResult.success) break;

      const scrapedSection = Array.isArray(scrapeResult.data) ? scrapeResult.data[0] : null;
      const freshEntries = flattenScrapedEntries(scrapedSection?.data);

      if (freshEntries.length === 0) break; // no more pages — nothing left to find

      cache.scripts = mergeScriptCache(cache.scripts, freshEntries);
      cache.page = nextPage;
      unsent = cache.scripts.filter(s => !s.sent);
    }

    if (unsent.length === 0) {
      return {
        success: false,
        error: `All scripts for tag group "${groupSource.tags}" have already been sent (checked through page ${cache.page})`
      };
    }

    const chosen = unsent[0];
    const chosenId = findEntryIdentifier(chosen);
    cache.scripts = cache.scripts.map(s => (chosenId && findEntryIdentifier(s) === chosenId) ? { ...s, sent: true } : s);

    const cacheWrite = insertData({ name: cacheKey, value: cache, table: "scene" });
    if (!cacheWrite.success) {
      console.warn("getNextSceneScript: failed to persist script cache:", cacheWrite.error);
    }

    return {
      success: true,
      data: [{
        source: groupSource.name,
        entries: [chosen]
      }]
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}
