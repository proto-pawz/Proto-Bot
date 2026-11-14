import {
    SlashCommandBuilder,
    ApplicationIntegrationType,
    InteractionContextType,
    MessageFlags
} from 'discord.js';

const VOWELS = new Set(['a', 'e', 'i', 'o', 'u', 'A', 'E', 'I', 'O', 'U']);
const MAX_LENGTH = 2000;

export const global = true;

export const data = new SlashCommandBuilder()
    .setName('uwuify')
    .setDescription('Uwuify some text.')
    .addStringOption(option => option
        .setName('text')
        .setDescription('The text you want to uwuify.')
        .setRequired(true)
        .setMaxLength(MAX_LENGTH)
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

function uwuify(text) {
    let result = '';

    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        const lower = char.toLowerCase();

        if (lower === 't' && text[i + 1]?.toLowerCase() === 'h') {
            const replacement = Math.random() < 0.5 ? 'd' : 'f';
            result += char === 'T' ? replacement.toUpperCase() : replacement;
            i++;
            continue;
        }

        if (lower === 'n' && VOWELS.has(text[i + 1])) {
            result += char === 'N' ? 'Ny' : 'ny';
            continue;
        }

        if (lower === 'r' || lower === 'l') {
            result += char === char.toUpperCase() ? 'W' : 'w';
            continue;
        }

        result += char;
    }

    return result;
}

function withTilde(text) {
    let message = text.trim();

    if (message.length > MAX_LENGTH - 1)
        message = message.slice(0, MAX_LENGTH - 1);

    if (!message.endsWith('~'))
        message += '~';

    return message;
}

export async function execute(interaction) {
    const text = interaction.options.getString('text', true).trim();

    if (!text) {
        return interaction.reply({
            content: withTilde(uwuify('Please give me some text to uwuify.')),
            flags: MessageFlags.Ephemeral,
            allowedMentions: { parse: [] }
        });
    }

    await interaction.reply({
        content: withTilde(uwuify(text)),
        allowedMentions: { parse: [] }
    });
}

export default { global, data, execute };