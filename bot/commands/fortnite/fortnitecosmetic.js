import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import {
    ContainerBuilder,
    MediaGalleryBuilder,
    MediaGalleryItemBuilder,
    MessageFlags,
    SeparatorBuilder,
    SeparatorSpacingSize,
    TextDisplayBuilder,
    escapeMarkdown
} from 'discord.js';

import { getEmoji } from '../music/spotifysearch.js';

export const subcommand = subcommand => subcommand
    .setName('cosmetic')
    .setDescription('Look up a Fortnite cosmetic')
    .addStringOption(option => option
        .setName('name')
        .setDescription('Cosmetic name to search for')
        .setMaxLength(100)
        .setRequired(true)
    );

const COSMETICS_URL = 'https://fortnite.gg/cosmetics';
const ITEMS_URL = 'https://fortnite.gg/data/items/all.en.js';
const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': COSMETICS_URL
};

// Cloudflare blocks Node's TLS fingerprint, so fall back to curl when needed.
const CURL_HEADERS = Object.entries(HEADERS)
    .flatMap(([name, value]) => ['--header', `${name}: ${value}`]);
const execFileAsync = promisify(execFile);
const FLAGS = MessageFlags.IsComponentsV2;
let preferCurl = false;

function stripTags(value) {
    return String(value ?? '').replace(/<[^>]*>/g, '');
}

