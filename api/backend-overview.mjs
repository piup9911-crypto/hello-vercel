import { readFile } from "node:fs/promises";
import { join } from "node:path";

function json(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      "Content-Type": "application/json; charset=utf-8"
    }
  });
}

async function readTriageMap() {
  const filePath = join(process.cwd(), "docs", "BUG_TRIAGE_MAP.json");
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw);
}

function summarizeTriage(map) {
  return {
    schemaVersion: map.schemaVersion,
    title: map.title,
    purpose: map.purpose,
    lastUpdated: map.lastUpdated,
    sourcePolicy: map.sourcePolicy,
    forbiddenPaths: map.forbiddenPaths,
    outputFormat: map.outputFormat,
    verificationDefaults: map.verificationDefaults,
    modules: Array.isArray(map.modules)
      ? map.modules.map((item) => ({
          id: item.id,
          name: item.name,
          description: item.description,
          pages: item.pages || [],
          apis: item.apis || [],
          docs: item.docs || [],
          symptoms: item.symptoms || [],
          priorityFiles: item.priorityFiles || [],
          recommendedChecks: item.recommendedChecks || []
        }))
      : [],
    knownBugs: Array.isArray(map.knownBugs) ? map.knownBugs : [],
    promptPackTemplate: map.promptPackTemplate || null
  };
}

export async function GET() {
  try {
    const triageMap = await readTriageMap();
    return json(200, {
      schemaVersion: 1,
      cockpit: {
        name: "Bug Triage Cockpit",
        mode: "read-only",
        sections: [
          "Overview",
          "Bug Triage",
          "Project Map",
          "Runtime Health",
          "Agent State",
          "Known Bugs",
          "Safety Check",
          "Prompt Packs"
        ]
      },
      triage: summarizeTriage(triageMap),
      safety: {
        noFullRepoScan: true,
        noEnvRead: true,
        noTokenRead: true,
        noPrivateMemoryRead: true,
        noBridgeStateRead: true,
        writeActions: []
      },
      agentState: {
        plans: "agent-state/plans/",
        tasks: "agent-state/tasks/",
        handoffs: "agent-state/handoffs/",
        reviews: "agent-state/reviews/",
        locks: "agent-state/locks/"
      }
    });
  } catch (error) {
    return json(500, {
      error: error && error.message ? error.message : String(error)
    });
  }
}
