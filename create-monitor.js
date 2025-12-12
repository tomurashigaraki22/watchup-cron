import dotenv from "dotenv";
import { query } from "./db.js";
import http from "http";

dotenv.config();

const port = Number(process.env.PORT || 3001);

const server = http.createServer(async (req, res) => {
  if (req.method === "POST" && req.url === "/api/monitor/create") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", async () => {
      try {
        const payload = JSON.parse(body || "{}");
        const { user_id, url, name, check_interval_seconds, tags } = payload;
        if (!user_id || !url || !check_interval_seconds) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "invalid_payload" }));
          return;
        }
        const rows = await query(
          "INSERT INTO monitors (user_id, url, name, check_interval_seconds, tags, enabled, status) VALUES (?, ?, ?, ?, ?, 1, 'unknown')",
          [user_id, url, name || null, Number(check_interval_seconds), tags ? JSON.stringify(tags) : null]
        );
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ id: rows.insertId }));
      } catch {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "server_error" }));
      }
    });
    return;
  }
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "not_found" }));
});

server.listen(port);

