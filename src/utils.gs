const properties = PropertiesService.getScriptProperties();

//////////////////AI SEARCH ABILITY COMING SOON///////////////////
function search(searchQuerys) {
  const serperKey = properties.getProperty('SERPER_API_KEY');
  const searchUrl = properties.getProperty('SEARCH_URL');
  const searchRequests = [];
  searchQuerys.forEach(searchQuery => {
    const searchPayload = {
      "q": searchQuery,
      "num": 2,
    };
    const searchOptions = {
      url: searchUrl,
      method: 'post',
      contentType: 'application/json',
      headers: { 'X-API-KEY': serperKey },
      payload: JSON.stringify(searchPayload),
      muteHttpExceptions: true
    };
    searchRequests.push(searchOptions);
  });
  const searchResponses = UrlFetchApp.fetchAll(searchRequests);
  return searchResponses;
}
//////////////////AI SEARCH ABILITY COMING SOON///////////////////

/**
 * Loads the agent's operating instructions from the AGENT Google Doc
 * (mirrors loadTools/loadSkills). Replaces the old hardcoded `instructions`
 * string that used to live in this file.
 */
function loadAgent() {
  try {
    const agentKey = properties.getProperty('AGENT_KEY');
    const doc = DocumentApp.openById(agentKey);
    const body = doc.getBody();
    return {
      success: true,
      data: body.getText()
    };
  } catch (e) {
    return {
      success: false,
      error: e.message
    };
  }
}

function loadTools() {
  try {
    const toolKey = properties.getProperty('TOOLS_KEY');
    const doc = DocumentApp.openById(toolKey);
    const body = doc.getBody();
    const tools = body.getText();
    return {
      success: true,
      data: tools
    };
  } catch (e) {
    return {
      success: false,
      error: e.message
    };
  }
}

function loadSkills() {
  try {
    const skillKey = properties.getProperty('SKILLS_KEY');
    const doc = DocumentApp.openById(skillKey);
    const body = doc.getBody();
    const skills = body.getText();
    return {
      success: true,
      data: skills
    };
  } catch (e) {
    return {
      success: false,
      error: e.message
    };
  }
}

/**
 * Sends a prompt to the LLM and returns its raw text response in `data`.
 * Callers are responsible for JSON.parse'ing `data` if they asked the model
 * for structured output.
 */
function llm(prompt) {
  const inputTokens = Math.ceil(prompt.length / 4);
  console.log("Prompt chars:", prompt.length, "~tokens:", inputTokens);

  // Fixed completion budget. The old version derived this as
  // (8000 - inputTokens - 250), which meant every extra observation added to
  // the prompt ate directly into the model's room to respond. Once the
  // prompt grew large (e.g. after webScraper results were embedded into the
  // observation history), this collapsed to its 100-token floor — nowhere
  // near enough to emit a full task JSON block, causing the model to fall
  // back to degenerate output like {"nextAction":{"tool":null}}.
  // TPM ("tokens per minute") is a rate limit on your Groq account, not a
  // per-request context budget, so it shouldn't be used to shrink this.
  const MAX_COMPLETION_TOKENS = 1200;

  const groqKey = properties.getProperty("GROQ_API_KEY");
  const groqUrl = properties.getProperty("GROQ_URL");

  const payload = {
    model: "openai/gpt-oss-120b",
    messages: [{ role: "user", content: prompt }],
    tool_choice: "none",
    temperature: 0,
    max_completion_tokens: MAX_COMPLETION_TOKENS,
  };

  const options = {
    method: "post",
    headers: { Authorization: `Bearer ${groqKey}` },
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  const MAX_RETRIES = 5;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      console.log("Calling LLM...");
      // Only throttle on retries — no need to pre-emptively delay the first attempt.
      if (attempt > 0) Utilities.sleep(5000);

      const response = UrlFetchApp.fetch(groqUrl, options);
      const status = response.getResponseCode();
      const text = response.getContentText();

      const headers = response.getHeaders();
      const remainingTokens = headers["x-ratelimit-remaining-tokens"];
      const resetTokens = headers["x-ratelimit-reset-tokens"];
      if (remainingTokens !== undefined || resetTokens !== undefined) {
        console.log(`Groq rate-limit — remaining tokens: ${remainingTokens}, resets in: ${resetTokens}`);
      }

      if (status === 429) {
        const delay = Math.min(15000 * Math.pow(2, attempt), 60000);
        console.warn(`Rate limited. Retry ${attempt + 1}/${MAX_RETRIES} in ${delay / 1000}s`);
        Utilities.sleep(delay);
        continue;
      }

      const data = JSON.parse(text);
      console.log("Parsed JSON");

      if (status >= 400 || data.error) {
        return {
          success: false,
          error: data?.error?.message || text
        };
      }

      const finishReason = data?.choices?.[0]?.finish_reason;
      console.log("finish_reason:", finishReason);
      if (finishReason && finishReason !== "stop") {
        // "length" = hit max_completion_tokens (or a live account-level TPM
        // ceiling below what we estimated); anything else (e.g.
        // "content_filter") is a different problem entirely — either way,
        // this is worth knowing explicitly rather than only inferring it
        // from a downstream JSON.parse failure.
        console.warn(`llm(): response did not finish normally (finish_reason="${finishReason}") — output may be truncated.`);
      }

      return {
        success: true,
        data: data.choices[0].message.content
      };
    } catch (e) {
      return {
        success: false,
        error: "Network error: " + e.toString()
      };
    }
  }

  return {
    success: false,
    error: "Rate limit exceeded after maximum retries."
  };
}

