import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ContainerBuilder,
    SeparatorBuilder,
    SeparatorSpacingSize,
    SectionBuilder,
    TextDisplayBuilder,
    ThumbnailBuilder,
    SlashCommandBuilder,
    ApplicationIntegrationType,
    InteractionContextType,
    MessageFlags,
    escapeMarkdown
} from 'discord.js';

export const global = true;

export const data = new SlashCommandBuilder()
    .setName('spotify')
    .setDescription('Spotify commands')
    .addSubcommand(subcommand => subcommand
        .setName('search')
        .setDescription('Search for Spotify tracks')
        .addStringOption(option => option
            .setName('query')
            .setDescription('Song name or artist')
            .setRequired(true)
            .setMaxLength(200)
        )
    )
    .addSubcommand(subcommand => subcommand
        .setName('cover')
        .setDescription('Show the album cover art for a Spotify track')
        .addStringOption(option => option
            .setName('query')
            .setDescription('Song name, artist + song, or Spotify URL')
            .setRequired(true)
            .setMaxLength(500)
        )
    )
    .addSubcommand(subcommand => subcommand
        .setName('preview')
        .setDescription('Play a 30s preview of a Spotify track')
        .addStringOption(option => option
            .setName('query')
            .setDescription('Song name, artist + song, or Spotify URL')
            .setRequired(true)
            .setMaxLength(500)
        )
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

const PAGE_SIZE = 4;
const MAX_RESULTS = 10;
const COLLECTOR_TIME = 5 * 60 * 1000;
export const TOKEN_URL = 'https://accounts.spotify.com/api/token';
export const SEARCH_URL = 'https://api.spotify.com/v1/search';
export const TRACK_URL = 'https://api.spotify.com/v1/tracks';
const SPOTIFY_EMOJI_ID = '1274904265114124308';
const PREVIOUS_EMOJI_ID = '1265476224742850633';
const NEXT_EMOJI_ID = '1265476229876678768';
const CANCEL_EMOJI_ID = '1317214464231079989';

export class SpotifyError extends Error { }

let accessToken;
let accessTokenExpiresAt = 0;

function getCredentials() {
    const clientId = process.env.SPOTIFY_CLIENT_ID;
    const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

    if (!clientId || !clientSecret)
        throw new SpotifyError('Spotify credentials are not configured. Add SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET to the bot environment.');

    return { clientId, clientSecret };
}

export async function getAccessToken() {
    if (accessToken && Date.now() < accessTokenExpiresAt)
        return accessToken;

    const { clientId, clientSecret } = getCredentials();
    const response = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: {
            Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({ grant_type: 'client_credentials' }),
        signal: AbortSignal.timeout(10000)
    });

    if (!response.ok)
        throw new SpotifyError('Could not authenticate with Spotify. Check the bot credentials.');

    const token = await response.json();

    if (!token.access_token)
        throw new SpotifyError('Spotify did not return an access token.');

    accessToken = token.access_token;
    accessTokenExpiresAt = Date.now() + Math.max(0, (token.expires_in ?? 3600) - 60) * 1000;

    return accessToken;
}

async function searchTracks(query) {
    const token = await getAccessToken();
    const url = new URL(SEARCH_URL);

    url.searchParams.set('q', query);
    url.searchParams.set('type', 'track');
    url.searchParams.set('limit', String(MAX_RESULTS));

    const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10000)
    });

    if (response.status === 429)
        throw new SpotifyError('Spotify is rate-limiting requests. Please try again in a moment.');

    if (!response.ok) {
        let detail;

        try {
            const error = await response.json();
            detail = error.error?.message;
        }
        catch { /* EMPTY */ }

        throw new SpotifyError(detail
            ? `Spotify returned HTTP ${response.status}: ${detail}`
            : `Spotify returned HTTP ${response.status} while searching.`);
    }

    const result = await response.json();
    return (result.tracks?.items ?? []).filter(Boolean);
}

export function formatReleaseDate(album) {
    const date = album?.release_date;
    const precision = album?.release_date_precision;

    if (!date)
        return 'Unknown';

    const parts = date.split('-').map(Number);

    if (precision === 'year' || parts.length === 1)
        return String(parts[0]);

    if (precision === 'month' || parts.length === 2) {
        return new Intl.DateTimeFormat('en-US', {
            month: 'long',
            year: 'numeric',
            timeZone: 'UTC'
        }).format(new Date(Date.UTC(parts[0], parts[1] - 1, 1)));
    }

    return new Intl.DateTimeFormat('en-US', {
        month: 'long',
        day: '2-digit',
        year: 'numeric',
        timeZone: 'UTC'
    }).format(new Date(Date.UTC(parts[0], parts[1] - 1, parts[2])));
}

export function escapeText(value) {
    return escapeMarkdown(String(value ?? '').replace(/\s+/g, ' ').trim(), {
        heading: true,
        maskedLink: true,
        numberedList: true,
        bulletedList: true
    });
}

export function getArtists(track) {
    return track.artists?.map(artist => artist.name).filter(Boolean).join(', ') || 'Unknown Artist';
}

