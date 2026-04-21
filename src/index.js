import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ReadResourceRequestSchema,
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ErrorCode,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import cors from "cors";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMAS_DIR = path.resolve(__dirname, "../schemas");

class NdcMcpServer {
  constructor() {
    this.server = new Server(
      {
        name: "ndc-mcp-server",
        version: "1.0.0",
      },
      {
        capabilities: {
          resources: {},
          tools: {},
        },
      }
    );
    this.transports = new Map();

    this.setupHandlers();
    this.server.onerror = (error) => console.error("[MCP Error]", error);
    process.on("SIGINT", async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  setupHandlers() {
    this.setupResourceHandlers();
    this.setupToolHandlers();
  }

  setupResourceHandlers() {
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => {
      const versions = await this.getVersions();
      const resources = [];

      for (const version of versions) {
        const schemaFiles = await this.getSchemaFiles(version);
        for (const file of schemaFiles) {
          resources.push({
            uri: `ndc://${version}/schema/${file}`,
            name: `${file} (v${version})`,
            mimeType: file.endsWith(".json") ? "application/json" : "application/xml",
            description: `NDC Schema file ${file} for version ${version}`,
          });
        }
      }

      return { resources };
    });

    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const url = new URL(request.params.uri);
      if (url.protocol !== "ndc:") {
        throw new McpError(ErrorCode.InvalidRequest, `Unsupported protocol: ${url.protocol}`);
      }

      const version = url.hostname;
      const pathParts = url.pathname.split("/").filter(Boolean);

      // Expected format: /schema/{filename}
      if (pathParts.length < 2 || pathParts[0] !== "schema") {
        throw new McpError(ErrorCode.InvalidRequest, `Invalid resource URI format: ${request.params.uri}. Expected ndc://{version}/schema/{filename}`);
      }

      const filename = decodeURIComponent(pathParts.slice(1).join("/"));
      this.validatePath(version, filename);
      const filePath = path.join(SCHEMAS_DIR, version, "raw", filename);

      try {
        const content = await fs.readFile(filePath, "utf-8");
        return {
          contents: [
            {
              uri: request.params.uri,
              mimeType: filename.endsWith(".json") ? "application/json" : "application/xml",
              text: content,
            },
          ],
        };
      } catch (error) {
        throw new McpError(ErrorCode.InternalError, `Could not read file: ${error.message}`);
      }
    });

