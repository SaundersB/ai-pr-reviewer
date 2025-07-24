"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getTokenCount = exports.encode = void 0;
// eslint-disable-next-line camelcase
const tiktoken_1 = require("@dqbd/tiktoken");
const tokenizer = (0, tiktoken_1.get_encoding)('cl100k_base');
function encode(input) {
    return tokenizer.encode(input);
}
exports.encode = encode;
function getTokenCount(input) {
    input = input.replace(/<\|endoftext\|>/g, '');
    return encode(input).length;
}
exports.getTokenCount = getTokenCount;
