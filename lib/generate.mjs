import fs from "fs/promises";
import path from "path";
import micromatch from "micromatch";

function countMatches(s, re) {
  if (!s) return 0;
  let m, c = 0;
  const r = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  while ((m = r.exec(s)) !== null) c++;
  return c;
}

function extToLang(rel) {
  const base = path.basename(rel);
  if (base.toLowerCase() === "dockerfile") return "dockerfile";
  const ext = path.extname(rel).toLowerCase();
  return EXT_LANG.get(ext) || "";
}

// very light static checks across a few popular languages
function analyzeContent(rel, content) {
  const lang = extToLang(rel);
  const lines = content.split(/\r?\n/);
  const loc = lines.length;

  // language-ish regex
  const jsLike = /(javascript|typescript|tsx|jsx)/.test(lang);
  const pyLike = /python/.test(lang);
  const goLike = /go/.test(lang);
  const shLike = /bash|shell/.test(lang);

  // imports / exports
  const importRe = jsLike ? /^\s*(import\s.+from\s+['"].+['"];?|const\s+\w+\s*=\s*require\(['"].+['"]\))/m
               : pyLike ? /^\s*(from\s+\w+(\.\w+)*\s+import\s+.+|import\s+\w+(\.\w+)*)/m
               : goLike ? /^\s*import\s*\(/m
               : /$^/;
  const exportRe = jsLike ? /\bexport\s+(?:default\s+)?(?:class|function|const|let|var|\{)/m
               : goLike ? /\bfunc\s+\w+\(/m
               : pyLike ? /^\s*def\s+\w+\(/m
               : /$^/;

  // basic structure/branching
  const fnCount = jsLike ? countMatches(content, /\bfunction\b|\=\>\s*\(/g)
               : pyLike ? countMatches(content, /^\s*def\s+\w+\s*\(/gm)
               : goLike ? countMatches(content, /\bfunc\s+\w+\s*\(/g)
               : countMatches(content, /\bfunction\b|\bdef\b|\bproc\b/g);

  const branchCount = countMatches(content, /\b(if|else if|elif|switch|case|for|while|catch|except)\b/g);

  // crude complexity proxy
  const cyclomaticProxy = 1 + branchCount;

  // notes / smells
  const todos = countMatches(content, /\b(TODO|FIXME|HACK|BUG)\b/g);
  const hasConsole = jsLike && /(^|\s)console\./m.test(content);
  const hasPrint = pyLike && /^\s*print\(/m.test(content);
  const suspiciousSecrets =
    /(?:(AWS|AZURE|GCP|GOOGLE|OPENAI)[\w\-]*_?(KEY|SECRET|TOKEN)|secret_key|api[_-]?key|access[_-]?key)\s*[:=]\s*['"][A-Za-z0-9\/\+\-_=\.\:]{12,}['"]/i
      .test(content) ||
    /-----BEGIN (?:RSA|EC|OPENSSH) PRIVATE KEY-----/.test(content);

  const bigFile = loc > 1200;

  const smells = [];
  if (todos) smells.push(`Has ${todos} TODO/FIXME/HACK/BUG tags`);
  if (hasConsole) smells.push("Uses console.* (consider a logger)");
  if (hasPrint) smells.push("Uses print() (consider a logger)");
  if (suspiciousSecrets) smells.push("⚠️ Possible secrets in file");
  if (bigFile) smells.push(`Large file (${loc} LOC)`);

  // quick import summary (top 50 lines)
  const head = lines.slice(0, 50).join("\n");
  let imports = [];
  if (jsLike) {
    const m1 = [...head.matchAll(/import\s+.+?from\s+['"](.+?)['"]/g)].map(m => m[1]);
    const m2 = [...head.matchAll(/require\(['"](.+?)['"]\)/g)].map(m => m[1]);
    imports = [...new Set([...m1, ...m2])].slice(0, 10);
  } else if (pyLike) {
    const m1 = [...head.matchAll(/^\s*from\s+([\w\.]+)\s+import/mg)].map(m => m[1]);
    const m2 = [...head.matchAll(/^\s*import\s+([\w\.]+)/mg)].map(m => m[1]);
    imports = [...new Set([...m1, ...m2])].slice(0, 10);
  } else if (goLike) {
    const block = head.match(/import\s*\(([^)]+)\)/);
    if (block) {
      imports = [...block[1].matchAll(/"(.*?)"/g)].map(m => m[1]).slice(0, 10);
    } else {
      const single = [...head.matchAll(/^\s*import\s+"(.*?)"/mg)].map(m => m[1]);
      imports = [...new Set(single)].slice(0, 10);
    }
  }

  const headerCommentSuggestion =
    jsLike ? [
      "/**",
      ` * File: ${rel}`,
      " * Purpose: …",
      " * Key exports: …",
      " * Notes: …",
      " */"
    ].join("\n")
    : pyLike ? [
      `\"\"\"`,
      `File: ${rel}`,
      `Purpose: …`,
      `Key functions/classes: …`,
      `Notes: …`,
      `\"\"\"`
    ].join("\n")
    : goLike ? [
      `// File: ${rel}`,
      `// Purpose: …`,
      `// Key functions: …`,
      `// Notes: …`
    ].join("\n")
    : `# File: ${rel}\n# Purpose: …\n# Notes: …`;

  return {
    lang,
    loc,
    fnCount,
    branchCount,
    cyclomaticProxy,
    imports,
    smells,
    hasExports: exportRe.test(content),
    hasImports: importRe.test(content),
    todos,
    headerCommentSuggestion
  };
}

const EXT_LANG = new Map([
  [".js", "javascript"], [".mjs", "javascript"], [".cjs", "javascript"],
  [".ts", "typescript"], [".tsx", "tsx"], [".jsx", "jsx"],
  [".json", "json"], [".yml", "yaml"], [".yaml", "yaml"], [".toml", "toml"],
  [".md", "markdown"], [".txt", "text"],
  [".py", "python"], [".rb", "ruby"], [".php", "php"],
  [".java", "java"], [".kt", "kotlin"], [".swift", "swift"],
  [".c", "c"], [".h", "c"], [".cpp", "cpp"], [".cc", "cpp"], [".hpp", "cpp"],
  [".cs", "csharp"], [".go", "go"], [".rs", "rust"],
  [".sh", "bash"], [".bat", "batch"], [".ps1", "powershell"],
  [".sql", "sql"], [".ini", "ini"], [".conf", "conf"], [".env", "dotenv"],
  [".html", "html"], [".css", "css"], [".scss", "scss"],
  [".xml", "xml"], [".vue", "vue"], [".svelte", "svelte"],
  [".lua", "lua"], [".pl", "perl"], [".r", "r"],
  [".gradle", "groovy"], [".groovy", "groovy"],
  [".makefile", "makefile"], [".mk", "makefile"], [".cmake", "cmake"],
  [".dockerfile", "dockerfile"], ["Dockerfile", "dockerfile"]
]);

export const DEFAULT_TEXT_EXTS = Array.from(
  new Set(Array.from(EXT_LANG.keys()).filter(x => x.startsWith(".")))
);

async function loadIgnoreGlobs(root, cliExcludes) {
  const globs = [];
  for (const file of [".mdgenignore", ".gitignore"]) {
    try {
      const content = await fs.readFile(path.join(root, file), "utf8");
      content.split(/\r?\n/).forEach(line => {
        const s = line.trim();
        if (!s || s.startsWith("#")) return;
        globs.push(s);
      });
    } catch { /* ignore */ }
  }
  if (cliExcludes?.length) globs.push(...cliExcludes);
  return globs;
}
function isIgnored(relPath, globs) {
  if (!globs.length) return false;
  const posixPath = relPath.split(path.sep).join("/");
  return micromatch.isMatch(posixPath, globs, { dot: true });
}
function looksTexty(filePath, whitelistExts) {
  const base = path.basename(filePath);
  if (base.toLowerCase() === "dockerfile") return true;
  const ext = path.extname(filePath).toLowerCase();
  return whitelistExts.includes(ext);
}
function trimContent(content, maxLines, maxBytes) {
  let t = content;
  if (maxBytes && Buffer.byteLength(t, "utf8") > maxBytes) {
    while (Buffer.byteLength(t, "utf8") > maxBytes) {
      t = t.slice(0, Math.floor(t.length * 0.9));
    }
  }
  if (maxLines) {
    const lines = t.split(/\r?\n/);
    if (lines.length > maxLines) {
      t = lines.slice(0, maxLines).join("\n") + `\n…[truncated to ${maxLines} lines]`;
    }
  }
  return t;
}
function treePrefix(depth, isLastFlags) {
  if (depth === 0) return "";
  let out = "";
  for (let i = 0; i < depth - 1; i++) out += isLastFlags[i] ? "    " : "│   ";
  out += isLastFlags[depth - 1] ? "└── " : "├── ";
  return out;
}
async function statSafe(p) { try { return await fs.lstat(p); } catch { return null; } }

async function* walk(root, rel = "", ignoreGlobs = []) {
  const current = path.join(root, rel);
  const st = await statSafe(current);
  if (!st) return;
  if (!st.isDirectory()) { yield { rel, abs: current, isDir: false }; return; }

  const names = await fs.readdir(current);
  const fulls = await Promise.all(names.map(async name => {
    const full = path.join(current, name);
    const s = await statSafe(full);
    return { name, full, s };
  }));
  fulls.sort((a, b) => {
    const ad = a.s?.isDirectory() ? 0 : 1;
    const bd = b.s?.isDirectory() ? 0 : 1;
    if (ad !== bd) return ad - bd;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });

  yield { rel, abs: current, isDir: true, children: fulls.map(f => f.name) };

  for (const f of fulls) {
    const childRel = path.join(rel, f.name);
    if (isIgnored(childRel, ignoreGlobs)) continue;
    yield* walk(root, childRel, ignoreGlobs);
  }
}

export async function generateMarkdown({
  root,
  includeContents,
  maxDepth,
  maxFileSizeBytes,
  maxLinesPerFile,
  maxBytesPerFile,
  maxTotalBytes,
  extWhitelist,
  excludeGlobs,
  analyze = false
}) {
  const ignoreGlobs = await loadIgnoreGlobs(root, excludeGlobs);
  const start = Date.now();
  let md = "";
  let totalBytes = 0;

  const header = [
    `# Repository Snapshot`,
    ``,
    `- **Root:** \`${root}\``,
    `- **Generated:** ${new Date().toISOString()}`,
    `- **Options:** ${JSON.stringify({ includeContents, analyze, maxDepth, maxFileSizeBytes, maxLinesPerFile, maxBytesPerFile, maxTotalBytes, extWhitelist, excludeGlobs: ignoreGlobs }, null, 2)}`,
    ``,
    `> This file contains a directory tree and${includeContents ? "" : " no"} inlined file contents.${analyze ? " Analysis is enabled." : ""}`,
    ``
  ].join("\n");
  md += header; totalBytes += Buffer.byteLength(header, "utf8");

  md += `## Directory Tree\n\n`;
  const treeLines = [];
  const dirChildren = new Map();
  for await (const entry of walk(root, "", ignoreGlobs)) {
    const depth = entry.rel ? entry.rel.split(path.sep).length : 0;
    if (maxDepth !== null && depth > maxDepth) continue;
    if (entry.isDir) dirChildren.set(entry.rel, entry.children || []);
  }
  async function printTree(rel = "", depth = 0, flags = []) {
    const name = rel === "" ? path.basename(path.resolve(root)) : path.basename(rel);
    treeLines.push(depth === 0 ? name : treePrefix(depth, flags) + name);
    const children = dirChildren.get(rel) || [];
    const vis = [];
    for (const c of children) {
      const cr = path.join(rel, c);
      if (!isIgnored(cr, ignoreGlobs)) vis.push(c);
    }
    const dirs = [], files = [];
    for (const c of vis) {
      const cr = path.join(rel, c);
      const st = await statSafe(path.join(root, cr));
      if (!st) continue;
      (st.isDirectory() ? dirs : files).push(c);
    }
    dirs.sort((a,b)=>a.localeCompare(b,undefined,{sensitivity:"base"}));
    files.sort((a,b)=>a.localeCompare(b,undefined,{sensitivity:"base"}));
    const ordered = [...dirs, ...files];
    for (let i = 0; i < ordered.length; i++) {
      const c = ordered[i];
      const cr = path.join(rel, c);
      const st = await statSafe(path.join(root, cr));
      if (!st) continue;
      const d2 = depth + 1;
      const last = i === ordered.length - 1;
      if (st.isDirectory()) {
        if (maxDepth === null || d2 <= maxDepth) await printTree(cr, d2, [...flags, last]);
      } else {
        if (maxDepth === null || d2 <= maxDepth) treeLines.push(treePrefix(d2, [...flags, last]) + c);
      }
    }
  }
  await printTree();
  md += "```text\n" + treeLines.join("\n") + "\n```\n\n";
  totalBytes += Buffer.byteLength(md, "utf8");

  if (!includeContents) {
    md += `_Generated by dir-to-markdown._\n`;
    return md;
  }

  md += `## File Contents\n\n`;
  for await (const entry of walk(root, "", ignoreGlobs)) {
    if (entry.isDir) continue;
    const rel = entry.rel;
    const depth = rel.split(path.sep).length;
    if (maxDepth !== null && depth > maxDepth) continue;

    const abs = entry.abs;
    const st = await statSafe(abs);
    if (!st?.isFile()) continue;

    if (maxFileSizeBytes && st.size > maxFileSizeBytes) {
      md += `### \`${rel}\`\n\n> Skipped (file size ${st.size} bytes exceeds limit of ${maxFileSizeBytes}).\n\n`;
      continue;
    }
    if (!looksTexty(rel, extWhitelist)) {
      md += `### \`${rel}\`\n\n> Skipped (non-text or unsupported extension).\n\n`;
      continue;
    }

    let raw = "";
    try { raw = await fs.readFile(abs, "utf8"); }
    catch { md += `### \`${rel}\`\n\n> Skipped (failed to read as UTF-8).\n\n`; continue; }

    if (maxTotalBytes && totalBytes > maxTotalBytes) {
      md += `> Stopped inlining more files (reached maxTotalBytes = ${maxTotalBytes}).\n`;
      break;
    }
    const base = path.basename(rel);
    const ext = base.toLowerCase() === "dockerfile" ? "dockerfile" : path.extname(rel).toLowerCase();
    const lang = EXT_LANG.get(ext) || "";
    const trimmed = trimContent(raw, maxLinesPerFile, maxBytesPerFile);

    // >>> Analysis block goes here <<<
    let analysisBlock = "";
    if (analyze) {
      const a = analyzeContent(rel, raw);
      analysisBlock =
        `**Analysis**\n\n` +
        `- Language: ${a.lang || "unknown"}\n` +
        `- LOC: ${a.loc}\n` +
        `- Functions: ${a.fnCount} · Branch points: ${a.branchCount} · Complexity≈ ${a.cyclomaticProxy}\n` +
        (a.imports.length ? `- Imports: ${a.imports.join(", ")}\n` : "") +
        `- Imports present: ${a.hasImports ? "yes" : "no"} · Exports/API: ${a.hasExports ? "yes" : "no"}\n` +
        (a.smells.length ? `- Flags: ${a.smells.join("; ")}\n` : "") +
        (a.todos ? `- TODO/FIXME count: ${a.todos}\n` : "") +
        `- Suggested header:\n\n` +
        "```" + (a.lang || "") + "\n" + a.headerCommentSuggestion + "\n```\n\n";
    }

    const sectionHeader = `### \`${rel}\`\n\n`;
    const blockOpen = "```" + lang + "\n";
    const blockClose = "\n```\n\n";
    const section = sectionHeader + (analysisBlock || "") + blockOpen + trimmed + blockClose;

    const chunkBytes = Buffer.byteLength(section, "utf8");
    if (maxTotalBytes && totalBytes + chunkBytes > maxTotalBytes) {
      md += `> Stopped before adding \`${rel}\` (would exceed maxTotalBytes = ${maxTotalBytes}).\n`;
      break;
    }
    md += section;
    totalBytes += chunkBytes;
  }

  md += `_Generated by dir-to-markdown in ${Math.round((Date.now() - start) / 1000)}s._\n`;
  return md;
}
