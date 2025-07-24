"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OpenAIOptions = exports.PathFilter = exports.Options = void 0;
const core_1 = require("@actions/core");
const minimatch_1 = require("minimatch");
const limits_1 = require("./limits");
class Options {
    debug;
    disableReview;
    disableReleaseNotes;
    maxFiles;
    reviewSimpleChanges;
    reviewCommentLGTM;
    pathFilters;
    systemMessage;
    openaiLightModel;
    openaiHeavyModel;
    openaiModelTemperature;
    openaiRetries;
    openaiTimeoutMS;
    openaiConcurrencyLimit;
    githubConcurrencyLimit;
    lightTokenLimits;
    heavyTokenLimits;
    apiBaseUrl;
    language;
    constructor(debug, disableReview, disableReleaseNotes, maxFiles = '0', reviewSimpleChanges = false, reviewCommentLGTM = false, pathFilters = null, systemMessage = '', openaiLightModel = 'gpt-3.5-turbo', openaiHeavyModel = 'gpt-3.5-turbo', openaiModelTemperature = '0.0', openaiRetries = '3', openaiTimeoutMS = '120000', openaiConcurrencyLimit = '6', githubConcurrencyLimit = '6', apiBaseUrl = 'https://api.openai.com/v1', language = 'en-US') {
        this.debug = debug;
        this.disableReview = disableReview;
        this.disableReleaseNotes = disableReleaseNotes;
        this.maxFiles = parseInt(maxFiles);
        this.reviewSimpleChanges = reviewSimpleChanges;
        this.reviewCommentLGTM = reviewCommentLGTM;
        this.pathFilters = new PathFilter(pathFilters);
        this.systemMessage = systemMessage;
        this.openaiLightModel = openaiLightModel;
        this.openaiHeavyModel = openaiHeavyModel;
        this.openaiModelTemperature = parseFloat(openaiModelTemperature);
        this.openaiRetries = parseInt(openaiRetries);
        this.openaiTimeoutMS = parseInt(openaiTimeoutMS);
        this.openaiConcurrencyLimit = parseInt(openaiConcurrencyLimit);
        this.githubConcurrencyLimit = parseInt(githubConcurrencyLimit);
        this.lightTokenLimits = new limits_1.TokenLimits(openaiLightModel);
        this.heavyTokenLimits = new limits_1.TokenLimits(openaiHeavyModel);
        this.apiBaseUrl = apiBaseUrl;
        this.language = language;
    }
    // print all options using core.info
    print() {
        (0, core_1.info)(`debug: ${this.debug}`);
        (0, core_1.info)(`disable_review: ${this.disableReview}`);
        (0, core_1.info)(`disable_release_notes: ${this.disableReleaseNotes}`);
        (0, core_1.info)(`max_files: ${this.maxFiles}`);
        (0, core_1.info)(`review_simple_changes: ${this.reviewSimpleChanges}`);
        (0, core_1.info)(`review_comment_lgtm: ${this.reviewCommentLGTM}`);
        (0, core_1.info)(`path_filters: ${this.pathFilters}`);
        (0, core_1.info)(`system_message: ${this.systemMessage}`);
        (0, core_1.info)(`openai_light_model: ${this.openaiLightModel}`);
        (0, core_1.info)(`openai_heavy_model: ${this.openaiHeavyModel}`);
        (0, core_1.info)(`openai_model_temperature: ${this.openaiModelTemperature}`);
        (0, core_1.info)(`openai_retries: ${this.openaiRetries}`);
        (0, core_1.info)(`openai_timeout_ms: ${this.openaiTimeoutMS}`);
        (0, core_1.info)(`openai_concurrency_limit: ${this.openaiConcurrencyLimit}`);
        (0, core_1.info)(`github_concurrency_limit: ${this.githubConcurrencyLimit}`);
        (0, core_1.info)(`summary_token_limits: ${this.lightTokenLimits.string()}`);
        (0, core_1.info)(`review_token_limits: ${this.heavyTokenLimits.string()}`);
        (0, core_1.info)(`api_base_url: ${this.apiBaseUrl}`);
        (0, core_1.info)(`language: ${this.language}`);
    }
    checkPath(path) {
        const ok = this.pathFilters.check(path);
        (0, core_1.info)(`checking path: ${path} => ${ok}`);
        return ok;
    }
}
exports.Options = Options;
class PathFilter {
    rules;
    constructor(rules = null) {
        this.rules = [];
        if (rules != null) {
            for (const rule of rules) {
                const trimmed = rule?.trim();
                if (trimmed) {
                    if (trimmed.startsWith('!')) {
                        this.rules.push([trimmed.substring(1).trim(), true]);
                    }
                    else {
                        this.rules.push([trimmed, false]);
                    }
                }
            }
        }
    }
    check(path) {
        if (this.rules.length === 0) {
            return true;
        }
        let included = false;
        let excluded = false;
        let inclusionRuleExists = false;
        for (const [rule, exclude] of this.rules) {
            if ((0, minimatch_1.minimatch)(path, rule)) {
                if (exclude) {
                    excluded = true;
                }
                else {
                    included = true;
                }
            }
            if (!exclude) {
                inclusionRuleExists = true;
            }
        }
        return (!inclusionRuleExists || included) && !excluded;
    }
}
exports.PathFilter = PathFilter;
class OpenAIOptions {
    model;
    tokenLimits;
    constructor(model = 'gpt-3.5-turbo', tokenLimits = null) {
        this.model = model;
        if (tokenLimits != null) {
            this.tokenLimits = tokenLimits;
        }
        else {
            this.tokenLimits = new limits_1.TokenLimits(model);
        }
    }
}
exports.OpenAIOptions = OpenAIOptions;
