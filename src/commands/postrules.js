const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('postrules')
    .setDescription('Post the 2026 PICKS LEAGUE league rules'),

  async execute(interaction) {
    const embed = new EmbedBuilder()
      .setTitle('📋 2026 PICKS LEAGUE League Rules')
      .setColor(0x1e90ff)
      .addFields(
        {
          name: 'The Basics',
          value: 'You get 3 picks per week. The week runs Monday through Sunday. If you don\'t submit 3 picks, you lose those opportunities — they don\'t roll over.',
        },
        {
          name: 'How to Submit Picks',
          value: 'DM the bot directly — find **2026 PICKS LEAGUE at your service** in the server member list, click its name, and hit Message. The bot will show you available games and walk you through the process. Picks submitted any other way will not count.',
        },
        {
          name: 'What You Can Pick',
          value: '• Moneyline (ML) — pick who wins\n• Spread (Runline) — pick against the spread',
        },
        {
          name: 'Pick Deadline & How Odds Work',
          value: 'Picks must be submitted before the game starts. The line shown when you submit is NOT your locked line. Odds are locked at the closing line when the game starts. The bot will DM you when your game begins to confirm your closing line and scoring opportunity.',
        },
        {
          name: 'Scoring',
          value: 'Points based on closing line odds:\n≤ -250 → Win: 0.5 / Loss: -0.5\n-249 to -200 → Win: 1 / Loss: -0.5\n-199 to -150 → Win: 1.5 / Loss: 0\n-149 to +100 → Win: 2 / Loss: 0\n+101 to +150 → Win: 2.5 / Loss: 0\n+151 to +199 → Win: 3 / Loss: 0\n+200 to +299 → Win: 3.5 / Loss: 0\n≥ +300 → Win: 4 / Loss: 0',
        },
        {
          name: 'Awards',
          value: '🏆 Season Champion — most points at end of season\n⭐ First-Half Award — most points through All-Star break (July 14)\n🎯 Longest Shot (First Half) — highest odds winning pick before All-Star break\n🎯 Longest Shot (Second Half) — highest odds winning pick after All-Star break',
        },
        {
          name: '💰 Buy-In & Payouts',
          value: 'Buy-in details and payout structure will be posted soon in #announcements. Stay tuned.',
        },
        {
          name: '🧪 Preseason Test Mode',
          value: 'The league is in preseason test mode. The 3 pick limit is lifted — make as many picks as you want. All preseason picks and scores will be wiped before Opening Day. Nothing from preseason counts. If anything looks broken, screenshot it and send it to Karl Blum.',
        },
        {
          name: 'Integrity & Questions',
          value: 'All picks are timestamped and logged. Admins can audit any pick at any time. Manipulation or circumvention results in disqualification.\n\nPost questions in #questions.',
        },
      );

    await interaction.reply({ embeds: [embed] });
  },
};
