const LINE_COUNT = 4;
const TOKEN_PREFIX = "k1";
const SENTENCE_SALT = 17;
const RAPPER_SALT = 53;

const state = {
    sentences: [],
    rappers: [],
    currentLines: [],
    currentSelection: [],
};

const elements = {};

document.addEventListener("DOMContentLoaded", async () => {
    cacheElements();
    bindEvents();
    await loadData();
});

function cacheElements() {
    elements.lyrics = document.getElementById("lyrics");
    elements.generateButton = document.getElementById("generateButton");
    elements.shareButton = document.getElementById("shareButton");
}

function bindEvents() {
    elements.generateButton.addEventListener("click", generateLyrics);
    elements.shareButton.addEventListener("click", shareLyrics);
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

        const sharedSelection = readSharedSelection();
        if (sharedSelection.length) {
            renderSelection(sharedSelection);
            elements.shareButton.disabled = false;
            return;
        }

        replaceUrl("");
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

    const sentenceIndexes = pickUniqueIndexes(state.sentences.length, LINE_COUNT);
    const selection = sentenceIndexes.map((sentenceIndex, index) => ({
        sentenceIndex,
        rapperIndex: pickRapperIndex(index),
    }));

    renderSelection(selection);
    replaceUrl(buildToken(selection));
}

function renderSelection(selection) {
    const safeSelection = selection.filter(isValidSelection);

    if (!safeSelection.length) {
        return;
    }

    state.currentSelection = safeSelection;

    const lines = safeSelection.map(({ sentenceIndex, rapperIndex }) => {
        const sentence = state.sentences[sentenceIndex];
        const rapper = state.rappers[rapperIndex];

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

    elements.shareButton.disabled = false;
}

async function shareLyrics() {
    if (!state.currentSelection.length) {
        return;
    }

    const token = buildToken(state.currentSelection);
    const shareUrl = buildShareUrl(token);
    replaceUrl(token);

    const shareData = {
        title: document.title,
        text: state.currentLines.join("\n"),
        url: shareUrl,
    };

    try {
        if (navigator.share) {
            await navigator.share(shareData);
            flashShareLabel("공유됨");
            return;
        }

        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(shareUrl);
            flashShareLabel("링크복사");
            return;
        }

        window.prompt("이 링크로 공유", shareUrl);
        flashShareLabel("링크생성");
    } catch (error) {
        if (error?.name === "AbortError") {
            return;
        }

        console.error(error);
        flashShareLabel("실패");
    }
}

function flashShareLabel(label) {
    const original = "내 가사 공유하기";
    elements.shareButton.textContent = label;

    window.setTimeout(() => {
        elements.shareButton.textContent = original;
    }, 1200);
}

function readSharedSelection() {
    const token = new URL(window.location.href).searchParams.get("v");
    if (!token) {
        return [];
    }

    return decodeToken(token);
}

function buildToken(selection) {
    const encoded = selection
        .map(({ sentenceIndex, rapperIndex }, index) => {
            const sentenceValue = wrapIndex(
                sentenceIndex + SENTENCE_SALT * (index + 1),
                state.sentences.length,
            );
            const rapperValue = wrapIndex(
                rapperIndex + RAPPER_SALT * (index + 1),
                state.rappers.length,
            );

            return encodeBase36(sentenceValue) + encodeBase36(rapperValue);
        })
        .join("");

    return TOKEN_PREFIX + reverseText(encoded);
}

function decodeToken(token) {
    if (!token.startsWith(TOKEN_PREFIX)) {
        return [];
    }

    const body = reverseText(token.slice(TOKEN_PREFIX.length));
    if (!body || body.length % 4 !== 0) {
        return [];
    }

    const selection = [];

    for (let index = 0; index < body.length / 4; index += 1) {
        const offset = index * 4;
        const encodedSentence = body.slice(offset, offset + 2);
        const encodedRapper = body.slice(offset + 2, offset + 4);

        const sentenceValue = parseInt(encodedSentence, 36);
        const rapperValue = parseInt(encodedRapper, 36);

        if (Number.isNaN(sentenceValue) || Number.isNaN(rapperValue)) {
            return [];
        }

        selection.push({
            sentenceIndex: wrapIndex(
                sentenceValue - SENTENCE_SALT * (index + 1),
                state.sentences.length,
            ),
            rapperIndex: wrapIndex(
                rapperValue - RAPPER_SALT * (index + 1),
                state.rappers.length,
            ),
        });
    }

    return selection.every(isValidSelection) ? selection : [];
}

function buildShareUrl(token) {
    const url = new URL(window.location.href);
    url.searchParams.set("v", token);
    return url.toString();
}

function replaceUrl(token) {
    const url = new URL(window.location.href);

    if (token) {
        url.searchParams.set("v", token);
    } else {
        url.searchParams.delete("v");
    }

    window.history.replaceState({}, "", url.toString());
}

function pickRapperIndex(index) {
    const randomIndex = Math.floor(Math.random() * state.rappers.length);
    return wrapIndex(randomIndex + index * 7, state.rappers.length);
}

function pickUniqueIndexes(length, count) {
    const pool = Array.from({ length }, (_, index) => index);
    const picked = [];

    while (picked.length < count && pool.length) {
        const index = Math.floor(Math.random() * pool.length);
        picked.push(pool.splice(index, 1)[0]);
    }

    return picked;
}

function isValidSelection({ sentenceIndex, rapperIndex }) {
    return Number.isInteger(sentenceIndex)
        && Number.isInteger(rapperIndex)
        && sentenceIndex >= 0
        && rapperIndex >= 0
        && sentenceIndex < state.sentences.length
        && rapperIndex < state.rappers.length;
}

function wrapIndex(value, length) {
    return ((value % length) + length) % length;
}

function encodeBase36(value) {
    return value.toString(36).padStart(2, "0");
}

function reverseText(value) {
    return [...value].reverse().join("");
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