function summarizeObservation(result) {
  if (!result?.success) {
    return {
      success: false,
      error: result.error
    };
  }

  let data;
  try {
    data = JSON.parse(result?.data);
  } catch (e) {
    data = result?.data;
  }

  if (Array.isArray(data)) {
    return { success: true, type: "array", count: data.length };
  }
  if (typeof data === "string") {
    return { success: true, type: "string", length: data.length };
  }
  if (typeof data === "object" && data !== null) {
    return { success: true, type: "object", keys: Object.keys(data) };
  }
  return { success: true };
}

/**
 * Strips empty/null/undefined fields from a scraped entry so sendEmail
 * doesn't render blank rows for them.
 */
/**
 * Finds the value of whichever field on an entry looks like a URL/link,
 * by name (e.g. "link", "url", "link to pdf") rather than requiring an
 * exact field name — schemas vary per source. Falls back to "title" (or
 * a JSON snapshot) when no link-like field exists, so identity matching
 * still works even without one, just less reliably.
 */
function findEntryIdentifier(entry) {
  if (!entry) return null;
  const linkKey = Object.keys(entry).find(k => /link|url/i.test(k));
  if (linkKey && entry[linkKey]) return entry[linkKey];
  return entry.title || JSON.stringify(entry);
}

function cleanEntry(entry) {
  const cleaned = {};
  Object.entries(entry || {}).forEach(([field, value]) => {
    if (value !== null && value !== undefined && value !== "") {
      cleaned[field] = value;
    }
  });
  return cleaned;
}

/**
 * Flattens whichever array-valued fields are present on a webScraper
 * result object (the schema key varies per source — "classes", "castings",
 * "scripts", etc.) into one combined, cleaned list of entries.
 */
function flattenScrapedEntries(dataObj) {
  return Object.values(dataObj || {})
    .filter(Array.isArray)
    .reduce((all, arr) => all.concat(arr), [])
    .map(cleanEntry);
}

/**
 * Reshapes webScraper's output ({source, data: {<schemaKey>: [...]}}) into
 * the flat {source, entries} structure sendEmail renders. Also accepts an
 * already-flattened {source, entries} shape as a no-op pass-through (just
 * cleaned) — the agent doesn't always call formatEmail and
 * filterSentOpportunities in the same order, so this needs to behave
 * correctly regardless of which one ran first.
 *
 * This is done in plain code, not via the LLM: now that webScraper returns
 * a uniform shape, flattening it is mechanical. Asking the LLM to reproduce
 * potentially dozens of entries verbatim per source risks truncation (it
 * competes with the TPM budget) and risks the model silently dropping or
 * altering entries — neither of which is acceptable for data that's about
 * to be emailed as fact.
 */
