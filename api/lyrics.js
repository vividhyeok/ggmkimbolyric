const crypto = require("node:crypto");
const { sentences, rappers } = require("./_lyrics-data");

const LINE_COUNT = 16;
const BAR_TARGET_SYLLABLES = 15;
const BAR_MAX_SYLLABLES = 20;
const BAR_MIN_SYLLABLES = 7;
const SECURE_PREFIX = "k3";
const PREVIOUS_SECURE_PREFIX = "k2";
const LEGACY_PREFIX = "k1";
const SENTENCE_SALT = 17;
const RAPPER_SALT = 53;
// Set this in Vercel so share tokens stay stable across deployments.
const TOKEN_SECRET = process.env.LYRIC_TOKEN_SECRET || "local-dev-only-change-this-before-deploy";
const ENCRYPTION_KEY = crypto.createHash("sha256").update(TOKEN_SECRET).digest();
const DATA_FINGERPRINT = crypto
    .createHash("sha256")
    .update(JSON.stringify({ sentences, rappers }))
    .digest()
    .readUInt32BE(0);

module.exports = async function handler(request, response) {
    if (request.method !== "GET") {
        response.setHeader("Allow", "GET");
        return response.status(405).json({ error: "Method Not Allowed" });
    }

    response.setHeader("Cache-Control", "no-store");

    try {
        const token = readToken(request);
        const resolved = token ? await resolveSharedLyricsAsync(token) : await createGeneratedLyricsAsync();

        if (!resolved) {
            return response.status(400).json({ error: "Invalid share token." });
        }

        return response.status(200).json(resolved);
    } catch (error) {
        console.error(error);
        return response.status(500).json({ error: "Failed to generate lyrics." });
    }
};

function readToken(request) {
    if (typeof request.query?.v === "string") {
        return request.query.v;
    }

    const requestUrl = new URL(request.url, "http://localhost");
    return requestUrl.searchParams.get("v") || "";
}

function resolveSharedLyrics(token) {
    if (token.startsWith(SECURE_PREFIX)) {
        const seed = decodeSecureSeed(token, SECURE_PREFIX);
        if (seed === null) {
            return null;
        }

        return buildGeneratedPayload(seed, token);
    }

    if (token.startsWith(PREVIOUS_SECURE_PREFIX)) {
        const seed = decodeSecureSeed(token, PREVIOUS_SECURE_PREFIX);
        if (seed === null) {
            return null;
        }

        const selection = createSelectionFromSeed(seed);
        return buildLegacyPayload(selection, token);
    }

    if (token.startsWith(LEGACY_PREFIX)) {
        const selection = decodeLegacySelection(token);
        if (!selection.length) {
            return null;
        }

        return buildLegacyPayload(selection, token);
    }

    return null;
}

async function resolveSharedLyricsAsync(token) {
    const result = resolveSharedLyrics(token);
    if (!result) return null;
    
    result.lines = await polishWithDeepseek(result.lines);
    return result;
}

function createGeneratedLyrics() {
    const seed = crypto.randomBytes(4).readUInt32BE(0);
    const token = encodeSecureSeed(seed, SECURE_PREFIX);

    return buildGeneratedPayload(seed, token);
}

async function createGeneratedLyricsAsync() {
    const result = createGeneratedLyrics();
    result.lines = await polishWithDeepseek(result.lines);
    return result;
}

function buildGeneratedPayload(seed, token) {
    return {
        token,
        lines: createClusterLyrics(seed),
    };
}

function buildLegacyPayload(selection, token) {
    const bars = [];

    for (const { sentenceIndex, rapperIndex } of selection) {
        const fullLine = renderSentenceWithRapper(sentences[sentenceIndex], rappers[rapperIndex]);
        const splitBars = splitIntoBars(fullLine).map((bar) => ensureMinimumEojeol(bar, 6));

        for (const bar of splitBars) {
            bars.push(bar);

            if (bars.length >= LINE_COUNT) {
                break;
            }
        }

        if (bars.length >= LINE_COUNT) {
            break;
        }
    }

    return {
        token,
        lines: finalizeGeneratedLines(bars),
    };
}

