import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    SlashCommandBuilder,
    ApplicationIntegrationType,
    InteractionContextType,
    MessageFlags
} from 'discord.js';

import { database } from '../../database/database.js';

export const global = true;

export const data = new SlashCommandBuilder()
    .setName('cheese')
    .setDescription('Throw a slice of cheese at another user.')
    .addUserOption(option => option
        .setName('user')
        .setDescription('The user you want to throw cheese at.')
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

database.exec('PRAGMA busy_timeout = 5000');
database.exec(`
    CREATE TABLE IF NOT EXISTS cheese_counts (
        user_id TEXT PRIMARY KEY,
        count INTEGER NOT NULL DEFAULT 0
    )
`);

const incrementCheese = database.prepare(`
    INSERT INTO cheese_counts (user_id, count)
    VALUES (?, 1)
    ON CONFLICT (user_id) DO UPDATE
    SET count = count + 1
    RETURNING count
`);

const CHEESE_BACK_TIME = 10 * 60 * 1000;

function createCheeseBackButton(customId, disabled = false) {
    return new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(customId)
                .setLabel('🧀 Cheese Back!')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(disabled)
        );
}

export async function execute(interaction) {
    const target = interaction.options.getUser('user');
    const { count } = incrementCheese.get(target.id);
    const customId = `cheese_back_${interaction.id}_${interaction.user.id}_${target.id}`;

    await interaction.reply({
        content: `${interaction.user} has thrown cheese at ${target}! They have been cheesed ${count} times.`,
        components: [createCheeseBackButton(customId)],
        allowedMentions: { parse: ['users'] }
    });

    const message = await interaction.fetchReply();
    const collector = message.createMessageComponentCollector({
        time: CHEESE_BACK_TIME
    });
    let used = false;

    collector.on('collect', async button => {
        try {
            if (button.customId !== customId)
                return await button.deferUpdate();

            if (button.user.id !== target.id) {
                return await button.reply({
                    content: `Only ${target} can cheese back!`,
                    flags: MessageFlags.Ephemeral,
                    allowedMentions: { parse: ['users'] }
                });
            }

            if (used)
                return await button.deferUpdate();

            used = true;
            const { count: backCount } = incrementCheese.get(interaction.user.id);

            await button.deferUpdate();
            await button.message.edit({
                components: [createCheeseBackButton(customId, true)]
            }).catch(() => { });
            await button.followUp({
                content: `${button.user} has thrown cheese at ${interaction.user}! They have been cheesed ${backCount} times.`,
                allowedMentions: { parse: ['users'] }
            });

            collector.stop('claimed');
        }
        catch (error) {
            console.error('cheese back button failed:', error);

            if (!button.deferred && !button.replied) {
                await button.reply({
                    content: '❌ Something went wrong while cheesing back.',
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
                components: [createCheeseBackButton(customId, true)]
            });
        }
        catch { /* EMPTY */ }
    });
}

export default { global, data, execute };
