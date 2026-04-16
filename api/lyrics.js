const crypto = require("node:crypto");
const { sentences, rappers } = require("./_lyrics-data");

const LINE_COUNT = 16;
const CLUSTER_SIZE = 4;
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
const ECHO_FAMILIES = [
    { a: "빙글빙글", b: "빙빙", c: "빙글대며", d: "빙글 모드" },
    { a: "실실실실", b: "실실", c: "실실대며", d: "실실 모드" },
    { a: "덜컹덜컹", b: "덜컹", c: "덜컹대며", d: "덜컹 모드" },
    { a: "우당탕탕", b: "우당탕", c: "우당거리며", d: "우당 모드" },
    { a: "반짝반짝", b: "반짝", c: "반짝대며", d: "반짝 모드" },
    { a: "출렁출렁", b: "출렁", c: "출렁대며", d: "출렁 모드" },
    { a: "쭈뼛쭈뼛", b: "쭈뼛", c: "쭈뼛대며", d: "쭈뼛 모드" },
    { a: "히죽히죽", b: "히죽", c: "히죽대며", d: "히죽 모드" },
];
const STREET_PLACES = ["피시방", "이발소", "노래방", "편의점", "분식집", "문방구", "당구장", "세탁방", "놀이터", "핫도그집"];
const STREET_ACTS = [
    "꼭짓점 춤 춰",
    "부채춤 춰",
    "리코더만 불어",
    "하모니카만 불어",
    "박수만 박아",
    "어깨만 튕겨",
    "슬리퍼 끌고 돌아",
    "그림자 밟고 따라다녀",
    "'잡았다 요놈' 하고 말 걸어",
    "회전의자 탄 척 밀고 가",
    "피시방에서 새피만 갈겨",
    "스텝만 밟아",
];
const SECOND_ACTS = [
    "빙글 돌아",
    "혼자 코러스 넣어",
    "목만 까딱여",
    "박자 없이 스텝 밟아",
    "회전의자 탄 척해",
    "휘파람만 불어",
    "케스터네츠만 쳐",
    "발뒤꿈치만 튕겨",
    "문 앞에서 대기만 타",
];
const PROPS = ["케스터네츠", "종이컵", "물티슈", "회전의자", "형광펜", "수박바", "딸기우유", "마이크커버", "핫식스", "리코더"];
const ITEMS = ["슬리퍼", "모자", "후드집업", "텀블러", "의자", "장바구니", "키보드", "스피커", "신발끈", "이어폰 케이스"];
const STICKERS = ["형광 리본", "포스트잇", "딸기잼", "초코시럽", "비닐장갑", "색종이", "빨대 세 개", "반짝이 스티커", "구슬", "휴지심"];
const ATTACH_VERBS = ["붙여놔", "매달아놔", "꽂아놔", "감아놔", "채워놔", "올려놔", "끼워놔"];
const STUDIO_NOISES = [
    "하모니카만 불어",
    "박수만 쳐",
    "테이블만 두드려",
    "코러스 흉내 내",
    "헤드폰 없이 끄덕여",
    "의자 끌고 드리프트해",
    "케스터네츠만 쳐",
    "방음문 앞에서 발만 굴러",
    "마이크보다 크게 콧노래해",
];
const FOOD_SHOPS = ["분식집", "편의점", "떡볶이집", "토스트집", "핫도그집", "김밥집"];
const FOODS = ["삼각김밥", "소시지", "핫바", "식혜", "딸기우유", "군만두", "토스트", "컵라면"];
const FOOD_TOPPINGS = ["케첩만", "머스터드만", "후추만", "파슬리만", "딸기잼만", "초코시럽만", "얼음만"];
const FASHION_LOOKS = ["선글라스 끼고", "비니 눌러쓰고", "후드 뒤집어쓰고", "트레이닝복 입고", "양말 질질 끌고", "목도리 두르고", "슬리퍼 신고"];
const FASHION_MOVES = ["런웨이처럼 걸어", "거울 앞에서 포즈만 잡아", "혼자 워킹해", "어깨만 으쓱해", "주머니에 손 넣고 빙글 돌아"];
const CLOSERS = [
    "오늘도 앞줄만 점령해",
    "오늘도 괜히 더 튀어",
    "오늘도 폼만 잔뜩 잡어",
    "오늘도 박자보다 먼저 나가",
    "오늘도 분위기만 괜히 흔들어",
    "오늘도 동네만 괜히 시끄럽혀",
    "오늘도 스텝만 괜히 앞서가",
    "오늘도 웃음만 먼저 터뜨려",
];

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
    const clusterCount = Math.ceil(LINE_COUNT / CLUSTER_SIZE);

    for (let index = 0; index < clusterCount; index += 1) {
        const rapper = pickRapper(rng, usedRappers);
        const family = pickFrom(ECHO_FAMILIES, rng);
        const builder = pickFrom(CLUSTER_BUILDERS, rng);
        const clusterLines = builder(rng, rapper, family);

        for (const line of clusterLines) {
            lines.push(line);

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
    const pool = available.length ? available : rappers;
    const rapper = pickFrom(pool, rng);
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

function buildStreetCluster(rng, rapper, family) {
    const place = pickFrom(STREET_PLACES, rng);
    const place2 = pickFrom(STREET_PLACES, rng);
    const prop = pickFrom(PROPS, rng);
    const item = pickFrom(ITEMS, rng);
    const sticker = pickFrom(STICKERS, rng);

    return [
        `${rapper} 동네 ${place} 앞에서 ${pickFrom(STREET_ACTS, rng)}`,
        `${family.a} ${family.b}, ${prop} 들고 ${pickFrom(SECOND_ACTS, rng)}`,
        `${rapper} ${item} 위에 ${sticker}만 ${pickFrom(ATTACH_VERBS, rng)}`,
        `${family.c} ${family.a}, 오늘도 ${place2} 앞을 접수해`,
    ];
}

function buildStudioCluster(rng, rapper, family) {
    const prop = pickFrom(PROPS, rng);
    const item = pickFrom(ITEMS, rng);
    const sticker = pickFrom(STICKERS, rng);

    return [
        `${rapper} 작업실 복도에서 ${pickFrom(STUDIO_NOISES, rng)}`,
        `${family.a} ${family.b}, ${prop}로 박수만 쳐`,
        `${rapper} ${item} 옆에 ${sticker}만 ${pickFrom(ATTACH_VERBS, rng)}`,
        `${family.c} ${family.a}, 세션보다 내가 더 튀어`,
    ];
}

function buildFoodCluster(rng, rapper, family) {
    const shop = pickFrom(FOOD_SHOPS, rng);
    const food = pickFrom(FOODS, rng);
    const food2 = pickFrom(FOODS, rng);
    const topping = pickFrom(FOOD_TOPPINGS, rng);

    return [
        `${rapper} 단골 ${shop} 가서 ${food}만 집어`,
        `${family.a} ${family.b}, ${food2} 위에 ${topping} 더 뿌려`,
        `${rapper} 장바구니에 ${pickFrom(FOODS, rng)}만 가득 담아`,
        `${family.c} ${family.a}, 계산 안 하고 포즈만 잡어`,
    ];
}

function buildFashionCluster(rng, rapper, family) {
    const prop = pickFrom(PROPS, rng);
    const sticker = pickFrom(STICKERS, rng);

    return [
        `${rapper} ${pickFrom(FASHION_LOOKS, rng)} ${pickFrom(FASHION_MOVES, rng)}`,
        `${family.a} ${family.b}, ${prop} 들고 거울만 봐`,
        `${rapper} 후드끈에 ${sticker}만 ${pickFrom(ATTACH_VERBS, rng)}`,
        `${family.c} ${family.a}, 오늘도 폼만 잔뜩 잡어`,
    ];
}

function buildStageCluster(rng, rapper, family) {
    const prop = pickFrom(PROPS, rng);
    const item = pickFrom(ITEMS, rng);
    const place = pickFrom(["무대 뒤", "백스테이지", "리허설장", "조명 밑", "복도 끝"], rng);

    return [
        `${rapper} ${place}에서 ${pickFrom(STREET_ACTS, rng)}`,
        `${family.a} ${family.b}, ${prop}만 흔들어`,
        `${rapper} ${item} 옆에 박수 소리만 덧칠해`,
        `${family.c} ${family.a}, ${pickFrom(CLOSERS, rng)}`,
    ];
}

const CLUSTER_BUILDERS = [
    buildStreetCluster,
    buildStudioCluster,
    buildFoodCluster,
    buildFashionCluster,
    buildStageCluster,
];
