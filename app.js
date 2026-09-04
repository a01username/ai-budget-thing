const STORAGE_KEY = "balance-finance-tracker-v2";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const today = startOfDay(new Date());

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
  transactions: []
};

let state = loadState();
let selectedType = "expenses";
let lastFocused = null;
let toastTimer;

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return saved && Array.isArray(saved.transactions) ? saved : structuredClone(defaultState);
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
  return ({ loans: "Loan", subscriptions: "Subscription", expenses: "Expense" })[category] || "Entry";
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
    let occurrence = new Date(`${entry.date}T12:00:00`);
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

function render() {
  const labels = { current: "Current", day: "In a day", week: "In a week", month: "In a month" };
  const notes = { current: "Available now", day: "Projected for tomorrow", week: "Projected seven days from now", month: "Projected one month from now" };
  $("#periodLabel").textContent = labels[state.period];
  $("#balanceKicker").textContent = state.period === "current" ? "CURRENT BALANCE" : "PROJECTED BALANCE";
  $("#balanceAmount").textContent = money(projectedBalance(state.period));
  $("#balanceNote").textContent = notes[state.period];

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
  const title = state.filter === "general" ? "General" : state.filter[0].toUpperCase() + state.filter.slice(1);
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
  const singular = { expenses: "Expense", subscriptions: "Subscription", loans: "Loan" }[type];
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
  const isCompleted = entryDate <= today;
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
    toggleMenu($("#typeMenu"), $("#typeTrigger"), false);
  }
});

document.addEventListener("click", (event) => {
  if (!$("#periodPicker").contains(event.target)) toggleMenu($("#periodMenu"), $("#periodTrigger"), false);
  if (!$("#typePicker").contains(event.target)) toggleMenu($("#typeMenu"), $("#typeTrigger"), false);
});

function setDefaultDates() {
  $("#entryDate").value = toISO(today);
  $("#nextDate").value = dateOffset(7);
  $("#dueDate").value = dateOffset(14);
}

setDefaultDates();
render();
