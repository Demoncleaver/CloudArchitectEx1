const FUNCTION_URL = "https://v5tnfzvagdjwu5mj4k7mowxj6q0bplps.lambda-url.us-east-1.on.aws/";
const USER_ID_KEY = "chatbot_user_id";

const messagesEl = document.getElementById("messages");
const form = document.getElementById("chat-form");
const promptInput = document.getElementById("prompt");
const sendButton = document.getElementById("send");
const totalTimes = [];
const openaiTimes = [];

let userId = loadUserId();

const chart = new Chart(document.getElementById("timing-chart"), {
  type: "bar",
  data: {
    labels: [],
    datasets: [
      { label: "Total Request Time", data: [], backgroundColor: "#1293a8" },
      { label: "OpenAI API Time", data: [], backgroundColor: "#5b8def" }
    ]
  },
  options: {
    responsive: true,
    maintainAspectRatio: false,
    scales: { y: { beginAtZero: true, title: { display: true, text: "Response Time (ms)" } } },
    plugins: { legend: { position: "bottom" } }
  }
});

form.addEventListener("submit", sendMessage);
document.getElementById("new-session").addEventListener("click", startNewSession);

async function sendMessage(event) {
  event.preventDefault();
  const prompt = promptInput.value.trim();
  if (!prompt) return;

  addMessage("user", prompt);
  promptInput.value = "";
  setBusy(true);
  const pending = addMessage("assistant pending", "Thinking...");

  const started = performance.now();
  try {
    const response = await fetch(FUNCTION_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_prompt: prompt, user_id: userId })
    });
    const data = await response.json();
    const totalMs = Math.round(performance.now() - started);
    pending.remove();

    if (!response.ok) {
      addMessage("error", data.error || `Request failed with status ${response.status}`);
      return;
    }

    addMessage("assistant", data.ai_reply);
    recordTiming(totalMs, data.openai_response_time_ms);
  } catch (error) {
    pending.remove();
    addMessage("error", `Network error: ${error.message}`);
  } finally {
    setBusy(false);
    promptInput.focus();
  }
}

function addMessage(role, text) {
  const empty = messagesEl.querySelector(".empty");
  if (empty) empty.remove();
  const el = document.createElement("div");
  el.className = `msg ${role}`;
  el.textContent = text;
  messagesEl.appendChild(el);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return el;
}

function recordTiming(totalMs, openaiMs) {
  totalTimes.push(totalMs);
  openaiTimes.push(openaiMs);

  chart.data.labels.push(`Call ${totalTimes.length}`);
  chart.data.datasets[0].data.push(totalMs);
  chart.data.datasets[1].data.push(openaiMs);
  chart.update();

  document.getElementById("avg-total").textContent = `${formatMs(average(totalTimes))} ms`;
  document.getElementById("avg-openai").textContent = `${formatMs(average(openaiTimes))} ms`;
  document.getElementById("last-total").textContent = `${formatMs(totalMs)} ms`;
  document.getElementById("last-openai").textContent = `${formatMs(openaiMs)} ms`;
}

function average(values) {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function formatMs(value) {
  return Math.round(value).toLocaleString("en-US");
}

function setBusy(busy) {
  sendButton.disabled = busy;
  promptInput.disabled = busy;
}

function loadUserId() {
  let id = null;
  try { id = localStorage.getItem(USER_ID_KEY); } catch (e) {}
  if (!id) {
    id = crypto.randomUUID ? crypto.randomUUID() : `user-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    try { localStorage.setItem(USER_ID_KEY, id); } catch (e) {}
  }
  return id;
}

function startNewSession() {
  try { localStorage.removeItem(USER_ID_KEY); } catch (e) {}
  userId = loadUserId();
  messagesEl.innerHTML = '<div class="empty">New session started. Ask me anything.</div>';
}
