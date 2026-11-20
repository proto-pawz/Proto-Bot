import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ContainerBuilder,
    MediaGalleryBuilder,
    MediaGalleryItemBuilder,
    MessageFlags,
    SeparatorBuilder,
    SeparatorSpacingSize,
    TextDisplayBuilder
} from 'discord.js';

import {
    SEARCH_URL,
    SpotifyError,
    TRACK_URL,
    escapeText,
    getAccessToken,
    getArtists
} from './spotifysearch.js';

const ACCENT_COLOR = 4868705;
const ALBUM_URL = 'https://api.spotify.com/v1/albums';
const SPOTIFY_TRACK_URL = 'https://open.spotify.com/track/';
const SPOTIFY_ALBUM_URL = 'https://open.spotify.com/album/';
const ID_PATTERN = /^[A-Za-z0-9]{22}$/;

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
        return { type: 'track', id: value };

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

async function getTrack(id) {
    return spotifyFetch(`${TRACK_URL}/${encodeURIComponent(id)}`);
}

async function getAlbum(id) {
    return spotifyFetch(`${ALBUM_URL}/${encodeURIComponent(id)}`);
}

async function searchTrack(query) {
    const url = new URL(SEARCH_URL);
    url.searchParams.set('q', query);
    url.searchParams.set('type', 'track');
    url.searchParams.set('limit', '1');

    const data = await spotifyFetch(url);
    return data.tracks?.items?.[0] ?? null;
}

function getAlbumArtists(album) {
    return album?.artists?.map(artist => artist.name).filter(Boolean).join(', ') || 'Unknown Artist';
}

export async function executeCover(interaction) {
    const query = interaction.options.getString('query', true)
        .replace(/\s+/g, ' ')
        .trim();

    if (!query)
        return interaction.reply({
            content: 'Please provide a song name or Spotify link.',
            flags: MessageFlags.Ephemeral
        });

    await interaction.deferReply();

    try {
        const target = await resolveSpotifyId(query);
        let track = null;
        let album;
        let spotifyUrl;

        if (target?.type === 'album') {
            album = await getAlbum(target.id);
            spotifyUrl = album.external_urls?.spotify ?? `${SPOTIFY_ALBUM_URL}${album.id}`;
        }
        else if (target) {
            track = await getTrack(target.id);
            album = track.album;
            spotifyUrl = track.external_urls?.spotify ?? `${SPOTIFY_TRACK_URL}${track.id}`;
        }
        else {
            track = await searchTrack(query);

            if (!track)
                return interaction.editReply({
                    content: `No Spotify track found for **${escapeText(query)}**.`
                });

            album = track.album;
            spotifyUrl = track.external_urls?.spotify ?? `${SPOTIFY_TRACK_URL}${track.id}`;
        }

        const cover = album?.images?.[0]?.url;

        if (!cover)
            return interaction.editReply({
                content: 'No cover art is available for this album.'
            });

        const title = track?.name ?? album?.name ?? 'Unknown';
        const artists = track ? getArtists(track) : getAlbumArtists(album);
        const description = [
            `**${escapeText(title)}**`,
            `-# Artist: **${escapeText(artists)}**`,
            `-# Album: **${escapeText(album?.name ?? 'Unknown Album')}**`
        ].join('\n');

        const container = new ContainerBuilder()
            .setAccentColor(ACCENT_COLOR)
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(description)
            )
            .addSeparatorComponents(
                new SeparatorBuilder()
                    .setDivider(true)
                    .setSpacing(SeparatorSpacingSize.Small)
            )
            .addMediaGalleryComponents(
                new MediaGalleryBuilder()
                    .addItems(
                        new MediaGalleryItemBuilder().setURL(cover)
                    )
            );

        const button = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setLabel('Open on Spotify')
                    .setEmoji({ id: '1274904265114124308', name: 'spotify' })
                    .setStyle(ButtonStyle.Link)
                    .setURL(spotifyUrl)
            );

        await interaction.editReply({
            components: [container, button],
            flags: MessageFlags.IsComponentsV2,
            allowedMentions: { parse: [] }
        });
    }
    catch (error) {
        console.error('spotify cover command failed:', error);
        await interaction.editReply({
            content: error instanceof SpotifyError
                ? `❌ ${error.message}`
                : '❌ Failed to fetch the Spotify cover art. Please try again.'
        });
    }
}

export default { executeCover };
