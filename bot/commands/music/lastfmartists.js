import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ContainerBuilder,
    MessageFlags,
    ModalBuilder,
    SeparatorBuilder,
    SeparatorSpacingSize,
    TextDisplayBuilder,
    TextInputBuilder,
    TextInputStyle,
    escapeMarkdown
} from 'discord.js';

import {
    getLastfmSession,
    isDatabaseConfigured
} from '../../database/lastfm.js';

import { getEmoji } from './spotifysearch.js';

const FLAGS = MessageFlags.IsComponentsV2;
const LASTFM_API_URL = 'https://ws.audioscrobbler.com/2.0/';
const PAGE_SIZE = 10;
const COLLECTOR_TIME = 5 * 60 * 1000;

export const subcommand = subcommand => subcommand
    .setName('artists')
    .setDescription('Show the top artists on Last.fm')
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

function formatArtistUrl(artist, name) {
    const fallback = `https://www.last.fm/music/${encodeURIComponent(name)}`;
    let url = artist.url || fallback;

    try {
        url = new URL(url).toString();
    }
    catch {
        url = fallback;
    }

    return url.replaceAll('(', '%28').replaceAll(')', '%29');
}

export async function fetchPage(state) {
    const data = await lastfmRequest(
        process.env.LASTFM_API_KEY,
        'user.getTopArtists',
        state.username,
        { limit: PAGE_SIZE, page: state.page + 1 }
    );

    const topArtists = data.topartists ?? {};
    const attr = topArtists['@attr'] ?? {};
    const totalPages = Number(attr.totalPages);

    state.artists = toArray(topArtists.artist);
    state.totalArtists = Number(attr.total) || state.artists.length;
    state.lastPage = Math.max(0, (
        Number.isFinite(totalPages) && totalPages > 0
            ? totalPages
            : Math.ceil(state.totalArtists / PAGE_SIZE)
    ) - 1);

    if (state.page > state.lastPage) {
        state.page = state.lastPage;
        await fetchPage(state);
    }
}

function createPaginationRow(state, client, disabled) {
    const { ids } = state;
    const firstPage = state.page === 0;
    const lastPage = state.page >= state.lastPage;

    return new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(ids.first)
                .setEmoji(getEmoji(client, '883825508633182208', '⏮️'))
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(disabled || firstPage),
            new ButtonBuilder()
                .setCustomId(ids.previous)
                .setEmoji(getEmoji(client, '883825508507336704', '◀️'))
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(disabled || firstPage),
            new ButtonBuilder()
                .setCustomId(ids.next)
                .setEmoji(getEmoji(client, '883825508087922739', '▶️'))
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(disabled || lastPage),
            new ButtonBuilder()
                .setCustomId(ids.last)
                .setEmoji(getEmoji(client, '883825508482183258', '⏭️'))
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(disabled || lastPage),
            new ButtonBuilder()
                .setCustomId(ids.jump)
                .setEmoji(getEmoji(client, '1138849626234036264', '🔢'))
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(disabled)
        );
}

function separator() {
    return new SeparatorBuilder()
        .setDivider(true)
        .setSpacing(SeparatorSpacingSize.Small);
}

export function buildPage(state) {
    const lines = state.artists.map((artist, index) => {
        const name = artist.name ?? 'Unknown Artist';

        return [
            `${state.page * PAGE_SIZE + index + 1}.`,
            `**[${escapeText(name)}](${formatArtistUrl(artist, name)})**`,
            `- *${formatNumber(artist.playcount)} plays*`
        ].join(' ');
    });

    const container = new ContainerBuilder()
        .setAccentColor(0xBA0000);

    container
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `### Top overall artists for ${escapeText(state.displayName)}`
            )
        )
        .addSeparatorComponents(separator())
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                lines.length ? lines.join('\n') : 'No top artists found.'
            )
        )
        .addSeparatorComponents(separator())
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `-# Page ${state.page + 1}/${state.lastPage + 1} - ${formatNumber(state.totalArtists)} different artists`
            )
        )
        .addActionRowComponents(createPaginationRow(state, state.client, state.disabled));

    return {
        components: [container],
        flags: FLAGS,
        allowedMentions: { parse: [] }
    };
}

function createJumpModal(state) {
    return new ModalBuilder()
        .setCustomId(state.client.bot.createId({
            module: 'lastfmartists.js',
            state
        }))
        .setTitle('Jump to page')
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('page')
                    .setLabel(`Page number (1-${state.lastPage + 1})`)
                    .setPlaceholder('1')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
            )
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
            console.error('Last.fm artists lookup failed:', error);

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
        const infoData = await lastfmRequest(apiKey, 'user.getInfo', username);
        const info = infoData.user ?? {};
        const prefix = `lfm-artists:${interaction.id}:${interaction.user.id}:`;

        const state = {
            client: interaction.client,
            userId: interaction.user.id,
            username,
            displayName: info.realname || info.name || username,
            page: 0,
            lastPage: 0,
            totalArtists: 0,
            artists: [],
            disabled: false,
            ids: {
                first: `${prefix}first`,
                previous: `${prefix}previous`,
                next: `${prefix}next`,
                last: `${prefix}last`,
                jump: `${prefix}jump`
            }
        };

        await fetchPage(state);
        await interaction.editReply(buildPage(state));

        const message = await interaction.fetchReply();
        const actions = Object.values(state.ids);
        const collector = message.createMessageComponentCollector({
            filter: component =>
                component.user.id === interaction.user.id &&
                actions.includes(component.customId),
            time: COLLECTOR_TIME
        });

        collector.on('collect', async button => {
            try {
                const action = button.customId.slice(prefix.length);

                if (action === 'jump')
                    return await button.showModal(createJumpModal(state));

                if (action === 'first')
                    state.page = 0;

                if (action === 'previous')
                    state.page = Math.max(0, state.page - 1);

                if (action === 'next')
                    state.page = Math.min(state.lastPage, state.page + 1);

                if (action === 'last')
                    state.page = state.lastPage;

                await fetchPage(state);
                await button.update(buildPage(state));
            }
            catch (error) {
                console.error('Last.fm artists button failed:', error);

                if (!button.deferred && !button.replied) {
                    await button.reply({
                        content: '❌ Something went wrong while handling that button.',
                        flags: MessageFlags.Ephemeral
                    }).catch(() => { });
                }
            }
        });

        collector.on('end', async (_, reason) => {
            if (reason === 'messageDelete')
                return;

            state.disabled = true;

            try {
                await interaction.editReply(buildPage(state));
            }
            catch { /* EMPTY */ }
        });
    }
    catch (error) {
        console.error('Last.fm artists failed:', error);

        await interaction.editReply(createNotice(
            '❌ Could not load those Last.fm artists. Check the username and try again.'
        ));
    }
}

export default { subcommand, execute };
