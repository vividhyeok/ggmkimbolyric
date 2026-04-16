const state = {
    currentLines: [],
    currentToken: "",
};

const elements = {};

document.addEventListener("DOMContentLoaded", async () => {
    cacheElements();
    bindEvents();
    await loadInitialLyrics();
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

async function loadInitialLyrics() {
    elements.generateButton.disabled = false;

    const token = new URL(window.location.href).searchParams.get("v");
    if (!token) {
        return;
    }

    try {
        const payload = await requestLyrics(token);
        applyLyricsPayload(payload);
        replaceUrl(payload.token);
    } catch (error) {
        console.error(error);
        replaceUrl("");
    }
}

async function generateLyrics() {
    elements.generateButton.disabled = true;

    try {
        const payload = await requestLyrics();
        applyLyricsPayload(payload);
        replaceUrl(payload.token);
    } catch (error) {
        console.error(error);
        elements.lyrics.innerHTML = '<p class="error">생성 실패</p>';
    } finally {
        elements.generateButton.disabled = false;
    }
}

async function requestLyrics(token = "") {
    const url = new URL("/api/lyrics", window.location.href);

    if (token) {
        url.searchParams.set("v", token);
    }

    const response = await fetch(url.toString(), { cache: "no-store" });
    const payload = await response.json().catch(() => null);

    if (!response.ok || !payload) {
        const message = payload?.error || `Request failed with status ${response.status}`;
        throw new Error(message);
    }

    if (!Array.isArray(payload.lines) || typeof payload.token !== "string") {
        throw new Error("Invalid API response.");
    }

    return payload;
}

function applyLyricsPayload(payload) {
    state.currentLines = payload.lines;
    state.currentToken = payload.token;

    elements.lyrics.innerHTML = payload.lines
        .map((line) => `<p class="line">${escapeHtml(line)}</p>`)
        .join("");

    elements.shareButton.disabled = !payload.token;
}

async function shareLyrics() {
    if (!state.currentToken || !state.currentLines.length) {
        return;
    }

    const shareUrl = buildShareUrl(state.currentToken);
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

function flashShareLabel(label) {
    const original = "내 가사 공유하기";
    elements.shareButton.textContent = label;

    window.setTimeout(() => {
        elements.shareButton.textContent = original;
    }, 1200);
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
