/**
 * Fetches current listings for send-swe-jobs from RemoteOK's public JSON
 * feed (https://remoteok.com/api — free, no auth, aggregates postings
 * across many companies). No Firecrawl/webScraper needed here since this
 * is already structured JSON, not an HTML page needing AI extraction.
 *
 * Reads one or more search configs from sources/swe, e.g.:
 *   [{ "name": "RemoteOK - DevOps Engineer", "keywords": "devops engineer" }]
 * "keywords" is matched (all words, case-insensitive) against each job's
 * title, company, tags, and description — RemoteOK's own ?tag= filter
 * only matches a fixed tag taxonomy, not free-text phrases, so filtering
 * is done here instead of relying on their query params.
 *
 * Returns the same {source, data: {jobs: [...]}} shape webScraper produces,
 * so formatEmail/filterSentOpportunities/sendEmail all work unchanged.
 */
function fetchSweJobs() {
  try {
    const sourceResult = lookupData({ name: "swe", table: "sources" });
    if (!sourceResult.success) return sourceResult;
    const configs = Array.isArray(sourceResult.data) ? sourceResult.data : [];
    if (configs.length === 0) {
      return { success: false, error: "No search configs found under sources/swe" };
    }

    const response = UrlFetchApp.fetch("https://remoteok.com/api", { muteHttpExceptions: true });
    if (response.getResponseCode() >= 400) {
      return { success: false, error: `RemoteOK request failed with status ${response.getResponseCode()}` };
    }

    let allItems;
    try {
      allItems = JSON.parse(response.getContentText());
    } catch (e) {
      return { success: false, error: "Could not parse RemoteOK response: " + e.message };
    }

    // RemoteOK's first array element is a legal/notice object, not a job.
    const jobs = (Array.isArray(allItems) ? allItems : []).filter(item => item?.id && item?.position);

    const results = configs.map(config => {
      const keywords = (config.keywords || "").toLowerCase().split(/\s+/).filter(Boolean);
      const matched = jobs
        .filter(job => {
          const haystack = [job.position, job.company, (job.tags || []).join(" "), job.description]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          return keywords.length === 0 || keywords.every(word => haystack.includes(word));
        })
        .map(job => ({
          title: job.position,
          company: job.company,
          location: job.location || "",
          link: job.url,
          date: job.date || "",
          tags: Array.isArray(job.tags) ? job.tags.join(", ") : ""
        }));

      return {
        source: config.name || "RemoteOK",
        data: { jobs: matched }
      };
    });

    return { success: true, data: results };
  } catch (e) {
    return { success: false, error: e.message };
  }
}
