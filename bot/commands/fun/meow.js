import {
    SlashCommandBuilder,
    ApplicationIntegrationType,
    InteractionContextType
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

export async function execute(interaction) {
    const target = interaction.options.getUser('user');
    const response = responses[Math.floor(Math.random() * responses.length)];

    await interaction.reply({
        content: response(interaction.user, target),
        allowedMentions: { parse: ['users'] }
    });
}

export default { global, data, execute };
