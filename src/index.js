import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
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
import express from "express";

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

      const version = url.hostname;
      const pathParts = url.pathname.split("/").filter(Boolean);
      
      // Expected format: /schema/{filename}
      if (pathParts.length < 2 || pathParts[0] !== "schema") {
        throw new McpError(ErrorCode.InvalidRequest, `Invalid resource URI format: ${request.params.uri}. Expected ndc://{version}/schema/{filename}`);
      }

      const filename = pathParts.slice(1).join("/");
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
    const filePath = path.join(SCHEMAS_DIR, version, "raw", filename);
    try {
      const content = await fs.readFile(filePath, "utf-8");
      const elements = [...content.matchAll(/<xs:element[^>]+name="([^"]+)"/g)].map(m => m[1]);
      const types = [...content.matchAll(/<xs:complexType[^>]+name="([^"]+)"/g)].map(m => m[1]);
      
      let toc = `### Table of Contents for ${filename}\n\n`;
      if (elements.length > 0) {
        toc += `**Elements:**\n` + elements.map(e => `- ${e}`).join("\n") + "\n\n";
      }
      if (types.length > 0) {
        toc += `**Complex Types:**\n` + types.map(t => `- ${t}`).join("\n") + "\n\n";
      }
      return toc || "No elements or types found.";
    } catch (error) {
      throw new McpError(ErrorCode.InternalError, `Error generating TOC: ${error.message}`);
    }
  }

  async getElementDefinition(version, elementName) {
    const files = await this.getSchemaFiles(version);
    const complexTypeRegex = new RegExp(`<xs:complexType[^>]+name="${elementName}"[\\s\\S]*?<\\/xs:complexType>`, "g");
    const elementRegex = new RegExp(`<xs:element[^>]+name="${elementName}"[\\s\\S]*?(\\/|\\/xs:element)>`, "g");

    for (const file of files) {
      const filePath = path.join(SCHEMAS_DIR, version, "raw", file);
      const content = await fs.readFile(filePath, "utf-8");
      
      const typeMatch = content.match(complexTypeRegex);
      if (typeMatch) return `File: ${file}\n\n${typeMatch[0]}`;

      const elementMatch = content.match(elementRegex);
      if (elementMatch) return `File: ${file}\n\n${elementMatch[0]}`;
    }

    return `Definition for "${elementName}" not found in NDC version ${version}.`;
  }

  async searchInSchemas(version, query) {
    const files = await this.getSchemaFiles(version);
    const regex = new RegExp(query, "i");
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
    const app = express();
    app.use(express.json());

    let transport;

    app.get("/sse", async (req, res) => {
      console.error("New SSE connection established");
      transport = new SSEServerTransport("/message", res);
      await this.server.connect(transport);
    });

    app.post("/message", async (req, res) => {
      console.error("Received message via HTTP POST");
      if (transport) {
        await transport.handlePostMessage(req, res);
      } else {
        res.status(400).send("No active SSE transport");
      }
    });

    const PORT = process.env.PORT || 3000;
    app.listen(PORT, "0.0.0.0", () => {
      console.error(`NDC MCP Server running on http://0.0.0.0:${PORT}/sse`);
    });
  }
}

const server = new NdcMcpServer();
server.run().catch(console.error);