    this.server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => {
      const versions = await this.getVersions();
      return {
        resourceTemplates: versions.map((version) => ({
          uriTemplate: `ndc://${version}/schema/{filename}`,
          name: `NDC v${version} Schema File`,
          mimeType: "application/xml",
          description: `A specific NDC v${version} schema file. Supports .xsd and .json files.`,
        })),
      };
    });
  }

  setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: "list_ndc_versions",
            description: "List available NDC schema versions",
            inputSchema: { type: "object", properties: {} },
          },
          {
            name: "list_ndc_schemas",
            description: "List all schema files for a given NDC version",
            inputSchema: {
              type: "object",
              properties: {
                version: { type: "string", description: "NDC version (e.g., '26.1')", default: "26.1" },
              },
            },
          },
          {
            name: "search_ndc_schemas",
            description: "Search for a keyword or regex within NDC schemas",
            inputSchema: {
              type: "object",
              properties: {
                query: { type: "string", description: "Search query or regex" },
                version: { type: "string", description: "NDC version to search in", default: "26.1" },
              },
              required: ["query"],
            },
          },
          {
            name: "read_ndc_schema",
            description: "Read the content of a specific NDC schema file",
            inputSchema: {
              type: "object",
              properties: {
                filename: { type: "string", description: "Schema filename (e.g., 'IATA_AirShoppingRQ.xsd')" },
                version: { type: "string", description: "NDC version", default: "26.1" },
                startLine: { type: "number", description: "Optional start line (1-indexed)" },
                endLine: { type: "number", description: "Optional end line" },
              },
              required: ["filename"],
            },
          },
          {
            name: "get_schema_toc",
            description: "Get a Table of Contents (list of elements and types) for a schema file",
            inputSchema: {
              type: "object",
              properties: {
                filename: { type: "string", description: "Schema filename" },
                version: { type: "string", description: "NDC version", default: "26.1" },
              },
              required: ["filename"],
            },
          },
          {
            name: "get_element_definition",
            description: "Get the XML definition block for a specific element or complexType",
            inputSchema: {
              type: "object",
              properties: {
                elementName: { type: "string", description: "The name of the element or complexType to find" },
                version: { type: "string", description: "NDC version", default: "26.1" },
              },
              required: ["elementName"],
            },
          },
        ],
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      switch (name) {
        case "list_ndc_versions":
          return { content: [{ type: "text", text: (await this.getVersions()).join("\n") }] };

        case "list_ndc_schemas": {
          const version = args.version || "26.1";
          const files = await this.getSchemaFiles(version);
          return { content: [{ type: "text", text: files.join("\n") }] };
        }

        case "search_ndc_schemas": {
          const { query, version = "26.1" } = args;
          const results = await this.searchInSchemas(version, query);
          return { content: [{ type: "text", text: results }] };
        }

        case "read_ndc_schema": {
          const { filename, version = "26.1", startLine, endLine } = args;
          const content = await this.readSchemaFile(version, filename, startLine, endLine);
          return { content: [{ type: "text", text: content }] };
        }

        case "get_schema_toc": {
          const { filename, version = "26.1" } = args;
          const toc = await this.getSchemaTOC(version, filename);
          return { content: [{ type: "text", text: toc }] };
        }

        case "get_element_definition": {
          const { elementName, version = "26.1" } = args;
          const definition = await this.getElementDefinition(version, elementName);
          return { content: [{ type: "text", text: definition }] };
        }

        default:
          throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
      }
    });
  }

  // --- Utility Methods ---

  /**
   * Validates that a path does not escape the version's raw schema directory (path traversal protection).
   */
  validatePath(version, filename) {
    // Reject version strings containing path separators or traversal
    if (version.includes("..") || version.includes("/") || version.includes("\\")) {
      throw new McpError(ErrorCode.InvalidRequest, `Invalid version: ${version}`);
    }
    const rawDir = path.resolve(SCHEMAS_DIR, version, "raw");
    const resolved = path.resolve(rawDir, filename);
    if (!resolved.startsWith(rawDir + path.sep) && resolved !== rawDir) {
      throw new McpError(ErrorCode.InvalidRequest, `Invalid path: ${filename}`);
    }
  }



  /**
   * Escapes special regex characters in a string for safe use in RegExp constructors.
   */
  static escapeRegex(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  async getVersions() {
    try {
      const entries = await fs.readdir(SCHEMAS_DIR, { withFileTypes: true });
      return entries.filter((e) => e.isDirectory()).map((e) => e.name);
    } catch (error) {
      return [];
    }
  }

  async getSchemaFiles(version, subDir = "") {
    // Always search within the "raw" subdirectory
    const baseDir = path.join(SCHEMAS_DIR, version, "raw");
    const dirPath = path.join(baseDir, subDir);
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      let files = [];
      for (const entry of entries) {
        const relativePath = path.join(subDir, entry.name);
        if (entry.isDirectory()) {
          files = files.concat(await this.getSchemaFiles(version, relativePath));
        } else if (entry.name.endsWith(".xsd") || entry.name.endsWith(".json")) {
          files.push(relativePath);
        }
      }
      return files;
    } catch (error) {
      return [];
    }
  }

  async readSchemaFile(version, filename, startLine, endLine) {
    this.validatePath(version, filename);
    const filePath = path.join(SCHEMAS_DIR, version, "raw", filename);
    try {
      const content = await fs.readFile(filePath, "utf-8");
      if (startLine !== undefined || endLine !== undefined) {
        const lines = content.split("\n");
        const start = startLine ? Math.max(0, startLine - 1) : 0;
        const end = endLine ? Math.min(lines.length, endLine) : lines.length;
        return lines.slice(start, end).join("\n");
      }
      return content;
    } catch (error) {
      throw new McpError(ErrorCode.InternalError, `Error reading file ${filename}: ${error.message}`);
    }
  }

  async getSchemaTOC(version, filename) {
    this.validatePath(version, filename);
    const filePath = path.join(SCHEMAS_DIR, version, "raw", filename);
    try {
      const content = await fs.readFile(filePath, "utf-8");
      const elements = [...content.matchAll(/<xs:element[^>]+name="([^"]+)"/g)].map(m => m[1]);
      const types = [...content.matchAll(/<xs:complexType[^>]+name="([^"]+)"/g)].map(m => m[1]);
      const simpleTypes = [...content.matchAll(/<xs:simpleType[^>]+name="([^"]+)"/g)].map(m => m[1]);

      let toc = `### Table of Contents for ${filename}\n\n`;
      if (elements.length > 0) {
        toc += `**Elements (${elements.length}):**\n` + elements.map(e => `- ${e}`).join("\n") + "\n\n";
      }
      if (types.length > 0) {
        toc += `**Complex Types (${types.length}):**\n` + types.map(t => `- ${t}`).join("\n") + "\n\n";
      }
      if (simpleTypes.length > 0) {
        toc += `**Simple Types (${simpleTypes.length}):**\n` + simpleTypes.map(t => `- ${t}`).join("\n") + "\n\n";
      }
      if (elements.length === 0 && types.length === 0 && simpleTypes.length === 0) {
        return "No elements or types found.";
      }
      return toc;
    } catch (error) {
      throw new McpError(ErrorCode.InternalError, `Error generating TOC: ${error.message}`);
    }
  }

  async getElementDefinition(version, elementName) {
    const files = await this.getSchemaFiles(version);
    const escapedName = NdcMcpServer.escapeRegex(elementName);

    for (const file of files) {
      const filePath = path.join(SCHEMAS_DIR, version, "raw", file);
      const content = await fs.readFile(filePath, "utf-8");

      // Try complexType first
      const typeResult = this.extractXmlBlock(content, "xs:complexType", escapedName);
      if (typeResult) return `File: ${file}\n\n${typeResult}`;

      // Try top-level element
      const elementResult = this.extractXmlBlock(content, "xs:element", escapedName);
      if (elementResult) return `File: ${file}\n\n${elementResult}`;

      // Try simpleType
      const simpleResult = this.extractXmlBlock(content, "xs:simpleType", escapedName);
      if (simpleResult) return `File: ${file}\n\n${simpleResult}`;
    }

    return `Definition for "${elementName}" not found in NDC version ${version}.`;
  }

  /**
   * Extracts a balanced XML block (e.g., a full <xs:complexType>...</xs:complexType>) from content.
   * Uses tag counting instead of greedy regex to correctly handle nested tags of the same type.
   */
  extractXmlBlock(content, tagName, escapedName) {
    const openPattern = new RegExp(`<${tagName}[^>]+name="${escapedName}"`, "g");
    const match = openPattern.exec(content);
    if (!match) return null;

    const startIndex = match.index;
    const shortTag = tagName; // e.g., "xs:complexType"

    // Check for self-closing tag first
    const selfCloseCheck = content.indexOf("/>", match.index + match[0].length);
    const nextClose = content.indexOf(">", match.index + match[0].length);
    if (nextClose === selfCloseCheck + 1) {
      // This is a self-closing tag like <xs:element name="Foo" type="Bar"/>
      return content.substring(startIndex, selfCloseCheck + 2);
    }

    // Count nested open/close tags to find the matching closing tag
    let depth = 1;
    let searchPos = nextClose + 1;
    const openTag = `<${shortTag}`;
    const closeTag = `</${shortTag}>`;

    while (depth > 0 && searchPos < content.length) {
      const nextOpen = content.indexOf(openTag, searchPos);
      const nextCloseTag = content.indexOf(closeTag, searchPos);

      if (nextCloseTag === -1) break; // Malformed XML, bail

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

    return null; // Could not find balanced closing tag
  }

  async searchInSchemas(version, query) {
    const files = await this.getSchemaFiles(version);
    let regex;
    try {
      regex = new RegExp(query, "i");
    } catch (error) {
      // If the user provides an invalid regex, fall back to a literal match
      regex = new RegExp(NdcMcpServer.escapeRegex(query), "i");
    }
    let results = "";

    for (const file of files) {
      const filePath = path.join(SCHEMAS_DIR, version, "raw", file);
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

  async run() {
    // Determine transport mode from CLI args or ENV
    const useSSE = process.argv.includes("--sse") || process.env.SSE === "true";

    if (useSSE) {
      const app = express();
      app.use(cors());
      // NOTE: Do NOT use express.json() globally. SSEServerTransport.handlePostMessage
      // reads the raw request body itself. If express.json() consumes the stream first,
      // handlePostMessage will fail with "stream is not readable".

      app.get("/sse", async (req, res) => {
        console.error("New SSE connection established");
        const { SSEServerTransport } = await import("@modelcontextprotocol/sdk/server/sse.js");
        const transport = new SSEServerTransport("/messages", res);

        this.transports.set(transport.sessionId, transport);

        res.on("close", () => {
          console.error(`SSE connection closed for session: ${transport.sessionId}`);
          this.transports.delete(transport.sessionId);
        });

        await this.server.connect(transport);
      });

      app.post("/messages", async (req, res) => {
        const sessionId = req.query.sessionId;
        const transport = this.transports.get(sessionId);

        if (transport) {
          await transport.handlePostMessage(req, res);
        } else {
          res.status(400).json({ error: `No active SSE transport for session: ${sessionId}` });
        }
      });

      // Health check endpoint
      app.get("/health", (req, res) => {
        res.json({
          status: "ok",
          activeSessions: this.transports.size,
          uptime: process.uptime(),
        });
      });

      const PORT = process.env.PORT || 3000;
      app.listen(PORT, "0.0.0.0", () => {
        console.error(`NDC MCP Server running on http://0.0.0.0:${PORT}/sse`);
      });
    } else {
      // Default to STDIO transport (Standard for local usage and Claude Desktop)
      const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
      const transport = new StdioServerTransport();
      await this.server.connect(transport);
      console.error("NDC MCP Server running on stdio");
    }
  }
}

export { NdcMcpServer, SCHEMAS_DIR };

const server = new NdcMcpServer();
server.run().catch(console.error);
