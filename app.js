// Simple prompt library using localStorage
const STORAGE_KEY = "prompts";
const RATINGS_KEY = "ratings";
const USER_ID = localStorage.getItem("userId") || `user-${Date.now()}`;

// Initialize user ID
if (!localStorage.getItem("userId")) {
  localStorage.setItem("userId", USER_ID);
}

function loadPrompts() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.error("Failed to parse prompts from storage", e);
    return [];
  }
}

function loadRatings() {
  try {
    const raw = localStorage.getItem(RATINGS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    console.error("Failed to parse ratings from storage", e);
    return {};
  }
}

function saveRatings(ratings) {
  localStorage.setItem(RATINGS_KEY, JSON.stringify(ratings));
}

function getUserRating(promptId) {
  const ratings = loadRatings();
  return ratings[promptId]?.[USER_ID] || 0;
}

function getAverageRating(promptId) {
  const ratings = loadRatings();
  const promptRatings = ratings[promptId];

  if (!promptRatings || Object.keys(promptRatings).length === 0) {
    return { average: 0, count: 0 };
  }

  const scores = Object.values(promptRatings);
  const sum = scores.reduce((acc, score) => acc + score, 0);
  const average = (sum / scores.length).toFixed(1);

  return { average: parseFloat(average), count: scores.length };
}

function submitRating(promptId, score) {
  const ratings = loadRatings();

  if (!ratings[promptId]) {
    ratings[promptId] = {};
  }

  ratings[promptId][USER_ID] = score;
  saveRatings(ratings);
  renderPrompts();
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

      const ratingSection = document.createElement("div");
      ratingSection.className = "rating-section";

      const ratingContainer = document.createElement("div");
      ratingContainer.className = "rating-container";

      const { average, count } = getAverageRating(p.id);
      const userRating = getUserRating(p.id);

      // Create stars
      const starsContainer = document.createElement("div");
      starsContainer.className = "stars";

      for (let i = 1; i <= 5; i++) {
        const star = document.createElement("button");
        star.className = `star ${i <= userRating ? "filled" : "empty"}`;
        star.setAttribute("aria-label", `Rate ${i} stars`);
        star.textContent = "★";
        star.dataset.rating = i;
        star.dataset.promptId = p.id;

        star.addEventListener("click", (e) => {
          e.preventDefault();
          const rating = Number(e.currentTarget.dataset.rating);
          const promptId = Number(e.currentTarget.dataset.promptId);
          submitRating(promptId, rating);
        });

        star.addEventListener("mouseenter", (e) => {
          const hoverRating = Number(e.currentTarget.dataset.rating);
          starsContainer.querySelectorAll(".star").forEach((s, idx) => {
            s.classList.toggle("hover", idx < hoverRating);
          });
        });

        starsContainer.appendChild(star);
      }

      starsContainer.addEventListener("mouseleave", () => {
        starsContainer
          .querySelectorAll(".star")
          .forEach((s) => s.classList.remove("hover"));
      });

      // Create rating text
      const ratingText = document.createElement("div");
      ratingText.className = "rating-text";

      if (count === 0) {
        ratingText.innerHTML =
          '<span class="no-ratings">Be the first to rate</span>';
      } else {
        ratingText.innerHTML = `<span class="average-rating">${average}</span> <span class="rating-count">(${count} ${
          count === 1 ? "rating" : "ratings"
        })</span>`;
      }

      ratingContainer.appendChild(starsContainer);
      ratingContainer.appendChild(ratingText);
      ratingSection.appendChild(ratingContainer);

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
      card.appendChild(ratingSection);
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
