import {
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
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

const HISTORY_LENGTH = 10;

function flip() {
    const heads = Math.random() < 0.5;

    return {
        heads,
        letter: heads ? 'H' : 'T',
        result: heads ? 'Heads' : 'Tails'
    };
}

function createEmbed(interaction, flips) {
    const { heads, result } = flips[flips.length - 1];

    const displayName =
        interaction.member?.displayName ?? interaction.user.displayName;
    const where = interaction.inGuild()
        ? `in ${interaction.guild.name}`
        : 'in a DM';

    return new EmbedBuilder()
        .setColor(heads ? 0xF1C40F : 0x95A5A6)
        .setTitle('🪙 Coinflip')
        .setDescription(`The coin landed on **${result}**!`)
        .addFields({
            name: 'History',
            value: flips.map(f => f.letter).join(', ')
        })
        .setFooter({ text: `Flipped by ${displayName} ${where}` })
        .setTimestamp();
}

export async function execute(interaction) {
    const flips = [flip()];

    const button = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('coinflip')
                .setLabel('🪙 Flip Again!')
                .setStyle(ButtonStyle.Primary)
        );

    await interaction.reply({
        embeds: [createEmbed(interaction, flips)],
        components: [button]
    });

    const msg = await interaction.fetchReply();
    const collector = msg.createMessageComponentCollector();

    collector.on('collect', async i => {
        if (i.customId !== 'coinflip') return;

        flips.push(flip());
        if (flips.length > HISTORY_LENGTH) flips.shift();

        await i.update({ embeds: [createEmbed(interaction, flips)] });
    });
}

export default { global, data, execute };
