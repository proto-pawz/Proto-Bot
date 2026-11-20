import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ContainerBuilder,
    MessageFlags,
    SectionBuilder,
    SeparatorBuilder,
    SeparatorSpacingSize,
    TextDisplayBuilder,
    ThumbnailBuilder
} from 'discord.js';

import {
    ALBUM_URL,
    SEARCH_URL,
    SpotifyError,
    TRACK_URL,
    escapeText,
    formatReleaseDate,
    getAccessToken,
    getArtists,
    getEmoji
} from './spotifysearch.js';

const PAGE_SIZE = 4;
const COLLECTOR_TIME = 5 * 60 * 1000;
const PREVIOUS_EMOJI_ID = '1265476224742850633';
const NEXT_EMOJI_ID = '1265476229876678768';
const CANCEL_EMOJI_ID = '1317214464231079989';
const ID_PATTERN = /^[A-Za-z0-9]{22}$/;
const SPOTIFY_TRACK_URL = 'https://open.spotify.com/track/';

function extractSpotifyId(value) {
    const uri = value.match(/^spotify:(track|album):([A-Za-z0-9]+)$/i);

    if (uri)
        return { type: uri[1].toLowerCase(), id: uri[2] };

    try {
        const url = new URL(value);

        if (/^(open\.|www\.)?spotify\.com$/.test(url.hostname)) {
            const match = url.pathname.match(/^\/(?:embed\/|intl-[^/]+\/)?(track|album)\/([A-Za-z0-9]+)/);

            if (match)
                return { type: match[1].toLowerCase(), id: match[2] };
        }
    }
    catch { /* EMPTY */ }

    if (ID_PATTERN.test(value))
        return { type: 'album', id: value };

    return null;
}

async function resolveSpotifyId(query) {
    let input = query.trim();

    try {
        const url = new URL(input);

        if (url.hostname === 'spotify.link') {
            const response = await fetch(url, {
                redirect: 'follow',
                signal: AbortSignal.timeout(10000)
            });
            input = response.url;
        }
    }
    catch { /* EMPTY */ }

    return extractSpotifyId(input);
}

async function spotifyFetch(url) {
    const token = await getAccessToken();
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
            : `Spotify returned HTTP ${response.status}.`);
    }

    return response.json();
}

async function getAlbum(id) {
    return spotifyFetch(`${ALBUM_URL}/${encodeURIComponent(id)}`);
}

async function getTrack(id) {
    return spotifyFetch(`${TRACK_URL}/${encodeURIComponent(id)}`);
}

async function searchAlbum(query) {
    const url = new URL(SEARCH_URL);
    url.searchParams.set('q', query);
    url.searchParams.set('type', 'album');
    url.searchParams.set('limit', '1');

    const data = await spotifyFetch(url);
    return data.albums?.items?.[0] ?? null;
}

function getAlbumArtists(album) {
    return album?.artists?.map(artist => artist.name).filter(Boolean).join(', ') || 'Unknown Artist';
}

function getTrackUrl(track) {
    return track.external_urls?.spotify
        ?? (track.id ? `${SPOTIFY_TRACK_URL}${track.id}` : 'https://open.spotify.com');
}

function getLyricsUrl(track) {
    const query = encodeURIComponent(`${track.name ?? ''} ${getArtists(track)}`.trim().slice(0, 200));
    return `https://genius.com/search?q=${query}`;
}

function createHeaderSection(album, trackCount) {
    const cover = album.images?.[0]?.url;
    const section = new SectionBuilder()
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent([
                `**${escapeText(album.name ?? 'Unknown Album')}**`,
                `-# Artist: **${escapeText(getAlbumArtists(album))}**`,
                `-# Released: **${escapeText(formatReleaseDate(album))}**`,
                `-# ${trackCount} ${trackCount === 1 ? 'track' : 'tracks'}`
            ].join('\n'))
        );

    if (cover)
        section.setThumbnailAccessory(new ThumbnailBuilder().setURL(cover));

    return section;
}

function createPaginationRow({ page, lastPage, interactionId, userId, client, disabled = false }) {
    return new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(`sp_aprev_${interactionId}_${page}_${userId}`)
                .setStyle(ButtonStyle.Secondary)
                .setEmoji(getEmoji(client, PREVIOUS_EMOJI_ID, '◀'))
                .setDisabled(disabled || page === 0),
            new ButtonBuilder()
                .setCustomId(`sp_apage_${interactionId}_${page}_${userId}`)
                .setLabel(`${page + 1}/${lastPage + 1}`)
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(disabled),
            new ButtonBuilder()
                .setCustomId(`sp_anext_${interactionId}_${page}_${userId}`)
                .setStyle(ButtonStyle.Secondary)
                .setEmoji(getEmoji(client, NEXT_EMOJI_ID, '▶'))
                .setDisabled(disabled || page === lastPage),
            new ButtonBuilder()
                .setCustomId(`sp_acancel_${interactionId}_${page}_${userId}`)
                .setStyle(ButtonStyle.Danger)
                .setEmoji(getEmoji(client, CANCEL_EMOJI_ID, '🗑️'))
                .setDisabled(disabled)
        );
}

