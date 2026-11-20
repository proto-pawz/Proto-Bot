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
    getLastfmSession,
    isDatabaseConfigured
} from '../../database/lastfm.js';

const LASTFM_EMOJI = '<:lastfm_nobg:1573228913143062690>';
const FLAGS = MessageFlags.IsComponentsV2;
const LASTFM_API_URL = 'https://ws.audioscrobbler.com/2.0/';

export const subcommand = subcommand => subcommand
    .setName('profile')
    .setDescription('Show Last.fm statistics for you or another user')
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

function toArray(value) {
    if (!value)
        return [];

    return Array.isArray(value) ? value : [value];
}

function formatNumber(value) {
    return (Number(value) || 0).toLocaleString('en-US');
}

function formatDecimal(value) {
    return (Number(value) || 0)
        .toLocaleString('en-US', {
            minimumFractionDigits: 1,
            maximumFractionDigits: 1
        })
        .replace('.', ',');
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

function getTotal(response, key, fallbackItems) {
    const attr = response?.[key]?.['@attr'];
    const total = Number(attr?.total);

    if (Number.isFinite(total))
        return total;

    return toArray(fallbackItems).length;
}

function getLargestImage(images) {
    const list = toArray(images).filter(image => image?.['#text']);

    if (!list.length)
        return null;

    return list[list.length - 1]['#text'];
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
                '❌ Last.fm profile is not configured. Add `POSTGRES_URL` or provide a username.'
            ));

        let session;

        try {
            session = await getLastfmSession(interaction.user.id);
        }
        catch (error) {
            console.error('Last.fm profile lookup failed:', error);

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
        const [infoData, artistsData, albumsData, tracksData, friendsData] = await Promise.all([
            lastfmRequest(apiKey, 'user.getInfo', username),
            lastfmRequest(apiKey, 'user.getTopArtists', username, { limit: 10 }),
            lastfmRequest(apiKey, 'user.getTopAlbums', username, { limit: 1 }),
            lastfmRequest(apiKey, 'user.getTopTracks', username, { limit: 1 }),
            lastfmRequest(apiKey, 'user.getFriends', username, { limit: 1 }).catch(() => null)
        ]);

        const info = infoData.user ?? {};
        const profileName = info.name || username;
        const displayName = info.realname || profileName;
        const playcount = Number(info.playcount) || 0;
        const registeredRaw = info.registered?.unixtime ?? info.registered;
        const registered = Number(registeredRaw) || 0;
        const profileUrl = `https://www.last.fm/user/${encodeURIComponent(profileName)}`;

        const artists = toArray(artistsData.topartists?.artist);
        const artistTotal = getTotal(artistsData, 'topartists', artists);
        const albumTotal = getTotal(albumsData, 'topalbums', albumsData.topalbums?.album);
        const trackTotal = getTotal(tracksData, 'toptracks', tracksData.toptracks?.track);
        const friendTotal = getTotal(friendsData ?? {}, 'friends', friendsData?.friends?.user);

        const topTenPlays = artists.reduce(
            (sum, artist) => sum + (Number(artist.playcount) || 0),
            0
        );

        const topPercent = playcount > 0
            ? Math.min(100, Math.round((topTenPlays / playcount) * 100))
            : 0;

        const days = registered > 0
            ? Math.max(1, Math.floor((Date.now() / 1000 - registered) / 86_400))
            : 1;

        const averagePerDay = playcount / days;
        const albumsPerArtist = artistTotal > 0 ? albumTotal / artistTotal : 0;
        const tracksPerArtist = artistTotal > 0 ? trackTotal / artistTotal : 0;

        const header = [
            `## ${LASTFM_EMOJI} ${displayName}`,
            `**${formatNumber(playcount)}** scrobbles`,
            registered > 0 ? `Since <t:${registered}:D>` : null
        ]
            .filter(Boolean)
            .join('\n');

        const counts = [
            `**${formatNumber(trackTotal)}** different tracks`,
            `**${formatNumber(albumTotal)}** different albums`,
            `**${formatNumber(artistTotal)}** different artists`
        ].join('\n');

        const averages = [
            `Average of **${formatDecimal(averagePerDay)}** scrobbles per day`,
            `Average of **${formatDecimal(albumsPerArtist)}** albums and **${formatDecimal(tracksPerArtist)}** tracks per artist`,
            `Top **10** artists make up **${topPercent}%** of scrobbles`
        ].join('\n');

        const imageUrl = getLargestImage(info.image);

        const container = new ContainerBuilder()
            .setAccentColor(0xBA0000);

        if (imageUrl)
            container.addMediaGalleryComponents(
                new MediaGalleryBuilder().addItems(
                    new MediaGalleryItemBuilder().setURL(imageUrl)
                )
            );

        container
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(header)
            )
            .addSeparatorComponents(
                new SeparatorBuilder()
                    .setDivider(true)
                    .setSpacing(SeparatorSpacingSize.Small)
            )
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(counts)
            )
            .addSeparatorComponents(
                new SeparatorBuilder()
                    .setDivider(true)
                    .setSpacing(SeparatorSpacingSize.Small)
            )
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(averages)
            )
            .addSeparatorComponents(
                new SeparatorBuilder()
                    .setDivider(true)
                    .setSpacing(SeparatorSpacingSize.Small)
            )
            .addTextDisplayComponents(
                new TextDisplayBuilder()
                    .setContent(`-# ${formatNumber(friendTotal)} friends on Last.fm`)
            );

        const button = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setLabel('Last.fm')
                    .setEmoji(LASTFM_EMOJI)
                    .setStyle(ButtonStyle.Link)
                    .setURL(profileUrl)
            );

        container.addActionRowComponents(button);

        await interaction.editReply({
            components: [container],
            flags: FLAGS,
            allowedMentions: { parse: [] }
        });
    }
    catch (error) {
        console.error('Last.fm profile failed:', error);

        await interaction.editReply(createNotice(
            '❌ Could not load that Last.fm profile. Check the username and try again.'
        ));
    }
}

export default { subcommand, execute };