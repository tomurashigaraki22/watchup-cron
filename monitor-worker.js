import dotenv from "dotenv";
import fetch from "node-fetch";
import { query } from "./db.js";

dotenv.config();

const tasks = new Map();

function createWorker(monitor) {
  const state = { running: false, monitor };

  const runCheck = async () => {
    if (state.running) return;
    state.running = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    let status = "down";
    try {
      const res = await fetch(state.monitor.url, { signal: controller.signal });
      status = res.ok ? "up" : "down";
    } catch {
      status = "down";
    } finally {
      clearTimeout(timeout);
    }
    await query(
      "UPDATE monitors SET status=?, last_checked=NOW(), next_check=DATE_ADD(NOW(), INTERVAL ? SECOND) WHERE id=?",
      [status, state.monitor.check_interval_seconds, state.monitor.id]
    );
    if (status === "down") {
      try {
        await fetch("https://yourmainapp.com/api/webhooks/monitor-status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            monitor_id: state.monitor.id,
            status: "down",
            details: {},
          }),
        });
      } catch {}
    }
    state.running = false;
  };

  const intervalId = setInterval(runCheck, state.monitor.check_interval_seconds * 1000);
  setTimeout(runCheck, 0);
  tasks.set(monitor.id, { intervalId, state });
}

function stopWorker(id) {
  const t = tasks.get(id);
  if (!t) return;
  clearInterval(t.intervalId);
  tasks.delete(id);
}

async function loadEnabledMonitors() {
  const rows = await query("SELECT * FROM monitors WHERE enabled = 1");
  return rows.map((r) => ({
    id: r.id,
    user_id: r.user_id,
    name: r.name,
    url: r.url,
    check_interval_seconds: r.check_interval_seconds,
    enabled: r.enabled,
  }));
}

async function reconcile() {
  const monitors = await loadEnabledMonitors();
  const currentIds = new Set(monitors.map((m) => m.id));

  for (const [id] of tasks) {
    if (!currentIds.has(id)) stopWorker(id);
  }

  for (const m of monitors) {
    const existing = tasks.get(m.id);
    if (!existing) {
      createWorker(m);
    } else {
      existing.state.monitor.url = m.url;
      if (existing.state.monitor.check_interval_seconds !== m.check_interval_seconds) {
        stopWorker(m.id);
        createWorker(m);
      } else {
        existing.state.monitor.check_interval_seconds = m.check_interval_seconds;
      }
    }
  }
}

async function start() {
  await reconcile();
  setInterval(reconcile, 60 * 1000);
}

start();

