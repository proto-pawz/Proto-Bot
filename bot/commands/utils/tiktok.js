import { performance } from 'node:perf_hooks';

import {
    ActionRowBuilder,
    AttachmentBuilder,
    ButtonBuilder,
    ButtonStyle,
    ContainerBuilder,
    MediaGalleryBuilder,
    MediaGalleryItemBuilder,
    SlashCommandBuilder,
    TextDisplayBuilder,
    ApplicationIntegrationType,
    InteractionContextType,
    MessageFlags
} from 'discord.js';

export const global = true;

export const data = new SlashCommandBuilder()
    .setName('tiktok')
    .setDescription('Download a TikTok video (up to 3 minutes) and send it as a video embed.')
    .addStringOption(option => option
        .setName('url')
        .setDescription('The TikTok video URL to download.')
        .setRequired(true)
        .setMaxLength(2048)
    )
    .setIntegrationTypes(
        ApplicationIntegrationType.GuildInstall,
        ApplicationIntegrationType.UserInstall
    )
    .setContexts(
        InteractionContextType.Guild,
        InteractionContextType.BotDM,
        InteractionContextType.PrivateChannel
    );

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const VIDEO_ID_PATTERN = /\/video\/(\d{5,})(?:\/|$)/;
const MOBILE_VIDEO_PATTERN = /^\/v\/(\d{5,})\.html$/;
const SHORT_PATH_PATTERN = /^\/[A-Za-z0-9]+\/?$/;
const MAX_VIDEO_SECONDS = 180;
const MAX_TITLE_LENGTH = 256;

class TikTokError extends Error { }

function truncate(text, maxLength) {
    if (text.length <= maxLength)
        return text;

    return `${text.slice(0, maxLength - 1)}…`;
}

