const http = require('http');
const WebSocket = require('ws');

// In-memory grid: key = "row-col", value = string
const grid = {};

const server = http.createServer((req, res) => {
  res.writeHead(200);
  res.end('OK');
});

const wss = new WebSocket.Server({ server });

function broadcastAll(message) {
  const data = JSON.stringify(message);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  });
}

wss.on('connection', (ws) => {
  // Send current state to the new client
  ws.send(
    JSON.stringify({
      type: 'init',
      grid,
      connectionCount: wss.clients.size,
    })
  );

  // Broadcast updated connection count to all clients
  broadcastAll({
    type: 'connection_count',
    count: wss.clients.size,
  });

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'cell_update') {
        const { row, col, value } = msg;
        const key = `${row}-${col}`;
        if (value === '' || value == null) {
          delete grid[key];
        } else {
          grid[key] = String(value);
        }
        // Broadcast the update to all connected clients (including sender)
        broadcastAll({
          type: 'cell_update',
          row,
          col,
          value: value === '' || value == null ? '' : String(value),
        });
      }
    } catch (e) {
      console.error('Message processing error:', e);
    }
  });

  ws.on('close', () => {
    // Broadcast updated count after client leaves
    broadcastAll({
      type: 'connection_count',
      count: wss.clients.size,
    });
  });

  ws.on('error', (err) => {
    console.error('WebSocket client error:', err);
  });
});

server.listen(3001, '0.0.0.0', () => {
  console.log('Backend WebSocket server running on port 3001');
});
