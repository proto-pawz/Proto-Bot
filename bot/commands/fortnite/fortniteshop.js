import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import {
    ActionRowBuilder,
    ApplicationIntegrationType,
    AttachmentBuilder,
    ButtonBuilder,
    ButtonStyle,
    ContainerBuilder,
    InteractionContextType,
    MediaGalleryBuilder,
    MediaGalleryItemBuilder,
    MessageFlags,
    ModalBuilder,
    SeparatorBuilder,
    SeparatorSpacingSize,
    SlashCommandBuilder,
    TextDisplayBuilder,
    TextInputBuilder,
    TextInputStyle,
    escapeMarkdown
} from 'discord.js';
import sharp from 'sharp';

import { getEmoji } from '../music/spotifysearch.js';

import {
    execute as executeCosmetic,
    subcommand as cosmeticSubcommand
} from './fortnitecosmetic.js';

export const global = true;

export const data = new SlashCommandBuilder()
    .setName('fortnite')
    .setDescription('Fortnite utilities')
    .addSubcommand(subcommand => subcommand
        .setName('shop')
        .setDescription("View today's Fortnite shop")
    )
    .addSubcommand(cosmeticSubcommand)
    .setIntegrationTypes(
        ApplicationIntegrationType.GuildInstall,
        ApplicationIntegrationType.UserInstall
    )
    .setContexts(
        InteractionContextType.Guild,
        InteractionContextType.BotDM,
        InteractionContextType.PrivateChannel
    );

const SHOP_URL = 'https://fortnite.gg/shop';
const SHOP_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': SHOP_URL
};

// Cloudflare fingerprints Node's TLS handshake (undici), so keep a curl fallback
// ready for hosts that reject native fetch despite browser-like headers.
const CURL_HEADERS = Object.entries(SHOP_HEADERS)
    .flatMap(([name, value]) => ['--header', `${name}: ${value}`]);
const execFileAsync = promisify(execFile);
let preferCurl = false;

const FLAGS = MessageFlags.IsComponentsV2;
const PAGE_SIZE = 12;
const GRID_COLUMNS = 3;
const GRID_ROWS = 4;
const GRID_TILE = 192;
const GRID_ICON = 160;
const GRID_FILE = 'fortnite-shop.png';
const COLLECTOR_TIME = 5 * 60 * 1000;

// Sections that are shop categories rather than a branded collaboration.
const NON_COLLAB_SECTIONS = new Set([
    'iconic-emotes',
    'jam-tracks',
    'save-the-world',
    'special-offers-bundles',
    'region-restricted-offers',
    'vehicle-accessories',
    'treasure-hunters',
    'get-your-kicks',
    'harvest-season',
    'birds-of-a-feather',
    'hoppers',
    'no-sweat',
    'main-character-energy',
    'the-sidekick-squad',
    'daily',
    'featured'
]);

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

function escapeText(value) {
    return escapeMarkdown(decodeEntities(stripTags(value)).replace(/\s+/g, ' ').trim());
}

function formatNumber(value) {
    return (Number(value) || 0).toLocaleString('en-US');
}

function parseClock(value) {
    const parts = String(value ?? '').trim().split(':').map(Number);

    if (parts.length !== 3 || parts.some(part => !Number.isFinite(part)))
        return 0;

    return ((parts[0] * 3600) + (parts[1] * 60) + parts[2]) * 1000;
}

function formatRemaining(milliseconds) {
    const seconds = Math.max(0, Math.floor(milliseconds / 1000));
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);

    if (days)
        return `${days}d ${hours}h`;

    if (hours)
        return `${hours}h ${minutes}m`;

    return `${minutes}m`;
}

