import {
    ActionRowBuilder,
    AttachmentBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    MessageFlags
} from 'discord.js';

import {
    SEARCH_URL,
    SpotifyError,
    TRACK_URL,
    escapeText,
    getAccessToken,
    getArtists,
    getTrackText
} from './spotifysearch.js';

const EMBED_COLOR = 13883121;
const TRACK_ID_PATTERN = /^[A-Za-z0-9]{22}$/;
const SPOTIFY_TRACK_URL = 'https://open.spotify.com/track/';

function extractTrackId(value) {
    const uri = value.match(/^spotify:track:([A-Za-z0-9]+)$/i);

    if (uri)
        return uri[1];

    try {
        const url = new URL(value);

        if (/^(open\.|www\.)?spotify\.com$/.test(url.hostname)) {
            const match = url.pathname.match(/^\/(?:embed\/|intl-[^/]+\/)?track\/([A-Za-z0-9]+)/);

            if (match)
                return match[1];
        }
    }
    catch { /* EMPTY */ }

    if (TRACK_ID_PATTERN.test(value))
        return value;

    return null;
}

async function resolveTrackId(query) {
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

    return extractTrackId(input);
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

async function getTrack(trackId) {
    return spotifyFetch(`${TRACK_URL}/${encodeURIComponent(trackId)}`);
}

async function searchTrack(query) {
    const url = new URL(SEARCH_URL);
    url.searchParams.set('q', query);
    url.searchParams.set('type', 'track');
    url.searchParams.set('limit', '1');

    const data = await spotifyFetch(url);
    return data.tracks?.items?.[0] ?? null;
}

async function getPreviewUrl(track) {
    if (track.preview_url)
        return track.preview_url;

    // Spotify no longer returns preview_url from the Web API for most tracks,
    // but the public track page still exposes it through its og:audio meta tag.
    const pageUrl = track.external_urls?.spotify ?? `${SPOTIFY_TRACK_URL}${track.id}`;
    const response = await fetch(pageUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Proto-Bot)' },
        signal: AbortSignal.timeout(10000)
    });

    if (!response.ok)
        return null;

    const html = await response.text();
    const match = html.match(/<meta\s+property="og:audio"\s+content="([^"]+)"/);
    return match?.[1] ?? null;
}

async function downloadPreview(url) {
    const response = await fetch(url, {
        signal: AbortSignal.timeout(30000)
    });

    if (!response.ok)
        throw new SpotifyError('Could not download the Spotify preview audio.');

    return Buffer.from(await response.arrayBuffer());
}

function createAudioFileName(track, artists) {
    const base = `${track.name ?? 'Spotify Preview'} - ${artists}`;
    const safe = base
        .replace(/[\u0000-\u001F<>:"\\|?*]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 100);

    // Discord sanitizes spaces in uploaded filenames to underscores while
    // preserving the original name as the attachment title.
    return `${safe || 'spotify-preview'}.mp3`;
}

export async function executePreview(interaction) {
    const query = interaction.options.getString('query', true)
        .replace(/\s+/g, ' ')
        .trim();

    if (!query)
        return interaction.reply({
            content: 'Please provide a song name or Spotify track link.',
            flags: MessageFlags.Ephemeral
        });

    await interaction.deferReply();

    try {
        const trackId = await resolveTrackId(query);
        const track = trackId ? await getTrack(trackId) : await searchTrack(query);

        if (!track)
            return interaction.editReply({
                content: `No Spotify track found for **${escapeText(query)}**.`
            });

        const previewUrl = await getPreviewUrl(track);

        if (!previewUrl)
            return interaction.editReply({
                content: `No 30s preview is available for **${escapeText(track.name ?? 'this track')}**.`
            });

        const audio = await downloadPreview(previewUrl);
        const artists = getArtists(track);
        const album = track.album;
        const cover = album?.images?.[0]?.url;
        const spotifyUrl = track.external_urls?.spotify ?? `${SPOTIFY_TRACK_URL}${track.id}`;
        const embed = new EmbedBuilder()
            .setColor(EMBED_COLOR)
            .setDescription(`${getTrackText(track)}\n-# 30s preview`);

        if (cover)
            embed.setThumbnail(cover);

        const button = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setLabel('Open on Spotify')
                    .setEmoji({ id: '1274904265114124308', name: 'spotify' })
                    .setStyle(ButtonStyle.Link)
                    .setURL(spotifyUrl)
            );

        await interaction.editReply({
            files: [new AttachmentBuilder(audio, { name: createAudioFileName(track, artists) })],
            embeds: [embed],
            components: [button],
            allowedMentions: { parse: [] }
        });
    }
    catch (error) {
        console.error('spotify preview command failed:', error);
        await interaction.editReply({
            content: error instanceof SpotifyError
                ? `❌ ${error.message}`
                : '❌ Failed to fetch the Spotify preview. Please try again.'
        });
    }
}

export default { executePreview };
