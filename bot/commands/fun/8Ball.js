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
    .setName('8ball')
    .setDescription('Ask the 8Ball a question.')
    .addStringOption(option => option
        .setName('question')
        .setDescription('The question you want to ask the 8Ball.')
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

const ANSWERS = [
    ':8ball: | It is certian.',
    ':8ball: | It is decidedly so.',
    ':8ball: | Without a doubt.',
    ':8ball: | Yes definitely.',
    ':8ball: | You may rely on it.',
    ':8ball: | As I see it, yes.',
    ':8ball: | Most likely.',
    ':8ball: | Outlook good.',
    ':8ball: | Yes.',
    ':8ball: | Signs point to yes.',
    ':8ball: | Reply hazy, try again.',
    ':8ball: | Ask again later.',
    ':8ball: | Better not tell you now.',
    ':8ball: | Cannot predict now.',
    ':8ball: | Concentrate and ask again.',
    ':8ball: | Don\'t count on it.',
    ':8ball: | My reply is no.',
    ':8ball: | My sources say no.',
    ':8ball: | Outlook not so good.',
    ':8ball: | Very doubtful.'
];

const FLAGS = MessageFlags.IsComponentsV2;

function createContainer(question, owner, answer = null) {
    const content = [
        `## :8ball: | ${owner}'s 8Ball`,
        '',
        `**Question**\n${question}`
    ];

    if (answer)
        content.push('', `**Answer**\n${answer}`);

    return new ContainerBuilder()
        .setAccentColor(0x0000FF)
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(content.join('\n'))
        )
        .addSeparatorComponents(
            new SeparatorBuilder()
                .setDivider(true)
                .setSpacing(SeparatorSpacingSize.Small)
        );
}

export async function execute(interaction) {
    const question = interaction.options.getString('question', true);
    const owner = interaction.user.displayName ?? interaction.user.username;
    const answer = ANSWERS[Math.floor(Math.random() * ANSWERS.length)];
    const rollButton = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('8ball')
                .setLabel('🎱 Roll!')
                .setStyle(ButtonStyle.Primary)
        );

    const container = createContainer(question, owner);
    container.addActionRowComponents(rollButton);

    const message = await interaction.reply({
        components: [container],
        flags: FLAGS,
        allowedMentions: { parse: [] }
    });

    const collector = message.createMessageComponentCollector();

    collector.on('collect', async button => {
        if (button.customId !== '8ball')
            return;

        await button.update({
            components: [createContainer(question, owner, answer)],
            flags: FLAGS,
            allowedMentions: { parse: [] }
        });
    });
}