function formatEmail(data) {
  try {
    const items = Array.isArray(data?.content) ? data.content : [];

    const sections = items.map(item => ({
      source: item?.source || "Unknown source",
      entries: Array.isArray(item?.entries)
        ? item.entries.map(cleanEntry)
        : flattenScrapedEntries(item?.data)
    }));

    return { success: true, data: sections };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

const SENT_OPPORTUNITIES_TTL_DAYS = 10;
const SENT_OPPORTUNITIES_TTL_MS = SENT_OPPORTUNITIES_TTL_DAYS * 24 * 60 * 60 * 1000;

/**
 * Removes any entries already emailed previously, and records the ones
 * about to be sent as sent — same idea as the scene-study "sent" cache,
 * but for a whole batch at once rather than picking a single item.
 *
 * Persists under the key "sentOpportunities" in whichever table is given
 * (e.g. "actor", "swe"), as a list of { id, sentAt } records (id from
 * findEntryIdentifier — not full entries, so it stays small). Records
 * older than SENT_OPPORTUNITIES_TTL_DAYS are pruned on every run, so a
 * listing that reappears after 10+ days is treated as new again rather
 * than being blocked forever.
 *
 * Works whether it's called before or after formatEmail — accepts either
 * formatEmail's {source, entries} shape or webScraper's raw {source, data}
 * shape (auto-flattening the latter), since the agent doesn't reliably
 * call these in the same order every time.
 */
function filterSentOpportunities(data) {
  try {
    const table = data?.table;
    if (!table) {
      return { success: false, error: "filterSentOpportunities requires a 'table' argument" };
    }
    const sections = Array.isArray(data?.content) ? data.content : [];
    const cacheKey = "sentOpportunities";

    const cacheLookup = lookupData({ name: cacheKey, table });
    const rawSent = (cacheLookup.success && Array.isArray(cacheLookup.data)) ? cacheLookup.data : [];

    const now = Date.now();
    const activeSent = rawSent.filter(record => {
      const sentAt = record && typeof record === "object" ? record.sentAt : null;
      if (!sentAt) return false; // drop malformed/legacy (pre-TTL, bare-string) records
      return (now - new Date(sentAt).getTime()) < SENT_OPPORTUNITIES_TTL_MS;
    });
    const sentSet = new Set(activeSent.map(record => record.id));

    const filteredSections = [];
    const newlySent = [];

    sections.forEach(section => {
      const entries = Array.isArray(section?.entries)
        ? section.entries
        : flattenScrapedEntries(section?.data);
      const unseen = entries.filter(entry => {
        const id = findEntryIdentifier(entry);
        return id && !sentSet.has(id);
      });
      if (unseen.length > 0) {
        filteredSections.push({ source: section.source, entries: unseen });
        unseen.forEach(entry => {
          const id = findEntryIdentifier(entry);
          if (id) newlySent.push({ id, sentAt: new Date(now).toISOString() });
        });
      }
    });

    // Always write back — even with nothing new — so pruned/expired
    // records actually get removed from storage rather than just
    // ignored in memory this one run.
    const updated = activeSent.concat(newlySent);
    const writeResult = insertData({ name: cacheKey, value: updated, table });
    if (!writeResult.success) {
      console.warn("filterSentOpportunities: failed to persist sent history:", writeResult.error);
    }

    // filteredSections may legitimately be empty when everything scraped
    // this run has already been sent before — that's success, not an
    // error; sendEmail treats empty content as "nothing new to send."
    return { success: true, data: filteredSections };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * Renders `data.content` (the array formatEmail produces) into an HTML email
 * and sends it to the user's own Gmail address.
 */
function sendEmail(data) {
  try {
    const email = Session.getEffectiveUser().getEmail();
    const sections = Array.isArray(data?.content) ? data.content : [];
    const subject = `${data?.subject}` || "Automated Report";

    const hasAnyEntries = sections.some(s => Array.isArray(s?.entries) && s.entries.length > 0);
    if (!hasAnyEntries) {
      console.log("sendEmail: nothing new to send (everything already sent previously) — skipping.");
      return { success: true, data: "Nothing new to send — no email sent." };
    }

    let htmlBody = `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #dddddd; color: #333333;">`;

    htmlBody += `
      <header style="padding-bottom: 10px; border-bottom: 2px solid #333333; margin-bottom: 20px;">
        <h1 style="margin: 0; font-size: 22px; color: #1a73e8;">⏰ ${subject}</h1>
      </header>
    `;

    sections.forEach(section => {
      htmlBody += `<h3 style="color: #5f6368; margin: 20px 0 10px 0; font-size: 16px; text-transform: uppercase; letter-spacing: 0.5px;">${section.source || ""}</h3>`;

      const entries = Array.isArray(section.entries) ? section.entries : [];
      entries.forEach(entry => {
        htmlBody += `<table style="width: 100%; border-collapse: collapse; margin-bottom: 12px; font-size: 14px;"><tbody>`;
        Object.entries(entry).forEach(([field, value]) => {
          if (value === null || value === undefined || value === "") return;
          const isLink = /link|url/i.test(field);
          const displayValue = isLink ? `<a href="${value}">${value}</a>` : value;
          htmlBody += `
            <tr style="border-bottom: 1px solid #e8eaed;">
              <td style="padding: 6px 10px; font-weight: 600; text-transform: capitalize;">${field}</td>
              <td style="padding: 6px 10px;">${displayValue}</td>
            </tr>
          `;
        });
        htmlBody += `</tbody></table>`;
      });
    });

    htmlBody += `</div>`;

    MailApp.sendEmail({
      to: email,
      subject: subject,
      htmlBody: htmlBody
    });

    return {
      success: true,
      data: `"${subject}" was emailed successfully`
    };
  } catch (e) {
    return {
      success: false,
      error: e.message
    };
  }
}

function webScraper(data) {
  try {
    const firecrawlUrl = properties.getProperty('FIRECRAWL_URL');
    const firecrawlKey = properties.getProperty('FIRECRAWL_API_KEY');
    const scrapeRequests = [];
    const sourceNames = [];

    data.content.forEach(website => {
      // Some sheet entries are missing "https://" (or have markdown-style
      // "[text](url)" wrapping) — normalize so the request doesn't silently
      // fail. webScraperResults() drops failed responses without surfacing
      // why, so a bad URL here looks identical to "the page had no data."
      let link = (website.link || "").trim();
      const markdownLinkMatch = link.match(/\(([^)]+)\)\s*$/);
      if (markdownLinkMatch) link = markdownLinkMatch[1];
      if (!/^https?:\/\//i.test(link)) link = "https://" + link;

      const firecrawlPayload = {
        url: link,
        formats: [{
          type: "json",
          schema: {
            type: "object",
            properties: website.properties
          }
        }]
      };
      const scrapeOptions = {
        url: firecrawlUrl,
        method: 'post',
        contentType: 'application/json',
        headers: { 'Authorization': 'Bearer ' + firecrawlKey },
        payload: JSON.stringify(firecrawlPayload),
        muteHttpExceptions: true
      };
      scrapeRequests.push(scrapeOptions);
      // fetchAll preserves request order, so this lines up 1:1 with the response at the same index.
      sourceNames.push(website.name || "Unknown source");
    });

    const scrapeResponses = UrlFetchApp.fetchAll(scrapeRequests);

    if (scrapeResponses.length > 0) {
      const results = webScraperResults(scrapeResponses, sourceNames);
      return { success: true, data: results };
    }
    return { success: false, error: "response is empty" };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * Unwraps Firecrawl's schema-driven JSON response and pairs each result
 * with the source name that produced it.
 * Firecrawl returns extracted fields nested under result.data.json when a
 * schema is used (e.g. { json: { classes: [...] } }) — previously the whole
 * wrapper was JSON.stringify'd again, forcing downstream tools to parse
 * JSON-within-JSON with no idea which source it came from.
 */
function webScraperResults(scrapeResponses, sourceNames) {
  const results = [];
  scrapeResponses.forEach((scrapeData, i) => {
    let result;
    try {
      result = JSON.parse(scrapeData.getContentText());
    } catch (e) {
      console.warn("webScraper: unparsable response for", sourceNames[i], "-", e.message);
      return;
    }
    if (result?.error) {
      console.warn("webScraper: a source returned an error and was dropped:", result.error);
      return;
    }

    const extracted = result?.data?.json ?? result?.data;
    if (!extracted) return;

    results.push({
      source: sourceNames[i],
      data: extracted
    });
  });
  return results;
}
/**
 * Executes a named tool with the given arguments.
 * Always returns { success, data } or { success: false, error }.
 */
function execute(action) {
  const functionRef = {
    lookupData,
    webScraper,
    insertData,
    formatEmail,
    filterSentOpportunities,
    sendEmail,
    getNextSceneScript,
    fetchSweJobs,
    loadTools,
    loadSkills,
  };
  const tool = functionRef[action?.tool];
  const args = action?.arguments;

  try {
    if (!tool) {
      return {
        success: false,
        error: `Unknown tool: "${action?.tool}". This is not a key in the Tools object provided — nextAction.tool must exactly match one of that object's keys.`
      };
    }
    const response = args ? tool(args) : tool();
    if (!response?.success) {
      return { success: false, error: response?.error || "Tool returned no result" };
    }
    return { success: true, data: response.data };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function agentLoop(task, skillsText) {
  const agentDoc = loadAgent();
  if (!agentDoc.success) {
    return [{ error: "Failed to load agent instructions: " + agentDoc.error }];
  }
  const instructions = agentDoc.data;

  let goal, tools, tables;
  const observations = [];
  const memory = {};
  let iterations = 0;
  let obsCounter = 0;
  let consecutiveFailures = 0;
  const MAX_ITERATIONS = 10;
  const MAX_CONSECUTIVE_FAILURES = 3;

  while (iterations < MAX_ITERATIONS) {
    let current;
    try {
      current = JSON.parse(task);
      goal = current?.goal ?? goal;
      tools = current?.tools ?? tools;
      tables = current?.tables ?? tables;
    } catch (e) {
      observations.push({
        error: "Invalid JSON returned from LLM",
        rawResponse: task
      });
      break;
    }

    if (current?.complete) {
      console.log("The agent loop completed. Model's stated reasoning:", current?.reasoning || "(none given)");
      break;
    }

    // actionForRecord is what gets stored in `observations` (kept small —
    // just the "id" reference). actionToRun is a separate copy with the
    // full prior result injected into it for execution. Previously
    // Object.assign() mutated current.nextAction in place, so the full
    // injected payload (e.g. an entire webScraper result) got baked
    // permanently into observations and re-sent on every future prompt,
    // growing without bound.
    let actionToRun = current?.nextAction;
    const actionForRecord = current?.nextAction;

    if (current?.nextAction?.arguments?.id) {
      console.log("tool", current.nextAction.tool, "id", current.nextAction.arguments.id);
      const injectedData = memory[current.nextAction.arguments.id]?.data;
      actionToRun = {
        ...current.nextAction,
        arguments: { ...current.nextAction.arguments, content: injectedData }
      };
    } else {
      console.log("tool", current?.nextAction?.tool);
    }

    const result = execute(actionToRun);
    obsCounter++;
    const observationId = `obs_${obsCounter}`;

    let resultSummary;
    if (!result.success) {
      console.log("error", result.error);
      consecutiveFailures++;
      resultSummary = { success: false, error: result.error };
    } else {
      consecutiveFailures = 0;
      memory[observationId] = result;
      resultSummary = summarizeObservation(result);
    }

    observations.push({
      id: observationId,
      completedAction: actionForRecord,
      reasoning: current?.reasoning,
      resultSummary: resultSummary
    });

    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      console.log(`Stopping early after ${consecutiveFailures} consecutive failures`);
      break;
    }

    // Always replan after every action — including failures. Previously,
    // a failed action just repeated itself verbatim until the failure cap
    // was hit, because the LLM was never asked again and `task` was never
    // reassigned. Now the model sees its own error and gets a real chance
    // to self-correct (see AGENT doc for the rule binding nextAction.tool
    // to the Tools object's keys).
    const replanPrompt = `
AGENT INSTRUCTIONS:
${instructions}

Goal:
${goal}

Previous Observations:
${JSON.stringify(observations)}

Skill Instructions:
${skillsText || ""}

Tools:
${JSON.stringify(tools)}

Tables:
${JSON.stringify(tables)}
`;

    const llmResult = llm(replanPrompt);

    if (!llmResult?.success) {
      observations.push({ error: llmResult.error });
      break;
    }

    task = llmResult.data;
    iterations++;
  }

  console.log("iterations", iterations);
  return observations;
}

/**
 * Pulls just the named skill's block out of the full Available Skills
 * doc text, so it can be reused across every replan turn without ever
 * asking the model to reproduce it. Falls back to the full text if a
 * name can't be matched (e.g. unexpected doc formatting), so a run
 * never silently loses skill guidance entirely.
 */
function extractSkillBlocks(fullSkillsText, skillNames) {
  if (!fullSkillsText) return "";
  const names = (Array.isArray(skillNames) ? skillNames : [skillNames])
    .filter(Boolean)
    .map(n => n.toLowerCase().trim());
  if (names.length === 0) return fullSkillsText;

  const blocks = fullSkillsText.split(/\n(?=name:\s*)/i);
  const matches = blocks.filter(block => {
    const firstLine = block.trim().split("\n")[0].toLowerCase();
    return names.some(name => firstLine === `name: ${name}`);
  });

  return matches.length > 0 ? matches.join("\n\n") : fullSkillsText;
}

function planner(goal) {
  goal = goal || 'Send new acting opportunities via Gmail email';
  try {
    const tools = loadTools();
    const skills = loadSkills();
    const agent = loadAgent();
    if (!tools?.success) return console.error(tools.error);
    if (!skills?.success) return console.error(skills.error);
    if (!agent?.success) return console.error(agent.error);

    const planningPrompt = `
AGENT INSTRUCTIONS:
${agent.data}

Goal:
${goal}

Available Skills:
${skills.data}

Available Tools:
${tools.data}

Select the necessary Skill(s) and Tool(s) from Available Skills and Available Tools needed to complete the goal, and include additional key/value pairs in the Task Structure for initial planning. IMPORTANT: the "tools" object you return must include every tool needed across the ENTIRE workflow described in the selected skill's instructions (e.g. retrieving data, scraping, and delivering the result) — not just the first action. No tool can be added later once the run starts, so under-selecting here will leave a later step with nothing valid to use. Only use tools that are in Available Tools, except those explicitly marked as not invokable. Make sure the tools object includes required argument keys set to placeholder default values of the exact expected type — these will be updated during the agent loop. For "skills", return ONLY an array of the exact skill name(s) needed, e.g. ["send-acting-opportunities"] — do NOT copy the skill's description or instructions text into your response; that text is already on file and will be reattached automatically. Do not invent tool or skill names that are not listed. Create a "tables" key listing the required tables to complete the goal. In "nextAction", include the actual expected data needed to complete the first step.
`;

    // A truncated/invalid initial plan is usually a transient live-TPM
    // issue (e.g. rapid back-to-back test runs eating into the account's
    // real per-minute budget) rather than a problem with this specific
    // prompt — so it's worth a couple of retries with a short pause
    // before giving up on the whole run.
    const MAX_PLAN_ATTEMPTS = 3;
    let planParsed = null;
    let lastRawResponse = null;
    let lastError = null;

    for (let attempt = 0; attempt < MAX_PLAN_ATTEMPTS; attempt++) {
      if (attempt > 0) {
        const delay = 25000;
        console.warn(`Retrying initial plan (attempt ${attempt + 1}/${MAX_PLAN_ATTEMPTS}) in ${delay / 1000}s...`);
        Utilities.sleep(delay);
      }

      const plan = llm(planningPrompt);
      if (!plan?.success) {
        lastError = plan.error;
        continue;
      }

      lastRawResponse = plan.data;
      try {
        planParsed = JSON.parse(plan.data);
        break;
      } catch (e) {
        lastError = e.message;
        console.warn(`Initial plan was not valid JSON on attempt ${attempt + 1}:`, e.message);
      }
    }

    if (!planParsed) {
      console.error("Initial plan failed after retries:", lastError, lastRawResponse);
      return [{ error: "Invalid JSON returned from LLM after retries", rawResponse: lastRawResponse }];
    }

    // "skills" should now just be an array of names, but handle the old
    // {name: text} shape too in case the model still returns it that way.
    const selectedSkillNames = Array.isArray(planParsed.skills)
      ? planParsed.skills
      : Object.keys(planParsed.skills || {});
    const skillsText = extractSkillBlocks(skills.data, selectedSkillNames);

    const observations = agentLoop(JSON.stringify(planParsed), skillsText);
    console.log(JSON.stringify(observations, null, 2));
    return observations;
  } catch (e) {
    console.error(`something went wrong: ${e}`);
  }
}
