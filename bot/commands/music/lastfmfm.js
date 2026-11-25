import {
    ContainerBuilder,
    MessageFlags,
    SectionBuilder,
    TextDisplayBuilder,
    ThumbnailBuilder,
    escapeMarkdown
} from 'discord.js';

import {
    getLastfmSession,
    isDatabaseConfigured
} from '../../database/lastfm.js';

const FLAGS = MessageFlags.IsComponentsV2;
const LASTFM_API_URL = 'https://ws.audioscrobbler.com/2.0/';

export const subcommand = subcommand => subcommand
    .setName('fm')
    .setDescription('Show what you or another user is listening to on Last.fm')
    .addStringOption(option => option
        .setName('user')
        .setDescription('The Last.fm username to look up (defaults to your connected account)')
        .setRequired(false)
    );

function createNotice(content) {
    return {
        components: [
            new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(content)
                )
        ],
        flags: FLAGS,
        allowedMentions: { parse: [] }
    };
}

function escapeText(value) {
    return escapeMarkdown(String(value ?? '').replace(/\s+/g, ' ').trim(), {
        heading: true,
        maskedLink: true,
        numberedList: true,
        bulletedList: true
    });
}

function formatNumber(value) {
    return (Number(value) || 0).toLocaleString('en-US');
}

function toArray(value) {
    if (!value)
        return [];

    return Array.isArray(value) ? value : [value];
}

function getLargestImage(images) {
    const list = toArray(images).filter(image => image?.['#text']);

    if (!list.length)
        return null;

    return list[list.length - 1]['#text'];
}

async function lastfmRequest(apiKey, method, username, extra = {}) {
    const url = new URL(LASTFM_API_URL);
    url.searchParams.set('method', method);
    url.searchParams.set('api_key', apiKey);
    url.searchParams.set('user', username);
    url.searchParams.set('format', 'json');

    for (const [key, value] of Object.entries(extra))
        url.searchParams.set(key, String(value));

    const response = await fetch(url);

    if (!response.ok)
        throw new Error(`Last.fm API returned ${response.status}`);

    const data = await response.json();

    if (data.error)
        throw new Error(data.message || 'Last.fm API request failed.');

    return data;
}

function formatTrackUrl(track, artist, title) {
    const fallback = `https://www.last.fm/music/${encodeURIComponent(artist)}/_/${encodeURIComponent(title)}`;
    let url = track.url || fallback;

    try {
        url = new URL(url).toString();
    }
    catch {
        url = fallback;
    }

    return url.replaceAll('(', '%28').replaceAll(')', '%29');
}

function createNowPlayingContainer({ displayName, track, trackUrl, imageUrl, playcount }) {
    const artist = escapeText(track.artist?.['#text'] || 'Unknown Artist');
    const title = escapeText(track.name || 'Unknown Track');
    const album = escapeText(track.album?.['#text'] || 'Unknown Album');
    const nowPlaying = String(track['@attr']?.nowplaying) === 'true';

    const header = [
        `-# ${nowPlaying ? 'Now playing' : 'Last played'} for ${escapeText(displayName)}`,
        `### [${title}](${trackUrl})`,
        `**${artist}** • *${album}*`
    ].join('\n');

    const text = new TextDisplayBuilder().setContent(header);
    const container = new ContainerBuilder().setAccentColor(0xBA0000);

    if (imageUrl) {
        container.addSectionComponents(
            new SectionBuilder()
                .addTextDisplayComponents(text)
                .setThumbnailAccessory(new ThumbnailBuilder().setURL(imageUrl))
        );
    }
    else {
        // A section requires an accessory, so fall back to plain text.
        container.addTextDisplayComponents(text);
    }

    return container.addTextDisplayComponents(
        new TextDisplayBuilder()
            .setContent(`-# ${formatNumber(playcount)} total scrobbles`)
    );
}

export async function execute(interaction) {
    const apiKey = process.env.LASTFM_API_KEY;

    if (!apiKey)
        return interaction.reply(createNotice(
            '❌ Last.fm is not configured. Add `LASTFM_API_KEY` to the bot environment.'
        ));

    const requestedUser = interaction.options.getString('user')?.trim();
    let username = requestedUser;

    if (!username) {
        if (!isDatabaseConfigured())
            return interaction.reply(createNotice(
                '❌ Last.fm is not configured. Add `POSTGRES_URL` or provide a username.'
            ));

        let session;

        try {
            session = await getLastfmSession(interaction.user.id);
        }
        catch (error) {
            console.error('Last.fm fm lookup failed:', error);

            return interaction.reply(createNotice(
                '❌ Could not check your Last.fm connection. Please try again.'
            ));
        }

        if (!session)
            return interaction.reply(createNotice(
                '❌ You do not have a linked Last.fm account. Use `/lastfm login` or provide a username.'
            ));

        username = session.lastfm_username;
    }

    await interaction.deferReply({ flags: FLAGS });

    try {
        const [infoData, recentData] = await Promise.all([
            lastfmRequest(apiKey, 'user.getInfo', username),
            lastfmRequest(apiKey, 'user.getRecentTracks', username, { limit: 1 })
        ]);

        const info = infoData.user ?? {};
        const track = toArray(recentData.recenttracks?.track)[0];

        if (!track)
            return interaction.editReply(createNotice(
                '❌ No recent scrobbles found for that user.'
            ));

        const profileName = info.name || username;
        const displayName = info.realname || profileName;
        const artist = track.artist?.['#text'] || 'Unknown Artist';
        const title = track.name || 'Unknown Track';

        const container = createNowPlayingContainer({
            displayName,
            track,
            trackUrl: formatTrackUrl(track, artist, title),
            imageUrl: getLargestImage(track.image),
            playcount: info.playcount
        });

        await interaction.editReply({
            components: [container],
            flags: FLAGS,
            allowedMentions: { parse: [] }
        });
    }
    catch (error) {
        console.error('Last.fm fm failed:', error);

        await interaction.editReply(createNotice(
            '❌ Could not load that Last.fm profile. Check the username and try again.'
        ));
    }
}

export default { subcommand, execute };
