import {
    SlashCommandBuilder,
    ApplicationIntegrationType,
    InteractionContextType
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

export async function execute(interaction) {
    const target = interaction.options.getUser('user');
    const response = responses[Math.floor(Math.random() * responses.length)];

    await interaction.reply({
        content: response(interaction.user, target),
        allowedMentions: { parse: ['users'] }
    });
}

export default { global, data, execute };