function parseShop(html) {
    const items = [];
    const sectionRegex = /<div id='([^']+)'><h2[^>]*><div class='shop-section-title'>([\s\S]*?)<div class='arrow'/g;
    const sections = [...html.matchAll(sectionRegex)];

    for (let index = 0; index < sections.length; index++) {
        const section = sections[index];
        const sectionId = section[1].toLowerCase();
        const collab = NON_COLLAB_SECTIONS.has(sectionId)
            ? null
            : escapeText(section[2]);

        const end = index + 1 < sections.length ? sections[index + 1].index : html.length;
        const body = html.slice(section.index, end);
        const itemRegex = /<div class='fn-item(?: nonbr)?'>([\s\S]*?)(?=<div class='fn-item(?: nonbr)?'>|$)/g;

        for (const match of body.matchAll(itemRegex)) {
            const chunk = match[1];
            const name = /<h3 class='fn-item-name'>([\s\S]*?)<\/h3>/.exec(chunk)?.[1];
            const image = /<img class='img' src='([^']+)'/.exec(chunk)?.[1];

            if (!name || !image)
                continue;

            const price = /<div class='fn-item-price'>([\s\S]*?)<\/div>/.exec(chunk)?.[1] ?? '';
            const expires = /<span class='js-bundle-countdown' data-ts='(\d+)'/.exec(chunk)?.[1];
            const tag = /<div class='shop-tag'>([\s\S]*?)<\/div>/.exec(chunk)?.[1];

            let imageUrl;

            try {
                imageUrl = new URL(decodeEntities(image), SHOP_URL).toString();
            }
            catch {
                continue;
            }

            items.push({
                name: escapeText(name),
                collab,
                price: Number(decodeEntities(stripTags(price)).replace(/[^\d]/g, '')) || 0,
                expiresAt: expires ? Number(expires) * 1000 : null,
                tag: tag ? escapeText(tag) : null,
                imageUrl
            });
        }
    }

    const reset = /class='shop-countdown'[^>]*>([^<]+)</.exec(html)?.[1];
    const date = /<h1[^>]*>[\s\S]*?<div>([^<]+)<\/div>/.exec(html)?.[1];

    return {
        items,
        resetAt: Date.now() + parseClock(reset),
        dateLabel: date ? escapeText(date) : 'Today'
    };
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

async function tryFetch(url) {
    try {
        const response = await fetch(url, {
            headers: SHOP_HEADERS,
            signal: AbortSignal.timeout(20_000)
        });

        if (response.ok)
            return Buffer.from(await response.arrayBuffer());
    }
    catch { /* EMPTY */ }

    return null;
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

async function fetchShop() {
    const shop = parseShop(await requestText(SHOP_URL));

    if (!shop.items.length)
        throw new Error('No shop items found.');

    return shop;
}

async function fetchIcon(state, url) {
    if (state.images.has(url))
        return state.images.get(url);

    let image = null;

    try {
        image = await requestBuffer(url);
    }
    catch { /* EMPTY */ }

    state.images.set(url, image);
    return image;
}

let placeholderPromise;

function placeholderIcon() {
    placeholderPromise ??= sharp({
        create: {
            width: GRID_ICON,
            height: GRID_ICON,
            channels: 4,
            background: { r: 0, g: 0, b: 0, alpha: 0 }
        }
    }).png().toBuffer();

    return placeholderPromise;
}

async function createGrid(state) {
    const width = GRID_COLUMNS * GRID_TILE;
    const height = GRID_ROWS * GRID_TILE;
    const offset = (GRID_TILE - GRID_ICON) / 2;

    const composites = await Promise.all(state.pageItems.map(async (item, index) => {
        const source = await fetchIcon(state, item.imageUrl) ?? await placeholderIcon();
        const input = await sharp(source)
            .resize(GRID_ICON, GRID_ICON, {
                fit: 'inside',
                background: { r: 0, g: 0, b: 0, alpha: 0 }
            })
            .png()
            .toBuffer();

        return {
            input,
            left: (index % GRID_COLUMNS) * GRID_TILE + offset,
            top: Math.floor(index / GRID_COLUMNS) * GRID_TILE + offset
        };
    }));

    return sharp({
        create: {
            width,
            height,
            channels: 4,
            background: { r: 23, g: 24, b: 28, alpha: 1 }
        }
    })
        .composite(composites)
        .png()
        .toBuffer();
}

export async function loadPage(state) {
    const start = state.page * PAGE_SIZE;

    state.pageItems = state.items.slice(start, start + PAGE_SIZE);
    state.grid = await createGrid(state);
}

function separator() {
    return new SeparatorBuilder()
        .setDivider(true)
        .setSpacing(SeparatorSpacingSize.Small);
}

function createPaginationRow(state) {
    const firstPage = state.page === 0;
    const lastPage = state.page >= state.lastPage;

    return new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(state.ids.first)
                .setEmoji(getEmoji(state.client, '883825508633182208', '⏮️'))
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(state.disabled || firstPage),
            new ButtonBuilder()
                .setCustomId(state.ids.previous)
                .setEmoji(getEmoji(state.client, '883825508507336704', '◀️'))
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(state.disabled || firstPage),
            new ButtonBuilder()
                .setCustomId(state.ids.next)
                .setEmoji(getEmoji(state.client, '883825508087922739', '▶️'))
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(state.disabled || lastPage),
            new ButtonBuilder()
                .setCustomId(state.ids.last)
                .setEmoji(getEmoji(state.client, '883825508482183258', '⏭️'))
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(state.disabled || lastPage),
            new ButtonBuilder()
                .setCustomId(state.ids.jump)
                .setEmoji(getEmoji(state.client, '1138849626234036264', '🔢'))
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(state.disabled)
        );
}

