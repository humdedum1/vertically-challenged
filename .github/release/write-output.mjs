#!/usr/bin/env node
// Called by semantic-release (exec successCmd) after a release: exposes it as step outputs.
// Usage: write-output.mjs <version> <tag> [channel]
import { appendFileSync } from 'node:fs';

const [version, tag, channel = ''] = process.argv.slice(2);
const lines = ['released=true', `version=${version}`, `tag=${tag}`, `channel=${channel}`];
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, lines.join('\n') + '\n');
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n### Released ${tag}\n`);
console.log(lines.join(' '));
