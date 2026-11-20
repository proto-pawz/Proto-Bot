import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ContainerBuilder,
    MessageFlags,
    SeparatorBuilder,
    SeparatorSpacingSize,
    TextDisplayBuilder
} from 'discord.js';

import {
    deleteLastfmSession,
    getLastfmSession,
    isDatabaseConfigured
} from '../../database/lastfm.js';

const LASTFM_EMOJI = '<:lastfm_nobg:1573228913143062690>';
const EPHEMERAL_V2 = MessageFlags.Ephemeral | MessageFlags.IsComponentsV2;
const LASTFM_APPLICATIONS_URL = 'https://www.last.fm/settings/applications';

export const subcommand = subcommand => subcommand
    .setName('logout')
    .setDescription('Disconnect your linked Last.fm account');

function createNotice(content) {
    return {
        components: [
            new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(content)
                )
        ],
        flags: EPHEMERAL_V2,
        allowedMentions: { parse: [] }
    };
}

export async function execute(interaction) {
    if (!isDatabaseConfigured())
        return interaction.reply(createNotice(
            '❌ Last.fm logout is not configured. Add `POSTGRES_URL` to the bot environment.'
        ));

    let session;

    try {
        session = await getLastfmSession(interaction.user.id);
    }
    catch (error) {
        console.error('Last.fm session lookup failed:', error);

        return interaction.reply(createNotice(
            '❌ Could not check your Last.fm connection. Please try again.'
        ));
    }

    if (!session)
        return interaction.reply(createNotice(
            '❌ You do not have a linked Last.fm account.'
        ));

    let removed;

    try {
        removed = await deleteLastfmSession(interaction.user.id);
    }
    catch (error) {
        console.error('Last.fm logout failed:', error);

        return interaction.reply(createNotice(
            '❌ Could not disconnect your Last.fm account. Please try again.'
        ));
    }

    if (!removed)
        return interaction.reply(createNotice(
            '❌ Your Last.fm account was already disconnected.'
        ));

    const username = session.lastfm_username || 'Your Last.fm account';

    const container = new ContainerBuilder()
        .addTextDisplayComponents(
            new TextDisplayBuilder()
                .setContent(`## ${LASTFM_EMOJI} Last.fm disconnected`)
        )
        .addTextDisplayComponents(
            new TextDisplayBuilder()
                .setContent(`**${username}** is no longer connected to Proto Bot.`)
        )
        .addSeparatorComponents(
            new SeparatorBuilder()
                .setDivider(true)
                .setSpacing(SeparatorSpacingSize.Small)
        );

    const button = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setLabel('Manage Last.fm Apps')
                .setStyle(ButtonStyle.Link)
                .setURL(LASTFM_APPLICATIONS_URL)
        );

    container
        .addActionRowComponents(button)
        .addTextDisplayComponents(
            new TextDisplayBuilder()
                .setContent('-# To fully revoke access, remove Proto Bot on Last.fm using the link above.')
        );

    await interaction.reply({
        components: [container],
        flags: EPHEMERAL_V2,
        allowedMentions: { parse: [] }
    });
}

export default { subcommand, execute };
