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
        const resolved = token ? resolveSharedLyrics(token) : createGeneratedLyrics();

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

function createGeneratedLyrics() {
    const seed = crypto.randomBytes(4).readUInt32BE(0);
    const token = encodeSecureSeed(seed, SECURE_PREFIX);

    return buildGeneratedPayload(seed, token);
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
        const fullLine = sentences[sentenceIndex].replaceAll("[래퍼]", rappers[rapperIndex]);
        const splitBars = splitIntoBars(fullLine);

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
        lines: bars,
    };
}

function createClusterLyrics(seed) {
    const rng = createMulberry32(seed);
    const lines = [];
    const usedRappers = new Set();
    const sentenceOrder = pickUniqueIndexes(sentences.length, sentences.length, rng);

    for (const sentenceIndex of sentenceOrder) {
        const rapper = pickRapper(rng, usedRappers);
        const fullLine = sentences[sentenceIndex].replaceAll("[래퍼]", rapper);
        const splitBars = splitByWordCount(fullLine, 6);

        for (const bar of splitBars) {
            lines.push(bar);

            if (lines.length >= LINE_COUNT) {
                return lines;
            }
        }
    }

    return lines.slice(0, LINE_COUNT);
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

    if (chunks.length > 1) {
        const lastChunk = chunks[chunks.length - 1];
        const prevChunk = chunks[chunks.length - 2];

        if (lastChunk.length <= 2 && prevChunk.length > 4) {
            while (lastChunk.length < 4 && prevChunk.length > 4) {
                lastChunk.unshift(prevChunk.pop());
            }
        }
    }

    return chunks.map((chunk) => chunk.join(" "));
}

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