function parseTikTokUrl(value) {
    let url;

    try {
        url = new URL(value);
    }
    catch {
        return null;
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:')
        return null;

    const host = url.hostname.toLowerCase();

    if (host !== 'tiktok.com' && !host.endsWith('.tiktok.com'))
        return null;

    const videoMatch = VIDEO_ID_PATTERN.exec(url.pathname);
    const mobileMatch = MOBILE_VIDEO_PATTERN.exec(url.pathname);

    if (videoMatch || mobileMatch)
        return { url };

    if (host === 'vm.tiktok.com' || host === 'vt.tiktok.com') {
        if (SHORT_PATH_PATTERN.test(url.pathname))
            return { url };
    }

    if (host.endsWith('tiktok.com') && /^\/t\/[A-Za-z0-9]+\/?$/.test(url.pathname))
        return { url };

    return null;
}

function getCookieHeader(response) {
    const setCookies = response.headers.getSetCookie?.() ?? [];

    return setCookies
        .map(cookie => cookie.split(';', 1)[0])
        .filter(Boolean)
        .join('; ');
}

async function getVideoPage(urlValue) {
    let response;

    try {
        response = await fetch(urlValue, {
            headers: {
                'user-agent': USER_AGENT,
                'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'accept-language': 'en-US,en;q=0.9'
            }
        });
    }
    catch {
        throw new TikTokError('Could not reach TikTok to look up that video.');
    }

    if (!response.ok)
        throw new TikTokError(`TikTok returned HTTP ${response.status} while looking up that video.`);

    return {
        html: await response.text(),
        cookieHeader: getCookieHeader(response)
    };
}

function parseVideoDetails(html) {
    const match = html.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application\/json">([\s\S]*?)<\/script>/);

    if (!match)
        throw new TikTokError('Could not read the TikTok video details.');

    let data;

    try {
        data = JSON.parse(match[1]);
    }
    catch {
        throw new TikTokError('Could not read the TikTok video details.');
    }

    const detail = data.__DEFAULT_SCOPE__?.['webapp.video-detail'];

    if (!detail || Number(detail.statusCode) !== 0)
        throw new TikTokError(detail?.statusMsg || 'That TikTok video is unavailable.');

    const item = detail.itemInfo?.itemStruct;

    if (!item?.video)
        throw new TikTokError('That TikTok post does not contain a video.');

    return item;
}

function selectVideoUrls(item) {
    const urls = [];
    const bitrates = [...(item.video.bitrateInfo ?? [])]
        .sort((a, b) => (b.Bitrate ?? 0) - (a.Bitrate ?? 0));

    for (const bitrate of bitrates) {
        for (const url of bitrate.PlayAddr?.UrlList ?? []) {
            if (typeof url === 'string' && /^https?:\/\//.test(url))
                urls.push(url);
        }
    }

    if (item.video.playAddr)
        urls.push(item.video.playAddr);

    if (item.video.downloadAddr)
        urls.push(item.video.downloadAddr);

    const unique = [...new Set(urls)];

    if (!unique.length)
        throw new TikTokError('That TikTok video does not have a downloadable MP4 stream.');

    return unique;
}

function looksLikeMp4(buffer) {
    return buffer.subarray(0, 32).includes(Buffer.from('ftyp'));
}

async function downloadVideo(urls, cookieHeader) {
    const headerVariants = [
        {
            'user-agent': USER_AGENT,
            'accept': '*/*',
            'referer': 'https://www.tiktok.com/',
            ...(cookieHeader ? { cookie: cookieHeader } : {})
        },
        {
            'user-agent': USER_AGENT,
            'accept': '*/*',
            'referer': 'https://www.tiktok.com/'
        },
        {
            'user-agent': USER_AGENT,
            'accept': '*/*'
        }
    ];

    for (const url of urls) {
        for (const headers of headerVariants) {
            let response;

            try {
                response = await fetch(url, { headers });
            }
            catch {
                continue;
            }

            if (!response.ok)
                continue;

            try {
                const buffer = Buffer.from(await response.arrayBuffer());

                if (looksLikeMp4(buffer))
                    return buffer;
            }
            catch {
                continue;
            }
        }
    }

    throw new TikTokError('Failed to download the TikTok video.');
}

function formatElapsed(milliseconds) {
    const seconds = Math.floor(milliseconds / 1000);
    const ms = Math.floor(milliseconds % 1000).toString().padStart(3, '0');

    return `${seconds}.${ms}s`;
}

export async function execute(interaction) {
    const urlValue = interaction.options.getString('url', true).trim();
    const tiktokUrl = parseTikTokUrl(urlValue);

    if (!tiktokUrl) {
        return interaction.reply({
            content: 'Please provide a valid TikTok video URL.',
            flags: MessageFlags.Ephemeral
        });
    }

    const startedAt = performance.now();

    await interaction.deferReply();

    try {
        const page = await getVideoPage(tiktokUrl.url.href);
        const item = parseVideoDetails(page.html);
        const lengthSeconds = Number(item.video.duration);

        if (!Number.isFinite(lengthSeconds) || lengthSeconds <= 0)
            throw new TikTokError('Could not determine how long that video is.');

        if (lengthSeconds > MAX_VIDEO_SECONDS)
            throw new TikTokError('That video is longer than 3 minutes. Only TikToks up to 3 minutes are supported.');

        const video = await downloadVideo(selectVideoUrls(item), page.cookieHeader);
        const fileName = 'tiktok.mp4';
        const title = truncate(item.desc?.trim() || 'TikTok Video', MAX_TITLE_LENGTH);
        const elapsed = performance.now() - startedAt;
        const button = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setLabel('Watch in TikTok')
                    .setStyle(ButtonStyle.Link)
                    .setURL(urlValue)
            );

        const container = new ContainerBuilder()
            .setAccentColor(0x000000)
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(title)
            )
            .addMediaGalleryComponents(
                new MediaGalleryBuilder().addItems(
                    new MediaGalleryItemBuilder().setURL(`attachment://${fileName}`)
                )
            )
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`Took ${formatElapsed(elapsed)}`)
            )
            .addActionRowComponents(button);

        await interaction.editReply({
            components: [container],
            files: [new AttachmentBuilder(video, { name: fileName })],
            flags: MessageFlags.IsComponentsV2
        });
    }
    catch (error) {
        console.error('tiktok command failed:', error);
        await interaction.editReply({
            content: error instanceof TikTokError
                ? `❌ ${error.message}`
                : '❌ Failed to download that video.'
        });
    }
}

export default { global, data, execute };