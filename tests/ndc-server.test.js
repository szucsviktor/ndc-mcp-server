import { describe, it, expect, beforeAll } from "vitest";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.resolve(__dirname, "fixtures");

// We can't easily import NdcMcpServer directly because it auto-runs on import.
// Instead, we test the core logic functions in isolation by re-implementing
// them as standalone helpers that mirror the class methods.

// --- Helper functions extracted from NdcMcpServer for unit testing ---

function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function validatePath(schemasDir, version, filename) {
  const rawDir = path.resolve(schemasDir, version, "raw");
  const resolved = path.resolve(rawDir, filename);
  if (!resolved.startsWith(rawDir + path.sep) && resolved !== rawDir) {
    throw new Error(`Invalid path: ${filename}`);
  }
}

async function getVersions(schemasDir) {
  try {
    const entries = await fs.readdir(schemasDir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

async function getSchemaFiles(schemasDir, version, subDir = "") {
  const baseDir = path.join(schemasDir, version, "raw");
  const dirPath = path.join(baseDir, subDir);
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    let files = [];
    for (const entry of entries) {
      const relativePath = path.join(subDir, entry.name);
      if (entry.isDirectory()) {
        files = files.concat(await getSchemaFiles(schemasDir, version, relativePath));
      } else if (entry.name.endsWith(".xsd") || entry.name.endsWith(".json")) {
        files.push(relativePath);
      }
    }
    return files;
  } catch {
    return [];
  }
}

async function readSchemaFile(schemasDir, version, filename, startLine, endLine) {
  const filePath = path.join(schemasDir, version, "raw", filename);
  const content = await fs.readFile(filePath, "utf-8");
  if (startLine !== undefined || endLine !== undefined) {
    const lines = content.split("\n");
    const start = startLine ? Math.max(0, startLine - 1) : 0;
    const end = endLine ? Math.min(lines.length, endLine) : lines.length;
    return lines.slice(start, end).join("\n");
  }
  return content;
}

async function getSchemaTOC(schemasDir, version, filename) {
  const filePath = path.join(schemasDir, version, "raw", filename);
  const content = await fs.readFile(filePath, "utf-8");
  const elements = [...content.matchAll(/<xs:element[^>]+name="([^"]+)"/g)].map((m) => m[1]);
  const types = [...content.matchAll(/<xs:complexType[^>]+name="([^"]+)"/g)].map((m) => m[1]);
  const simpleTypes = [...content.matchAll(/<xs:simpleType[^>]+name="([^"]+)"/g)].map((m) => m[1]);

  let toc = `### Table of Contents for ${filename}\n\n`;
  if (elements.length > 0) {
    toc += `**Elements (${elements.length}):**\n` + elements.map((e) => `- ${e}`).join("\n") + "\n\n";
  }
  if (types.length > 0) {
    toc += `**Complex Types (${types.length}):**\n` + types.map((t) => `- ${t}`).join("\n") + "\n\n";
  }
  if (simpleTypes.length > 0) {
    toc += `**Simple Types (${simpleTypes.length}):**\n` + simpleTypes.map((t) => `- ${t}`).join("\n") + "\n\n";
  }
  if (elements.length === 0 && types.length === 0 && simpleTypes.length === 0) {
    return "No elements or types found.";
  }
  return toc;
}

function extractXmlBlock(content, tagName, escapedName) {
  const openPattern = new RegExp(`<${tagName}[^>]+name="${escapedName}"`, "g");
  const match = openPattern.exec(content);
  if (!match) return null;

  const startIndex = match.index;
  const shortTag = tagName;

  const selfCloseCheck = content.indexOf("/>", match.index + match[0].length);
  const nextClose = content.indexOf(">", match.index + match[0].length);
  if (nextClose === selfCloseCheck + 1) {
    return content.substring(startIndex, selfCloseCheck + 2);
  }

  let depth = 1;
  let searchPos = nextClose + 1;
  const openTag = `<${shortTag}`;
  const closeTag = `</${shortTag}>`;

  while (depth > 0 && searchPos < content.length) {
    const nextOpen = content.indexOf(openTag, searchPos);
    const nextCloseTag = content.indexOf(closeTag, searchPos);

    if (nextCloseTag === -1) break;

    if (nextOpen !== -1 && nextOpen < nextCloseTag) {
      depth++;
      searchPos = nextOpen + openTag.length;
    } else {
      depth--;
      if (depth === 0) {
        return content.substring(startIndex, nextCloseTag + closeTag.length);
      }
      searchPos = nextCloseTag + closeTag.length;
    }
  }

  return null;
}

async function searchInSchemas(schemasDir, version, query) {
  const files = await getSchemaFiles(schemasDir, version);
  let regex;
  try {
    regex = new RegExp(query, "i");
  } catch {
    regex = new RegExp(escapeRegex(query), "i");
  }
  let results = "";

  for (const file of files) {
    const filePath = path.join(schemasDir, version, "raw", file);
    const content = await fs.readFile(filePath, "utf-8");
    const lines = content.split("\n");

    lines.forEach((line, index) => {
      if (regex.test(line)) {
        results += `${file}:${index + 1}: ${line.trim()}\n`;
      }
    });

    if (results.length > 5000) {
      results += "... (results truncated)";
      break;
    }
  }

  return results || "No matches found.";
}

// ====================== TESTS ======================

describe("escapeRegex", () => {
  it("escapes special regex characters", () => {
    expect(escapeRegex("foo.bar")).toBe("foo\\.bar");
    expect(escapeRegex("a+b*c?")).toBe("a\\+b\\*c\\?");
    expect(escapeRegex("(test)")).toBe("\\(test\\)");
    expect(escapeRegex("[hello]")).toBe("\\[hello\\]");
  });

  it("leaves normal strings unchanged", () => {
    expect(escapeRegex("PassengerType")).toBe("PassengerType");
    expect(escapeRegex("IATA_AirShoppingRQ")).toBe("IATA_AirShoppingRQ");
  });
});

describe("validatePath", () => {
  it("allows valid paths", () => {
    expect(() => validatePath(FIXTURES_DIR, "test-version", "TestSchema.xsd")).not.toThrow();
  });

  it("rejects path traversal attempts", () => {
    expect(() => validatePath(FIXTURES_DIR, "test-version", "../../etc/passwd")).toThrow("Invalid path");
    expect(() => validatePath(FIXTURES_DIR, "../..", "TestSchema.xsd")).toThrow("Invalid path");
  });

  it("rejects absolute paths injected as filename", () => {
    expect(() => validatePath(FIXTURES_DIR, "test-version", "/etc/passwd")).toThrow("Invalid path");
  });
});

describe("getVersions", () => {
  it("returns directory names from the schemas folder", async () => {
    const versions = await getVersions(FIXTURES_DIR);
    expect(versions).toContain("test-version");
  });

  it("returns empty array if directory does not exist", async () => {
    const versions = await getVersions("/nonexistent/path");
    expect(versions).toEqual([]);
  });
});

describe("getSchemaFiles", () => {
  it("lists .xsd and .json files from the raw subdirectory", async () => {
    const files = await getSchemaFiles(FIXTURES_DIR, "test-version");
    expect(files).toContain("TestSchema.xsd");
    expect(files).toContain("TestAPI.json");
  });

  it("does not list non-schema files", async () => {
    const files = await getSchemaFiles(FIXTURES_DIR, "test-version");
    const nonSchema = files.filter((f) => !f.endsWith(".xsd") && !f.endsWith(".json"));
    expect(nonSchema).toHaveLength(0);
  });

  it("returns empty for nonexistent version", async () => {
    const files = await getSchemaFiles(FIXTURES_DIR, "nonexistent");
    expect(files).toEqual([]);
  });
});

describe("readSchemaFile", () => {
  it("reads full file content", async () => {
    const content = await readSchemaFile(FIXTURES_DIR, "test-version", "TestSchema.xsd");
    expect(content).toContain("xs:schema");
    expect(content).toContain("PassengerType");
  });

  it("reads a specific line range", async () => {
    const content = await readSchemaFile(FIXTURES_DIR, "test-version", "TestSchema.xsd", 1, 3);
    const lines = content.split("\n");
    expect(lines.length).toBe(3);
    expect(lines[0]).toContain("xml version");
  });

  it("handles startLine only", async () => {
    const content = await readSchemaFile(FIXTURES_DIR, "test-version", "TestSchema.xsd", 5);
    expect(content).not.toContain("xml version");
  });

  it("throws on nonexistent file", async () => {
    await expect(
      readSchemaFile(FIXTURES_DIR, "test-version", "nonexistent.xsd")
    ).rejects.toThrow();
  });
});

describe("getSchemaTOC", () => {
  it("extracts named elements", async () => {
    const toc = await getSchemaTOC(FIXTURES_DIR, "test-version", "TestSchema.xsd");
    expect(toc).toContain("AirShoppingRQ");
    expect(toc).toContain("SimpleElement");
  });

  it("extracts named complexTypes", async () => {
    const toc = await getSchemaTOC(FIXTURES_DIR, "test-version", "TestSchema.xsd");
    expect(toc).toContain("PassengerType");
    expect(toc).toContain("FlightSegmentType");
  });

  it("extracts named simpleTypes", async () => {
    const toc = await getSchemaTOC(FIXTURES_DIR, "test-version", "TestSchema.xsd");
    expect(toc).toContain("CurrencyCodeType");
  });

  it("includes counts in headers", async () => {
    const toc = await getSchemaTOC(FIXTURES_DIR, "test-version", "TestSchema.xsd");
    expect(toc).toMatch(/Elements \(\d+\)/);
    expect(toc).toMatch(/Complex Types \(\d+\)/);
    expect(toc).toMatch(/Simple Types \(\d+\)/);
  });
});

describe("extractXmlBlock", () => {
  let content;

  beforeAll(async () => {
    content = await fs.readFile(
      path.join(FIXTURES_DIR, "test-version", "raw", "TestSchema.xsd"),
      "utf-8"
    );
  });

  it("extracts a simple complexType correctly", () => {
    const result = extractXmlBlock(content, "xs:complexType", "PassengerType");
    expect(result).not.toBeNull();
    expect(result).toContain('name="PassengerType"');
    expect(result).toContain("</xs:complexType>");
    expect(result).toContain("Name");
    expect(result).toContain("DateOfBirth");
  });

  it("extracts a complexType with nested complexTypes (balanced tags)", () => {
    const result = extractXmlBlock(content, "xs:complexType", "FlightSegmentType");
    expect(result).not.toBeNull();
    expect(result).toContain('name="FlightSegmentType"');
    // Should contain the full block including nested <xs:complexType>...</xs:complexType>
    expect(result).toContain("Departure");
    expect(result).toContain("Arrival");
    expect(result).toContain("AirportCode");
    // The block should end with the OUTER closing tag
    expect(result).toMatch(/<\/xs:complexType>$/);
  });

  it("extracts a simpleType", () => {
    const result = extractXmlBlock(content, "xs:simpleType", "CurrencyCodeType");
    expect(result).not.toBeNull();
    expect(result).toContain('name="CurrencyCodeType"');
    expect(result).toContain("</xs:simpleType>");
  });

  it("extracts a self-closing element", () => {
    const result = extractXmlBlock(content, "xs:element", "SimpleElement");
    expect(result).not.toBeNull();
    expect(result).toContain('name="SimpleElement"');
    expect(result).toContain("/>");
  });

  it("returns null for non-existent type", () => {
    const result = extractXmlBlock(content, "xs:complexType", "NonExistentType");
    expect(result).toBeNull();
  });
});

describe("searchInSchemas", () => {
  it("finds matches across schema files", async () => {
    const results = await searchInSchemas(FIXTURES_DIR, "test-version", "PassengerType");
    expect(results).toContain("TestSchema.xsd");
    expect(results).toContain("PassengerType");
  });

  it("returns 'No matches found.' for nonsense query", async () => {
    const results = await searchInSchemas(FIXTURES_DIR, "test-version", "zzz_no_match_zzz");
    expect(results).toBe("No matches found.");
  });

  it("handles invalid regex gracefully by falling back to literal match", async () => {
    // "[" is invalid regex — should not throw, should fall back to literal
    const results = await searchInSchemas(FIXTURES_DIR, "test-version", "[invalid");
    // The literal string "[invalid" won't appear in our test file
    expect(results).toBe("No matches found.");
  });

  it("is case-insensitive", async () => {
    const results = await searchInSchemas(FIXTURES_DIR, "test-version", "passengertype");
    expect(results).toContain("PassengerType");
  });
});
