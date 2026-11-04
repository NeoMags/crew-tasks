// Metro config: the app imports shared types/logic from server/src/shared (via the @shared alias),
// so keep the server's own node_modules and tests out of the app bundle's file crawl.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const config = getDefaultConfig(__dirname);
const serverDir = path.join(__dirname, 'server').replace(/[/\\]/g, '[/\\\\]');
config.resolver.blockList = [new RegExp(`${serverDir}[/\\\\](node_modules|test|scripts)[/\\\\].*`)];

module.exports = config;