function createClusterLyrics(seed) {
    const rng = createMulberry32(seed);
    const candidates = [];
    const usedRappers = new Set();
    const sentenceOrder = pickUniqueIndexes(sentences.length, sentences.length, rng);

    for (const sentenceIndex of sentenceOrder) {
        if (usedRappers.size >= rappers.length) {
            break;
        }

        const rapper = pickRapper(rng, usedRappers);
        const fullLine = renderSentenceWithRapper(sentences[sentenceIndex], rapper);
        const splitBars = splitByWordCount(fullLine, 6).map((bar) => ensureMinimumEojeol(bar, 6));
        candidates.push({
            sentenceIndex,
            rapper,
            fullLine,
            bars: splitBars,
        });
    }

    const exactPlan = findExactLinePlan(candidates, LINE_COUNT);
    if (exactPlan) {
        return finalizeGeneratedLines(exactPlan.flatMap((candidate) => candidate.bars));
    }

    const lines = [];
    const usedSentenceIndexes = new Set();

    for (const candidate of candidates) {
        const remaining = LINE_COUNT - lines.length;
        if (candidate.bars.length <= remaining) {
            lines.push(...candidate.bars);
            usedSentenceIndexes.add(candidate.sentenceIndex);
        }

        if (lines.length >= LINE_COUNT) {
            return lines;
        }
    }

    const remaining = LINE_COUNT - lines.length;
    if (remaining > 0) {
        const fallbackCandidate = candidates.find((candidate) => {
            if (usedSentenceIndexes.has(candidate.sentenceIndex)) {
                return false;
            }

            const wordCount = countWords(candidate.fullLine);
            return wordCount >= remaining;
        });

        if (fallbackCandidate) {
            lines.push(...splitByTargetLineCount(fallbackCandidate.fullLine, remaining));
        }
    }

    return finalizeGeneratedLines(lines.slice(0, LINE_COUNT));
}

function findExactLinePlan(candidates, targetLineCount) {
    const memo = new Map();

    function dfs(index, remaining) {
        if (remaining === 0) {
            return [];
        }

        if (index >= candidates.length || remaining < 0) {
            return null;
        }

        const key = `${index}:${remaining}`;
        if (memo.has(key)) {
            return memo.get(key);
        }

        const current = candidates[index];
        const takeLength = current.bars.length;

        if (takeLength <= remaining) {
            const takeRest = dfs(index + 1, remaining - takeLength);
            if (takeRest) {
                const result = [current, ...takeRest];
                memo.set(key, result);
                return result;
            }
        }

        const skip = dfs(index + 1, remaining);
        memo.set(key, skip);
        return skip;
    }

    return dfs(0, targetLineCount);
}

function createSelectionFromSeed(seed) {
    const rng = createMulberry32(seed);
    const sentenceIndexes = pickUniqueIndexes(sentences.length, Math.min(LINE_COUNT, sentences.length), rng);

    return sentenceIndexes.map((sentenceIndex) => ({
        sentenceIndex,
        rapperIndex: Math.floor(rng() * rappers.length),
    }));
}

function createMulberry32(seed) {
    let value = seed >>> 0;

    return function next() {
        value += 0x6d2b79f5;
        let mixed = Math.imul(value ^ (value >>> 15), value | 1);
        mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
        return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
    };
}

function pickUniqueIndexes(length, count, rng) {
    const pool = Array.from({ length }, (_, index) => index);
    const picked = [];

    while (picked.length < count && pool.length) {
        const index = Math.floor(rng() * pool.length);
        picked.push(pool.splice(index, 1)[0]);
    }

    return picked;
}

function pickRapper(rng, usedRappers) {
    const available = rappers.filter((rapper) => !usedRappers.has(rapper));
    if (!available.length) {
        throw new Error("Not enough unique rappers to build lyrics.");
    }

    const rapper = pickFrom(available, rng);
    usedRappers.add(rapper);
    return rapper;
}

function pickFrom(items, rng) {
    return items[Math.floor(rng() * items.length)];
}

