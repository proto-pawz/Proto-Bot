import { MessageFlags } from 'discord.js';

import {
    buildPage,
    fetchPage
} from '../../../../commands/music/lastfmalbums.js';

/**
 * Handles the "jump to page" modal for /lastfm albums.
 * @param {import('discord.js').ModalSubmitInteraction} interaction
 * @param {object} data
 * @param {object} data.state
 */
export async function execute(interaction, data) {
    const { state } = data;

    if (interaction.user.id !== state.userId) {
        return interaction.reply({
            content: '❌ Run `/lastfm albums` to browse your own results.',
            flags: MessageFlags.Ephemeral
        });
    }

    const input = interaction.fields.getTextInputValue('page').trim();
    const page = Number(input);

    if (!Number.isInteger(page) || page < 1 || page > state.lastPage + 1) {
        return interaction.reply({
            content: `❌ Enter a page number between 1 and ${state.lastPage + 1}.`,
            flags: MessageFlags.Ephemeral
        });
    }

    try {
        state.page = page - 1;
        await fetchPage(state);

        await interaction.deferUpdate();
        await interaction.editReply(buildPage(state));
    }
    catch (error) {
        console.error('Last.fm albums jump failed:', error);

        if (!interaction.deferred && !interaction.replied) {
            await interaction.reply({
                content: '❌ Could not load that page. Please try again.',
                flags: MessageFlags.Ephemeral
            });
        }
    }
}

export default { execute };
