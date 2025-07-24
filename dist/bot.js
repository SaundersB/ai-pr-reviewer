"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Bot = void 0;
const core_1 = require("@actions/core");
const chatgpt_1 = require("chatgpt");
const p_retry_1 = __importDefault(require("p-retry"));
class Bot {
    api = null; // not free
    options;
    constructor(options, openaiOptions) {
        this.options = options;
        if (process.env.OPENAI_API_KEY) {
            const currentDate = new Date().toISOString().split('T')[0];
            const systemMessage = `${options.systemMessage} 
Knowledge cutoff: ${openaiOptions.tokenLimits.knowledgeCutOff}
Current date: ${currentDate}

IMPORTANT: Entire response must be in the language with ISO code: ${options.language}
`;
            this.api = new chatgpt_1.ChatGPTAPI({
                apiBaseUrl: options.apiBaseUrl,
                systemMessage,
                apiKey: process.env.OPENAI_API_KEY,
                apiOrg: process.env.OPENAI_API_ORG ?? undefined,
                debug: options.debug,
                maxModelTokens: openaiOptions.tokenLimits.maxTokens,
                maxResponseTokens: openaiOptions.tokenLimits.responseTokens,
                completionParams: {
                    temperature: options.openaiModelTemperature,
                    model: openaiOptions.model
                }
            });
        }
        else {
            const err = "Unable to initialize the OpenAI API, both 'OPENAI_API_KEY' environment variable are not available";
            throw new Error(err);
        }
    }
    chat = async (message, ids) => {
        let res = ['', {}];
        try {
            res = await this.chat_(message, ids);
            return res;
        }
        catch (e) {
            if (e instanceof chatgpt_1.ChatGPTError) {
                (0, core_1.warning)(`Failed to chat: ${e}, backtrace: ${e.stack}`);
            }
            return res;
        }
    };
    chat_ = async (message, ids) => {
        // record timing
        const start = Date.now();
        if (!message) {
            return ['', {}];
        }
        let response;
        if (this.api != null) {
            const opts = {
                timeoutMs: this.options.openaiTimeoutMS
            };
            if (ids.parentMessageId) {
                opts.parentMessageId = ids.parentMessageId;
            }
            try {
                response = await (0, p_retry_1.default)(() => this.api.sendMessage(message, opts), {
                    retries: this.options.openaiRetries
                });
            }
            catch (e) {
                if (e instanceof chatgpt_1.ChatGPTError) {
                    (0, core_1.info)(`response: ${response}, failed to send message to openai: ${e}, backtrace: ${e.stack}`);
                }
            }
            const end = Date.now();
            (0, core_1.info)(`response: ${JSON.stringify(response)}`);
            (0, core_1.info)(`openai sendMessage (including retries) response time: ${end - start} ms`);
        }
        else {
            (0, core_1.setFailed)('The OpenAI API is not initialized');
        }
        let responseText = '';
        if (response != null) {
            responseText = response.text;
        }
        else {
            (0, core_1.warning)('openai response is null');
        }
        // remove the prefix "with " in the response
        if (responseText.startsWith('with ')) {
            responseText = responseText.substring(5);
        }
        if (this.options.debug) {
            (0, core_1.info)(`openai responses: ${responseText}`);
        }
        const newIds = {
            parentMessageId: response?.id,
            conversationId: response?.conversationId
        };
        return [responseText, newIds];
    };
}
exports.Bot = Bot;
