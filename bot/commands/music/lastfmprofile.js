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
    getLastfmSession,
    isDatabaseConfigured
} from '../../database/lastfm.js';

const LASTFM_EMOJI = '<:lastfm_nobg:1573228913143062690>';
const FLAGS = MessageFlags.IsComponentsV2;
const LASTFM_API_URL = 'https://ws.audioscrobbler.com/2.0/';
const COLLECTOR_TIMEOUT_MS = 120_000;

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

function formatEstimatedDuration(plays) {
    const minutes = Math.round((Number(plays) || 0) * 3.5);
    const days = Math.floor(minutes / 1440);
    const hours = Math.floor((minutes % 1440) / 60);
    const remainingMinutes = minutes % 60;
    const parts = [];

    if (days)
        parts.push(`${days} day${days === 1 ? '' : 's'}`);

    if (hours)
        parts.push(`${hours} hour${hours === 1 ? '' : 's'}`);

    if (remainingMinutes)
        parts.push(`${remainingMinutes} minute${remainingMinutes === 1 ? '' : 's'}`);

    return parts.join(', ') || '0 minutes';
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

async function getRecentMonths(apiKey, username) {
    const now = new Date();
    const months = [];

    for (let offset = 0; offset < 6; offset++) {
        const start = new Date(Date.UTC(
            now.getUTCFullYear(),
            now.getUTCMonth() - offset,
            1
        ));
        const end = new Date(Date.UTC(
            now.getUTCFullYear(),
            now.getUTCMonth() - offset + 1,
            1
        ));

        const data = await lastfmRequest(apiKey, 'user.getRecentTracks', username, {
            from: Math.floor(start.getTime() / 1000),
            to: Math.floor(end.getTime() / 1000) - 1,
            limit: 1
        });

        months.push({
            name: start.toLocaleString('en-US', {
                month: 'long',
                timeZone: 'UTC'
            }),
            plays: Number(data.recenttracks?.['@attr']?.total) || 0
        });
    }

    return months;
}

function createNavigationRow({ userId, profileName, profileUrl, view }) {
    const suffix = profileName.slice(0, 32);
    const historyId = `lastfm-history:${userId}:${suffix}`;
    const profileId = `lastfm-profile:${userId}:${suffix}`;

    const navigationButton = view === 'profile'
        ? new ButtonBuilder()
            .setCustomId(historyId)
            .setLabel('📖 History')
            .setStyle(ButtonStyle.Primary)
        : new ButtonBuilder()
            .setCustomId(profileId)
            .setLabel('ℹ️ Profile')
            .setStyle(ButtonStyle.Primary);

    const row = new ActionRowBuilder()
        .addComponents(navigationButton);

    row.addComponents(
        new ButtonBuilder()
            .setLabel('Last.fm')
            .setEmoji(LASTFM_EMOJI)
            .setStyle(ButtonStyle.Link)
            .setURL(profileUrl)
    );

    return { row, historyId, profileId };
}

function addHeader(container, content, imageUrl) {
    const text = new TextDisplayBuilder().setContent(content);

    if (imageUrl) {
        const section = new SectionBuilder()
            .addTextDisplayComponents(text)
            .setThumbnailAccessory(new ThumbnailBuilder().setURL(imageUrl));

        container.addSectionComponents(section);
    }
    else {
        // A section requires an accessory, so use a plain text display when
        // the profile has no avatar image.
        container.addTextDisplayComponents(text);
    }

    return container;
}

function separator() {
    return new SeparatorBuilder()
        .setDivider(true)
        .setSpacing(SeparatorSpacingSize.Small);
}

function createProfileContainer(context) {
    const { row } = createNavigationRow({ ...context, view: 'profile' });

    const container = addHeader(
        new ContainerBuilder().setAccentColor(0xBA0000),
        context.header,
        context.imageUrl
    );

    container
        .addSeparatorComponents(separator())
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(context.counts)
        )
        .addSeparatorComponents(separator())
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(context.averages)
        )
        .addSeparatorComponents(separator())
        .addTextDisplayComponents(
            new TextDisplayBuilder()
                .setContent(`-# ${formatNumber(context.friendTotal)} friends on Last.fm`)
        )
        .addActionRowComponents(row);

    return container;
}

