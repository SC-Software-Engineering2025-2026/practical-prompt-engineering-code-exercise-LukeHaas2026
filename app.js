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

const NOTES_KEY = "promptNotes";

function loadNotes() {
  try {
    const raw = localStorage.getItem(NOTES_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    console.error("Failed to parse notes from storage", e);
    return {};
  }
}

function saveNotes(notes) {
  localStorage.setItem(NOTES_KEY, JSON.stringify(notes));
}

function getNote(promptId) {
  const notes = loadNotes();
  return notes[promptId] || null;
}

function saveNote(promptId, content) {
  const notes = loadNotes();
  notes[promptId] = {
    content: content.trim(),
    savedAt: notes[promptId]?.savedAt || Date.now(),
    updatedAt: Date.now(),
  };
  saveNotes(notes);
  renderPrompts();
}

function deleteNote(promptId) {
  if (!confirm("Are you sure you want to delete this note?")) {
    return;
  }
  const notes = loadNotes();
  delete notes[promptId];
  saveNotes(notes);
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

      // Notes section
      const notesSection = document.createElement("div");
      notesSection.className = "notes-section";

      const note = getNote(p.id);

      if (note) {
        // Display existing note
        const noteDisplay = document.createElement("div");
        noteDisplay.className = "note-display";

        const noteContent = document.createElement("div");
        noteContent.className = "note-content";
        noteContent.textContent = note.content;

        const noteFooter = document.createElement("div");
        noteFooter.className = "note-footer";

        const noteTimestamp = document.createElement("span");
        noteTimestamp.className = "note-timestamp";
        noteTimestamp.textContent = `Updated: ${new Date(
          note.updatedAt
        ).toLocaleString()}`;

        const noteActions = document.createElement("div");
        noteActions.className = "note-actions";

        const editNoteBtn = document.createElement("button");
        editNoteBtn.className = "edit-note-btn";
        editNoteBtn.textContent = "Edit";
        editNoteBtn.addEventListener("click", () => {
          showNoteEditor(notesSection, p.id, note.content);
        });

        const deleteNoteBtn = document.createElement("button");
        deleteNoteBtn.className = "delete-note-btn";
        deleteNoteBtn.textContent = "Delete";
        deleteNoteBtn.addEventListener("click", () => {
          deleteNote(p.id);
        });

        noteActions.appendChild(editNoteBtn);
        noteActions.appendChild(deleteNoteBtn);

        noteFooter.appendChild(noteTimestamp);
        noteFooter.appendChild(noteActions);

        noteDisplay.appendChild(noteContent);
        noteDisplay.appendChild(noteFooter);
        notesSection.appendChild(noteDisplay);
      } else {
        // Show add note button
        const addNoteBtn = document.createElement("button");
        addNoteBtn.className = "add-note-btn";
        addNoteBtn.textContent = "Add Note";
        addNoteBtn.addEventListener("click", () => {
          showNoteEditor(notesSection, p.id, "");
        });
        notesSection.appendChild(addNoteBtn);
      }

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
      card.appendChild(notesSection);
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

function showNoteEditor(container, promptId, currentContent) {
  container.innerHTML = "";

  const editorWrapper = document.createElement("div");
  editorWrapper.className = "note-editor";

  const textarea = document.createElement("textarea");
  textarea.className = "note-textarea";
  textarea.placeholder = "Add your note here (max 500 characters)";
  textarea.value = currentContent;
  textarea.maxLength = 500;

  const charCount = document.createElement("div");
  charCount.className = "char-count";
  charCount.textContent = `${currentContent.length}/500`;

  textarea.addEventListener("input", (e) => {
    charCount.textContent = `${e.target.value.length}/500`;
  });

  const buttonGroup = document.createElement("div");
  buttonGroup.className = "note-button-group";

  const saveBtn = document.createElement("button");
  saveBtn.className = "save-note-btn";
  saveBtn.textContent = "Save";
  saveBtn.addEventListener("click", () => {
    if (textarea.value.trim()) {
      saveNote(promptId, textarea.value);
    }
  });

  const cancelBtn = document.createElement("button");
  cancelBtn.className = "cancel-note-btn";
  cancelBtn.textContent = "Cancel";
  cancelBtn.addEventListener("click", () => {
    renderPrompts();
  });

  buttonGroup.appendChild(saveBtn);
  buttonGroup.appendChild(cancelBtn);

  editorWrapper.appendChild(textarea);
  editorWrapper.appendChild(charCount);
  editorWrapper.appendChild(buttonGroup);

  container.appendChild(editorWrapper);
  textarea.focus();
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
