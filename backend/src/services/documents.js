const CHUNK_SIZE = 800;
const CHUNK_OVERLAP = 120;
const MAX_CHUNKS = 600; // ~480k characters; keeps embedding time and DB size sane
const SUPPORTED_EXTENSIONS = new Set([".pdf", ".docx", ".txt", ".md", ".csv"]);

function fail(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

// Split on whitespace-collapsed text, preferring to end a chunk at a sentence
// or word boundary instead of cutting mid-word.
function chunkText(input) {
  const text = input.replace(/\s+/g, " ").trim();
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + CHUNK_SIZE, text.length);
    if (end < text.length) {
      const window = text.slice(start, end);
      const sentence = Math.max(window.lastIndexOf(". "), window.lastIndexOf("? "), window.lastIndexOf("! "));
      const space = window.lastIndexOf(" ");
      const cut = sentence > CHUNK_SIZE * 0.5 ? sentence + 1 : space > CHUNK_SIZE * 0.5 ? space : -1;
      if (cut > 0) end = start + cut;
    }
    const chunk = text.slice(start, end).trim();
    if (chunk) chunks.push(chunk);
    if (end >= text.length) break;
    start = Math.max(end - CHUNK_OVERLAP, start + 1);
  }
  return chunks;
}

function chunkPages(pages) {
  const chunks = [];
  for (const page of pages) {
    for (const text of chunkText(page.text)) chunks.push({ text, pageNumber: page.number });
  }
  return chunks;
}

function loadPdfParse() {
  // The package root runs a debug routine in some setups; import the parser directly.
  try { return require("pdf-parse/lib/pdf-parse.js"); } catch { return require("pdf-parse"); }
}

async function extractText(file) {
  const dot = file.originalname.lastIndexOf(".");
  const extension = dot === -1 ? "" : file.originalname.toLowerCase().slice(dot);
  if (!SUPPORTED_EXTENSIONS.has(extension)) throw fail("Only PDF, DOCX, TXT, MD, and CSV files are supported.");
  let content = "";
  const pages = [];
  let pdfPageNumber = 0;
  if (extension === ".pdf") {
    if (file.buffer.subarray(0, 5).toString("latin1") !== "%PDF-") throw fail("That file doesn't look like a valid PDF.");
    try {
      const parsed = await loadPdfParse()(file.buffer, {
        pagerender: async pageData => {
          const textContent = await pageData.getTextContent();
          const pageText = textContent.items.map(item => item.str).join(" ").replace(/\s+/g, " ").trim();
          pdfPageNumber += 1;
          if (pageText) pages.push({ number: pdfPageNumber, text: pageText });
          return pageText;
        }
      });
      content = parsed.text;
    } catch (error) {
      throw fail("Couldn't read that PDF. It may be damaged or password-protected.");
    }
  } else if (extension === ".docx") {
    try {
      const mammoth = require("mammoth");
      const result = await mammoth.extractRawText({ buffer: file.buffer });
      content = result.value;
    } catch (error) {
      throw fail("Couldn't read that DOCX. It may be damaged or password-protected.");
    }
  } else {
    content = file.buffer.toString("utf8");
  }
  if (!content.trim()) {
    throw fail(extension === ".pdf"
      ? "No readable text found. This PDF may be a scan (images of text), which isn't supported yet."
      : "No readable text was found in that file.");
  }
  if (!pages.length) pages.push({ number: 1, text: content });
  return { text: content, pages };
}

module.exports = { CHUNK_SIZE, CHUNK_OVERLAP, MAX_CHUNKS, SUPPORTED_EXTENSIONS, chunkText, chunkPages, extractText };
