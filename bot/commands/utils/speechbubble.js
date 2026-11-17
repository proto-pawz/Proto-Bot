import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
    AttachmentBuilder,
    SlashCommandBuilder,
    ApplicationIntegrationType,
    InteractionContextType,
    MessageFlags
} from 'discord.js';
import sharp from 'sharp';

export const global = true;

export const data = new SlashCommandBuilder()
    .setName('speechbubble')
    .setDescription('Add a transparent speech bubble to an image.')
    .addAttachmentOption(option => option
        .setName('image')
        .setDescription('The PNG, JPG, WebP, or GIF image to use.')
        .setRequired(false)
    )
    .addStringOption(option => option
        .setName('url')
        .setDescription('An image URL to use instead of an attachment.')
        .setMaxLength(2048)
        .setRequired(false)
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

const ALLOWED_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif']);
const MASK_PATH = path.join(import.meta.dirname, 'speechbubble-mask.png');

class ImageFetchError extends Error { }

let maskPromise;

function loadMask() {
    maskPromise ??= readFile(MASK_PATH);
    return maskPromise;
}

function isPrivateHostname(hostname) {
    const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();

    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local'))
        return true;

    if (host.includes(':')) {
        if (host.startsWith('::ffff:'))
            return isPrivateHostname(host.slice(7));

        if (host === '::1' || host === '::' || host.startsWith('fc') || host.startsWith('fd')
            || host.startsWith('fe8') || host.startsWith('fe9')
            || host.startsWith('fea') || host.startsWith('feb'))
            return true;
    }

    const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);

    if (!match)
        return false;

    const octets = match.slice(1).map(Number);

    if (octets.some(octet => octet > 255))
        return true;

    const [a, b] = octets;

    return a === 0
        || a === 10
        || a === 127
        || (a === 169 && b === 254)
        || (a === 172 && b >= 16 && b <= 31)
        || (a === 192 && b === 168);
}

function parseImageUrl(value) {
    let url;

    try {
        url = new URL(value);
    }
    catch {
        return null;
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:')
        return null;

    if (isPrivateHostname(url.hostname))
        return null;

    return url;
}

function isDiscordCdnUrl(url) {
    const host = url.hostname.toLowerCase();
    const pathname = url.pathname;

    return (host === 'cdn.discordapp.com' || host === 'media.discordapp.net')
        && (pathname.startsWith('/attachments/') || pathname.startsWith('/ephemeral-attachments/'));
}

async function refreshDiscordUrl(client, url) {
    try {
        const data = await client.rest.post('/attachments/refresh-urls', {
            body: { attachment_urls: [url] },
            auth: true
        });
        const refreshed = data?.refreshed_urls?.[0]?.refreshed;

        return typeof refreshed === 'string' ? refreshed : url;
    }
    catch (error) {
        console.error('Failed to refresh Discord CDN URL:', error);
        return url;
    }
}

async function downloadImage(url) {
    let response;

    try {
        response = await fetch(url);
    }
    catch {
        throw new ImageFetchError('Could not reach that image URL. Make sure it is a valid, public, direct image link.');
    }

    if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
            throw new ImageFetchError(
                `The image host refused access (HTTP ${response.status}). The link may be private, expired, or missing its access parameters.`
            );
        }

        if (response.status === 404) {
            throw new ImageFetchError(
                'The image was not found (HTTP 404). The link may be expired, deleted, or missing its access parameters.'
            );
        }

        if (response.status === 429)
            throw new ImageFetchError('The image host is rate-limiting requests (HTTP 429). Please try again later.');

        throw new ImageFetchError(`The image host returned HTTP ${response.status}.`);
    }

    try {
        return Buffer.from(await response.arrayBuffer());
    }
    catch {
        throw new ImageFetchError('The image download was interrupted. Please try again.');
    }
}

async function resizeMask(width, height, mask) {
    return sharp(mask)
        .resize(width, height, { fit: 'fill' })
        .png()
        .toBuffer();
}

async function createSpeechbubble(image) {
    const mask = await loadMask();
    const metadata = await sharp(image, { animated: true }).metadata();
    const pages = metadata.pages ?? 1;
    const width = metadata.width;
    const height = metadata.pageHeight ?? metadata.height;

    if (!width || !height)
        throw new Error('Failed to read image dimensions');

    const resizedMask = await resizeMask(width, height, mask);

    if (pages === 1) {
        return sharp(image)
            .ensureAlpha()
            .composite([{ input: resizedMask, blend: 'dest-in' }])
            .gif({ loop: metadata.loop ?? 0 })
            .toBuffer();
    }

    const frames = [];

    for (let page = 0; page < pages; page++) {
        frames.push(await sharp(image, { page, pages: 1 })
            .ensureAlpha()
            .composite([{ input: resizedMask, blend: 'dest-in' }])
            .png()
            .toBuffer());
    }

    const delay = metadata.delay?.length === pages
        ? metadata.delay
        : Array(pages).fill(100);

    return sharp(frames, { join: { animated: true } })
        .gif({ delay, loop: metadata.loop ?? 0 })
        .toBuffer();
}

export async function execute(interaction) {
    const image = interaction.options.getAttachment('image');
    const urlValue = interaction.options.getString('url');

    if (!image && !urlValue) {
        return interaction.reply({
            content: 'Please provide an image attachment or an image URL.',
            flags: MessageFlags.Ephemeral
        });
    }

    if (image && urlValue) {
        return interaction.reply({
            content: 'Please provide either an image attachment or a URL, not both.',
            flags: MessageFlags.Ephemeral
        });
    }

    let imageUrl;
    let shouldRefreshUrl = false;

    if (image) {
        const extension = path.extname(image.name).slice(1).toLowerCase();

        if (!ALLOWED_EXTENSIONS.has(extension)) {
            return interaction.reply({
                content: 'Please upload a PNG, JPG, WebP, or GIF image.',
                flags: MessageFlags.Ephemeral
            });
        }

        imageUrl = image.url;
    }
    else {
        const url = parseImageUrl(urlValue);

        if (!url) {
            return interaction.reply({
                content: 'Please provide a valid HTTP or HTTPS image URL.',
                flags: MessageFlags.Ephemeral
            });
        }

        imageUrl = url.href;
        shouldRefreshUrl = isDiscordCdnUrl(url);
    }

    await interaction.deferReply();

    try {
        if (shouldRefreshUrl)
            imageUrl = await refreshDiscordUrl(interaction.client, imageUrl);

        const input = await downloadImage(imageUrl);
        const gif = await createSpeechbubble(input);

        await interaction.editReply({
            files: [new AttachmentBuilder(gif, { name: 'speechbubble.gif' })]
        });
    }
    catch (error) {
        console.error('speechbubble command failed:', error);
        await interaction.editReply({
            content: error instanceof ImageFetchError
                ? `❌ ${error.message}`
                : '❌ Could not convert that file or URL. Make sure it is a valid PNG, JPG, WebP, or GIF image.'
        });
    }
}

export default { global, data, execute };