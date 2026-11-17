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
        .setDescription('The PNG, JPG, or WebP image to use.')
        .setRequired(true)
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

const ALLOWED_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp']);
const MASK_PATH = path.join(import.meta.dirname, 'speechbubble-mask.png');

let maskPromise;

function loadMask() {
    maskPromise ??= readFile(MASK_PATH);
    return maskPromise;
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
    const image = interaction.options.getAttachment('image', true);
    const extension = path.extname(image.name).slice(1).toLowerCase();

    if (!ALLOWED_EXTENSIONS.has(extension)) {
        return interaction.reply({
            content: 'Please upload a PNG, JPG, or WebP image.',
            flags: MessageFlags.Ephemeral
        });
    }

    await interaction.deferReply();

    try {
        const response = await fetch(image.url);

        if (!response.ok)
            throw new Error(`Failed to download image (${response.status})`);

        const input = Buffer.from(await response.arrayBuffer());
        const gif = await createSpeechbubble(input);

        await interaction.editReply({
            files: [new AttachmentBuilder(gif, { name: 'speechbubble.gif' })]
        });
    }
    catch (error) {
        console.error('speechbubble command failed:', error);
        await interaction.editReply({
            content: '❌ Failed to create that speech bubble GIF.'
        });
    }
}

export default { global, data, execute };
