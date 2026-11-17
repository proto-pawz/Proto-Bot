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
    .setName('gif')
    .setDescription('Convert an image into a GIF.')
    .addAttachmentOption(option => option
        .setName('image')
        .setDescription('The PNG, JPG, or WebP image to convert.')
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

async function convertToGif(image) {
    const metadata = await sharp(image, { animated: true }).metadata();
    const options = { loop: metadata.loop ?? 0 };

    if (metadata.pages > 1 && metadata.delay?.length)
        options.delay = metadata.delay;

    return sharp(image, { animated: true })
        .gif(options)
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
        const gif = await convertToGif(input);
        const baseName = path.parse(image.name).name || 'image';
        const fileName = `${baseName}.gif`;

        await interaction.editReply({
            files: [new AttachmentBuilder(gif, { name: fileName })]
        });
    }
    catch (error) {
        console.error('gif command failed:', error);
        await interaction.editReply({
            content: '❌ Failed to convert that image into a GIF.'
        });
    }
}

export default { global, data, execute };