export function getTrackText(track) {
    return [
        `**${escapeText(track.name ?? 'Unknown Track')}**`,
        `-# Artist: **${escapeText(getArtists(track))}**`,
        `-# Album: **${escapeText(track.album?.name ?? 'Unknown Album')}**`,
        `-# Released: **${escapeText(formatReleaseDate(track.album))}**`
    ].join('\n');
}

function getEmoji(client, id, fallback) {
    const emoji = client?.emojis?.cache?.get(id) ?? client?.application?.emojis?.cache?.get(id);

    if (!emoji)
        return { name: fallback };

    return {
        id: emoji.id,
        name: emoji.name ?? fallback,
        animated: emoji.animated ?? false
    };
}

function formatEmoji(emoji) {
    if (!emoji.id)
        return emoji.name;

    return `<${emoji.animated ? 'a' : ''}:${emoji.name}:${emoji.id}>`;
}

function createTrackSection(track) {
    const section = new SectionBuilder()
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(getTrackText(track))
        );

    const thumbnail = track.album?.images?.[0]?.url;

    if (thumbnail)
        section.setThumbnailAccessory(new ThumbnailBuilder().setURL(thumbnail));

    return section;
}

function createTrackButtons(track, userId, disabled = false) {
    const trackId = track.id ?? 'unknown';
    const albumId = track.album?.id ?? 'unknown';

    return new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(`sp_listen_${trackId}_${userId}`)
                .setLabel('Listen')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(disabled),
            new ButtonBuilder()
                .setCustomId(`sp_lyrics_${trackId}_${userId}`)
                .setLabel('Lyrics')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(disabled),
            new ButtonBuilder()
                .setCustomId(`sp_album_${albumId}_${trackId}_${userId}`)
                .setLabel('Album')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(disabled)
        );
}

function createPaginationRow({ page, lastPage, interactionId, userId, client, disabled = false }) {
    return new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(`sp_prev_${interactionId}_${userId}`)
                .setStyle(ButtonStyle.Secondary)
                .setEmoji(getEmoji(client, PREVIOUS_EMOJI_ID, '◀'))
                .setDisabled(disabled || page === 0),
            new ButtonBuilder()
                .setCustomId(`sp_page_${interactionId}_${userId}`)
                .setLabel(`${page + 1}/${lastPage + 1}`)
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(disabled),
            new ButtonBuilder()
                .setCustomId(`sp_next_${interactionId}_${userId}`)
                .setStyle(ButtonStyle.Secondary)
                .setEmoji(getEmoji(client, NEXT_EMOJI_ID, '▶'))
                .setDisabled(disabled || page === lastPage),
            new ButtonBuilder()
                .setCustomId(`sp_cancel_${interactionId}_${userId}`)
                .setStyle(ButtonStyle.Danger)
                .setEmoji(getEmoji(client, CANCEL_EMOJI_ID, '🗑️'))
                .setDisabled(disabled)
        );
}

function createPage(query, tracks, page, { client, interactionId, userId, disabled = false }) {
    const lastPage = Math.max(0, Math.ceil(tracks.length / PAGE_SIZE) - 1);
    const pageTracks = tracks.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
    const spotifyEmoji = getEmoji(client, SPOTIFY_EMOJI_ID, '🎵');
    const container = new ContainerBuilder()
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`### ${formatEmoji(spotifyEmoji)} Results for ${escapeText(query)}`)
        )
        .addSeparatorComponents(
            new SeparatorBuilder()
                .setDivider(true)
                .setSpacing(SeparatorSpacingSize.Small)
        );

    for (const track of pageTracks) {
        const thumbnail = track.album?.images?.[0]?.url;

        if (thumbnail) {
            container.addSectionComponents(createTrackSection(track));
        }
        else {
            container.addTextDisplayComponents(
                new TextDisplayBuilder().setContent(getTrackText(track))
            );
        }

        container.addActionRowComponents(createTrackButtons(track, userId, disabled));
    }

    container
        .addSeparatorComponents(
            new SeparatorBuilder()
                .setDivider(true)
                .setSpacing(SeparatorSpacingSize.Small)
        )
        .addActionRowComponents(createPaginationRow({
            page,
            lastPage,
            interactionId,
            userId,
            client,
            disabled
        }));

    return {
        components: [container],
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [] }
    };
}

function createNotice(content) {
    return {
        components: [
            new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(content)
                )
        ],
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [] }
    };
}

function getTrackUrl(track) {
    return track.external_urls?.spotify
        ?? (track.id ? `https://open.spotify.com/track/${track.id}` : 'https://open.spotify.com');
}

function getAlbumUrl(track) {
    return track.album?.external_urls?.spotify
        ?? (track.album?.id ? `https://open.spotify.com/album/${track.album.id}` : 'https://open.spotify.com');
}

function getLyricsUrl(track) {
    const query = encodeURIComponent(`${track.name ?? ''} ${getArtists(track)}`.trim().slice(0, 200));
    return `https://genius.com/search?q=${query}`;
}

