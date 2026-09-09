import "dotenv/config";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { join } from "node:path";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const demoPort = Number(process.env.DEMO_PORT || 3042);
const controlPort = Number(process.env.CONTROL_PORT || 3043);
const host = "127.0.0.1";
const demoUrl = `http://localhost:${demoPort}`;
const serverPath = join(__dirname, "server.js");
const logs = [];

let demoProcess = null;

const server = createServer(async (req, res) => {
  if (!isLocalRequest(req)) {
    sendJson(res, 403, { error: "forbidden" });
    return;
  }

  const url = new URL(req.url || "/", `http://${req.headers.host}`);

  if (url.pathname === "/" || url.pathname === "/control") {
    sendHtml(res, renderControlPage());
    return;
  }

  if (url.pathname === "/api/status") {
    sendJson(res, 200, await buildStatus());
    return;
  }

  if (url.pathname === "/api/start" && req.method === "POST") {
    sendJson(res, 200, await startDemo());
    return;
  }

  if (url.pathname === "/api/stop" && req.method === "POST") {
    sendJson(res, 200, await stopDemo());
    return;
  }

  sendJson(res, 404, { error: "not_found" });
});

server.listen(controlPort, host, () => {
  console.log(`Doubao demo control: http://localhost:${controlPort}`);
});

function isLocalRequest(req) {
  const address = req.socket.remoteAddress || "";
  return address === host || address === "::1" || address.endsWith("127.0.0.1");
}