export function buildPage(state) {
    const lines = state.pageItems.map((item, index) => {
        const meta = [
            `${formatNumber(item.price)} VBUCKS`,
            `${formatRemaining((item.expiresAt ?? state.resetAt) - Date.now())} left`
        ];

        if (item.collab)
            meta.unshift(`Collab: **${item.collab}**`);

        return [
            `**${state.page * PAGE_SIZE + index + 1}. ${item.name}**${item.tag ? ` (${item.tag})` : ''}`,
            `-# ${meta.join(' · ')}`
        ].join('\n');
    });

    const container = new ContainerBuilder()
        .setAccentColor(0x0099DF)
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                [
                    '## 🛒 Fortnite Item Shop',
                    `**${state.dateLabel}** · ${formatRemaining(state.resetAt - Date.now())} until rotation`,
                    `-# ${formatNumber(state.items.length)} items · Page ${state.page + 1}/${state.lastPage + 1}`
                ].join('\n')
            )
        )
        .addMediaGalleryComponents(
            new MediaGalleryBuilder().addItems(
                new MediaGalleryItemBuilder().setURL(`attachment://${GRID_FILE}`)
            )
        )
        .addSeparatorComponents(separator())
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                lines.length ? lines.join('\n') : 'No shop items found.'
            )
        )
        .addSeparatorComponents(separator())
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `-# Source: [fortnite.gg/shop](${SHOP_URL})`
            )
        )
        .addActionRowComponents(createPaginationRow(state));

    return {
        components: [container],
        files: [new AttachmentBuilder(state.grid, { name: GRID_FILE })],
        flags: FLAGS,
        allowedMentions: { parse: [] }
    };
}

function createJumpModal(state) {
    return new ModalBuilder()
        .setCustomId(state.client.bot.createId({
            module: 'fortniteshop.js',
            state
        }))
        .setTitle('Jump to page')
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('page')
                    .setLabel(`Page number (1-${state.lastPage + 1})`)
                    .setPlaceholder('1')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
            )
        );
}

function createNotice(content) {
    return {
        components: [
            new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(content)
                )
        ],
        flags: FLAGS,
        allowedMentions: { parse: [] }
    };
}

export async function execute(interaction) {
    const subcommandName = interaction.options.getSubcommand();

    if (subcommandName === 'cosmetic')
        return executeCosmetic(interaction);

    if (subcommandName !== 'shop')
        return;

    await interaction.deferReply({ flags: FLAGS });

    try {
        const shop = await fetchShop();
        const prefix = `fs:${interaction.id}:${interaction.user.id}:`;

        const state = {
            client: interaction.client,
            userId: interaction.user.id,
            items: shop.items,
            dateLabel: shop.dateLabel,
            resetAt: shop.resetAt,
            page: 0,
            lastPage: Math.max(0, Math.ceil(shop.items.length / PAGE_SIZE) - 1),
            pageItems: [],
            grid: null,
            images: new Map(),
            disabled: false,
            ids: {
                first: `${prefix}first`,
                previous: `${prefix}previous`,
                next: `${prefix}next`,
                last: `${prefix}last`,
                jump: `${prefix}jump`
            }
        };

        await loadPage(state);
        await interaction.editReply(buildPage(state));

        const message = await interaction.fetchReply();
        const actions = Object.values(state.ids);
        const collector = message.createMessageComponentCollector({
            filter: component =>
                component.user.id === state.userId &&
                actions.includes(component.customId),
            time: COLLECTOR_TIME
        });

        collector.on('collect', async button => {
            try {
                const action = button.customId.slice(prefix.length);

                if (action === 'jump')
                    return await button.showModal(createJumpModal(state));

                if (action === 'first')
                    state.page = 0;

                if (action === 'previous')
                    state.page = Math.max(0, state.page - 1);

                if (action === 'next')
                    state.page = Math.min(state.lastPage, state.page + 1);

                if (action === 'last')
                    state.page = state.lastPage;

                await loadPage(state);
                await button.update(buildPage(state));
            }
            catch (error) {
                console.error('Fortnite shop button failed:', error);

                if (!button.deferred && !button.replied) {
                    await button.reply({
                        content: '❌ Something went wrong while handling that button.',
                        flags: MessageFlags.Ephemeral
                    }).catch(() => { });
                }
            }
        });

        collector.on('end', async (_, reason) => {
            if (reason === 'messageDelete')
                return;

            state.disabled = true;

            try {
                await interaction.editReply(buildPage(state));
            }
            catch { /* EMPTY */ }
        });
    }
    catch (error) {
        console.error('Fortnite shop failed:', error);

        await interaction.editReply(createNotice(
            '❌ Could not load the Fortnite item shop. Please try again.'
        ));
    }
}

export default { global, data, execute };
