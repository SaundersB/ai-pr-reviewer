#!/bin/bash

set -euo pipefail

# Get the latest version tag that matches vX.Y.Z
latest_tag=$(git tag -l "v[0-9]*" | sort -V | tail -n 1)
echo "🔖 Latest tag: $latest_tag"

# Parse into major.minor.patch
IFS='.' read -r major minor patch <<<"${latest_tag#v}"

# Bump patch version
new_patch=$((patch + 1))
new_version="v${major}.${minor}.${new_patch}"
echo "🚀 Bumping version to: $new_version"

# Create annotated tag for new version
git tag -a "$new_version" -m "chore: release $new_version"

# Update floating `v1` tag to point to the new version
git tag -f v$major "$new_version"

# Push tags
echo "📤 Pushing $new_version and updating v$major..."
git push origin "$new_version"
git push origin -f "v$major"

# Optional: generate GitHub release (if using gh CLI)
gh release create "$new_version" --target main --title "$new_version" --notes "Automated release for $new_version"

echo "✅ Done. Current version: $new_version"