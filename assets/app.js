const state = {
    sentences: [],
    rappers: [],
    currentLines: [],
};

const elements = {};

document.addEventListener("DOMContentLoaded", async () => {
    cacheElements();
    bindEvents();
    await loadData();
});

function cacheElements() {
    elements.output = document.getElementById("output");
    elements.lyrics = document.getElementById("lyrics");
    elements.generateButton = document.getElementById("generateButton");
    elements.copyButton = document.getElementById("copyButton");
}

function bindEvents() {
    elements.generateButton.addEventListener("click", generateLyrics);
    elements.copyButton.addEventListener("click", copyLyrics);
}

async function loadData() {
    try {
        const [sentencesResponse, rappersResponse] = await Promise.all([
            fetchJson("./data/sentences.json"),
            fetchJson("./data/rappers.json"),
        ]);

        state.sentences = Array.isArray(sentencesResponse.sentences) ? sentencesResponse.sentences : [];
        state.rappers = Array.isArray(rappersResponse.rappers) ? rappersResponse.rappers : [];

        if (!state.sentences.length || !state.rappers.length) {
            throw new Error("Empty data.");
        }

        elements.generateButton.disabled = false;
    } catch (error) {
        console.error(error);
        elements.lyrics.innerHTML = '<p class="error">불러오기 실패</p>';
    }
}

async function fetchJson(url) {
    const response = await fetch(url, { cache: "no-store" });

    if (!response.ok) {
        throw new Error(`Failed to fetch ${url}: ${response.status}`);
    }

    return response.json();
}

function generateLyrics() {
    if (!state.sentences.length || !state.rappers.length) {
        return;
    }

    const lines = pickUniqueItems(state.sentences, 4).map((sentence) => {
        const rapper = pickRandom(state.rappers);

        return {
            plain: sentence.replaceAll("[래퍼]", rapper),
            html: escapeHtml(sentence).replaceAll(
                "[래퍼]",
                `<span class="rapper">${escapeHtml(rapper)}</span>`,
            ),
        };
    });

    state.currentLines = lines.map((line) => line.plain);
    elements.lyrics.innerHTML = lines
        .map((line) => `<p class="line">${line.html}</p>`)
        .join("");

    elements.copyButton.disabled = false;
}

async function copyLyrics() {
    if (!state.currentLines.length) {
        return;
    }

    const text = state.currentLines.join("\n");

    try {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
        } else {
            legacyCopy(text);
        }

        flashCopyLabel("복사됨");
    } catch (error) {
        console.error(error);
        flashCopyLabel("실패");
    }
}

function flashCopyLabel(label) {
    const original = "복사";
    elements.copyButton.textContent = label;

    window.setTimeout(() => {
        elements.copyButton.textContent = original;
    }, 1000);
}

function legacyCopy(text) {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "absolute";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    document.body.removeChild(textarea);
}

function pickRandom(items) {
    return items[Math.floor(Math.random() * items.length)];
}

function pickUniqueItems(items, count) {
    const pool = [...items];
    const picked = [];

    while (picked.length < count && pool.length) {
        const index = Math.floor(Math.random() * pool.length);
        picked.push(pool.splice(index, 1)[0]);
    }

    return picked;
}

function escapeHtml(value) {
    const replacements = {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "\"": "&quot;",
        "'": "&#39;",
    };

    return value.replace(/[&<>\"']/g, (character) => replacements[character]);
}
