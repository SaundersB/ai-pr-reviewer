"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.octokit = void 0;
const core_1 = require("@actions/core");
const action_1 = require("@octokit/action");
const plugin_retry_1 = require("@octokit/plugin-retry");
const plugin_throttling_1 = require("@octokit/plugin-throttling");
const token = (0, core_1.getInput)('token') || process.env.GITHUB_TOKEN;
const RetryAndThrottlingOctokit = action_1.Octokit.plugin(plugin_throttling_1.throttling, plugin_retry_1.retry);
exports.octokit = new RetryAndThrottlingOctokit({
    auth: `token ${token}`,
    throttle: {
        onRateLimit: (retryAfter, options, _o, retryCount) => {
            (0, core_1.warning)(`Request quota exhausted for request ${options.method} ${options.url}
Retry after: ${retryAfter} seconds
Retry count: ${retryCount}
`);
            if (retryCount <= 3) {
                (0, core_1.warning)(`Retrying after ${retryAfter} seconds!`);
                return true;
            }
        },
        onSecondaryRateLimit: (retryAfter, options) => {
            (0, core_1.warning)(`SecondaryRateLimit detected for request ${options.method} ${options.url} ; retry after ${retryAfter} seconds`);
            // if we are doing a POST method on /repos/{owner}/{repo}/pulls/{pull_number}/reviews then we shouldn't retry
            if (options.method === 'POST' &&
                options.url.match(/\/repos\/.*\/.*\/pulls\/.*\/reviews/)) {
                return false;
            }
            return true;
        }
    }
});
