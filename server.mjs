import express from "express";
import path from "path";
import fs from "fs/promises";
import { fileURLToPath } from "url";
import { generateMarkdown, DEFAULT_TEXT_EXTS } from "./lib/generate.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: "10mb" }));
app.use(express.static(path.join(__dirname, "public")));

app.post("/api/generate", async (req, res) => {
  try {
    const {
      directory,
      includeContents = false,
      maxDepth = null,
      maxFileSizeBytes = 500_000,
      maxLinesPerFile = 1200,
      maxBytesPerFile = 200_000,
      maxTotalBytes = 5_000_000,
      extWhitelist = DEFAULT_TEXT_EXTS,
      excludeGlobs = [],
      analyze = false
    } = req.body || {};

    if (!directory) return res.status(400).json({ error: "Missing 'directory'." });

    const absRoot = path.resolve(directory);
    try {
      const st = await fs.lstat(absRoot);
      if (!st.isDirectory()) return res.status(400).json({ error: "Path is not a directory." });
    } catch {
      return res.status(404).json({ error: "Directory not found." });
    }

    const md = await generateMarkdown({
      root: absRoot,
      includeContents,
      maxDepth,
      maxFileSizeBytes,
      maxLinesPerFile,
      maxBytesPerFile,
      maxTotalBytes,
      extWhitelist,
      excludeGlobs,
      analyze
    });

    res.json({
      ok: true,
      filename: `snapshot-${path.basename(absRoot)}.md`,
      markdown: md
    });
  } catch (e) {
    res.status(500).json({ error: e?.message || "Server error" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`📄 UI ready: http://localhost:${PORT}`)
);
