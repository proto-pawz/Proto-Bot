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

export const global = true;

export const data = new SlashCommandBuilder()
    .setName('lastfm')
    .setDescription('Last.fm commands')
    .addSubcommand(subcommand => subcommand
        .setName('login')
        .setDescription('Connect your Last.fm account')
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
    if (interaction.options.getSubcommand() !== 'login')
        return;

    const apiKey = process.env.LASTFM_API_KEY;
    const callback = process.env.LASTFM_CALLBACK_URL;

    if (!apiKey || !callback)
        return interaction.reply(createNotice(
            '❌ Last.fm login is not configured. Add `LASTFM_API_KEY` and `LASTFM_CALLBACK_URL` to the bot environment.'
        ));

    const authUrl = new URL('https://www.last.fm/api/auth/');
    authUrl.searchParams.set('api_key', apiKey);
    authUrl.searchParams.set('cb', callback);

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

    const note = new TextDisplayBuilder()
        .setContent('-# Once you authorize, your account will be linked to Proto Bot');

    await interaction.reply({
        components: [container, button, note],
        flags: EPHEMERAL_V2,
        allowedMentions: { parse: [] }
    });
}

export default { global, data, execute };
