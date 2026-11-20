import {
    SlashCommandBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ContainerBuilder,
    MessageFlags,
    SeparatorBuilder,
    SeparatorSpacingSize,
    TextDisplayBuilder,
    ApplicationIntegrationType,
    InteractionContextType
} from 'discord.js';

export const global = true;

export const data = new SlashCommandBuilder()
    .setName('blackjack')
    .setDescription('Play a hand of blackjack against The Dealer.')
    .setIntegrationTypes(
        ApplicationIntegrationType.GuildInstall,
        ApplicationIntegrationType.UserInstall
    )
    .setContexts(
        InteractionContextType.Guild,
        InteractionContextType.BotDM,
        InteractionContextType.PrivateChannel
    );

const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

function cardValue(rank) {
    if (rank === 'A') return 11;
    if (rank === 'K' || rank === 'Q' || rank === 'J') return 10;
    return Number(rank);
}

function createDeck() {
    const deck = [];

    for (const suit of SUITS) {
        for (const rank of RANKS)
            deck.push({ rank, suit, value: cardValue(rank) });
    }

    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }

    return deck;
}

function handValue(hand) {
    let total = hand.reduce((sum, card) => sum + card.value, 0);
    let aces = hand.filter(card => card.value === 11).length;

    while (total > 21 && aces > 0) {
        total -= 10;
        aces--;
    }

    return total;
}

function formatHand(hand) {
    return hand.map(card => `${card.rank}${card.suit}`).join(', ');
}

export async function execute(interaction) {
    const displayName =
        interaction.member?.displayName
        ?? interaction.user?.displayName
        ?? interaction.user?.username
        ?? 'there';
    let deck;
    let playerHand;
    let dealerHand;
    let finished;

    function startRound() {
        deck = createDeck();
        playerHand = [deck.pop(), deck.pop()];
        dealerHand = [deck.pop(), deck.pop()];
        finished = false;

        if (handValue(playerHand) === 21 || handValue(dealerHand) === 21)
            finishRound();
    }

    function finishRound() {
        finished = true;

        if (handValue(playerHand) > 21) return;

        while (handValue(dealerHand) < 17)
            dealerHand.push(deck.pop());
    }

    function getOutcome() {
        const playerTotal = handValue(playerHand);
        const dealerTotal = handValue(dealerHand);
        const playerBlackjack = playerHand.length === 2 && playerTotal === 21;
        const dealerBlackjack = dealerHand.length === 2 && dealerTotal === 21;

        if (playerTotal > 21)
            return { text: '💥 You busted! The Dealer wins.', color: 0xED4245 };
        if (dealerTotal > 21)
            return { text: '🎉 The Dealer busted! You win!', color: 0x57F287 };
        if (playerBlackjack && dealerBlackjack)
            return { text: '🤝 You both have blackjack — push!', color: 0xFEE75C };
        if (playerBlackjack)
            return { text: '🎉 Blackjack! You win!', color: 0x57F287 };
        if (dealerBlackjack)
            return { text: '💀 The Dealer has blackjack! You lose.', color: 0xED4245 };
        if (playerTotal > dealerTotal)
            return { text: '🎉 You win!', color: 0x57F287 };
        if (playerTotal < dealerTotal)
            return { text: '💀 The Dealer wins.', color: 0xED4245 };
        return { text: '🤝 It\'s a push!', color: 0xFEE75C };
    }

    function buildContainer() {
        const playerTotal = handValue(playerHand);
        const dealerCards = finished
            ? formatHand(dealerHand)
            : `${dealerHand[0].rank}${dealerHand[0].suit}, ❓`;
        const dealerTotal = finished ? `**${handValue(dealerHand)}**` : '**?**';
        const { text, color } = finished
            ? getOutcome()
            : { text: 'Hit or stand?', color: 0x5865F2 };

        return new ContainerBuilder()
            .setAccentColor(color)
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent('## 🃏 Blackjack'),
                new TextDisplayBuilder().setContent(`**You** vs **The Dealer**\n\n${text}`),
                new TextDisplayBuilder().setContent([
                    `**Your Hand**\n${formatHand(playerHand)} (**${playerTotal}**)`,
                    `**The Dealer**\n${dealerCards} (${dealerTotal})`
                ].join('\n'))
            )
            .addSeparatorComponents(
                new SeparatorBuilder()
                    .setDivider(true)
                    .setSpacing(SeparatorSpacingSize.Small)
            )
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`-# Played by ${displayName}`)
            )
            .addActionRowComponents(buildButtons());
    }

    function buildButtons() {
        if (finished) {
            return new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('blackjack_again')
                        .setLabel('🔄 Play Again')
                        .setStyle(ButtonStyle.Primary)
                );
        }

        return new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('blackjack_hit')
                    .setLabel('🃏 Hit')
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId('blackjack_stand')
                    .setLabel('✋ Stand')
                    .setStyle(ButtonStyle.Secondary)
            );
    }

    startRound();

    await interaction.reply({
        components: [buildContainer()],
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [] }
    });

    const msg = await interaction.fetchReply();
    const collector = msg.createMessageComponentCollector();

    collector.on('collect', async i => {
        if (i.user.id !== interaction.user.id) {
            return await i.reply({
                content: 'This is not your game. Run `/blackjack` to start your own.',
                flags: MessageFlags.Ephemeral
            });
        }

        if (i.customId === 'blackjack_again')
            startRound();
        else if (i.customId === 'blackjack_hit' && !finished) {
            playerHand.push(deck.pop());
            if (handValue(playerHand) > 21) finishRound();
        }
        else if (i.customId === 'blackjack_stand' && !finished)
            finishRound();
        else
            return await i.deferUpdate();

        await i.update({
            components: [buildContainer()],
            flags: MessageFlags.IsComponentsV2,
            allowedMentions: { parse: [] }
        });
    });
}

export default { global, data, execute };