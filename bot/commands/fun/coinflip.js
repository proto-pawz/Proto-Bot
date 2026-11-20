import {
    ActionRowBuilder,
    ApplicationIntegrationType,
    ButtonBuilder,
    ButtonStyle,
    ContainerBuilder,
    InteractionContextType,
    MessageFlags,
    SeparatorBuilder,
    SeparatorSpacingSize,
    SlashCommandBuilder,
    TextDisplayBuilder
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
const FLAGS = MessageFlags.IsComponentsV2;

function flip() {
    const heads = Math.random() < 0.5;

    return {
        heads,
        letter: heads ? 'H' : 'T',
        result: heads ? 'Heads' : 'Tails'
    };
}

function createContainer(interaction, flips) {
    const { heads, result } = flips[flips.length - 1];

    const displayName =
        interaction.member?.displayName
        ?? interaction.user?.displayName
        ?? interaction.user?.username
        ?? 'there';
    const button = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('coinflip')
                .setLabel('🪙 Flip Again!')
                .setStyle(ButtonStyle.Primary)
        );

    return new ContainerBuilder()
        .setAccentColor(heads ? 0xF1C40F : 0x95A5A6)
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent('## 🪙 Coinflip'),
            new TextDisplayBuilder().setContent(`The coin landed on **${result}**!`),
            new TextDisplayBuilder()
                .setContent(`**History**\n${flips.map(f => f.letter).join(', ')}`)
        )
        .addSeparatorComponents(
            new SeparatorBuilder()
                .setDivider(true)
                .setSpacing(SeparatorSpacingSize.Small)
        )
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`-# Played by ${displayName}`)
        )
        .addActionRowComponents(button);
}

export async function execute(interaction) {
    const flips = [flip()];

    await interaction.reply({
        components: [createContainer(interaction, flips)],
        flags: FLAGS,
        allowedMentions: { parse: [] }
    });

    const msg = await interaction.fetchReply();
    const collector = msg.createMessageComponentCollector();

    collector.on('collect', async i => {
        if (i.customId !== 'coinflip') return;

        flips.push(flip());
        if (flips.length > HISTORY_LENGTH) flips.shift();

        await i.update({
            components: [createContainer(interaction, flips)],
            flags: FLAGS,
            allowedMentions: { parse: [] }
        });
    });
}

export default { global, data, execute };