function decodeEntities(value) {
    return String(value ?? '')
        .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
        .replace(/&#(\d+);/g, (_, decimal) => String.fromCodePoint(Number(decimal)))
        .replace(/&(amp|apos|quot|lt|gt|nbsp|ndash|mdash);/g, (_, name) => ({
            amp: '&',
            apos: '\'',
            quot: '"',
            lt: '<',
            gt: '>',
            nbsp: ' ',
            ndash: '–',
            mdash: '—'
        })[name] ?? name);
}

function clean(value) {
    return decodeEntities(stripTags(value)).replace(/\s+/g, ' ').trim();
}

function escapeText(value) {
    return escapeMarkdown(clean(value));
}

function normalize(value) {
    return String(value ?? '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/['".]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function capitalize(value) {
    return value ? value.charAt(0).toUpperCase() + value.slice(1) : null;
}

async function tryFetch(url) {
    try {
        const response = await fetch(url, {
            headers: HEADERS,
            signal: AbortSignal.timeout(20_000)
        });

        if (response.ok)
            return Buffer.from(await response.arrayBuffer());
    }
    catch { /* EMPTY */ }

    return null;
}

async function requestWithCurl(url) {
    const { stdout } = await execFileAsync('curl', [
        '--silent',
        '--show-error',
        '--location',
        '--fail',
        '--max-time', '20',
        ...CURL_HEADERS,
        url
    ], {
        encoding: 'buffer',
        maxBuffer: 32 * 1024 * 1024
    });

    return stdout;
}

async function requestBuffer(url) {
    if (!preferCurl) {
        const direct = await tryFetch(url);

        if (direct)
            return direct;

        preferCurl = true;
    }

    try {
        return await requestWithCurl(url);
    }
    catch (error) {
        preferCurl = false;

        const direct = await tryFetch(url);

        if (!direct)
            throw error;

        return direct;
    }
}

async function requestText(url) {
    return (await requestBuffer(url)).toString('utf8');
}

// The site stores its item index as bare JavaScript object literals.
function parseDataFile(source) {
    const fixLiterals = value => value
        .trim()
        .replace(/;$/, '')
        .replace(/([{,])(\$?[\w$]+):/g, '$1"$2":')
        .replace(/,\s*([}\]])/g, '$1');

    const itemsMarker = ';Items=';
    const itemsStart = source.indexOf(itemsMarker);
    const setsStart = source.indexOf('Sets=');

    if (setsStart !== 0 || itemsStart < 0)
        throw new Error('Unexpected cosmetics data format.');

    const sets = JSON.parse(fixLiterals(source.slice(setsStart + 'Sets='.length, itemsStart)));
    const items = JSON.parse(fixLiterals(source.slice(itemsStart + itemsMarker.length)));

    return { sets, items };
}

let indexPromise;

function getCosmeticIndex() {
    indexPromise ??= requestText(ITEMS_URL)
        .then(parseDataFile)
        .catch(error => {
            indexPromise = undefined;
            throw error;
        });

    return indexPromise;
}

function findCosmetic(items, queryText) {
    const query = normalize(queryText);

    if (!query)
        return null;

    const words = query.split(' ');
    let best = null;
    let bestScore = 0;

    for (const item of items) {
        if (!item.name || item.id === 9999999)
            continue;

        const name = normalize(item.name);
        let score = 0;

        if (name === query)
            score = 4;
        else if (name.startsWith(query))
            score = 3;
        else if (name.includes(query))
            score = 2;
        else if (words.every(word => name.includes(word)))
            score = 1;

        if (score > bestScore) {
            best = item;
            bestScore = score;

            if (score === 4)
                break;
        }
    }

    return best;
}

async function fetchCosmetic(id) {
    const html = await requestText(`${COSMETICS_URL}?id=${id}`);
    const name = clean(/<h1 class='fn-detail-name'>([\s\S]*?)<\/h1>/.exec(html)?.[1]);

    if (!name)
        throw new Error('Cosmetic details could not be parsed.');

    const typeBlock = /<div class='fn-detail-type'>([\s\S]*?)<\/div>/.exec(html)?.[1] ?? '';
    const rarity = clean(/<span[^>]*>([\s\S]*?)<\/span>/.exec(typeBlock)?.[1]) || null;
    const type = clean(typeBlock).replace(rarity ?? '', '').trim() || null;

    const description = clean(
        /<div class='fn-detail-desc grey'>([\s\S]*?)<\/div>/.exec(html)?.[1]
    ) || null;

    const introduced = clean(
        /<th scope='row' class='grey'>Introduced in:<\/th><td[^>]*>([\s\S]*?)<\/td>/.exec(html)?.[1]
    ) || null;

    const collab = clean(
        /<th scope='row' class='grey'>Collab:<\/th><td[^>]*>([\s\S]*?)<\/td>/.exec(html)?.[1]
    ) || null;

    const icon = [...html.matchAll(/<img src='(\/img\/items\/(\d+)\/icon\.[^']+)'/g)]
        .find(match => match[2] === String(id))?.[1] ?? `/img/items/${id}/icon.png`;

    return {
        name,
        type,
        rarity,
        description,
        introduced,
        collab,
        iconUrl: new URL(decodeEntities(icon), COSMETICS_URL).toString()
    };
}

function separator() {
    return new SeparatorBuilder()
        .setDivider(true)
        .setSpacing(SeparatorSpacingSize.Small);
}

function buildPage(client, item, detail, index) {
    const emoji = getEmoji(client, '1506004918538866771', '🎮');
    const emojiMarkup = emoji.id
        ? `<${emoji.animated ? 'a' : ''}:${emoji.name}:${emoji.id}>`
        : emoji.name;
    const searchUrl = `${COSMETICS_URL}?search=${encodeURIComponent(detail.name)}`;
    const set = detail.collab ?? capitalize(index.sets[item.set] ?? null);

    const info = [
        detail.type ? `**Type:** ${escapeText(detail.type)}` : null,
        detail.rarity ? `**Rarity:** ${escapeText(detail.rarity)}` : null,
        set ? `**Set:** ${escapeText(set)}` : null,
        detail.introduced ? `**Introduced:** ${escapeText(detail.introduced)}` : null,
        detail.description ? `-# ${escapeText(detail.description)}` : null
    ].filter(Boolean).join('\n');

    const container = new ContainerBuilder()
        .setAccentColor(0xD3D6F1)
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `### ${emojiMarkup} [${escapeText(detail.name)}](${searchUrl})`
            )
        )
        .addSeparatorComponents(separator())
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(info || 'No additional information available.')
        )
        .addSeparatorComponents(separator())
        .addMediaGalleryComponents(
            new MediaGalleryBuilder().addItems(
                new MediaGalleryItemBuilder().setURL(detail.iconUrl)
            )
        );

    return {
        components: [container],
        flags: FLAGS,
        allowedMentions: { parse: [] }
    };
}

function createNotice(content) {
    return {
        components: [
            new ContainerBuilder().addTextDisplayComponents(
                new TextDisplayBuilder().setContent(content)
            )
        ],
        flags: FLAGS,
        allowedMentions: { parse: [] }
    };
}

export async function execute(interaction) {
    const query = interaction.options.getString('name').trim();

    if (!query)
        return interaction.reply(createNotice('❌ Provide a cosmetic name to search for.'));

    await interaction.deferReply({ flags: FLAGS });

    try {
        const index = await getCosmeticIndex();
        const item = findCosmetic(index.items, query);

        if (!item)
            return interaction.editReply(createNotice(
                `❌ No cosmetic found for \`${escapeText(query)}\`.`
            ));

        const detail = await fetchCosmetic(item.id);

        await interaction.editReply(
            buildPage(interaction.client, item, detail, index)
        );
    }
    catch (error) {
        console.error('Fortnite cosmetic lookup failed:', error);

        await interaction.editReply(createNotice(
            '❌ Could not look up that cosmetic. Please try again.'
        ));
    }
}

export default { subcommand, execute };
