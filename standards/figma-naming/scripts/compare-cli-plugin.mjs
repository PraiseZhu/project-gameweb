/**
 * compare-cli-plugin.mjs — A1 acceptance diff.
 *
 * Compares the set of (code, nodeId) findings from the CLI JSON and the plugin
 * JSON. Exits 0 when the sets are equal, 1 when they differ.
 */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function loadFindings(json) {
  if (Array.isArray(json)) return json;
  if (Array.isArray(json?.findings)) return json.findings;
  throw new Error("JSON 里没有 findings 数组");
}

export function findingKey(f) {
  return `${String(f?.code ?? "")}\u0000${String(f?.nodeId ?? "")}`;
}

export function compareFindings(cliFindings, pluginFindings) {
  const cli = new Set(cliFindings.map(findingKey));
  const plugin = new Set(pluginFindings.map(findingKey));
  const onlyCli = [...cli].filter((k) => !plugin.has(k)).sort();
  const onlyPlugin = [...plugin].filter((k) => !cli.has(k)).sort();
  return { equal: onlyCli.length === 0 && onlyPlugin.length === 0, onlyCli, onlyPlugin };
}

function main() {
  const [, , cliPath, pluginPath] = process.argv;
  if (!cliPath || !pluginPath) {
    console.error("用法: node scripts/compare-cli-plugin.mjs <cli.json> <plugin.json>");
    process.exit(2);
  }

  let cli, plugin;
  try {
    cli = loadFindings(JSON.parse(readFileSync(cliPath, "utf8")));
    plugin = loadFindings(JSON.parse(readFileSync(pluginPath, "utf8")));
  } catch (error) {
    console.error(`✘ ${error.message}`);
    process.exit(1);
  }

  const result = compareFindings(cli, plugin);
  if (result.equal) {
    console.log("集合完全一致");
    process.exit(0);
  }

  console.error(`集合不一致：CLI ${cli.length} 条 / 插件 ${plugin.length} 条`);
  for (const k of result.onlyCli) {
    const [code, nodeId] = k.split("\u0000");
    console.error(`  仅 CLI: ${code} @ ${nodeId}`);
  }
  for (const k of result.onlyPlugin) {
    const [code, nodeId] = k.split("\u0000");
    console.error(`  仅插件: ${code} @ ${nodeId}`);
  }
  process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
