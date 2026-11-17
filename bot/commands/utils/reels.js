import { performance } from 'node:perf_hooks';

import {
    AttachmentBuilder,
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
    .setName('reels')
    .setDescription('Download an Instagram Reel (up to 3 minutes) and send it as a video embed.')
    .addStringOption(option => option
        .setName('url')
        .setDescription('The Instagram Reel URL to download.')
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

const BROWSER_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const CRAWLER_USER_AGENTS = [
    'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)'
];
const INSTAGRAM_HOSTS = new Set([
    'instagram.com',
    'www.instagram.com',
    'm.instagram.com'
]);
const REEL_PATH_PATTERN = /^\/(?:reel|reels)\/([A-Za-z0-9_-]{8,})\/?$/;
const MAX_VIDEO_SECONDS = 180;
const MAX_TITLE_LENGTH = 256;

class ReelsError extends Error { }

function truncate(text, maxLength) {
    if (text.length <= maxLength)
        return text;

    return `${text.slice(0, maxLength - 1)}…`;
}

function parseReelUrl(value) {
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

    if (!INSTAGRAM_HOSTS.has(host))
        return null;

    const match = REEL_PATH_PATTERN.exec(url.pathname);

    if (!match)
        return null;

    return { url, shortcode: match[1] };
}

function parseIsoDuration(value) {
    if (typeof value !== 'string')
        return null;

    const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(value);

    if (!match)
        return null;

    const days = Number(match[1] ?? 0);
    const hours = Number(match[2] ?? 0);
    const minutes = Number(match[3] ?? 0);
    const seconds = Number(match[4] ?? 0);
    const total = days * 86400 + hours * 3600 + minutes * 60 + seconds;

    return Number.isFinite(total) ? total : null;
}

function findMediaObject(value, shortcode) {
    if (!value || typeof value !== 'object')
        return null;

    if (Array.isArray(value)) {
        for (const item of value) {
            const found = findMediaObject(item, shortcode);

            if (found)
                return found;
        }

        return null;
    }

    if (Array.isArray(value.video_versions) && value.video_versions.length) {
        if (!shortcode || !value.code || value.code === shortcode)
            return value;
    }

    for (const child of Object.values(value)) {
        const found = findMediaObject(child, shortcode);

        if (found)
            return found;
    }

    return null;
}

function findMediaData(html, shortcode) {
    const scriptPattern = /<script[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/g;

    for (const match of html.matchAll(scriptPattern)) {
        let data;

        try {
            data = JSON.parse(match[1]);
        }
        catch {
            continue;
        }

        const media = findMediaObject(data, shortcode);

        if (media)
            return media;
    }

    return null;
}

async function getReelData(urlValue, shortcode) {
    let lastError;

    for (const userAgent of CRAWLER_USER_AGENTS) {
        let response;

        try {
            response = await fetch(urlValue, {
                headers: {
                    'user-agent': userAgent,
                    'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'accept-language': 'en-US,en;q=0.9'
                }
            });
        }
        catch {
            lastError = new ReelsError('Could not reach Instagram to look up that Reel.');
            continue;
        }

        if (!response.ok) {
            lastError = new ReelsError(`Instagram returned HTTP ${response.status} while looking up that Reel.`);
            continue;
        }

        const media = findMediaData(await response.text(), shortcode);

        if (media)
            return media;

        lastError = new ReelsError('Could not read the Instagram Reel details.');
    }

    throw lastError ?? new ReelsError('Could not reach Instagram to look up that Reel.');
}

function getDurationFromVideoUrl(value) {
    if (typeof value !== 'string')
        return null;

    try {
        const efg = new URL(value).searchParams.get('efg');

        if (!efg)
            return null;

        const decoded = Buffer.from(efg.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
        const data = JSON.parse(decoded);
        const duration = Number(data.duration_s);

        return Number.isFinite(duration) && duration > 0 ? duration : null;
    }
    catch {
        return null;
    }
}

function getDurationSeconds(media) {
    const manifest = typeof media.video_dash_manifest === 'string' ? media.video_dash_manifest : '';
    const durationMatch = manifest.match(/mediaPresentationDuration="([^"]+)"/);
    const fromManifest = parseIsoDuration(durationMatch?.[1]);

    if (fromManifest !== null)
        return fromManifest;

    const fromMedia = Number(media.video_duration);

    if (Number.isFinite(fromMedia) && fromMedia > 0)
        return fromMedia;

    for (const version of media.video_versions ?? []) {
        const fromUrl = getDurationFromVideoUrl(version?.url);

        if (fromUrl !== null)
            return fromUrl;
    }

    return null;
}

function selectVideoUrls(media) {
    const urls = [];

    for (const version of media.video_versions ?? []) {
        if (typeof version?.url === 'string' && /^https?:\/\//.test(version.url))
            urls.push(version.url);
    }

    const unique = [...new Set(urls)];

    if (!unique.length)
        throw new ReelsError('That Instagram Reel does not have a downloadable MP4 stream.');

    return unique;
}

function looksLikeMp4(buffer) {
    return buffer.subarray(0, 32).includes(Buffer.from('ftyp'));
}

async function downloadVideo(urls) {
    const headerVariants = [
        {
            'user-agent': BROWSER_USER_AGENT,
            'accept': '*/*',
            'referer': 'https://www.instagram.com/'
        },
        {
            'user-agent': CRAWLER_USER_AGENTS[0],
            'accept': '*/*'
        },
        {
            'user-agent': BROWSER_USER_AGENT,
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

    throw new ReelsError('Failed to download the Instagram Reel.');
}

function formatElapsed(milliseconds) {
    const seconds = Math.floor(milliseconds / 1000);
    const ms = Math.floor(milliseconds % 1000).toString().padStart(3, '0');

    return `${seconds}.${ms}s`;
}

export async function execute(interaction) {
    const urlValue = interaction.options.getString('url', true).trim();
    const reelUrl = parseReelUrl(urlValue);

    if (!reelUrl) {
        return interaction.reply({
            content: 'Please provide a valid Instagram Reel URL.',
            flags: MessageFlags.Ephemeral
        });
    }

    const startedAt = performance.now();

    await interaction.deferReply();

    try {
        const media = await getReelData(reelUrl.url.href, reelUrl.shortcode);
        const lengthSeconds = getDurationSeconds(media);

        if (!Number.isFinite(lengthSeconds) || lengthSeconds <= 0)
            throw new ReelsError('Could not determine how long that Reel is.');

        if (lengthSeconds > MAX_VIDEO_SECONDS)
            throw new ReelsError('That video is longer than 3 minutes. Only Reels up to 3 minutes are supported.');

        const video = await downloadVideo(selectVideoUrls(media));
        const fileName = 'reels.mp4';
        const caption = typeof media.caption?.text === 'string' ? media.caption.text.trim() : '';
        const title = truncate(caption || 'Instagram Reel', MAX_TITLE_LENGTH);
        const elapsed = performance.now() - startedAt;
        const container = new ContainerBuilder()
            .setAccentColor(0xEB459E)
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`**${title}**\n<${urlValue}>`)
            )
            .addMediaGalleryComponents(
                new MediaGalleryBuilder().addItems(
                    new MediaGalleryItemBuilder().setURL(`attachment://${fileName}`)
                )
            );

        await interaction.editReply({
            components: [
                new TextDisplayBuilder().setContent(`Look what I found! Took ${formatElapsed(elapsed)}.`),
                container
            ],
            files: [new AttachmentBuilder(video, { name: fileName })],
            flags: MessageFlags.IsComponentsV2
        });
    }
    catch (error) {
        console.error('reels command failed:', error);
        await interaction.editReply({
            content: error instanceof ReelsError
                ? `❌ ${error.message}`
                : '❌ Failed to download that Reel.'
        });
    }
}

export default { global, data, execute };
