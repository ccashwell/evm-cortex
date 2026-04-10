// src/natspec-enforcer.ts
import { readFileSync, existsSync } from "fs";
function readStdin() {
  return readFileSync(0, "utf-8");
}
function checkNatSpec(filePath) {
  if (!existsSync(filePath)) return [];
  const content = readFileSync(filePath, "utf-8");
  const lines = content.split("\n");
  const missing = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const isFunctionDecl = /^\s*(function\s+\w+)/.test(line);
    if (!isFunctionDecl) continue;
    const isPublicOrExternal = /\b(public|external)\b/.test(line);
    if (!isPublicOrExternal) continue;
    const isOverride = /\boverride\b/.test(line);
    if (isOverride) continue;
    let hasNatSpec = false;
    for (let j = i - 1; j >= Math.max(0, i - 5); j--) {
      const prevLine = lines[j].trim();
      if (prevLine.startsWith("///") || prevLine.startsWith("/**") || prevLine.startsWith("*")) {
        hasNatSpec = true;
        break;
      }
      if (prevLine === "" || prevLine === "}" || prevLine === "{") continue;
      break;
    }
    if (!hasNatSpec) {
      const funcMatch = line.match(/function\s+(\w+)/);
      const funcName = funcMatch ? funcMatch[1] : "unknown";
      missing.push(`Line ${i + 1}: ${funcName}() missing NatSpec`);
    }
  }
  return missing;
}
async function main() {
  const input = JSON.parse(readStdin());
  if (input.tool_name !== "Write" && input.tool_name !== "Edit") {
    console.log("{}");
    return;
  }
  const filePath = input.tool_input?.file_path || input.tool_response?.filePath || "";
  if (!filePath.endsWith(".sol")) {
    console.log("{}");
    return;
  }
  const missing = checkNatSpec(filePath);
  if (missing.length > 0) {
    console.log(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext: `NATSPEC: ${missing.length} public/external function(s) missing documentation:

${missing.join("\n")}

Add /// @notice, @param, @return for each.`
      }
    }));
  } else {
    console.log("{}");
  }
}
main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