function splitIntoBars(text, depth = 0) {
    const normalized = text.replace(/\s+/g, " ").trim();
    const syllableCount = countBeatSyllables(normalized);

    if (!normalized) {
        return [];
    }

    if (syllableCount <= BAR_MAX_SYLLABLES || depth >= 2 || !normalized.includes(" ")) {
        return [normalized];
    }

    const words = normalized.split(" ");
    let bestSplit = null;

    for (let index = 1; index < words.length; index += 1) {
        const left = words.slice(0, index).join(" ");
        const right = words.slice(index).join(" ");
        const leftCount = countBeatSyllables(left);
        const rightCount = countBeatSyllables(right);

        if (leftCount < BAR_MIN_SYLLABLES || rightCount < BAR_MIN_SYLLABLES) {
            continue;
        }

        const score = Math.abs(leftCount - BAR_TARGET_SYLLABLES) + Math.abs(rightCount - BAR_TARGET_SYLLABLES);

        if (!bestSplit || score < bestSplit.score) {
            bestSplit = { left, right, score };
        }
    }

    if (!bestSplit) {
        return [normalized];
    }

    return [
        ...splitIntoBars(bestSplit.left, depth + 1),
        ...splitIntoBars(bestSplit.right, depth + 1),
    ];
}

function renderSentenceWithRapper(sentence, rapper) {
    if (!sentence.includes("[래퍼]")) {
        return sentence;
    }

    const pairParticles = [
        ["으로", "로"],
        ["까지", "까지"],
        ["부터", "부터"],
        ["에게", "에게"],
        ["한테", "한테"],
        ["처럼", "처럼"],
        ["보다", "보다"],
        ["조차", "조차"],
        ["마저", "마저"],
        ["마냥", "마냥"],
        ["만", "만"],
        ["도", "도"],
        ["랑", "랑"],
        ["하고", "하고"],
        ["의", "의"],
        ["은", "는"],
        ["를", "를"],
        ["이", "가"],
        ["과", "와"],
    ];

    let rendered = sentence;

    for (const [withFinal, withoutFinal] of pairParticles) {
        const pattern = new RegExp(`\\[래퍼\\]${withFinal}`, "g");
        rendered = rendered.replace(pattern, `${rapper}${chooseParticle(rapper, withFinal, withoutFinal)}`);
    }

    rendered = rendered.replace(/\[래퍼\]/g, `${rapper}가`);
    return rendered;
}

function chooseParticle(rapper, withFinal, withoutFinal) {
    if (!rapper) {
        return withoutFinal;
    }

    const lastCharacter = rapper.trim().slice(-1);
    const hasFinalConsonant = hasFinalConsonantInHangul(lastCharacter);

    if (withFinal === "으로") {
        return hasFinalConsonant ? "으로" : "로";
    }

    if (withFinal === "이") {
        return hasFinalConsonant ? "이" : "가";
    }

    if (withFinal === "은") {
        return hasFinalConsonant ? "은" : "는";
    }

    if (withFinal === "을") {
        return hasFinalConsonant ? "을" : "를";
    }

    if (withFinal === "과") {
        return hasFinalConsonant ? "과" : "와";
    }

    return withoutFinal;
}

function hasFinalConsonantInHangul(character) {
    if (!character) {
        return false;
    }

    const code = character.charCodeAt(0) - 0xac00;
    if (code < 0 || code > 11171) {
        return false;
    }

    return code % 28 !== 0;
}

