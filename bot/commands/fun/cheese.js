import {
    SlashCommandBuilder,
    ApplicationIntegrationType,
    InteractionContextType
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

export async function execute(interaction) {
    const target = interaction.options.getUser('user');
    const { count } = incrementCheese.get(target.id);

    await interaction.reply({
        content: `${interaction.user} has thrown cheese at ${target}! They have been cheesed ${count} times.`,
        allowedMentions: { parse: ['users'] }
    });
}

export default { global, data, execute };
