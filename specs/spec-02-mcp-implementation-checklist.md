# MCP Server Implementation Checklist

Use this playbook whenever you or another agent need to build a Model Context Protocol (MCP) server that Claude Code (or any compliant client) can talk to.

---

## 1. Pick your transport

| Transport | When to use | Server requirements |
|-----------|-------------|---------------------|
| **SSE** (Server-Sent Events) | Simple to self-host, works well for local dev | Expose a long-lived `GET /sse` stream and a `POST /messages` endpoint |
| **HTTP** | API-style servers with stateless request/response | Expose a single endpoint that handles JSON-RPC over HTTP POST |
| **stdio** | CLI tools or binaries you can spawn | Implement the JSON-RPC protocol on stdin/stdout |

> These instructions focus on SSE, because it’s the most common for local MCP servers. The JSON-RPC pieces apply to any transport.

---

## 2. SSE endpoint structure

### 2.1. Provide a health probe

Claude’s CLI sends a quick probe before opening the SSE stream. Respond with **200 OK**:

```
POST /sse
→ { "ok": true }
```

### 2.2. Stream setup (`GET /sse`)

When a client connects:

1. Set headers:

```
Content-Type: text/event-stream; charset=utf-8
Cache-Control: no-cache, no-transform
Connection: keep-alive
Access-Control-Allow-Origin: *
```

2. Flush headers (if your server framework requires it).

3. Generate a unique `sessionId`.

4. Send these SSE events, in order:

   ```text
   event: endpoint
   data: /messages?sessionId=<YOUR_SESSION_ID>

   data: {"type":"ready","version":"X.Y.Z","serverInfo":{"name":"...","version":"..."},"capabilities":{...}}
   ```

   * `event: endpoint` tells Claude how to POST back to you.
   * The `ready` event must be JSON and contain your version and capabilities.

5. Optionally send a greeting or notification.

6. Keep the connection alive with periodic heartbeats (e.g., every 15 s send `data: {"type":"ping"}`).

7. Store the `sessionId → {res, heartbeat}` so you can reply later.

8. On `close`:
   * Clear timers.
   * Remove the session from your map.
   * End the response.

---

## 3. JSON-RPC contract (`POST /messages?sessionId=...`)

Claude sends JSON-RPC 2.0 payloads to the endpoint you advertised.

### 3.1. Basic validation

- Reject requests with missing or unknown `sessionId` (return HTTP 400).
- Accept single objects or arrays (batch requests).
- For each payload, check `jsonrpc === "2.0"`.

### 3.2. Respond to required methods

Handle at least:

| Method | Required response |
|--------|-------------------|
| `initialize` (request) | Reply with `{"jsonrpc":"2.0","id":...,"result":{ "protocolVersion":"2025-11-25", "capabilities": { ... }, "serverInfo": {...} }}`. Echo `params.protocolVersion` if provided. |
| `shutdown` (request) | Reply with `{"jsonrpc":"2.0","id":...,"result":null}`. |
| `exit` (notification) | No response; close the session. |

Capabilities shape (fill with the features you implement):

```json
{
  "tools": {},
  "resources": {},
  "prompts": {},
  "roots": {},
  "elicitation": {}
}
```

### 3.3. Respond to other requests

- For supported methods (custom tool logic), return either:
  - Result: `{"jsonrpc":"2.0","id":ID,"result":...}`
  - Error: `{"jsonrpc":"2.0","id":ID,"error":{"code":INT,"message":"string","data":optional}}`
- For unsupported methods, return error `code: -32601` (`Method not found`).

### 3.4. Send notifications/events

Use SSE to push server-initiated messages:

```js
sendJson(sessionId, {
  jsonrpc: "2.0",
  method: "myEvent",
  params: {...}
});
```

### 3.5. Handle incoming responses

Claude may send responses to your own requests if you implement bidirectional communication. Log or process them accordingly.

---

## 4. Session lifecycle & cleanup

- Track active clients by `sessionId`.
- Cancel heartbeats and remove entries on disconnect.
- If your logic aborts a client (e.g., after `exit`), call your cleanup routine and `res.end()`.

---

## 5. Authentication (optional)

- If your server requires tokens, accept `Authorization: Bearer ...`.
- Prompt the user to add a token: `claude mcp token set <name>`.
- Verify the token on every `/messages` and `/sse` request.

---

## 6. Testing checklist

1. **Curl probe**:

   ```bash
   curl -X POST http://127.0.0.1:3030/sse
   # expect {"ok":true}
   ```

2. **Manual SSE**:

   ```bash
   curl -N http://127.0.0.1:3030/sse
   ```

   - See `event: endpoint` with a session URL.
   - See `data: {"type":"ready", ...}`.
   - Observe periodic `ping` messages.
   - Press Ctrl‑C to exit.

3. **Sample JSON-RPC request**:

   ```bash
   curl -X POST "http://127.0.0.1:3030/messages?sessionId=<ID>" \
        -H 'Content-Type: application/json' \
        -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25"}}'
   ```

   - SSE stream should emit a JSON-RPC response with `result.protocolVersion`.

---

## 7. Register with Claude Code

```bash
claude mcp add --transport sse <name> http://127.0.0.1:<port>/sse
```

(Exact flags vary by version; check `claude mcp add --help`.)

Inside the Claude CLI, run `/mcp`. Look for a green check mark (✔) next to your server.

---

## 8. Common pitfalls

| Issue | Cause | Fix |
|-------|-------|-----|
| Connection fails immediately | 404 on `POST /sse` or wrong URL | Implement probe endpoint, double-check registration |
| Times out after 30 s | No `ready` message, or stream closes | Send `ready` JSON and keep SSE open |
| `ZodError` about `protocolVersion` | Missing `result.protocolVersion` | Include the string in `initialize` response |
| `Method not implemented` surfaces | You didn’t handle Claude’s request | Add a handler or respond with `-32601` |
| Response ignored | Missing `jsonrpc: "2.0"` or `id` | Always include them in responses |

---

## 9. Optional extras

- **Logging**: include session IDs in logs for traceability.
- **Graceful shutdown**: close all sessions on server exit.
- **Tooling**: define tool descriptors if you want Claude to call functions automatically.
- **Resource providers**: implement resource listings/reads if you expose directories or data.