const state = {
    sentences: [],
    rappers: [],
    currentLines: [],
};

const elements = {};

document.addEventListener("DOMContentLoaded", () => {
    cacheElements();
    bindEvents();
    loadData();
});

function cacheElements() {
    elements.generateBtn = document.getElementById("generateBtn");
    elements.copyBtn = document.getElementById("copyBtn");
    elements.statusLine = document.getElementById("statusLine");
    elements.loadState = document.getElementById("loadState");
    elements.sentenceCount = document.getElementById("sentenceCount");
    elements.rapperCount = document.getElementById("rapperCount");
    elements.lyricsPanel = document.getElementById("lyricsPanel");
    elements.lyricsList = document.getElementById("lyricsList");
    elements.panelCode = document.getElementById("panelCode");
}

function bindEvents() {
    elements.generateBtn.addEventListener("click", generateLyrics);
    elements.copyBtn.addEventListener("click", copyLyrics);
}

async function loadData() {
    setStatus("JSON 문서를 봉인 해제하는 중...", "default");

    try {
        const [sentencePayload, rapperPayload] = await Promise.all([
            fetchJson("./data/sentences.json"),
            fetchJson("./data/rappers.json"),
        ]);

        state.sentences = Array.isArray(sentencePayload.sentences) ? sentencePayload.sentences : [];
        state.rappers = Array.isArray(rapperPayload.rappers) ? rapperPayload.rappers : [];

        if (!state.sentences.length || !state.rappers.length) {
            throw new Error("JSON payload is empty.");
        }

        elements.sentenceCount.textContent = `${state.sentences.length}개`;
        elements.rapperCount.textContent = `${state.rappers.length}명`;
        elements.loadState.textContent = "로드 완료";
        elements.generateBtn.disabled = false;

        setStatus(
            `${state.sentences.length}개 문장과 ${state.rappers.length}명 래퍼를 불러왔습니다. 이제 뽑으면 됩니다.`,
            "success",
        );
    } catch (error) {
        console.error(error);
        elements.loadState.textContent = "로드 실패";

        const message = location.protocol === "file:"
            ? "이 구조는 정적 서버 기준입니다. GitHub나 Vercel에서 열거나 로컬 서버로 확인하세요."
            : "JSON을 불러오지 못했습니다. 파일 경로와 배포 상태를 확인하세요.";

        setStatus(message, "error");
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

    const selectedSentences = pickUniqueItems(state.sentences, 4);
    state.currentLines = [];
    elements.lyricsList.innerHTML = "";
    elements.lyricsPanel.classList.remove("is-empty");
    elements.lyricsPanel.classList.add("is-ready");
    elements.copyBtn.disabled = false;
    elements.panelCode.textContent = createSerial();

    selectedSentences.forEach((template, index) => {
        const rapper = pickRandom(state.rappers);
        const plainText = template.replaceAll("[래퍼]", rapper);
        state.currentLines.push(plainText);

        const line = document.createElement("article");
        line.className = "line";
        line.style.animationDelay = `${index * 90}ms`;
        line.innerHTML = `
            <span class="line-index">${String(index + 1).padStart(2, "0")}</span>
            <p class="line-text">${renderSentence(template, rapper)}</p>
        `;

        elements.lyricsList.appendChild(line);
    });

    setStatus("킴보식 출력 완료. 마음에 안 들면 다시 뽑으시오.", "success");
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
            copyWithTextarea(text);
        }

        setStatus("가사를 복사했습니다. GitHub에 올려서 Vercel에 박을 준비가 끝났습니다.", "success");
    } catch (error) {
        console.error(error);
        setStatus("복사에 실패했습니다. 브라우저 권한 상태를 확인하세요.", "error");
    }
}

function copyWithTextarea(text) {
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

function renderSentence(template, rapper) {
    return escapeHtml(template).replaceAll(
        "[래퍼]",
        `<span class="rapper-tag">${escapeHtml(rapper)}</span>`,
    );
}

function escapeHtml(value) {
    const table = {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "\"": "&quot;",
        "'": "&#39;",
    };

    return value.replace(/[&<>\"']/g, (character) => table[character]);
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

function createSerial() {
    const serial = Math.floor(Math.random() * 900) + 100;
    return `NO. GGM-KIMBO-${serial}`;
}

function setStatus(message, tone) {
    elements.statusLine.textContent = message;
    elements.statusLine.classList.remove("is-error", "is-success");

    if (tone === "error") {
        elements.statusLine.classList.add("is-error");
        return;
    }

    if (tone === "success") {
        elements.statusLine.classList.add("is-success");
    }
}
