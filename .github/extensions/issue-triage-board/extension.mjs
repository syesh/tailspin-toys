import { createServer } from "node:http";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { CanvasError, createCanvas, joinSession } from "@github/copilot-sdk/extension";

const execFile = promisify(execFileCallback);
const servers = new Map();

const PRIORITY_LABELS = new Map([
    ["critical", 100],
    ["blocker", 95],
    ["blocking", 90],
    ["security", 85],
    ["high priority", 80],
    ["priority: high", 80],
    ["bug", 45],
    ["enhancement", 10],
]);

function escapeHtml(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function trimText(value, length = 280) {
    const text = String(value ?? "").replace(/\s+/g, " ").trim();
    return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}

async function loadIssues() {
    const { stdout: repository } = await execFile(
        "gh",
        ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"],
        { cwd: process.cwd() },
    );
    const { stdout } = await execFile(
        "gh",
        [
            "issue",
            "list",
            "--state",
            "open",
            "--limit",
            "100",
            "--json",
            "number,title,body,url,labels,updatedAt,createdAt",
        ],
        { cwd: process.cwd() },
    );
    const issues = JSON.parse(stdout);
    const now = Date.now();
    const ranked = issues.map((issue) => {
        const labels = issue.labels.map((label) => label.name.toLowerCase());
        const matchingLabels = labels
            .filter((label) => PRIORITY_LABELS.has(label))
            .sort((left, right) => PRIORITY_LABELS.get(right) - PRIORITY_LABELS.get(left));
        const ageInDays = Math.max(0, (now - Date.parse(issue.updatedAt)) / 86_400_000);
        const recencyScore = Math.max(0, 25 - ageInDays);
        const labelScore = matchingLabels.length > 0 ? PRIORITY_LABELS.get(matchingLabels[0]) : 0;
        const score = labelScore + recencyScore;
        const reasons = [];
        if (matchingLabels.length > 0) reasons.push(`has the ${matchingLabels[0]} label`);
        if (ageInDays < 7) reasons.push("was updated recently");
        if (reasons.length === 0) reasons.push("is among the remaining open issues");
        return {
            ...issue,
            repository: repository.trim(),
            labels: issue.labels.map((label) => label.name),
            description: trimText(issue.body || "No description provided."),
            justification: reasons.join(" and "),
            score,
        };
    });
    ranked.sort((left, right) => right.score - left.score || left.number - right.number);
    return {
        repository: repository.trim(),
        top: ranked.slice(0, 3),
        remainder: ranked.slice(3),
    };
}

async function addIssueToContext(issue) {
    await session.send({
        prompt: [
            `Please add GitHub issue #${issue.number} (${issue.title}) to the current working context.`,
            `Issue URL: ${issue.url}`,
            `Issue description: ${issue.body || "No description provided."}`,
            "Start by inspecting the repository and outlining the smallest complete implementation path.",
        ].join("\n\n"),
    });
}

function issueCard(issue, highlighted) {
    const labels = issue.labels
        .map((label) => `<span class="label">${escapeHtml(label)}</span>`)
        .join("");
    return `<article class="card${highlighted ? " highlighted" : ""}">
      <div class="card-header">
        <span class="number">#${issue.number}</span>
        <a href="${escapeHtml(issue.url)}" target="_blank" rel="noreferrer">${escapeHtml(issue.title)}</a>
      </div>
      <p>${escapeHtml(issue.description)}</p>
      <div class="labels">${labels || '<span class="muted">No labels</span>'}</div>
      ${highlighted ? `<p class="why"><strong>Why now:</strong> ${escapeHtml(issue.justification)}</p>` : ""}
      <button class="add" data-number="${issue.number}">Add to current context</button>
    </article>`;
}

function renderHtml(instanceId, board) {
    const topCards = board.top.map((issue) => issueCard(issue, true)).join("");
    const remainderCards = board.remainder.length
        ? board.remainder.map((issue) => issueCard(issue, false)).join("")
        : '<p class="empty">No other open issues.</p>';
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Issue triage board</title>
  <style>
    :root { color-scheme: light dark; }
    body { margin: 0; padding: 24px; background: var(--background-color-default, #fff); color: var(--text-color-default, #1f2328); font: 14px/1.5 var(--font-sans, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif); }
    h1 { margin: 0; font-size: 24px; } h2 { margin: 28px 0 12px; font-size: 16px; }
    .intro, .muted, .empty { color: var(--text-color-muted, #656d76); }
    .intro { margin: 4px 0 20px; }
    .grid { display: grid; gap: 12px; }
    .card { border: 1px solid var(--border-color-default, #d0d7de); border-radius: 8px; padding: 14px; background: var(--background-color-default, #fff); }
    .highlighted { border-color: var(--true-color-blue, #0969da); }
    .card-header { display: flex; gap: 8px; align-items: baseline; }
    .card-header a { color: var(--true-color-blue, #0969da); font-weight: 600; text-decoration: none; }
    .card-header a:hover { text-decoration: underline; } .number { color: var(--text-color-muted, #656d76); }
    .card p { margin: 10px 0; } .why { font-size: 13px; }
    .labels { display: flex; flex-wrap: wrap; gap: 5px; }
    .label { border-radius: 999px; padding: 2px 8px; background: var(--true-color-blue-muted, #ddf4ff); color: var(--true-color-blue, #0969da); font-size: 12px; }
    button { border: 0; border-radius: 6px; padding: 7px 11px; background: var(--true-color-blue, #0969da); color: var(--color-white, #fff); cursor: pointer; font: inherit; }
    button:hover { filter: brightness(1.1); } button:focus-visible { outline: 2px solid var(--color-focus-outline, #0969da); outline-offset: 2px; }
    button:disabled { cursor: wait; opacity: .6; } .status { min-height: 20px; color: var(--text-color-muted, #656d76); }
  </style>
</head>
<body>
  <h1>Issue triage board</h1>
  <p class="intro">${escapeHtml(board.repository)} · ${board.top.length + board.remainder.length} open issue${board.top.length + board.remainder.length === 1 ? "" : "s"}</p>
  <div id="status" class="status" role="status" aria-live="polite"></div>
  <h2>Needs attention now</h2>
  <div class="grid">${topCards || '<p class="empty">No open issues.</p>'}</div>
  <h2>Remaining open issues</h2>
  <div class="grid">${remainderCards}</div>
  <script>
    document.querySelectorAll(".add").forEach((button) => {
      button.addEventListener("click", async () => {
        button.disabled = true;
        document.querySelector("#status").textContent = "Adding issue to the current context…";
        try {
          const response = await fetch("/add", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ number: Number(button.dataset.number) }) });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error || "Unable to add issue");
          document.querySelector("#status").textContent = result.message;
        } catch (error) {
          document.querySelector("#status").textContent = error.message;
          button.disabled = false;
        }
      });
    });
  </script>
</body>
</html>`;
}

async function startServer(instanceId) {
    const board = await loadIssues();
    const server = createServer(async (req, res) => {
        try {
            if (req.method === "POST" && req.url === "/add") {
                let body = "";
                for await (const chunk of req) body += chunk;
                const { number } = JSON.parse(body);
                const issue = [...board.top, ...board.remainder].find((item) => item.number === number);
                if (!issue) {
                    res.writeHead(404, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ error: "Issue not found on this board." }));
                    return;
                }
                await addIssueToContext(issue);
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ message: `Issue #${issue.number} added to the current context.` }));
                return;
            }
            res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
            res.end(renderHtml(instanceId, board));
        } catch (error) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: error instanceof Error ? error.message : "Unable to load issues." }));
        }
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    return { server, url: `http://127.0.0.1:${port}/` };
}

const session = await joinSession({
    canvases: [
        createCanvas({
            id: "issue-triage-board",
            displayName: "Issue triage board",
            description: "Kanban board that ranks open repository issues and adds selected issues to the current session context.",
            actions: [
                {
                    name: "add_issue_to_context",
                    description: "Add an issue from the board to the current session context.",
                    inputSchema: { type: "object", properties: { number: { type: "integer" } }, required: ["number"], additionalProperties: false },
                    handler: async (ctx) => {
                        const board = await loadIssues();
                        const issue = [...board.top, ...board.remainder].find((item) => item.number === ctx.input?.number);
                        if (!issue) throw new CanvasError("issue_not_found", "The requested open issue was not found.");
                        await addIssueToContext(issue);
                        return { added: issue.number };
                    },
                },
            ],
            open: async (ctx) => {
                let entry = servers.get(ctx.instanceId);
                if (!entry) {
                    entry = await startServer(ctx.instanceId);
                    servers.set(ctx.instanceId, entry);
                }
                return { title: "Issue triage board", url: entry.url };
            },
            onClose: async (ctx) => {
                const entry = servers.get(ctx.instanceId);
                if (entry) {
                    servers.delete(ctx.instanceId);
                    await new Promise((resolve) => entry.server.close(() => resolve()));
                }
            },
        }),
    ],
});
