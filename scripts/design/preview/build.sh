#!/bin/bash
# Build the preview bundle for one commit: bash scripts/design/preview/build.sh <commit> <outdir>
# Throwaway worktree (hard-linked node_modules), PreviewApp.js over App.web.js, react-native-maps stubbed on web only.
set -e
C=$1; OUT=$2; REPO=$(git -C "$(dirname "$0")" rev-parse --show-toplevel); W=$OUT.wt
git -C $REPO worktree remove --force $W 2>/dev/null || true
git -C $REPO worktree add -q --detach $W $C
cp -al $REPO/node_modules $W/node_modules
cp $REPO/scripts/design/preview/PreviewApp.js $W/App.web.js
mkdir -p $W/preview-stubs && cp $REPO/scripts/design/preview/maps-stub.js $W/preview-stubs/react-native-maps.js
cat > $W/metro.config.js <<'M'
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');
const config = getDefaultConfig(__dirname);
const orig = config.resolver.resolveRequest;
config.resolver.resolveRequest = (ctx, name, platform) => {
  if (platform === 'web' && name === 'react-native-maps') return { type: 'sourceFile', filePath: path.join(__dirname, 'preview-stubs/react-native-maps.js') };
  return (orig || ctx.resolveRequest)(ctx, name, platform);
};
module.exports = config;
M
cd $W && NEARBY_WEB_EXPORT_BASE_URL= npx expo export -p web --output-dir $OUT > $OUT.log 2>&1
git -C $REPO worktree remove --force $W
echo "built $C -> $OUT"
