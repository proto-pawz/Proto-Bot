import {
    SlashCommandBuilder,
    EmbedBuilder,
    ApplicationIntegrationType,
    InteractionContextType
} from 'discord.js';

export const global = true;

export const data = new SlashCommandBuilder()
    .setName('coinflip')
    .setDescription('Flip a coin: heads or tails?')
    .setIntegrationTypes(
        ApplicationIntegrationType.GuildInstall,
        ApplicationIntegrationType.UserInstall
    )
    .setContexts(
        InteractionContextType.Guild,
        InteractionContextType.BotDM,
        InteractionContextType.PrivateChannel
    );

export async function execute(interaction) {
    const heads = Math.random() < 0.5;
    const result = heads ? 'Heads' : 'Tails';

    const displayName =
        interaction.member?.displayName ?? interaction.user.displayName;
    const where = interaction.inGuild()
        ? `in ${interaction.guild.name}`
        : 'in a DM';

    const embed = new EmbedBuilder()
        .setColor(heads ? 0xF1C40F : 0x95A5A6)
        .setTitle('🪙 Coinflip')
        .setDescription(`The coin landed on **${result}**!`)
        .setFooter({ text: `Flipped by ${displayName} ${where}` })
        .setTimestamp();

    await interaction.reply({ embeds: [embed] });
}

export default { global, data, execute };