function createHistoryContainer(context) {
    const { row } = createNavigationRow({ ...context, view: 'history' });

    const historyHeader = [
        `## ${LASTFM_EMOJI} ${context.displayName}'s history`,
        `**${formatNumber(context.playcount)}** scrobbles`,
        context.registered > 0 ? `Since <t:${context.registered}:D>` : null
    ]
        .filter(Boolean)
        .join('\n');

    const historyLines = context.months.map(month =>
        `**\`${month.name}\`** - **${formatNumber(month.plays)}** plays - ${formatEstimatedDuration(month.plays)}`
    );

    const historyText = [
        '**Recent months**',
        ...(historyLines.length ? historyLines : ['No recent scrobbles found.'])
    ].join('\n');

    const container = addHeader(
        new ContainerBuilder().setAccentColor(0xBA0000),
        historyHeader,
        context.imageUrl
    );

    container
        .addSeparatorComponents(separator())
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(historyText)
        )
        .addSeparatorComponents(separator())
        .addTextDisplayComponents(
            new TextDisplayBuilder()
                .setContent('-# Listening times are estimates based on play counts.')
        )
        .addActionRowComponents(row);

    return container;
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
        const [infoData, artistsData, albumsData, tracksData, friendsData, months] = await Promise.all([
            lastfmRequest(apiKey, 'user.getInfo', username),
            lastfmRequest(apiKey, 'user.getTopArtists', username, { limit: 10 }),
            lastfmRequest(apiKey, 'user.getTopAlbums', username, { limit: 1 }),
            lastfmRequest(apiKey, 'user.getTopTracks', username, { limit: 1 }),
            lastfmRequest(apiKey, 'user.getFriends', username, { limit: 1 }).catch(() => null),
            getRecentMonths(apiKey, username).catch(() => [])
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

        const context = {
            userId: interaction.user.id,
            profileName,
            displayName,
            profileUrl,
            imageUrl: getLargestImage(info.image),
            playcount,
            registered,
            friendTotal,
            months,
            header: [
                `## ${LASTFM_EMOJI} ${displayName}`,
                `**${formatNumber(playcount)}** scrobbles`,
                registered > 0 ? `Since <t:${registered}:D>` : null
            ]
                .filter(Boolean)
                .join('\n'),
            counts: [
                `**${formatNumber(trackTotal)}** different tracks`,
                `**${formatNumber(albumTotal)}** different albums`,
                `**${formatNumber(artistTotal)}** different artists`
            ].join('\n'),
            averages: [
                `Average of **${formatDecimal(averagePerDay)}** scrobbles per day`,
                `Average of **${formatDecimal(albumsPerArtist)}** albums and **${formatDecimal(tracksPerArtist)}** tracks per artist`,
                `Top **10** artists make up **${topPercent}%** of scrobbles`
            ].join('\n')
        };

        const profileContainer = createProfileContainer(context);
        const historyContainer = createHistoryContainer(context);

        const { historyId, profileId } = createNavigationRow({ ...context, view: 'profile' });

        const message = await interaction.editReply({
            components: [profileContainer],
            flags: FLAGS,
            allowedMentions: { parse: [] }
        });

        const collector = message.createMessageComponentCollector({
            filter: component =>
                component.user.id === interaction.user.id &&
                (component.customId === historyId || component.customId === profileId),
            time: COLLECTOR_TIMEOUT_MS
        });

        collector.on('collect', async component => {
            try {
                await component.deferUpdate();

                await component.editReply({
                    components: [
                        component.customId === historyId
                            ? historyContainer
                            : profileContainer
                    ],
                    flags: FLAGS,
                    allowedMentions: { parse: [] }
                });
            }
            catch (error) {
                console.error('Last.fm profile navigation failed:', error);
            }
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