#!/usr/bin/env node
import { Command } from "commander";
import fs from "fs/promises";
import path from "path";
import { generateMarkdown, DEFAULT_TEXT_EXTS } from "./lib/generate.mjs";

async function statSafe(p){ try{ return await fs.lstat(p);}catch{ return null; } }

const program = new Command();
program
  .name("dir2md")
  .description("Generate a single Markdown snapshot of a directory (tree + optional file contents).")
  .argument("<directory>", "Directory to scan")
  .option("-o, --output <file>", "Output Markdown file", "./snapshot.md")
  .option("--contents", "Include file contents (text/code files only)", false)
  .option("--analyze", "Add per-file analysis comments", false)
  .option("--max-depth <n>", "Limit recursion depth (0=root only)", v => Number(v), null)
  .option("--max-file-size <bytes>", "Skip files larger than this many bytes", v => Number(v), 500_000)
  .option("--max-lines <n>", "Trim each file to at most N lines", v => Number(v), 1200)
  .option("--max-bytes <bytes>", "Trim each file to at most N bytes", v => Number(v), 200_000)
  .option("--max-total-bytes <bytes>", "Stop inlining once total output exceeds N bytes", v => Number(v), 5_000_000)
  .option("--ext <csv>", "Whitelist of extensions (e.g. .js,.ts,.py).", v => v.split(",").map(s=>s.trim().toLowerCase()), DEFAULT_TEXT_EXTS)
  .option("--exclude <csv>", "Comma-separated ignore globs.", v => v.split(",").map(s=>s.trim()), [])
  .action(async (directory, opts) => {
    const root = path.resolve(directory);
    const st = await statSafe(root);
    if (!st?.isDirectory()) {
      console.error(`Error: "${root}" is not a directory or does not exist.`);
      process.exit(1);
    }
    const md = await generateMarkdown({
      root,
      includeContents: !!opts.contents,
      maxDepth: opts.maxDepth === null ? null : Number.isFinite(opts.maxDepth) ? opts.maxDepth : null,
      maxFileSizeBytes: opts.maxFileSize,
      maxLinesPerFile: opts.maxLines,
      maxBytesPerFile: opts.maxBytes,
      maxTotalBytes: opts.maxTotalBytes,
      extWhitelist: opts.ext,
      excludeGlobs: opts.exclude,
      analyze: !!opts.analyze
    });
    const outPath = path.resolve(opts.output);
    await fs.writeFile(outPath, md, "utf8");
    console.log(`✅ Wrote Markdown to ${outPath}`);
  });

program.parse(process.argv);