export async function execute(interaction) {
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'cover') {
        const { executeCover } = await import('./spotifycover.js');
        return executeCover(interaction);
    }

    if (subcommand === 'preview') {
        const { executePreview } = await import('./spotifypreview.js');
        return executePreview(interaction);
    }

    if (subcommand !== 'search')
        return;

    const query = interaction.options.getString('query', true).replace(/\s+/g, ' ').trim();

    if (!query) {
        return interaction.reply({
            content: 'Please provide a song, artist, or album to search for.',
            flags: MessageFlags.Ephemeral
        });
    }

    try {
        getCredentials();
    }
    catch (error) {
        return interaction.reply({
            content: `❌ ${error.message}`,
            flags: MessageFlags.Ephemeral
        });
    }

    await interaction.deferReply();

    try {
        const tracks = await searchTracks(query);
        const spotifyEmoji = getEmoji(interaction.client, SPOTIFY_EMOJI_ID, '🎵');

        if (!tracks.length) {
            return interaction.editReply(createNotice(
                `### ${formatEmoji(spotifyEmoji)} Results for ${escapeText(query)}\nNo Spotify tracks found.`
            ));
        }

        let page = 0;
        const context = {
            client: interaction.client,
            interactionId: interaction.id,
            userId: interaction.user.id
        };

        await interaction.editReply(createPage(query, tracks, page, context));

        const message = await interaction.fetchReply();
        const collector = message.createMessageComponentCollector({
            time: COLLECTOR_TIME
        });
        const lastPage = Math.max(0, Math.ceil(tracks.length / PAGE_SIZE) - 1);
        const trackById = new Map(tracks.map(track => [track.id, track]));
        const previousId = `sp_prev_${interaction.id}_${interaction.user.id}`;
        const pageId = `sp_page_${interaction.id}_${interaction.user.id}`;
        const nextId = `sp_next_${interaction.id}_${interaction.user.id}`;
        const cancelId = `sp_cancel_${interaction.id}_${interaction.user.id}`;

        collector.on('collect', async button => {
            try {
                if (button.user.id !== interaction.user.id) {
                    return await button.reply({
                        content: 'Run `/spotify search` to start your own search.',
                        flags: MessageFlags.Ephemeral
                    });
                }

                if (button.customId === cancelId) {
                    collector.stop('cancelled');

                    try {
                        await interaction.deleteReply();
                    }
                    catch {
                        await button.update(createPage(query, tracks, page, {
                            ...context,
                            disabled: true
                        })).catch(() => { });
                        return;
                    }

                    await button.deferUpdate().catch(() => { });
                    return;
                }

                if (button.customId === previousId) {
                    if (page > 0)
                        page--;

                    return await button.update(createPage(query, tracks, page, context));
                }

                if (button.customId === nextId) {
                    if (page < lastPage)
                        page++;

                    return await button.update(createPage(query, tracks, page, context));
                }

                if (button.customId === pageId)
                    return await button.deferUpdate();

                const parts = button.customId.split('_');

                if (parts[0] !== 'sp')
                    return await button.deferUpdate();

                const type = parts[1];
                const trackId = type === 'album' ? parts[3] : parts[2];
                const track = trackById.get(trackId);

                if (!track)
                    return await button.deferUpdate();

                if (type === 'listen') {
                    return await button.reply({
                        content: `🎧 Listen to **${escapeText(track.name ?? 'Unknown Track')}** on Spotify:\n<${getTrackUrl(track)}>`,
                        flags: MessageFlags.Ephemeral,
                        allowedMentions: { parse: [] }
                    });
                }

                if (type === 'lyrics') {
                    return await button.reply({
                        content: `📝 Lyrics for **${escapeText(track.name ?? 'Unknown Track')}**:\n<${getLyricsUrl(track)}>`,
                        flags: MessageFlags.Ephemeral,
                        allowedMentions: { parse: [] }
                    });
                }

                if (type === 'album') {
                    return await button.reply({
                        content: `💿 **${escapeText(track.album?.name ?? 'Unknown Album')}** by **${escapeText(getArtists(track))}**:\n<${getAlbumUrl(track)}>`,
                        flags: MessageFlags.Ephemeral,
                        allowedMentions: { parse: [] }
                    });
                }

                return await button.deferUpdate();
            }
            catch (error) {
                console.error('spotify search button failed:', error);

                if (!button.deferred && !button.replied) {
                    await button.reply({
                        content: '❌ Something went wrong while handling that button.',
                        flags: MessageFlags.Ephemeral
                    }).catch(() => { });
                }
            }
        });

        collector.on('end', async (_, reason) => {
            if (reason === 'cancelled' || reason === 'messageDelete')
                return;

            try {
                await interaction.editReply(createPage(query, tracks, page, {
                    ...context,
                    disabled: true
                }));
            }
            catch { /* EMPTY */ }
        });
    }
    catch (error) {
        console.error('spotify search command failed:', error);

        const message = error instanceof SpotifyError
            ? error.message
            : 'Failed to search Spotify. Please try again.';

        await interaction.editReply(createNotice(`### ❌ Spotify Search\n${escapeText(message)}`));
    }
}

export default { global, data, execute };
