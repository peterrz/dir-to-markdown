const $ = sel => document.querySelector(sel);

function parseCSV(input) {
  if (!input) return null;
  return input.split(",").map(s => s.trim()).filter(Boolean);
}

let lastFilename = "snapshot.md";
let lastMarkdown = "";

$("#generateBtn").addEventListener("click", async () => {
  $("#status").textContent = "Working…";
  $("#downloadBtn").disabled = true;

  const directory = $("#directory").value.trim();
  const includeContents = $("#includeContents").checked;
  const maxDepthRaw = $("#maxDepth").value.trim();
  const maxDepth = maxDepthRaw === "" ? null : Number(maxDepthRaw);
  const payload = {
    directory,
    includeContents,
    maxDepth,
    maxFileSizeBytes: Number($("#maxFileSizeBytes").value),
    maxLinesPerFile: Number($("#maxLinesPerFile").value),
    maxBytesPerFile: Number($("#maxBytesPerFile").value),
    maxTotalBytes: Number($("#maxTotalBytes").value),
    extWhitelist: parseCSV($("#extWhitelist").value) || undefined,
    excludeGlobs: parseCSV($("#excludeGlobs").value) || [],
    analyze: $("#analyze").checked
  };

  try {
    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed");

    lastFilename = data.filename || "snapshot.md";
    lastMarkdown = data.markdown || "";
    // $("#output").value = lastMarkdown;
    updatePreview(lastMarkdown);
    $("#status").textContent = "Done.";
    $("#downloadBtn").disabled = false;
  } catch (e) {
    $("#status").textContent = "Error: " + (e?.message || e);
    $("#output").value = "";
    $("#downloadBtn").disabled = true;
  }
});

$("#downloadBtn").addEventListener("click", () => {
  const blob = new Blob([lastMarkdown], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = lastFilename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
});
