const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// Exclude Claude Code worktrees from Metro's file watcher to avoid ENOENT errors
config.watchFolders = (config.watchFolders ?? []).filter(
  (folder) => !folder.includes('.claude')
);

config.resolver = {
  ...config.resolver,
  blockList: [
    ...(Array.isArray(config.resolver?.blockList) ? config.resolver.blockList : []),
    new RegExp(
      path.join(__dirname, '\\.claude', 'worktrees').replace(/\\/g, '\\\\')
    ),
  ],
};

module.exports = config;
