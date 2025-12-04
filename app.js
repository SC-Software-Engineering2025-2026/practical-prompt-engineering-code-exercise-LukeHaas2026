// Simple prompt library using localStorage
const STORAGE_KEY = "prompts";

function loadPrompts() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.error("Failed to parse prompts from storage", e);
    return [];
  }
}

function savePrompts(list) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}

function renderPrompts() {
  const cards = document.getElementById("cards");
  const prompts = loadPrompts();
  cards.innerHTML = "";

  if (prompts.length === 0) {
    const empty = document.createElement("div");
    empty.className = "card";
    empty.textContent = "No saved prompts yet.";
    cards.appendChild(empty);
    return;
  }

  prompts
    .slice()
    .reverse()
    .forEach((p) => {
      const card = document.createElement("div");
      card.className = "card";

      const title = document.createElement("div");
      title.className = "title";
      title.textContent = p.title || "Untitled";

      const content = document.createElement("div");
      content.className = "content";
      content.textContent = p.content || "";

      const meta = document.createElement("div");
      meta.className = "meta";

      const timestamp = document.createElement("div");
      timestamp.className = "ts";
      timestamp.style.fontSize = "12px";
      timestamp.style.color = "var(--muted)";
      timestamp.textContent = new Date(p.id).toLocaleString();

      const del = document.createElement("button");
      del.className = "delete-btn";
      del.setAttribute("aria-label", `Delete prompt ${p.title}`);
      del.textContent = "Delete";
      del.dataset.id = p.id;

      del.addEventListener("click", (e) => {
        const id = Number(e.currentTarget.dataset.id);
        deletePrompt(id);
      });

      meta.appendChild(timestamp);
      meta.appendChild(del);

      card.appendChild(title);
      card.appendChild(content);
      card.appendChild(meta);

      cards.appendChild(card);
    });
}

function addPrompt(title, content) {
  const list = loadPrompts();
  const item = { id: Date.now(), title: title.trim(), content: content.trim() };
  list.push(item);
  savePrompts(list);
  renderPrompts();
}

function deletePrompt(id) {
  let list = loadPrompts();
  list = list.filter((i) => i.id !== id);
  savePrompts(list);
  renderPrompts();
}

document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("promptForm");
  const titleEl = document.getElementById("title");
  const contentEl = document.getElementById("content");

  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const title = titleEl.value;
    const content = contentEl.value;
    if (!title.trim() || !content.trim()) {
      // minimal validation: require both fields
      // keep UI simple per requirements
      return;
    }
    addPrompt(title, content);
    form.reset();
    titleEl.focus();
  });

  // initial render
  renderPrompts();
});
