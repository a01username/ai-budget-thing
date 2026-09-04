const STORAGE_KEY = "balance-finance-tracker-v2";
const THEME_KEY = "balance-finance-tracker-theme";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
let today = startOfDay(new Date());

function startOfDay(date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function dateOffset(days) {
  const date = new Date(today);
  date.setDate(date.getDate() + days);
  return toISO(date);
}

function toISO(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

const defaultState = {
  balance: 0,
  filter: "general",
  period: "current",
  view: "amount",
  transactions: []
};

let state = loadState();
let selectedType = "expenses";
let lastFocused = null;
let toastTimer;

function applyTheme(theme) {
  const isDark = theme === "dark";
  document.documentElement.dataset.theme = theme;
  $("#themeToggle").setAttribute("aria-pressed", String(isDark));
  $("#themeLabel").textContent = isDark ? "Light mode" : "Dark mode";
  $("#themeToggle").setAttribute("aria-label", isDark ? "Switch to light mode" : "Switch to dark mode");
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return saved && Array.isArray(saved.transactions)
      ? { ...structuredClone(defaultState), ...saved, transactions: saved.transactions }
      : structuredClone(defaultState);
  } catch {
    return structuredClone(defaultState);
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function money(value, includePlus = false) {
  const sign = includePlus && value > 0 ? "+" : "";
  return `${sign}${new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value)}`;
}

function formatDate(dateString) {
  const date = new Date(`${dateString}T12:00:00`);
  return new Intl.DateTimeFormat("en-US", { month: "numeric", day: "numeric", year: "2-digit" }).format(date);
}

function categoryLabel(category) {
  return ({ loans: "Loan", subscriptions: "Subscription", expenses: "Transaction" })[category] || "Entry";
}

function getHorizon(period) {
  const date = new Date(today);
  if (period === "day") date.setDate(date.getDate() + 1);
  if (period === "week") date.setDate(date.getDate() + 7);
  if (period === "month") date.setMonth(date.getMonth() + 1);
  return date;
}

function nextOccurrence(date, frequency) {
  const next = new Date(date);
  if (frequency === "weekly") next.setDate(next.getDate() + 7);
  else if (frequency === "yearly") next.setFullYear(next.getFullYear() + 1);
  else next.setMonth(next.getMonth() + 1);
  return next;
}

function projectedBalance(period) {
  if (period === "current") return state.balance;
  const horizon = getHorizon(period);
  let projected = state.balance;

  state.transactions.forEach((entry) => {
    let occurrence = startOfDay(new Date(`${entry.date}T12:00:00`));
    if (entry.status === "upcoming" && occurrence > today && occurrence <= horizon) projected += entry.amount;

    if (entry.category === "subscriptions" && entry.frequency) {
      if (entry.status !== "upcoming") occurrence = nextOccurrence(occurrence, entry.frequency);
      else occurrence = nextOccurrence(occurrence, entry.frequency);
      while (occurrence <= horizon) {
        if (occurrence > today) projected += entry.amount;
        occurrence = nextOccurrence(occurrence, entry.frequency);
      }
    }
  });
  return projected;
}

function renderBalanceVisualization(value, periodLabels, periodNotes) {
  const viewLabels = { amount: "Amount", line: "Line graph", xp: "XP bar" };
  const activeView = viewLabels[state.view] ? state.view : "amount";
  state.view = activeView;
  $("#viewLabel").textContent = viewLabels[activeView];
  $$("#viewMenu [role='option']").forEach((option) => {
    option.setAttribute("aria-selected", String(option.dataset.view === activeView));
  });

  $("#amountView").hidden = activeView !== "amount";
  $("#lineView").hidden = activeView !== "line";
  $("#xpView").hidden = activeView !== "xp";
  $("#balanceNote").hidden = activeView === "xp";

  if (activeView === "line") {
    $("#balanceNote").textContent = `${periodLabels[state.period]}: ${money(value)} · select a timeframe to highlight it`;
    requestAnimationFrame(drawBalanceChart);
    return;
  }

  if (activeView === "xp") {
    const totalCents = Math.round(Math.max(0, value) * 100);
    const level = Math.floor(totalCents / 100);
    const progress = totalCents % 100;
    $("#xpLevel").textContent = level;
    $("#xpLevelWord").textContent = level === 1 ? "Level" : "Levels";
    $("#xpBalanceValue").textContent = money(value);
    $("#xpBarArea").style.setProperty("--xp-position", `${progress}%`);
    $("#xpFill").style.width = `${progress}%`;
    $("#xpPercent").textContent = `${progress}%`;
    $("#xpTrack").setAttribute("aria-valuenow", progress);
    $("#xpTrack").setAttribute("aria-valuetext", `${progress} percent toward level ${level + 1}`);
    return;
  }

  $("#balanceNote").textContent = periodNotes[state.period];
}

function drawBalanceChart() {
  if (state.view !== "line" || $("#lineView").hidden) return;
  const canvas = $("#balanceChart");
  const width = Math.max(260, canvas.getBoundingClientRect().width);
  const height = 168;
  const scale = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const context = canvas.getContext("2d");
  context.setTransform(scale, 0, 0, scale, 0, 0);

  const styles = getComputedStyle(document.documentElement);
  const ink = styles.getPropertyValue("--ink").trim();
  const muted = styles.getPropertyValue("--muted").trim();
  const accent = styles.getPropertyValue("--accent").trim();
  const softLine = styles.getPropertyValue("--soft-line").trim();
  const periods = ["current", "day", "week", "month"];
  const labels = ["Now", "+1 day", "+1 week", "+1 month"];
  const values = periods.map(projectedBalance);
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const spread = Math.max(1, maximum - minimum);
  const lower = minimum - spread * .2;
  const upper = maximum + spread * .2;
  const padding = { left: 58, right: 18, top: 15, bottom: 29 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const x = (index) => padding.left + (chartWidth * index) / (values.length - 1);
  const y = (number) => padding.top + ((upper - number) / (upper - lower)) * chartHeight;

  context.clearRect(0, 0, width, height);
  context.font = "11px Arial, sans-serif";
  context.textBaseline = "middle";
  context.strokeStyle = softLine;
  context.fillStyle = muted;
  context.lineWidth = 1;
  for (let index = 0; index < 3; index += 1) {
    const chartValue = upper - ((upper - lower) * index) / 2;
    const chartY = y(chartValue);
    context.beginPath();
    context.moveTo(padding.left, chartY);
    context.lineTo(width - padding.right, chartY);
    context.stroke();
    context.textAlign = "right";
    context.fillText(money(chartValue), padding.left - 8, chartY);
  }

  context.beginPath();
  values.forEach((number, index) => {
    if (index === 0) context.moveTo(x(index), y(number));
    else context.lineTo(x(index), y(number));
  });
  context.lineTo(x(values.length - 1), padding.top + chartHeight);
  context.lineTo(x(0), padding.top + chartHeight);
  context.closePath();
  context.globalAlpha = .16;
  context.fillStyle = accent;
  context.fill();
  context.globalAlpha = 1;

  context.beginPath();
  values.forEach((number, index) => {
    if (index === 0) context.moveTo(x(index), y(number));
    else context.lineTo(x(index), y(number));
  });
  context.strokeStyle = ink;
  context.lineWidth = 3;
  context.lineJoin = "round";
  context.stroke();

  const selectedIndex = periods.indexOf(state.period);
  values.forEach((number, index) => {
    context.beginPath();
    context.arc(x(index), y(number), index === selectedIndex ? 6 : 4, 0, Math.PI * 2);
    context.fillStyle = index === selectedIndex ? accent : ink;
    context.fill();
    if (index === selectedIndex) {
      context.strokeStyle = ink;
      context.lineWidth = 2;
      context.stroke();
    }
    context.fillStyle = muted;
    context.textAlign = index === 0 ? "left" : index === labels.length - 1 ? "right" : "center";
    context.textBaseline = "bottom";
    context.fillText(labels[index], x(index), height - 3);
  });

  canvas.setAttribute("aria-label", `Balance projection: ${labels.map((label, index) => `${label} ${money(values[index])}`).join(", ")}`);
}

function render() {
  const labels = { current: "Current", day: "In a day", week: "In a week", month: "In a month" };
  const notes = { current: "Available now", day: "Projected for tomorrow", week: "Projected seven days from now", month: "Projected one month from now" };
  $("#periodLabel").textContent = labels[state.period];
  $("#balanceKicker").textContent = state.period === "current" ? "CURRENT BALANCE" : "PROJECTED BALANCE";
  const selectedBalance = projectedBalance(state.period);
  $("#balanceAmount").textContent = money(selectedBalance);
  renderBalanceVisualization(selectedBalance, labels, notes);

  const counts = {
    general: state.transactions.length,
    loans: state.transactions.filter((entry) => entry.category === "loans").length,
    subscriptions: state.transactions.filter((entry) => entry.category === "subscriptions").length,
    expenses: state.transactions.filter((entry) => entry.category === "expenses").length
  };
  $("#countGeneral").textContent = counts.general;
  $("#countLoans").textContent = counts.loans;
  $("#countSubscriptions").textContent = counts.subscriptions;
  $("#countExpenses").textContent = counts.expenses;

  $$(".filter-button").forEach((button) => button.classList.toggle("active", button.dataset.filter === state.filter));
  const title = {
    general: "General",
    loans: "Loans",
    subscriptions: "Subscriptions",
    expenses: "Transactions"
  }[state.filter];
  $("#ledgerTitle").textContent = title;

  const visible = state.transactions
    .filter((entry) => state.filter === "general" || entry.category === state.filter)
    .sort((a, b) => new Date(b.date) - new Date(a.date));
  $("#entryCount").textContent = `${visible.length} ${visible.length === 1 ? "entry" : "entries"}`;
  $("#emptyState").hidden = visible.length > 0;
  $("#transactionList").innerHTML = visible.map((entry) => `
    <article class="transaction-row">
      <div class="transaction-name" title="${escapeHTML(entry.name)}">
        ${escapeHTML(entry.name)}
        <small>${categoryLabel(entry.category)}${entry.frequency ? ` · ${entry.frequency}` : ""}</small>
      </div>
      <div class="status ${entry.status}">${entry.status === "upcoming" ? "Upcoming" : "Completed"}</div>
      <div class="amount ${entry.amount >= 0 ? "positive" : "negative"}">${money(entry.amount, true)}</div>
      <time class="transaction-date" datetime="${entry.date}">${formatDate(entry.date)}</time>
      <button class="delete-entry" type="button" data-delete="${entry.id}" aria-label="Delete ${escapeHTML(entry.name)}">×</button>
    </article>
  `).join("");
}

function escapeHTML(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}

function toggleMenu(menu, trigger, force) {
  const willOpen = force ?? menu.hidden;
  menu.hidden = !willOpen;
  trigger.setAttribute("aria-expanded", String(willOpen));
}

function showToast(message) {
  clearTimeout(toastTimer);
  $("#toast").textContent = message;
  $("#toast").classList.add("show");
  toastTimer = setTimeout(() => $("#toast").classList.remove("show"), 2200);
}

function openPanel() {
  lastFocused = document.activeElement;
  today = startOfDay(new Date());
  setDefaultDates();
  $("#modalBackdrop").hidden = false;
  document.body.style.overflow = "hidden";
  setType(state.filter === "general" ? "expenses" : state.filter);
  setTimeout(() => $("#entryName").focus(), 0);
}

function closePanel() {
  $("#modalBackdrop").hidden = true;
  document.body.style.overflow = "";
  toggleMenu($("#typeMenu"), $("#typeTrigger"), false);
  $("#formError").textContent = "";
  if (lastFocused) lastFocused.focus();
}

function setType(type) {
  selectedType = type;
  const singular = { expenses: "Transaction", subscriptions: "Subscription", loans: "Loan" }[type];
  $("#typeLabel").textContent = singular;
  $("#addTitle").textContent = `Add ${singular.toLowerCase()}`;
  $("#subscriptionFields").hidden = type !== "subscriptions";
  $("#loanFields").hidden = type !== "loans";
  $("#standardDateField").hidden = type !== "expenses";
  $("#entryDate").required = type === "expenses";
  $("#nextDate").required = type === "subscriptions";
  $("#dueDate").required = type === "loans";
  $$("#typeMenu [role='option']").forEach((option) => option.setAttribute("aria-selected", String(option.dataset.type === type)));
}

$("#periodTrigger").addEventListener("click", () => toggleMenu($("#periodMenu"), $("#periodTrigger")));
$("#viewTrigger").addEventListener("click", () => toggleMenu($("#viewMenu"), $("#viewTrigger")));
$("#typeTrigger").addEventListener("click", () => toggleMenu($("#typeMenu"), $("#typeTrigger")));

$("#periodMenu").addEventListener("click", (event) => {
  const option = event.target.closest("[data-period]");
  if (!option) return;
  state.period = option.dataset.period;
  $$("#periodMenu [role='option']").forEach((item) => item.setAttribute("aria-selected", String(item === option)));
  toggleMenu($("#periodMenu"), $("#periodTrigger"), false);
  saveState();
  render();
});

$("#viewMenu").addEventListener("click", (event) => {
  const option = event.target.closest("[data-view]");
  if (!option) return;
  state.view = option.dataset.view;
  toggleMenu($("#viewMenu"), $("#viewTrigger"), false);
  saveState();
  render();
});

$("#typeMenu").addEventListener("click", (event) => {
  const option = event.target.closest("[data-type]");
  if (!option) return;
  setType(option.dataset.type);
  toggleMenu($("#typeMenu"), $("#typeTrigger"), false);
});

$(".filters").addEventListener("click", (event) => {
  const button = event.target.closest("[data-filter]");
  if (!button) return;
  state.filter = button.dataset.filter;
  saveState();
  render();
});

$("#transactionList").addEventListener("click", (event) => {
  const button = event.target.closest("[data-delete]");
  if (!button) return;
  const entry = state.transactions.find((item) => item.id === button.dataset.delete);
  if (!entry) return;
  if (entry.status === "completed") state.balance -= entry.amount;
  state.transactions = state.transactions.filter((item) => item.id !== entry.id);
  saveState();
  render();
  showToast("Entry deleted");
});

$("#openAdd").addEventListener("click", openPanel);
$("#themeToggle").addEventListener("click", () => {
  const nextTheme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  localStorage.setItem(THEME_KEY, nextTheme);
  applyTheme(nextTheme);
  render();
});
$("#emptyAdd").addEventListener("click", openPanel);
$("#closeAdd").addEventListener("click", closePanel);
$("#modalBackdrop").addEventListener("mousedown", (event) => { if (event.target === $("#modalBackdrop")) closePanel(); });

$("#entryForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const amount = Number(form.get("amount"));
  let date = form.get("date");
  if (selectedType === "subscriptions") date = form.get("nextDate");
  if (selectedType === "loans") date = form.get("dueDate");

  if (!Number.isFinite(amount) || amount === 0) {
    $("#formError").textContent = "Enter an amount other than zero.";
    return;
  }

  const entryDate = new Date(`${date}T12:00:00`);
  const isCompleted = startOfDay(entryDate) <= today;
  const entry = {
    id: crypto.randomUUID(),
    name: String(form.get("name")).trim(),
    amount,
    category: selectedType,
    date,
    status: isCompleted ? "completed" : "upcoming"
  };
  if (selectedType === "subscriptions") entry.frequency = form.get("frequency");
  if (selectedType === "loans") entry.person = String(form.get("person") || "").trim();
  if (isCompleted) state.balance += amount;
  state.transactions.push(entry);
  state.filter = selectedType;
  state.period = "current";
  saveState();
  render();
  event.currentTarget.reset();
  setDefaultDates();
  closePanel();
  showToast("Entry added");
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    if (!$("#modalBackdrop").hidden) closePanel();
    toggleMenu($("#periodMenu"), $("#periodTrigger"), false);
    toggleMenu($("#viewMenu"), $("#viewTrigger"), false);
    toggleMenu($("#typeMenu"), $("#typeTrigger"), false);
  }
});

document.addEventListener("click", (event) => {
  if (!$("#periodPicker").contains(event.target)) toggleMenu($("#periodMenu"), $("#periodTrigger"), false);
  if (!$("#viewPicker").contains(event.target)) toggleMenu($("#viewMenu"), $("#viewTrigger"), false);
  if (!$("#typePicker").contains(event.target)) toggleMenu($("#typeMenu"), $("#typeTrigger"), false);
});

let chartResizeFrame;
window.addEventListener("resize", () => {
  cancelAnimationFrame(chartResizeFrame);
  chartResizeFrame = requestAnimationFrame(drawBalanceChart);
});

function setDefaultDates() {
  const currentDate = toISO(new Date());
  $("#entryDate").value = currentDate;
  $("#nextDate").value = currentDate;
  $("#dueDate").value = currentDate;
}

setDefaultDates();
applyTheme(localStorage.getItem(THEME_KEY) || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
render();
