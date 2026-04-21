# NDC MCP Server

A Node.js-based [Model Context Protocol (MCP)](https://modelcontextprotocol.io) server that provides standardized access to **IATA NDC (New Distribution Capability)** schemas.

This server allows AI assistants (like Claude, ChatGPT, or custom agents) to explore, search, and retrieve NDC schema definitions (XSD and JSON) to facilitate deep architectural comparisons, such as translating legacy GDS systems (like Navitaire) into modern NDC standards.

---

## 🌟 Features

### 🔌 Dual Transport (Stdio & SSE)
Run it locally for desktop apps (Claude Desktop) via standard I/O, or run it as a network service using Server-Sent Events (SSE) so remote agents can connect via HTTP.

### 🧠 AI-Optimized "Lens" Tools
Raw XSD files can exceed 1MB, instantly blowing out an AI's context window. This server includes specialized tools to extract just what the AI needs:
- `get_schema_toc`: Generates a lightweight Table of Contents for massive schemas.
- `get_element_definition`: Extracts only the precise XML definition block for a requested element, saving thousands of tokens.

### 📂 Versioned Schema Storage
Organized storage for different NDC versions (currently supports **v26.1**). The structure allows drop-in support for `/schemas/27.1/`, etc.

---

## 🚀 Installation & Setup

1. **Clone the repository**:
   ```bash
   git clone <your-repo-url>
   cd ndc-mcp-server
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

---

## 💻 Usage & Testing

### 1. Local / Desktop Usage (Stdio)
This is the default mode and is how Claude Desktop expects local servers to behave.
```bash
npm start
```
*(You will see `NDC MCP Server running on stdio` and it will wait for MCP JSON-RPC over standard input).*

**Testing via MCP Inspector (Stdio):**
To test this mode cleanly:
```bash
npx @modelcontextprotocol/inspector node src/index.js
```

### 2. Remote Usage (SSE / HTTP)
To expose the server to the network so remote agents can hit it via an IP address:
```bash
npm run start:sse
```
Or equivalently: `node src/index.js --sse`
> By default, this listens on `0.0.0.0:3000`. You can change this by setting the `PORT` environment variable (e.g., `PORT=8080 node src/index.js --sse`).

**Testing via MCP Inspector (SSE):**
1. Ensure the server is running with the SSE flag (`node src/index.js --sse`).
2. Run the inspector UI:
   ```bash
   npx @modelcontextprotocol/inspector
   ```
3. In the web interface that opens, change the Transport type to "SSE" and enter `http://localhost:3000/sse` as the URL.

---

## 🤖 Integrating with AI Tools

All **local tools** (Claude Desktop, Cursor, Windsurf, VS Code) use **Stdio** mode — they spawn the server process themselves.
All **remote agents** (LangChain, custom scripts) use **SSE** mode — you start the server first.

---

### Windsurf / Codeium (Cascade)

Edit `~/.codeium/windsurf/mcp_config.json`:
```json
{
  "mcpServers": {
    "ndc-schemas": {
      "command": "node",
      "args": ["/absolute/path/to/ndc-mpc/src/index.js"]
    }
  }
}
```
Then click the **🔨 hammer icon** in Cascade → **Refresh MCP**.

---

### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS):
```json
{
  "mcpServers": {
    "ndc-schemas": {
      "command": "node",
      "args": ["/absolute/path/to/ndc-mpc/src/index.js"]
    }
  }
}
```
Restart Claude Desktop after saving.

---

### Claude Code (CLI)

```bash
claude mcp add ndc-schemas -- node /absolute/path/to/ndc-mpc/src/index.js
```
To verify it's connected, run `/mcp` inside the Claude Code REPL.

---

### Cursor

Create `.cursor/mcp.json` in your project root (or `~/.cursor/mcp.json` globally):
```json
{
  "mcpServers": {
    "ndc-schemas": {
      "command": "node",
      "args": ["/absolute/path/to/ndc-mpc/src/index.js"]
    }
  }
}
```
Reload the window (`Cmd+Shift+P` → **Reload Window**) after saving.

---

### VS Code (GitHub Copilot)

Create `.vscode/mcp.json` in your project root:
```json
{
  "servers": {
    "ndc-schemas": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/ndc-mpc/src/index.js"]
    }
  }
}
```

---

### Remote Agents (LangChain, custom scripts, etc.)

Start the server in SSE mode first:
```bash
npm run start:sse
```
Then point your agent at the SSE endpoint:
```text
http://<SERVER_IP_ADDRESS>:3000/sse
```

---

### Example AI Prompts
Once connected, use prompts like:

> *"Search the NDC 26.1 schemas for how 'Ancillaries' are modelled. Compare this to Navitaire's SSR model — what are the key differences?"*

> *"Use `get_schema_toc` on `IATA_AirShoppingRQ.xsd`, then use `get_element_definition` to extract the full definition of the root request element."*

---

## 🧰 Available Tools & Resources

### Available Tools
The AI agent has access to the following functions:
- **`list_ndc_versions`**: Returns a list of supported schema versions (e.g., `["26.1"]`).
- **`list_ndc_schemas`**: Lists all available schema files for a given version.
- **`search_ndc_schemas`**: Performs a regex search across all schemas in a version (e.g., query `"OfferInfo"`).
- **`read_ndc_schema`**: Reads a snippet or the entirety of a raw schema file with line-range targeting.
- **`get_schema_toc`**: Returns a Markdown list of every `<xs:element>`, `<xs:complexType>`, and `<xs:simpleType>` in a file.
- **`get_element_definition`**: The most powerful tool. Extracts only the exact XML block defining a requested element using balanced tag matching (e.g., `BaggageConformanceQualifyRQ`).

### Available Resources
The raw schemas are exposed as direct MCP resources if an agent prefers direct URI access.
- **URI Format**: `ndc://{version}/schema/{filename}`
- **Example**: `ndc://26.1/schema/IATA_AirShoppingRQ.xsd`

---

## 📁 Project Structure

```text
ndc-mcp-server/
├── schemas/
│   └── 26.1/raw/            # Raw NDC v26.1 XSD and JSON standards
├── src/
│   └── index.js             # MCP server (Stdio + Express/SSE dual transport)
├── tests/
│   ├── fixtures/            # Test schema fixtures
│   └── ndc-server.test.js   # Unit tests (21 test cases)
├── vitest.config.js         # Test runner configuration
├── package.json             # Node.js configuration
└── .gitignore               # Standard git exclusions
```

## 🧪 Running Tests

```bash
npm test             # Run all tests once
npm run test:watch   # Run tests in watch mode
```

## 🩺 Health Check (SSE Mode)

When running in SSE mode, a health endpoint is available:
```bash
curl http://localhost:3000/health
```
Returns: `{ "status": "ok", "activeSessions": 0, "uptime": 123.45 }`

## ⚖️ License
Refer to the `IATA PSC Data Exchange Specifications License` included in the schemas folder for usage terms regarding the underlying IATA standards.
