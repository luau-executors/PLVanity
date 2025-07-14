import { Client, GatewayIntentBits, EmbedBuilder, PermissionFlagsBits } from 'discord.js';

class StatusTrackerBot {
  client;
  trackedUsers = new Map();
  guildSettings = new Map();
  rewardLog = new Map();
  userRewardCooldown = new Map();

  constructor() {
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildPresences,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
      ]
    });

    this.setupEventListeners();
  }

  setupEventListeners() {
    this.client.once('ready', () => {
      console.log(`✅ Bot is ready! Logged in as ${this.client.user.tag}`);
    });

    this.client.on('presenceUpdate', (oldPresence, newPresence) => {
      if (!newPresence || !newPresence.member || newPresence.member.user.bot) return;

      const guild = newPresence.guild;
      const member = newPresence.member;
      const userId = member.id;

      const oldStatus = oldPresence?.activities?.find(a => a.type === 4)?.state || '';
      const newStatus = newPresence.activities?.find(a => a.type === 4)?.state || '';

      const previousStatus = this.trackedUsers.get(userId) || '';
      if (previousStatus === newStatus) return;

      this.trackedUsers.set(userId, newStatus);

      const settings = this.guildSettings.get(guild.id);
      if (!settings) return;

      const hasVanity = newStatus.toLowerCase().includes(settings.vanity_url.toLowerCase());
      const hadVanity = previousStatus.toLowerCase().includes(settings.vanity_url.toLowerCase());

      if (hasVanity && !hadVanity) {
        const lastReward = this.userRewardCooldown.get(userId) || 0;
        const now = Date.now();
        const cooldownTime = 24 * 60 * 60 * 1000;

        if (now - lastReward < cooldownTime) {
          console.log(`⏳ User ${member.user.tag} is on cooldown`);
          return;
        }

        this.rewardUser(guild, member, settings.vanity_url, settings.reward_channel);
        this.userRewardCooldown.set(userId, now);
      }
    });

    this.client.on('messageCreate', message => {
      if (message.author.bot || !message.guild) return;

      const prefix = '!';
      if (!message.content.startsWith(prefix)) return;

      const args = message.content.slice(prefix.length).trim().split(/ +/);
      const command = args.shift()?.toLowerCase();
      if (!command) return;

      if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return message.reply('❌ You need Administrator permissions to use this command.');
      }

      switch (command) {
        case 'setup':
          this.handleSetup(message, args);
          break;
        case 'setstatus':
          this.handleSetStatus(message, args);
          break;
        case 'stats':
          this.handleStats(message);
          break;
        case 'checkstatus':
          this.handleCheckStatus(message, args);
          break;
        case 'resetcooldown':
          this.handleResetCooldown(message, args);
          break;
      }
    });

    this.client.on('error', err => console.error('Client error:', err));
  }

  async rewardUser(guild, member, vanityUrl, channelId) {
    try {
      const channel = guild.channels.cache.get(channelId);
      if (!channel) return;

      const botPermissions = channel.permissionsFor(guild.members.me);
      if (!botPermissions?.has([PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])) return;

      const imageRole = await this.getOrCreateImageRole(guild);
      if (imageRole && !member.roles.cache.has(imageRole.id)) {
        await member.roles.add(imageRole).catch(console.error);
      }

      const status = member.presence?.activities?.find(a => a.type === 4)?.state || 'No status';

      const embed = new EmbedBuilder()
        .setColor('#00ff00')
        .setTitle('Status Rep Reward! 🎉')
        .setDescription(`${member} repped **${vanityUrl}**!`)
        .addFields(
          { name: 'Rewards', value: '• Image permissions\n• Embed permissions\n• File upload permissions' },
          { name: 'Current Status', value: status.length > 100 ? status.slice(0, 100) + '...' : status }
        )
        .setThumbnail(member.user.displayAvatarURL({ extension: 'png', size: 256 }))
        .setTimestamp()
        .setFooter({ text: `User ID: ${member.id}` });

      await channel.send({ embeds: [embed] });

      const count = this.rewardLog.get(guild.id) || 0;
      this.rewardLog.set(guild.id, count + 1);

      console.log(`✅ Rewarded ${member.user.tag}`);
    } catch (err) {
      console.error('Error rewarding user:', err);
    }
  }

  async getOrCreateImageRole(guild) {
    try {
      let imageRole = guild.roles.cache.find(r => r.name === 'Image Permissions');
      if (!imageRole) {
        if (!guild.members.me.permissions.has(PermissionFlagsBits.ManageRoles)) {
          console.error('Missing ManageRoles permission');
          return null;
        }
        imageRole = await guild.roles.create({
          name: 'Image Permissions',
          color: '#00ff00',
          permissions: [
            PermissionFlagsBits.AttachFiles,
            PermissionFlagsBits.EmbedLinks,
            PermissionFlagsBits.UseExternalEmojis
          ]
        });
      }
      return imageRole;
    } catch (err) {
      console.error('Error creating role:', err);
      return null;
    }
  }

  handleSetup(message, args) {
    if (args.length < 2) return message.reply('❌ Usage: `!setup <vanity_url> <#channel>`');

    const vanityUrl = args[0];
    const channelId = args[1].replace(/[<#>]/g, '');
    const channel = message.guild.channels.cache.get(channelId);
    if (!channel) return message.reply('❌ Invalid channel');

    if (!vanityUrl.includes('.')) return message.reply('❌ Invalid vanity URL format.');

    this.guildSettings.set(message.guild.id, { vanity_url: vanityUrl, reward_channel: channelId });

    const embed = new EmbedBuilder()
      .setColor('#00ff00')
      .setTitle('✅ Setup Complete!')
      .addFields(
        { name: 'Vanity URL', value: `\`${vanityUrl}\`` },
        { name: 'Reward Channel', value: `<#${channelId}>` }
      )
      .setTimestamp();

    message.reply({ embeds: [embed] });
  }

  handleSetStatus(message, args) {
    if (!args.length) return message.reply('❌ Usage: `!setstatus <text>`');
    const vanity = this.guildSettings.get(message.guild.id)?.vanity_url || 'your-vanity';
    message.reply(`This is a demo. Ask users to set their custom status to include \`${vanity}\``);
  }

  handleStats(message) {
    const guildId = message.guild.id;
    const settings = this.guildSettings.get(guildId);
    const rewardCount = this.rewardLog.get(guildId) || 0;

    const tracked = Array.from(this.trackedUsers.entries()).filter(([_, s]) =>
      s.toLowerCase().includes(settings?.vanity_url.toLowerCase() || '')
    ).length;

    const embed = new EmbedBuilder()
      .setColor('#0099ff')
      .setTitle('📊 Stats')
      .addFields(
        { name: 'Vanity URL', value: settings?.vanity_url || 'Not set' },
        { name: 'Rewards Given', value: rewardCount.toString() },
        { name: 'Tracked Users', value: tracked.toString() }
      )
      .setTimestamp();

    message.reply({ embeds: [embed] });
  }

  handleCheckStatus(message, args) {
    if (!args.length) return message.reply('❌ Usage: `!checkstatus <@user>`');
    const userId = args[0].replace(/[<@!>]/g, '');
    const member = message.guild.members.cache.get(userId);
    if (!member) return message.reply('❌ User not found.');

    const status = this.trackedUsers.get(userId) || 'No status tracked';
    const settings = this.guildSettings.get(message.guild.id);
    const hasVanity = settings && status.toLowerCase().includes(settings.vanity_url.toLowerCase());

    const embed = new EmbedBuilder()
      .setColor(hasVanity ? '#00ff00' : '#ff0000')
      .setTitle(`${member.user.tag} Status Check`)
      .addFields(
        { name: 'Current Status', value: status },
        { name: 'Has Vanity URL', value: hasVanity ? '✅ Yes' : '❌ No' }
      )
      .setTimestamp();

    message.reply({ embeds: [embed] });
  }

  handleResetCooldown(message, args) {
    if (!args.length) return message.reply('❌ Usage: `!resetcooldown <@user>`');
    const userId = args[0].replace(/[<@!>]/g, '');
    this.userRewardCooldown.delete(userId);
    message.reply(`✅ Cooldown reset for <@${userId}>`);
  }

  async start() {
    const token = process.env.DISCORD_TOKEN;
    if (!token) throw new Error('Missing DISCORD_TOKEN env var');
    await this.client.login(token);
  }
}

process.on('SIGINT', () => process.exit());
process.on('SIGTERM', () => process.exit());
process.on('shutdown', () => process.exit());
process.on('maintenance', () => process.exit());

const bot = new StatusTrackerBot();
bot.start();
