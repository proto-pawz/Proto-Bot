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
    .setName('hug')
    .setDescription('Hug another user.')
    .addUserOption(option => option
        .setName('user')
        .setDescription('The user you want to hug.')
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
        `${actor} and ${target} is hugging, look at how wholesome that is!`,
    (actor, target) =>
        `Woah, look over there; A wild sighting of ${actor} and ${target} hugging, get the camera!`,
    (actor, target) =>
        `Would you look at that, ${actor} and ${target} are hugging in front of everyone!`,
    (actor, target) =>
        `Jeez, ${actor} and ${target} are showing off how good they are at hugging one another!`
];

const HUG_BACK_TIME = 10 * 60 * 1000;

function getResponse() {
    return responses[Math.floor(Math.random() * responses.length)];
}

function createHugBackButton(customId, disabled = false) {
    return new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(customId)
                .setLabel('🫂 Hug Back!')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(disabled)
        );
}

export async function execute(interaction) {
    const target = interaction.options.getUser('user');
    const customId = `hug_back_${interaction.id}_${interaction.user.id}_${target.id}`;

    await interaction.reply({
        content: getResponse()(interaction.user, target),
        components: [createHugBackButton(customId)],
        allowedMentions: { parse: ['users'] }
    });

    const message = await interaction.fetchReply();
    const collector = message.createMessageComponentCollector({
        time: HUG_BACK_TIME
    });
    let used = false;

    collector.on('collect', async button => {
        try {
            if (button.customId !== customId)
                return await button.deferUpdate();

            if (button.user.id !== target.id) {
                return await button.reply({
                    content: `Only ${target} can hug back!`,
                    flags: MessageFlags.Ephemeral,
                    allowedMentions: { parse: ['users'] }
                });
            }

            if (used)
                return await button.deferUpdate();

            used = true;

            await button.deferUpdate();
            await button.message.edit({
                components: [createHugBackButton(customId, true)]
            }).catch(() => { });
            await button.followUp({
                content: getResponse()(button.user, interaction.user),
                allowedMentions: { parse: ['users'] }
            });

            collector.stop('claimed');
        }
        catch (error) {
            console.error('hug back button failed:', error);

            if (!button.deferred && !button.replied) {
                await button.reply({
                    content: '❌ Something went wrong while hugging back.',
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
                components: [createHugBackButton(customId, true)]
            });
        }
        catch { /* EMPTY */ }
    });
}

export default { global, data, execute };