function countBeatSyllables(text) {
    const tokens = text.match(/[가-힣]+|[A-Za-z0-9]+(?:[._'-][A-Za-z0-9]+)*/g) || [];

    return tokens.reduce((total, token) => {
        if (/^[가-힣]+$/.test(token)) {
            return total + token.length;
        }

        const latinLength = token.replace(/[^A-Za-z0-9]/g, "").length;
        const latinWeight = Math.max(1, Math.min(3, Math.ceil(latinLength / 4)));
        return total + latinWeight;
    }, 0);
}

function splitByWordCount(text, chunkSize = 6) {
    const normalized = text.replace(/\s+/g, " ").trim();
    if (!normalized) {
        return [];
    }

    const words = normalized.split(" ");
    if (words.length <= chunkSize) {
        return [normalized];
    }

    const chunks = [];

    for (let index = 0; index < words.length; index += chunkSize) {
        chunks.push(words.slice(index, index + chunkSize));
    }

    rebalanceTailChunk(chunks, 6);

    return chunks.map((chunk) => chunk.join(" "));
}

function countWords(text) {
    const normalized = text.replace(/\s+/g, " ").trim();
    if (!normalized) {
        return 0;
    }

    return normalized.split(" ").length;
}

function splitByTargetLineCount(text, lineCount) {
    const normalized = text.replace(/\s+/g, " ").trim();
    if (!normalized || lineCount <= 1) {
        return normalized ? [normalized] : [];
    }

    const words = normalized.split(" ");
    const target = Math.max(1, Math.min(lineCount, words.length));
    const chunks = Array.from({ length: target }, () => []);

    for (let index = 0; index < words.length; index += 1) {
        const slot = Math.min(target - 1, Math.floor((index * target) / words.length));
        chunks[slot].push(words[index]);
    }

    rebalanceTailChunk(chunks, 6);

    return chunks
        .filter((chunk) => chunk.length > 0)
        .map((chunk) => chunk.join(" "));
}

function rebalanceTailChunk(chunks, minimumTailWords) {
    if (chunks.length <= 1) {
        return chunks;
    }

    const tail = chunks[chunks.length - 1];
    const previous = chunks[chunks.length - 2];

    while (tail.length < minimumTailWords && previous.length > minimumTailWords) {
        tail.unshift(previous.pop());
    }

    if (tail.length < minimumTailWords && previous.length > 1) {
        while (tail.length < minimumTailWords && previous.length > 1) {
            tail.unshift(previous.pop());
        }
    }

    return chunks;
}

function finalizeGeneratedLines(lines) {
    return lines
        .map((line, index) => ensureMinimumEojeol(line, 6, index === lines.length - 1))
        .slice(0, LINE_COUNT);
}

function ensureMinimumEojeol(line, minimumCount, isFinalLine = false) {
    const normalized = String(line || "").replace(/\s+/g, " ").trim();
    const words = normalized ? normalized.split(" ") : [];
    const fillers = isFinalLine ? FINAL_LINE_FILLERS : GENERAL_FILLERS;
    let cursor = 0;

    while (words.length < minimumCount) {
        words.push(fillers[cursor % fillers.length]);
        cursor += 1;
    }

    if (words.length > 0) {
        const lastWord = words[words.length - 1];
        if (/[,·…-]$/.test(lastWord)) {
            words[words.length - 1] = lastWord.replace(/[,·…-]+$/, "");
        }
    }

    return words.join(" ").replace(/\s+/g, " ").trim();
}

const GENERAL_FILLERS = ["끝까지", "한 번 더", "다시", "그대로", "바로", "천천히"];
const FINAL_LINE_FILLERS = ["마무리해", "여기서 닫아", "끝까지 가", "이제 끝내", "마침표 찍어", "여기서 끝"];

function encodeSecureSeed(seed, prefix) {
    const payload = Buffer.allocUnsafe(8);
    payload.writeUInt32BE(seed >>> 0, 0);
    payload.writeUInt32BE(DATA_FINGERPRINT, 4);

    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", ENCRYPTION_KEY, iv);
    const encrypted = Buffer.concat([cipher.update(payload), cipher.final()]);
    const tag = cipher.getAuthTag();

    return prefix + Buffer.concat([iv, encrypted, tag]).toString("base64url");
}

function decodeSecureSeed(token, prefix) {
    try {
        const packed = Buffer.from(token.slice(prefix.length), "base64url");
        if (packed.length !== 36) {
            return null;
        }

        const iv = packed.subarray(0, 12);
        const encrypted = packed.subarray(12, 20);
        const tag = packed.subarray(20);
        const decipher = crypto.createDecipheriv("aes-256-gcm", ENCRYPTION_KEY, iv);
        decipher.setAuthTag(tag);

        const payload = Buffer.concat([decipher.update(encrypted), decipher.final()]);
        const seed = payload.readUInt32BE(0);
        const fingerprint = payload.readUInt32BE(4);

        return fingerprint === DATA_FINGERPRINT ? seed : null;
    } catch {
        return null;
    }
}

function decodeLegacySelection(token) {
    const body = reverseText(token.slice(LEGACY_PREFIX.length));
    if (!body || body.length % 4 !== 0) {
        return [];
    }

    const selection = [];

    for (let index = 0; index < body.length / 4; index += 1) {
        const offset = index * 4;
        const sentenceValue = parseInt(body.slice(offset, offset + 2), 36);
        const rapperValue = parseInt(body.slice(offset + 2, offset + 4), 36);

        if (Number.isNaN(sentenceValue) || Number.isNaN(rapperValue)) {
            return [];
        }

        selection.push({
            sentenceIndex: wrapIndex(
                sentenceValue - SENTENCE_SALT * (index + 1),
                sentences.length,
            ),
            rapperIndex: wrapIndex(
                rapperValue - RAPPER_SALT * (index + 1),
                rappers.length,
            ),
        });
    }

    return selection.every(isValidSelection) ? selection : [];
}

function isValidSelection({ sentenceIndex, rapperIndex }) {
    return Number.isInteger(sentenceIndex)
        && Number.isInteger(rapperIndex)
        && sentenceIndex >= 0
        && rapperIndex >= 0
        && sentenceIndex < sentences.length
        && rapperIndex < rappers.length;
}

function wrapIndex(value, length) {
    return ((value % length) + length) % length;
}

function reverseText(value) {
    return [...value].reverse().join("");
}

async function polishWithDeepseek(lines) {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    
    // API 키 없으면 원본 반환
    if (!apiKey) {
        return lines;
    }

    try {
        const prompt = `다음 16줄 가사를 킴보 스타일로 다시 배치해줘.

주의사항:
1. 문장 의미는 절대 바뀌면 안 됨 (핵심 내용 유지)
2. 각 줄은 반드시 5~7어절이어야 함:
   - 목표: 5~7어절 (자연스러운 랩 플로우)
   - 만약 어절이 모자라면 (4어절 이하):
     * 문장 의미를 유지하면서 알아서 문장을 구사해서 어절을 채울 것
     * 예: "짬뽕 국물" (3어절) → "짬뽕의 국물에" (4어절) → "어떤 짬뽕의 국물에" (5어절)
     * 수식어 추가, 조사 활용, 명사 보충 등으로 자연스럽게 5~7어절 완성
   - 음절이 많으면 8~9어절도 괜찮음 (하지만 너무 길면 안 됨)
3. 마지막 문장은 완전한 문법적 완결로 끝나야 함 (중단/불완전하지 않게)
4. 받침 유무에 따른 조사 자동 정정:
   - 받침 있는 단어 뒤: 이, 을(를), 고, 로(으로)
   - 받침 없는 단어 뒤: 가, 를, 고, 로
   예: '래퍼이 말했다' → '래퍼가 말했다'
5. 중복 조사나 문법적 오류 수정
6. 결과는 정확히 16줄이어야 함
7. 줄바꿈과 배치만 정리해서 자연스럽고 임팩트 있게

원본:
${lines.join("\n")}

정정된 16줄을 한 줄씩 출력하기 (다른 설명 없이):`;

        const response = await fetch("https://api.deepseek.com/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${apiKey}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: "deepseek-chat",
                messages: [
                    {
                        role: "user",
                        content: prompt
                    }
                ],
                temperature: 0.3,
                max_tokens: 500
            })
        });

        if (!response.ok) {
            console.error(`DeepSeek API error: ${response.status}`);
            return lines;
        }

        const json = await response.json();
        if (!json.choices || !json.choices[0] || !json.choices[0].message) {
            console.error("Invalid DeepSeek response structure");
            return lines;
        }

        const polished = json.choices[0].message.content
            .split("\n")
            .map(line => line.trim())
            .filter(line => line.length > 0)
            .slice(0, 16);

        // 16줄 확보 못 했으면 원본 반환
        if (polished.length < 16) {
            console.warn(`DeepSeek returned ${polished.length} lines, expected 16. Returning original.`);
            return lines;
        }

        return polished;
    } catch (error) {
        console.error("DeepSeek polishing failed:", error.message);
        return lines; // 실패 시 원본 반환
    }
}
