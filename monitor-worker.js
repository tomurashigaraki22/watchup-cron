import dotenv from "dotenv";
import fetch from "node-fetch";
import nodemailer from "nodemailer";
import { query } from "./db.js";

dotenv.config();

const tasks = new Map();

const botToken = process.env.TELEGRAM_BOT_TOKEN;
const smtpHost = "smtp.gmail.com";
const smtpPort = 587;
const smtpUser = "devtomiwa9@gmail.com";
const smtpPass = "skyh iwhz zzis exdq";
const smtpFrom = "Watchup Web";
const transporter = smtpHost
  ? nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort || 587,
      secure: (smtpPort || 587) === 465,
      auth: smtpUser ? { user: smtpUser, pass: smtpPass } : undefined,
    })
  : null;

async function sendTelegramMessage(chatId, text) {
  if (!botToken || !chatId) return;
  await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" }),
  });
}

async function sendEmail(to, subject, text) {
  if (!transporter || !smtpFrom || !to) return;
  await transporter.sendMail({ from: smtpFrom, to, subject, text });
}

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
    const prevStatus = state.monitor.status || "unknown";
    if (prevStatus !== status) {
      if (status === "down") {
        try {
          const users = await query(
            "SELECT id, email, name, telegram_chat_id, telegram_enabled FROM users WHERE id=?",
            [state.monitor.user_id]
          );
          const user = users && users[0];
          if (user) {
            const text = `❗️ Website down\n${state.monitor.name || "Monitor"}: ${state.monitor.url}`;
            if (user.telegram_enabled === 1 && user.telegram_chat_id) {
              await sendTelegramMessage(user.telegram_chat_id, text);
            } else if (user.email) {
              await sendEmail(user.email, "Website down", `${state.monitor.name || "Monitor"} is DOWN: ${state.monitor.url}`);
            }
          }
        } catch {}
        try {
          await fetch("https://watchup-web.vercel.app/api/webhooks/monitor-status", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              monitor_id: state.monitor.id,
              status: "down",
              details: {},
            }),
          });
        } catch {}
      } else if (status === "up") {
        try {
          const users = await query(
            "SELECT id, email, name, telegram_chat_id, telegram_enabled FROM users WHERE id=?",
            [state.monitor.user_id]
          );
          const user = users && users[0];
          if (user) {
            const text = `✅ Website recovery\n${state.monitor.name || "Monitor"}: ${state.monitor.url}`;
            if (user.telegram_enabled === 1 && user.telegram_chat_id) {
              await sendTelegramMessage(user.telegram_chat_id, text);
            } else if (user.email) {
              await sendEmail(user.email, "Website recovered", `${state.monitor.name || "Monitor"} is UP: ${state.monitor.url}`);
            }
          }
        } catch {}
      }
    }
    await query(
      "UPDATE monitors SET status=?, last_checked=NOW(), next_check=DATE_ADD(NOW(), INTERVAL ? SECOND) WHERE id=?",
      [status, state.monitor.check_interval_seconds, state.monitor.id]
    );
    state.monitor.status = status;
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
    status: r.status,
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
        existing.state.monitor.status = m.status;
      }
    }
  }
}

async function start() {
  await reconcile();
  setInterval(reconcile, 60 * 1000);
}

start();