async function startDemo() {
  if (await isDemoRunning()) {
    addLog("Demo is already running.");
    return await buildStatus("already_running");
  }

  demoProcess = spawn(process.execPath, [serverPath], {
    cwd: __dirname,
    env: {
      ...process.env,
      PORT: String(demoPort)
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  addLog(`Starting demo with pid ${demoProcess.pid}.`);
  demoProcess.stdout.on("data", (chunk) => addLog(chunk.toString().trim()));
  demoProcess.stderr.on("data", (chunk) => addLog(chunk.toString().trim()));
  demoProcess.on("exit", (code, signal) => {
    addLog(`Demo exited: code=${code ?? ""} signal=${signal ?? ""}`);
    demoProcess = null;
  });

  await waitForDemo(true, 5000);
  return await buildStatus("started");
}

async function stopDemo() {
  const pids = await findDemoPids();

  if (demoProcess && !demoProcess.killed) {
    demoProcess.kill("SIGTERM");
  }

  for (const pid of pids) {
    if (pid !== process.pid) {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        // The process may have already exited.
      }
    }
  }

  const stopped = await waitForDemo(false, 5000);
  if (!stopped) {
    for (const pid of await findDemoPids()) {
      if (pid !== process.pid) {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          // The process may have already exited.
        }
      }
    }
    await waitForDemo(false, 2000);
  }

  demoProcess = null;
  addLog("Stop requested.");
  return await buildStatus("stopped");
}

async function buildStatus(action = "status") {
  return {
    action,
    controlUrl: `http://localhost:${controlPort}`,
    demoUrl,
    demoPort,
    running: await isDemoRunning(),
    logs: logs.slice(-30)
  };
}

async function isDemoRunning() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1200);
    const response = await fetch(`${demoUrl}/health`, { signal: controller.signal });
    clearTimeout(timeout);
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForDemo(targetRunning, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if ((await isDemoRunning()) === targetRunning) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

async function findDemoPids() {
  return new Promise((resolve) => {
    execFile("lsof", ["-ti", `tcp:${demoPort}`], (error, stdout) => {
      if (error || !stdout.trim()) {
        resolve([]);
        return;
      }
      resolve(
        stdout
          .trim()
          .split(/\s+/)
          .map((pid) => Number(pid))
          .filter(Number.isInteger)
      );
    });
  });
}

function addLog(line) {
  if (!line) return;
  const stamp = new Date().toLocaleTimeString();
  for (const item of String(line).split(/\r?\n/).filter(Boolean)) {
    logs.push(`[${stamp}] ${item}`);
  }
  logs.splice(0, Math.max(0, logs.length - 80));
}

function sendJson(res, code, body) {
  res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function sendHtml(res, body) {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(body);
}

function renderControlPage() {
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>豆包 Demo 服务控制台</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f5f7fb;
        --panel: #ffffff;
        --text: #172033;
        --muted: #647086;
        --line: #dce2ec;
        --primary: #1763ff;
        --danger: #c43c3c;
        --ok: #137a45;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        min-height: 100vh;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: var(--bg);
        color: var(--text);
      }

      main {
        width: min(880px, calc(100vw - 32px));
        margin: 48px auto;
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 8px;
        padding: 28px;
        box-shadow: 0 14px 34px rgba(23, 32, 51, 0.08);
      }

      header {
        display: flex;
        justify-content: space-between;
        gap: 18px;
        align-items: flex-start;
        margin-bottom: 24px;
      }

      h1 {
        margin: 0 0 8px;
        font-size: 24px;
        line-height: 1.2;
      }

      p {
        margin: 0;
        color: var(--muted);
        line-height: 1.6;
      }

      .status {
        min-width: 112px;
        text-align: center;
        border-radius: 999px;
        padding: 8px 12px;
        border: 1px solid var(--line);
        color: var(--muted);
        font-weight: 700;
      }

      .status.ok {
        color: var(--ok);
        border-color: rgba(19, 122, 69, 0.28);
        background: rgba(19, 122, 69, 0.08);
      }

      .status.off {
        color: var(--danger);
        border-color: rgba(196, 60, 60, 0.24);
        background: rgba(196, 60, 60, 0.08);
      }

      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        margin: 24px 0;
      }

      button,
      a.button {
        appearance: none;
        border: 1px solid var(--line);
        border-radius: 8px;
        background: #fff;
        color: var(--text);
        min-height: 42px;
        padding: 0 16px;
        font: inherit;
        font-weight: 700;
        text-decoration: none;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
      }

      button.primary {
        border-color: var(--primary);
        background: var(--primary);
        color: #fff;
      }

      button.danger {
        border-color: rgba(196, 60, 60, 0.3);
        color: var(--danger);
      }

      button:disabled,
      a.button.disabled {
        opacity: 0.45;
        cursor: not-allowed;
      }

      .meta {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 12px;
        margin-bottom: 18px;
      }

      .meta div {
        border: 1px solid var(--line);
        border-radius: 8px;
        padding: 12px;
      }

      .meta span {
        display: block;
        color: var(--muted);
        font-size: 12px;
        margin-bottom: 5px;
      }

      .meta b {
        font-size: 14px;
        overflow-wrap: anywhere;
      }

      pre {
        min-height: 180px;
        max-height: 320px;
        overflow: auto;
        margin: 0;
        padding: 14px;
        border-radius: 8px;
        border: 1px solid var(--line);
        background: #101828;
        color: #e9eef8;
        font-size: 12px;
        line-height: 1.6;
        white-space: pre-wrap;
      }

      @media (max-width: 680px) {
        header,
        .meta {
          display: block;
        }

        .status {
          margin-top: 16px;
        }

        .meta div + div {
          margin-top: 12px;
        }

        main {
          margin: 20px auto;
          padding: 18px;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <header>
        <div>
          <h1>豆包 Demo 服务控制台</h1>
          <p>控制本机 ${demoPort} 端口上的豆包全双工语音 demo。</p>
        </div>
        <div id="status" class="status">检测中</div>
      </header>

      <section class="meta" aria-label="服务信息">
        <div>
          <span>Demo 地址</span>
          <b>${demoUrl}</b>
        </div>
        <div>
          <span>控制台地址</span>
          <b>http://localhost:${controlPort}</b>
        </div>
      </section>

      <div class="actions">
        <button id="startBtn" class="primary" type="button">开启服务</button>
        <button id="stopBtn" class="danger" type="button">关闭服务</button>
        <button id="refreshBtn" type="button">刷新状态</button>
        <a id="openDemo" class="button" href="${demoUrl}" target="_blank" rel="noreferrer">打开 Demo</a>
      </div>

      <pre id="log">等待状态...</pre>
    </main>

    <script>
      const statusEl = document.querySelector("#status");
      const logEl = document.querySelector("#log");
      const startBtn = document.querySelector("#startBtn");
      const stopBtn = document.querySelector("#stopBtn");
      const refreshBtn = document.querySelector("#refreshBtn");
      const openDemo = document.querySelector("#openDemo");

      startBtn.addEventListener("click", () => requestAction("/api/start"));
      stopBtn.addEventListener("click", () => requestAction("/api/stop"));
      refreshBtn.addEventListener("click", refreshStatus);

      async function requestAction(path) {
        setBusy(true);
        try {
          const response = await fetch(path, { method: "POST" });
          renderStatus(await response.json());
        } catch (error) {
          renderError(error);
        } finally {
          setBusy(false);
        }
      }

      async function refreshStatus() {
        setBusy(true);
        try {
          const response = await fetch("/api/status");
          renderStatus(await response.json());
        } catch (error) {
          renderError(error);
        } finally {
          setBusy(false);
        }
      }

      function renderStatus(data) {
        statusEl.textContent = data.running ? "运行中" : "已关闭";
        statusEl.className = data.running ? "status ok" : "status off";
        startBtn.disabled = data.running;
        stopBtn.disabled = !data.running;
        openDemo.classList.toggle("disabled", !data.running);
        openDemo.tabIndex = data.running ? 0 : -1;
        logEl.textContent = [
          "状态: " + (data.running ? "运行中" : "已关闭"),
          "Demo: " + data.demoUrl,
          "",
          ...(data.logs?.length ? data.logs : ["暂无日志"])
        ].join("\\n");
      }

      function renderError(error) {
        statusEl.textContent = "异常";
        statusEl.className = "status off";
        logEl.textContent = error?.message || String(error);
      }

      function setBusy(busy) {
        startBtn.disabled = busy || statusEl.classList.contains("ok");
        stopBtn.disabled = busy || statusEl.classList.contains("off");
        refreshBtn.disabled = busy;
      }

      refreshStatus();
      setInterval(refreshStatus, 3000);
    </script>
  </body>
</html>`;
}