function createPage(album, tracks, page, { client, interactionId, userId, disabled = false }) {
    const lastPage = Math.max(0, Math.ceil(tracks.length / PAGE_SIZE) - 1);
    const pageTracks = tracks.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
    const container = new ContainerBuilder()
        .addSectionComponents(createHeaderSection(album, tracks.length));

    pageTracks.forEach((track, index) => {
        const number = page * PAGE_SIZE + index + 1;

        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `-# ${number}. **${escapeText(track.name ?? 'Unknown Track')}**  •  ${escapeText(getArtists(track))}`
            )
        );

        container.addActionRowComponents(
            new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`sp_listen_${track.id ?? 'unknown'}_${userId}`)
                        .setLabel('Listen')
                        .setStyle(ButtonStyle.Primary)
                        .setDisabled(disabled),
                    new ButtonBuilder()
                        .setCustomId(`sp_lyrics_${track.id ?? 'unknown'}_${userId}`)
                        .setLabel('Lyrics')
                        .setStyle(ButtonStyle.Primary)
                        .setDisabled(disabled)
                )
        );
    });

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

export async function executeAlbum(interaction) {
    const query = interaction.options.getString('query', true)
        .replace(/\s+/g, ' ')
        .trim();

    if (!query)
        return interaction.reply({
            content: 'Please provide an album name or Spotify link.',
            flags: MessageFlags.Ephemeral
        });

    await interaction.deferReply();

    try {
        const target = await resolveSpotifyId(query);
        let album;

        if (target?.type === 'album') {
            album = await getAlbum(target.id);
        }
        else if (target) {
            const track = await getTrack(target.id);
            album = track.album?.id ? await getAlbum(track.album.id) : track.album;
        }
        else {
            album = await searchAlbum(query);
        }

        if (!album)
            return interaction.editReply(createNotice(`No Spotify album found for **${escapeText(query)}**.`));

        const tracks = album.tracks?.items ?? [];
        let page = 0;
        const context = {
            client: interaction.client,
            interactionId: interaction.id,
            userId: interaction.user.id
        };

        await interaction.editReply(createPage(album, tracks, page, context));

        const message = await interaction.fetchReply();
        const collector = message.createMessageComponentCollector({
            time: COLLECTOR_TIME
        });
        const lastPage = Math.max(0, Math.ceil(tracks.length / PAGE_SIZE) - 1);
        const tracksById = new Map(tracks.map(track => [track.id, track]));

        collector.on('collect', async button => {
            try {
                if (button.user.id !== interaction.user.id) {
                    return await button.reply({
                        content: 'Run `/spotify album` to browse your own album.',
                        flags: MessageFlags.Ephemeral
                    });
                }

                const parts = button.customId.split('_');

                if (parts[0] !== 'sp')
                    return await button.deferUpdate();

                const type = parts[1];

                if (type === 'acancel') {
                    collector.stop('cancelled');

                    try {
                        await interaction.deleteReply();
                    }
                    catch {
                        await button.update(createPage(album, tracks, page, {
                            ...context,
                            disabled: true
                        })).catch(() => { });
                        return;
                    }

                    await button.deferUpdate().catch(() => { });
                    return;
                }

                if (type === 'aprev') {
                    if (page > 0)
                        page--;

                    return await button.update(createPage(album, tracks, page, context));
                }

                if (type === 'anext') {
                    if (page < lastPage)
                        page++;

                    return await button.update(createPage(album, tracks, page, context));
                }

                if (type === 'apage')
                    return await button.deferUpdate();

                const track = tracksById.get(parts[2]);

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

                return await button.deferUpdate();
            }
            catch (error) {
                console.error('spotify album button failed:', error);

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
                await interaction.editReply(createPage(album, tracks, page, {
                    ...context,
                    disabled: true
                }));
            }
            catch { /* EMPTY */ }
        });
    }
    catch (error) {
        console.error('spotify album command failed:', error);
        await interaction.editReply({
            content: error instanceof SpotifyError
                ? `❌ ${error.message}`
                : '❌ Failed to browse the Spotify album. Please try again.'
        });
    }
}

export default { executeAlbum };
