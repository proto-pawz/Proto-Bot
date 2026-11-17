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

async function downloadImage(url) {
    const response = await fetch(url);

    if (!response.ok)
        throw new Error(`Failed to download image (${response.status})`);

    return Buffer.from(await response.arrayBuffer());
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
    }

    await interaction.deferReply();

    try {
        const input = await downloadImage(imageUrl);
        const gif = await createSpeechbubble(input);

        await interaction.editReply({
            files: [new AttachmentBuilder(gif, { name: 'speechbubble.gif' })]
        });
    }
    catch (error) {
        console.error('speechbubble command failed:', error);
        await interaction.editReply({
            content: '❌ Failed to create that speech bubble GIF. Make sure the file or URL points directly to a PNG, JPG, WebP, or GIF image.'
        });
    }
}

export default { global, data, execute };