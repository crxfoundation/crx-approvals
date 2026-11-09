/* eslint-disable @typescript-eslint/no-require-imports -- PostCSS loads plugins with require. */
const fs = require('node:fs');
const path = require('node:path');
const postcss = require('postcss');

const tokenFile = path.resolve(__dirname, '../app/discover/skin-gs/tokens.css');
function queryTokens() {
  const tokens = new Map();
  postcss.parse(fs.readFileSync(tokenFile, 'utf8')).walkDecls(d => {
    if (d.prop.startsWith('--gs-breakpoint-')) tokens.set(d.prop, d.value);
  });
  return tokens;
}
module.exports = () => ({
  postcssPlugin: 'discover-query-tokens',
  Once(root, { result }) {
    const tokens = queryTokens();
    result.messages.push({ type: 'dependency', plugin: 'discover-query-tokens', file: tokenFile });
    root.walkAtRules(rule => {
      if (!['media', 'container'].includes(rule.name)) return;
      rule.params = rule.params.replace(/token\((--gs-breakpoint-[\w-]+)\)/g, (_, name) => {
        const value = tokens.get(name);
        if (!value) throw rule.error(`Unknown Discover query token: ${name}`);
        return value;
      });
      if (rule.params.includes("token(")) throw rule.error("Invalid Discover query token");
    });
  },
});
module.exports.postcss = true;
