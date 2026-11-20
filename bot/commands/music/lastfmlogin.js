import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ContainerBuilder,
    MessageFlags,
    SeparatorBuilder,
    SeparatorSpacingSize,
    SlashCommandBuilder,
    TextDisplayBuilder,
    ApplicationIntegrationType,
    InteractionContextType
} from 'discord.js';

import {
    createPendingLogin,
    isDatabaseConfigured
} from '../../database/lastfm.js';

import {
    execute as executeLogout,
    subcommand as logoutSubcommand
} from './lastfmlogout.js';

import {
    execute as executeProfile,
    subcommand as profileSubcommand
} from './lastfmprofile.js';

export const global = true;

export const data = new SlashCommandBuilder()
    .setName('lastfm')
    .setDescription('Last.fm commands')
    .addSubcommand(subcommand => subcommand
        .setName('login')
        .setDescription('Connect your Last.fm account')
    )
    .addSubcommand(logoutSubcommand)
    .addSubcommand(profileSubcommand)
    .setIntegrationTypes(
        ApplicationIntegrationType.GuildInstall,
        ApplicationIntegrationType.UserInstall
    )
    .setContexts(
        InteractionContextType.Guild,
        InteractionContextType.BotDM,
        InteractionContextType.PrivateChannel
    );

const LASTFM_EMOJI = '<:lastfm_nobg:1573228913143062690>';
const EPHEMERAL_V2 = MessageFlags.Ephemeral | MessageFlags.IsComponentsV2;

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
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'logout')
        return executeLogout(interaction);

    if (subcommand === 'profile')
        return executeProfile(interaction);

    if (subcommand !== 'login')
        return;

    const apiKey = process.env.LASTFM_API_KEY;
    const callback = process.env.LASTFM_CALLBACK_URL;

    if (!apiKey || !callback || !isDatabaseConfigured())
        return interaction.reply(createNotice(
            '❌ Last.fm login is not configured. Add `LASTFM_API_KEY`, `LASTFM_CALLBACK_URL`, and `POSTGRES_URL` to the bot environment.'
        ));

    let callbackUrl;

    try {
        callbackUrl = new URL(callback);
    }
    catch {
        return interaction.reply(createNotice(
            '❌ `LASTFM_CALLBACK_URL` is not a valid URL.'
        ));
    }

    await interaction.deferReply({ flags: EPHEMERAL_V2 });

    let state;

    try {
        state = await createPendingLogin(interaction.user.id);
    }
    catch (error) {
        console.error('Last.fm pending login failed:', error);

        await interaction.editReply(createNotice(
            '❌ Could not start Last.fm login. Please try again.'
        ));
        return;
    }

    callbackUrl.searchParams.set('state', state);

    const authUrl = new URL('https://www.last.fm/api/auth/');
    authUrl.searchParams.set('api_key', apiKey);
    authUrl.searchParams.set('cb', callbackUrl.toString());

    const container = new ContainerBuilder()
        .addTextDisplayComponents(
            new TextDisplayBuilder()
                .setContent(`## ${LASTFM_EMOJI} Connect your Last.fm`)
        )
        .addTextDisplayComponents(
            new TextDisplayBuilder()
                .setContent('Click Connect Last.fm below and authorize Proto Bot.')
        )
        .addSeparatorComponents(
            new SeparatorBuilder()
                .setDivider(true)
                .setSpacing(SeparatorSpacingSize.Small)
        );

    const button = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setLabel('Connect Last.fm')
                .setEmoji(LASTFM_EMOJI)
                .setStyle(ButtonStyle.Link)
                .setURL(authUrl.toString())
        );

    container
        .addActionRowComponents(button)
        .addTextDisplayComponents(
            new TextDisplayBuilder()
                .setContent('-# Once you authorize, your account will be linked to Proto Bot')
        );

    await interaction.editReply({
        components: [container],
        flags: EPHEMERAL_V2,
        allowedMentions: { parse: [] }
    });
}

export default { global, data, execute };
