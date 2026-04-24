### Goal
Update the local MCP server’s `/sse` endpoint so it conforms to Claude’s MCP SSE protocol and stays connected.

### Current Behavior
- Immediately emits `event: endpoint` with data like `/messages?sessionId=...`.
- Closes the HTTP response right after that event.
- Result: clients (curl/Claude) read the first chunk and the connection drops (`curl: (18) transfer closed…`), so Claude marks the server as failed.

### Required Changes

1. **Keep the SSE stream open**  
   - Do **not** call `res.end()` after the first event.
   - Let the connection persist until the client disconnects (`req.on('close', …)` handler should clean everything up).

2. **Send a compliant handshake message**  
   - The very first `data:` block must be a JSON line with `type: "ready"`.  
   ```
   data: {"type":"ready","version":"DOTTED_STRING","capabilities":{"tools":true_or_false,"resources":true_or_false}}
   ```
   - Do **not** set a custom `event:` name; just write `data: …\n\n`.

3. **Handle heartbeats & subsequent messages**  
   - Optionally send periodic pings (e.g., `{ "type": "ping" }`) every ~15 seconds to keep proxies happy.
   - Later messages (tool calls, responses, etc.) should also be JSON in plain SSE `data:` blocks.

4. **Implement cleanup**  
   - On `req.on('close')`, clear intervals/timeouts and call `res.end()`.

5. **Test expectations**  
   - `curl -N http://127.0.0.1:3000/sse` should print the `ready` JSON and then sit idle until you Ctrl+C.
   - Claude CLI (`/mcp`) should now show the server as connected.

### Pseudocode Skeleton

```js
app.get('/sse', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const ready = {
    type: 'ready',
    version: '0.1.0',
    capabilities: {
      tools: true,      // adjust to actual support
      resources: false,
    },
  };
  res.write(`data: ${JSON.stringify(ready)}\n\n`);

  const heartbeat = setInterval(() => {
    res.write(`data: ${JSON.stringify({ type: 'ping' })}\n\n`);
  }, 15000);

  // TODO: wire up actual MCP message handling here

  req.on('close', () => {
    clearInterval(heartbeat);
    res.end();
  });
});
```
