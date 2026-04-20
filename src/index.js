import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ErrorCode,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

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

      const pathParts = url.pathname.split("/").filter(Boolean);
      // Expected format: /{version}/schema/{filename}
      if (pathParts.length < 3 || pathParts[1] !== "schema") {
        throw new McpError(ErrorCode.InvalidRequest, `Invalid resource URI format: ${request.params.uri}`);
      }

      const version = pathParts[0];
      const filename = pathParts.slice(2).join("/");
      const filePath = path.join(SCHEMAS_DIR, version, filename);

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

        default:
          throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
      }
    });
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
    const dirPath = path.join(SCHEMAS_DIR, version, subDir);
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
    const filePath = path.join(SCHEMAS_DIR, version, filename);
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

  async searchInSchemas(version, query) {
    const files = await this.getSchemaFiles(version);
    const regex = new RegExp(query, "i");
    let results = "";

    for (const file of files) {
      const filePath = path.join(SCHEMAS_DIR, version, file);
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
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("NDC MCP Server running on stdio");
  }
}

const server = new NdcMcpServer();
server.run().catch(console.error);
