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
node src/index.js --sse
```
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

### Connecting Claude Desktop (Local)
To use this server with your local Claude Desktop app, edit your config file:

**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "ndc-mcp": {
      "command": "node",
      "args": ["<absolute-path-to-your-project>/src/index.js"]
    }
  }
}
```

### Connecting Remote AI Agents (LangChain, etc.)
Point your remote agent's MCP Client configuration to the Server-Sent Events endpoint:
```text
http://<SERVER_IP_ADDRESS>:3000/sse
```

### Example AI Prompts
Once your AI is connected to the server, you can give it highly complex prompts bridging NDC and your existing knowledge base:

> *"Search the NDC 26.1 schemas to find how 'Ancillaries' are modelled. Compare this structure to Navitaire's SSR (Special Service Request) model. What are the key differences in how pricing is attached to the service?"*

> *"Use the `get_schema_toc` tool on `IATA_AirShoppingRQ.xsd` to list the root elements. Then, use `get_element_definition` to extract the definition of the shopping request payload."*

---

## 🧰 Available Tools & Resources

### Available Tools
The AI agent has access to the following functions:
- **`list_ndc_versions`**: Returns a list of supported schema versions (e.g., `["26.1"]`).
- **`list_ndc_schemas`**: Lists all available schema files for a given version.
- **`search_ndc_schemas`**: Performs a regex search across all schemas in a version (e.g., query `"OfferInfo"`).
- **`read_ndc_schema`**: Reads a snippet or the entirety of a raw schema file with line-range targeting.
- **`get_schema_toc`**: Returns a Markdown list of every `<xs:element>` and `<xs:complexType>` in a file.
- **`get_element_definition`**: The most powerful tool. Extrapolates only the exact XML block defining a requested element (e.g., `BaggageConformanceQualifyRQ`).

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
│   └── index.js             # Main Express & MCP SSE server implementation
├── package.json             # Node.js configuration
└── .gitignore               # Standard git exclusions
```

## ⚖️ License
Refer to the `IATA PSC Data Exchange Specifications License` included in the schemas folder for usage terms regarding the underlying IATA standards.
