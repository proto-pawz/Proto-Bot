import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    SlashCommandBuilder,
    ApplicationIntegrationType,
    InteractionContextType,
    MessageFlags
} from 'discord.js';

export const global = true;

export const data = new SlashCommandBuilder()
    .setName('meow')
    .setDescription('Meow at another user.')
    .addUserOption(option => option
        .setName('user')
        .setDescription('The user you want to meow at.')
        .setRequired(true)
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

const responses = [
    (actor, target) =>
        `${actor} is meowing at ${target}, look at how vocal they are!`,
    (actor, target) =>
        `${actor}, did you just meow? It looks like it got the attention of ${target}`,
    (actor, target) =>
        `I got a question for you ${target}, did you just hear ${actor} meow just now?`,
    (actor, target) =>
        `Hey ${target}, ${actor} is meowing at you for attention`
];

const MEOW_BACK_TIME = 10 * 60 * 1000;

function getResponse() {
    return responses[Math.floor(Math.random() * responses.length)];
}

function createMeowBackButton(customId, disabled = false) {
    return new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(customId)
                .setLabel('🐱 Meow Back!')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(disabled)
        );
}

export async function execute(interaction) {
    const target = interaction.options.getUser('user');
    const customId = `meow_back_${interaction.id}_${interaction.user.id}_${target.id}`;

    await interaction.reply({
        content: getResponse()(interaction.user, target),
        components: [createMeowBackButton(customId)],
        allowedMentions: { parse: ['users'] }
    });

    const message = await interaction.fetchReply();
    const collector = message.createMessageComponentCollector({
        time: MEOW_BACK_TIME
    });
    let used = false;

    collector.on('collect', async button => {
        try {
            if (button.customId !== customId)
                return await button.deferUpdate();

            if (button.user.id !== target.id) {
                return await button.reply({
                    content: `Only ${target} can meow back!`,
                    flags: MessageFlags.Ephemeral,
                    allowedMentions: { parse: ['users'] }
                });
            }

            if (used)
                return await button.deferUpdate();

            used = true;

            await button.deferUpdate();
            await button.message.edit({
                components: [createMeowBackButton(customId, true)]
            }).catch(() => { });
            await button.followUp({
                content: getResponse()(button.user, interaction.user),
                allowedMentions: { parse: ['users'] }
            });

            collector.stop('claimed');
        }
        catch (error) {
            console.error('meow back button failed:', error);

            if (!button.deferred && !button.replied) {
                await button.reply({
                    content: '❌ Something went wrong while meowing back.',
                    flags: MessageFlags.Ephemeral
                }).catch(() => { });
            }
        }
    });

    collector.on('end', async (_, reason) => {
        if (reason === 'claimed' || reason === 'messageDelete')
            return;

        try {
            await interaction.editReply({
                components: [createMeowBackButton(customId, true)]
            });
        }
        catch { /* EMPTY */ }
    });
}

export default { global, data, execute };
