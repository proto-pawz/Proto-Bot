import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
    AttachmentBuilder,
    SlashCommandBuilder,
    ApplicationIntegrationType,
    InteractionContextType
} from 'discord.js';
import sharp from 'sharp';

export const global = true;

export const data = new SlashCommandBuilder()
    .setName('petpet')
    .setDescription('Turn a user\'s avatar into a petpet GIF.')
    .addUserOption(option => option
        .setName('user')
        .setDescription('The user whose avatar to pet. Defaults to you.')
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

const SIZE = 128;
const FRAMES = 10;
const HAND_CANVAS = 112;
const HAND_PATH = path.join(import.meta.dirname, 'petpet-hand.gif');

let handPromise;

async function loadHand() {
    handPromise ??= (async () => {
        const buffer = await readFile(HAND_PATH);
        const metadata = await sharp(buffer, { animated: true }).metadata();
        const pages = metadata.pages ?? 1;
        const pageHeight = metadata.pageHeight ?? metadata.height;
        const padding = {
            right: Math.max(0, HAND_CANVAS - metadata.width),
            bottom: Math.max(0, HAND_CANVAS - pageHeight),
            background: { r: 0, g: 0, b: 0, alpha: 0 }
        };
        const frames = [];

        for (let page = 0; page < pages; page++) {
            const padded = await sharp(buffer, { page, pages: 1 })
                .extend(padding)
                .png()
                .toBuffer();

            frames.push(await sharp(padded)
                .resize(SIZE, SIZE, { fit: 'fill' })
                .png()
                .toBuffer());
        }

        const delays = metadata.delay ?? [];
        const totalDelay = delays.length
            ? delays.reduce((total, delay) => total + delay, 0)
            : pages * 60;

        return {
            frames,
            delay: Math.max(20, Math.round(totalDelay / FRAMES))
        };
    })();

    return handPromise;
}

async function fetchAvatar(user) {
    const url = user.displayAvatarURL({
        extension: 'png',
        size: 256,
        forceStatic: true
    });

    const response = await fetch(url);
    if (!response.ok)
        throw new Error(`Failed to fetch avatar (${response.status})`);

    return Buffer.from(await response.arrayBuffer());
}

async function createPetpet(avatar) {
    const hand = await loadHand();
    const frames = [];

    for (let i = 0; i < FRAMES; i++) {
        const j = i < FRAMES / 2 ? i : FRAMES - i;

        const width = 0.8 + j * 0.02;
        const height = 0.8 - j * 0.05;
        const offsetX = (1 - width) * 0.5 + 0.1;
        const offsetY = (1 - height) - 0.08;

        const avatarFrame = await sharp(avatar)
            .resize(
                Math.round(SIZE * width),
                Math.round(SIZE * height),
                { fit: 'fill' }
            )
            .png()
            .toBuffer();

        const handIndex = Math.min(
            hand.frames.length - 1,
            Math.floor(i * hand.frames.length / FRAMES)
        );

        frames.push(await sharp({
            create: {
                width: SIZE,
                height: SIZE,
                channels: 4,
                background: { r: 0, g: 0, b: 0, alpha: 0 }
            }
        }).composite([
            {
                input: avatarFrame,
                left: Math.round(SIZE * offsetX),
                top: Math.round(SIZE * offsetY)
            },
            { input: hand.frames[handIndex], left: 0, top: 0 }
        ]).png().toBuffer());
    }

    return sharp(frames, { join: { animated: true } })
        .gif({ delay: Array(FRAMES).fill(hand.delay), loop: 0 })
        .toBuffer();
}

export async function execute(interaction) {
    await interaction.deferReply();

    const user = interaction.options.getUser('user') ?? interaction.user;
    const avatar = await fetchAvatar(user);
    const gif = await createPetpet(avatar);

    await interaction.editReply({
        files: [new AttachmentBuilder(gif, { name: 'petpet.gif' })]
    });
}

export default { global, data, execute };
