import { describe, it, expect, beforeAll } from "vitest";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { NdcMcpServer, SCHEMAS_DIR } from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.resolve(__dirname, "fixtures");

// Use a server instance pointed at the fixtures directory for testing.
// Because of the ESM main-module guard in index.js, importing NdcMcpServer no longer auto-starts the server.
const server = new NdcMcpServer(FIXTURES_DIR);

// ====================== TESTS ======================

describe("escapeRegex", () => {
  it("escapes special regex characters", () => {
    expect(NdcMcpServer.escapeRegex("foo.bar")).toBe("foo\\.bar");
    expect(NdcMcpServer.escapeRegex("a+b*c?")).toBe("a\\+b\\*c\\?");
    expect(NdcMcpServer.escapeRegex("(test)")).toBe("\\(test\\)");
    expect(NdcMcpServer.escapeRegex("[hello]")).toBe("\\[hello\\]");
  });

  it("leaves normal strings unchanged", () => {
    expect(NdcMcpServer.escapeRegex("PassengerType")).toBe("PassengerType");
    expect(NdcMcpServer.escapeRegex("IATA_AirShoppingRQ")).toBe("IATA_AirShoppingRQ");
  });
});

describe("validatePath", () => {
  it("allows valid paths", () => {
    expect(() => server.validatePath("test-version", "TestSchema.xsd")).not.toThrow();
  });

  it("rejects path traversal attempts", () => {
    expect(() => server.validatePath("test-version", "../../etc/passwd")).toThrow("Invalid path");
    expect(() => server.validatePath("../..", "TestSchema.xsd")).toThrow("Invalid version");
  });

  it("rejects absolute paths injected as filename", () => {
    expect(() => server.validatePath("test-version", "/etc/passwd")).toThrow("Invalid path");
  });
});

describe("getVersions", () => {
  it("returns directory names from the schemas folder", async () => {
    const versions = await server.getVersions();
    expect(versions).toContain("test-version");
  });

  it("returns empty array if directory does not exist", async () => {
    const tempServer = new NdcMcpServer("/nonexistent/path");
    const versions = await tempServer.getVersions();
    expect(versions).toEqual([]);
  });
});

describe("getSchemaFiles", () => {
  it("lists .xsd and .json files from the raw subdirectory", async () => {
    const files = await server.getSchemaFiles("test-version");
    expect(files).toContain("TestSchema.xsd");
    expect(files).toContain("TestAPI.json");
  });

  it("does not list non-schema files", async () => {
    const files = await server.getSchemaFiles("test-version");
    const nonSchema = files.filter((f) => !f.endsWith(".xsd") && !f.endsWith(".json"));
    expect(nonSchema).toHaveLength(0);
  });

  it("returns empty for nonexistent version", async () => {
    const files = await server.getSchemaFiles("nonexistent");
    expect(files).toEqual([]);
  });
});

describe("readSchemaFile", () => {
  it("reads full file content", async () => {
    const content = await server.readSchemaFile("test-version", "TestSchema.xsd");
    expect(content).toContain("xs:schema");
    expect(content).toContain("PassengerType");
  });

  it("reads a specific line range", async () => {
    const content = await server.readSchemaFile("test-version", "TestSchema.xsd", 1, 3);
    const lines = content.split("\n");
    expect(lines.length).toBe(3);
    expect(lines[0]).toContain("xml version");
  });

  it("handles startLine only", async () => {
    const content = await server.readSchemaFile("test-version", "TestSchema.xsd", 5);
    expect(content).not.toContain("xml version");
  });

  it("throws on nonexistent file", async () => {
    await expect(
      server.readSchemaFile("test-version", "nonexistent.xsd")
    ).rejects.toThrow();
  });
});

describe("getSchemaTOC", () => {
  it("extracts named elements", async () => {
    const toc = await server.getSchemaTOC("test-version", "TestSchema.xsd");
    expect(toc).toContain("AirShoppingRQ");
    expect(toc).toContain("SimpleElement");
  });

  it("extracts named complexTypes", async () => {
    const toc = await server.getSchemaTOC("test-version", "TestSchema.xsd");
    expect(toc).toContain("PassengerType");
    expect(toc).toContain("FlightSegmentType");
  });

  it("extracts named simpleTypes", async () => {
    const toc = await server.getSchemaTOC("test-version", "TestSchema.xsd");
    expect(toc).toContain("CurrencyCodeType");
  });

  it("includes counts in headers", async () => {
    const toc = await server.getSchemaTOC("test-version", "TestSchema.xsd");
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
    const result = server.extractXmlBlock(content, "xs:complexType", "PassengerType");
    expect(result).not.toBeNull();
    expect(result).toContain('name="PassengerType"');
    expect(result).toContain("</xs:complexType>");
    expect(result).toContain("Name");
    expect(result).toContain("DateOfBirth");
  });

  it("extracts a complexType with nested complexTypes (balanced tags)", () => {
    const result = server.extractXmlBlock(content, "xs:complexType", "FlightSegmentType");
    expect(result).not.toBeNull();
    expect(result).toContain('name="FlightSegmentType"');
    expect(result).toContain("Departure");
    expect(result).toContain("Arrival");
    expect(result).toContain("AirportCode");
    expect(result).toMatch(/<\/xs:complexType>$/);
  });

  it("extracts a simpleType", () => {
    const result = server.extractXmlBlock(content, "xs:simpleType", "CurrencyCodeType");
    expect(result).not.toBeNull();
    expect(result).toContain('name="CurrencyCodeType"');
    expect(result).toContain("</xs:simpleType>");
  });

  it("extracts a self-closing element", () => {
    const result = server.extractXmlBlock(content, "xs:element", "SimpleElement");
    expect(result).not.toBeNull();
    expect(result).toContain('name="SimpleElement"');
    expect(result).toContain("/>");
  });

  it("returns null for non-existent type", () => {
    const result = server.extractXmlBlock(content, "xs:complexType", "NonExistentType");
    expect(result).toBeNull();
  });
});

describe("searchInSchemas", () => {
  it("finds matches across schema files", async () => {
    const results = await server.searchInSchemas("test-version", "PassengerType");
    expect(results).toContain("TestSchema.xsd");
    expect(results).toContain("PassengerType");
  });

  it("returns 'No matches found.' for nonsense query", async () => {
    const results = await server.searchInSchemas("test-version", "zzz_no_match_zzz");
    expect(results).toBe("No matches found.");
  });

  it("handles invalid regex gracefully by falling back to literal match", async () => {
    const results = await server.searchInSchemas("test-version", "[invalid");
    expect(results).toBe("No matches found.");
  });

  it("is case-insensitive", async () => {
    const results = await server.searchInSchemas("test-version", "passengertype");
    expect(results).toContain("PassengerType");
  });
});
