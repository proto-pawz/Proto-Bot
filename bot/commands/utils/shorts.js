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
    .setName('shorts')
    .setDescription('Download a YouTube Short (up to 3 minutes) and send it as a video embed.')
    .addStringOption(option => option
        .setName('url')
        .setDescription('The YouTube /shorts/ URL to download.')
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

const API_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';
const PLAYER_URL = `https://www.youtube.com/youtubei/v1/player?key=${API_KEY}`;
const USER_AGENT = 'com.google.android.youtube/20.10.38 (Linux; U; Android 13)';
const SHORTS_PATH_PATTERN = /^\/shorts\/([A-Za-z0-9_-]{11})(?:\/|$)/;
const MAX_VIDEO_SECONDS = 180;
const MAX_TITLE_LENGTH = 256;

class ShortsError extends Error { }

function truncate(text, maxLength) {
    if (text.length <= maxLength)
        return text;

    return `${text.slice(0, maxLength - 1)}…`;
}

function extractShortId(value) {
    let url;

    try {
        url = new URL(value);
    }
    catch {
        return null;
    }

    const host = url.hostname.toLowerCase().replace(/^(www\.|m\.)/, '');

    if (host !== 'youtube.com' && host !== 'youtube-nocookie.com')
        return null;

    return SHORTS_PATH_PATTERN.exec(url.pathname)?.[1] ?? null;
}

async function getPlayerResponse(videoId) {
    let response;

    try {
        response = await fetch(PLAYER_URL, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'user-agent': USER_AGENT
            },
            body: JSON.stringify({
                context: {
                    client: {
                        clientName: 'ANDROID',
                        clientVersion: '20.10.38',
                        androidSdkVersion: 35,
                        hl: 'en',
                        gl: 'US'
                    }
                },
                videoId
            })
        });
    }
    catch {
        throw new ShortsError('Could not reach YouTube to look up that video.');
    }

    if (!response.ok)
        throw new ShortsError(`YouTube returned HTTP ${response.status} while looking up that video.`);

    const data = await response.json();

    if (data.playabilityStatus?.status !== 'OK')
        throw new ShortsError(data.playabilityStatus?.reason ?? 'That video is unavailable.');

    return data;
}

function selectFormat(data) {
    const formats = data.streamingData?.formats ?? [];
    const usable = formats
        .filter(format => format.url && format.mimeType?.startsWith('video/mp4'))
        .sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0));

    if (!usable.length)
        throw new ShortsError('That video does not have a downloadable MP4 stream.');

    return usable[0];
}

async function downloadVideo(url) {
    let response;

    try {
        response = await fetch(url, {
            headers: { 'user-agent': USER_AGENT }
        });
    }
    catch {
        throw new ShortsError('Could not reach the video stream.');
    }

    if (!response.ok)
        throw new ShortsError(`Failed to download the video (HTTP ${response.status}).`);

    try {
        return Buffer.from(await response.arrayBuffer());
    }
    catch {
        throw new ShortsError('The video download was interrupted. Please try again.');
    }
}

function formatElapsed(milliseconds) {
    const seconds = Math.floor(milliseconds / 1000);
    const ms = Math.floor(milliseconds % 1000).toString().padStart(3, '0');

    return `${seconds}.${ms}s`;
}

export async function execute(interaction) {
    const urlValue = interaction.options.getString('url', true).trim();
    const videoId = extractShortId(urlValue);

    if (!videoId) {
        return interaction.reply({
            content: 'Please provide a valid YouTube URL with a /shorts/ path.',
            flags: MessageFlags.Ephemeral
        });
    }

    const startedAt = performance.now();

    await interaction.deferReply();

    try {
        const player = await getPlayerResponse(videoId);
        const lengthSeconds = Number(player.videoDetails?.lengthSeconds);

        if (!Number.isFinite(lengthSeconds) || lengthSeconds <= 0)
            throw new ShortsError('Could not determine how long that video is.');

        if (lengthSeconds > MAX_VIDEO_SECONDS)
            throw new ShortsError('That video is longer than 3 minutes. Only Shorts up to 3 minutes are supported.');

        const format = selectFormat(player);
        const video = await downloadVideo(format.url);
        const fileName = 'shorts.mp4';
        const title = truncate(player.videoDetails?.title ?? 'YouTube Short', MAX_TITLE_LENGTH);
        const elapsed = performance.now() - startedAt;
        const button = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setLabel('Watch in YouTube')
                    .setStyle(ButtonStyle.Link)
                    .setURL(urlValue)
            );

        const container = new ContainerBuilder()
            .setAccentColor(0xED4245)
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
        console.error('shorts command failed:', error);
        await interaction.editReply({
            content: error instanceof ShortsError
                ? `❌ ${error.message}`
                : '❌ Failed to download that video.'
        });
    }
}

export default { global, data, execute };