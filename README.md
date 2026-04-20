# NDC MCP Server

A Node.js-based [Model Context Protocol (MCP)](https://modelcontextprotocol.io) server that provides standardized access to **IATA NDC (New Distribution Capability)** schemas.

This server allows AI assistants (like Claude, ChatGPT, or custom agents) to explore, search, and retrieve NDC schema definitions (XSD and JSON) to facilitate comparison with other GDS systems like Navitaire.

## Features

### 📂 Versioned Schema Access
Organized storage for different NDC versions (currently supports **v26.1**). The structure is designed to be easily extensible for future releases.

### 🔍 Powerful Search
Built-in tools to search for specific NDC concepts (e.g., `Baggage`, `Offer`, `Ancillary`) across hundreds of schema files using regex.

### 📖 Smart Reading
Retrieve specific schema files or target specific line ranges, ensuring large schema files (like `IATA_OffersAndOrdersCommonTypes.xsd`) can be parsed efficiently by AI models.

### 🔌 MCP Standardized Tools & Resources
- **Resources**: Direct access to schemas via `ndc://{version}/schema/{path}`.
- **Tools**:
    - `list_ndc_versions`: View supported NDC versions.
    - `list_ndc_schemas`: List all available schemas for a version.
    - `search_ndc_schemas`: Find keywords/regex matches across all files.
    - `read_ndc_schema`: Read file contents with optional line-range support.

## Installation

1.  **Clone the repository**:
    ```bash
    git clone <your-repo-url>
    cd ndc-mcp-server
    ```

2.  **Install dependencies**:
    ```bash
    npm install
    ```

## Usage

### Running Locally
You can start the server in stdio mode:
```bash
npm start
```

### Configuring for AI Clients

To use this server with an MCP client (e.g., **Claude Desktop**), add it to your configuration file:

**macOS (Claude Desktop config):**
`~/Library/Application Support/Claude/claude_desktop_config.json`

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

## Project Structure

```text
ndc-mpc/
├── schemas/
│   └── 26.1/                 # NDC v26.1 XSD and JSON standards
├── src/
│   └── index.js             # Main MCP server implementation
├── package.json             # Node.js project configuration
└── .gitignore               # Standard git exclusions
```

## Why this exists?
NDC is a complex, evolving standard. Comparing its concepts (like `Offer/Order`) with legacy GDS models (like Navitaire's `Commit/Hold`) requires deep schema knowledge. This MCP server empowers AI agents to perform this analysis accurately by providing them direct, searchable access to the source-of-truth IATA schemas.

## License
Refer to the `IATA PSC Data Exchange Specifications License` included in the schemas folder for usage terms regarding the IATA standards.
