"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.codeReview = void 0;
const core_1 = require("@actions/core");
// eslint-disable-next-line camelcase
const github_1 = require("@actions/github");
const p_limit_1 = __importDefault(require("p-limit"));
const commenter_1 = require("./commenter");
const inputs_1 = require("./inputs");
const octokit_1 = require("./octokit");
const tokenizer_1 = require("./tokenizer");
// eslint-disable-next-line camelcase
const context = github_1.context;
const repo = context.repo;
const ignoreKeyword = '@aiprbot: ignore';
const codeReview = async (lightBot, heavyBot, options, prompts) => {
    const commenter = new commenter_1.Commenter();
    const openaiConcurrencyLimit = (0, p_limit_1.default)(options.openaiConcurrencyLimit);
    const githubConcurrencyLimit = (0, p_limit_1.default)(options.githubConcurrencyLimit);
    if (context.eventName !== 'pull_request' &&
        context.eventName !== 'pull_request_target') {
        (0, core_1.warning)(`Skipped: current event is ${context.eventName}, only support pull_request event`);
        return;
    }
    if (context.payload.pull_request == null) {
        (0, core_1.warning)('Skipped: context.payload.pull_request is null');
        return;
    }
    const inputs = new inputs_1.Inputs();
    inputs.title = context.payload.pull_request.title;
    if (context.payload.pull_request.body != null) {
        inputs.description = commenter.getDescription(context.payload.pull_request.body);
    }
    // if the description contains ignore_keyword, skip
    if (inputs.description.includes(ignoreKeyword)) {
        (0, core_1.info)('Skipped: description contains ignore_keyword');
        return;
    }
    // as gpt-3.5-turbo isn't paying attention to system message, add to inputs for now
    inputs.systemMessage = options.systemMessage;
    // get SUMMARIZE_TAG message
    const existingSummarizeCmt = await commenter.findCommentWithTag(commenter_1.SUMMARIZE_TAG, context.payload.pull_request.number);
    let existingCommitIdsBlock = '';
    let existingSummarizeCmtBody = '';
    if (existingSummarizeCmt != null) {
        existingSummarizeCmtBody = existingSummarizeCmt.body;
        inputs.rawSummary = commenter.getRawSummary(existingSummarizeCmtBody);
        inputs.shortSummary = commenter.getShortSummary(existingSummarizeCmtBody);
        existingCommitIdsBlock = commenter.getReviewedCommitIdsBlock(existingSummarizeCmtBody);
    }
    const allCommitIds = await commenter.getAllCommitIds();
    // find highest reviewed commit id
    let highestReviewedCommitId = '';
    if (existingCommitIdsBlock !== '') {
        highestReviewedCommitId = commenter.getHighestReviewedCommitId(allCommitIds, commenter.getReviewedCommitIds(existingCommitIdsBlock));
    }
    if (highestReviewedCommitId === '' ||
        highestReviewedCommitId === context.payload.pull_request.head.sha) {
        (0, core_1.info)(`Will review from the base commit: ${context.payload.pull_request.base.sha}`);
        highestReviewedCommitId = context.payload.pull_request.base.sha;
    }
    else {
        (0, core_1.info)(`Will review from commit: ${highestReviewedCommitId}`);
    }
    // Fetch the diff between the highest reviewed commit and the latest commit of the PR branch
    const incrementalDiff = await octokit_1.octokit.repos.compareCommits({
        owner: repo.owner,
        repo: repo.repo,
        base: highestReviewedCommitId,
        head: context.payload.pull_request.head.sha
    });
    // Fetch the diff between the target branch's base commit and the latest commit of the PR branch
    const targetBranchDiff = await octokit_1.octokit.repos.compareCommits({
        owner: repo.owner,
        repo: repo.repo,
        base: context.payload.pull_request.base.sha,
        head: context.payload.pull_request.head.sha
    });
    const incrementalFiles = incrementalDiff.data.files;
    const targetBranchFiles = targetBranchDiff.data.files;
    if (incrementalFiles == null || targetBranchFiles == null) {
        (0, core_1.warning)('Skipped: files data is missing');
        return;
    }
    // Filter out any file that is changed compared to the incremental changes
    const files = targetBranchFiles.filter(targetBranchFile => incrementalFiles.some(incrementalFile => incrementalFile.filename === targetBranchFile.filename));
    if (files.length === 0) {
        (0, core_1.warning)('Skipped: files is null');
        return;
    }
    // skip files if they are filtered out
    const filterSelectedFiles = [];
    const filterIgnoredFiles = [];
    for (const file of files) {
        if (!options.checkPath(file.filename)) {
            (0, core_1.info)(`skip for excluded path: ${file.filename}`);
            filterIgnoredFiles.push(file);
        }
        else {
            filterSelectedFiles.push(file);
        }
    }
    if (filterSelectedFiles.length === 0) {
        (0, core_1.warning)('Skipped: filterSelectedFiles is null');
        return;
    }
    const commits = incrementalDiff.data.commits;
    if (commits.length === 0) {
        (0, core_1.warning)('Skipped: commits is null');
        return;
    }
    // find hunks to review
    const filteredFiles = await Promise.all(filterSelectedFiles.map(file => githubConcurrencyLimit(async () => {
        // retrieve file contents
        let fileContent = '';
        if (context.payload.pull_request == null) {
            (0, core_1.warning)('Skipped: context.payload.pull_request is null');
            return null;
        }
        try {
            const contents = await octokit_1.octokit.repos.getContent({
                owner: repo.owner,
                repo: repo.repo,
                path: file.filename,
                ref: context.payload.pull_request.base.sha
            });
            if (contents.data != null) {
                if (!Array.isArray(contents.data)) {
                    if (contents.data.type === 'file' &&
                        contents.data.content != null) {
                        fileContent = Buffer.from(contents.data.content, 'base64').toString();
                    }
                }
            }
        }
        catch (e) {
            (0, core_1.warning)(`Failed to get file contents: ${e}. This is OK if it's a new file.`);
        }
        let fileDiff = '';
        if (file.patch != null) {
            fileDiff = file.patch;
        }
        const patches = [];
        for (const patch of splitPatch(file.patch)) {
            const patchLines = patchStartEndLine(patch);
            if (patchLines == null) {
                continue;
            }
            const hunks = parsePatch(patch);
            if (hunks == null) {
                continue;
            }
            const hunksStr = `
---new_hunk---
\`\`\`
${hunks.newHunk}
\`\`\`

---old_hunk---
\`\`\`
${hunks.oldHunk}
\`\`\`
`;
            patches.push([
                patchLines.newHunk.startLine,
                patchLines.newHunk.endLine,
                hunksStr
            ]);
        }
        if (patches.length > 0) {
            return [file.filename, fileContent, fileDiff, patches];
        }
        else {
            return null;
        }
    })));
    // Filter out any null results
    const filesAndChanges = filteredFiles.filter(file => file !== null);
    if (filesAndChanges.length === 0) {
        (0, core_1.error)('Skipped: no files to review');
        return;
    }
    let statusMsg = `<details>
<summary>Commits</summary>
Files that changed from the base of the PR and between ${highestReviewedCommitId} and ${context.payload.pull_request.head.sha} commits.
</details>
${filesAndChanges.length > 0
        ? `
<details>
<summary>Files selected (${filesAndChanges.length})</summary>

* ${filesAndChanges
            .map(([filename, , , patches]) => `${filename} (${patches.length})`)
            .join('\n* ')}
</details>
`
        : ''}
${filterIgnoredFiles.length > 0
        ? `
<details>
<summary>Files ignored due to filter (${filterIgnoredFiles.length})</summary>

* ${filterIgnoredFiles.map(file => file.filename).join('\n* ')}

</details>
`
        : ''}
`;
    // update the existing comment with in progress status
    const inProgressSummarizeCmt = commenter.addInProgressStatus(existingSummarizeCmtBody, statusMsg);
    // add in progress status to the summarize comment
    await commenter.comment(`${inProgressSummarizeCmt}`, commenter_1.SUMMARIZE_TAG, 'replace');
    const summariesFailed = [];
    const doSummary = async (filename, fileContent, fileDiff) => {
        (0, core_1.info)(`summarize: ${filename}`);
        const ins = inputs.clone();
        if (fileDiff.length === 0) {
            (0, core_1.warning)(`summarize: file_diff is empty, skip ${filename}`);
            summariesFailed.push(`${filename} (empty diff)`);
            return null;
        }
        ins.filename = filename;
        ins.fileDiff = fileDiff;
        // render prompt based on inputs so far
        const summarizePrompt = prompts.renderSummarizeFileDiff(ins, options.reviewSimpleChanges);
        const tokens = (0, tokenizer_1.getTokenCount)(summarizePrompt);
        if (tokens > options.lightTokenLimits.requestTokens) {
            (0, core_1.info)(`summarize: diff tokens exceeds limit, skip ${filename}`);
            summariesFailed.push(`${filename} (diff tokens exceeds limit)`);
            return null;
        }
        // summarize content
        try {
            const [summarizeResp] = await lightBot.chat(summarizePrompt, {});
            if (summarizeResp === '') {
                (0, core_1.info)('summarize: nothing obtained from openai');
                summariesFailed.push(`${filename} (nothing obtained from openai)`);
                return null;
            }
            else {
                if (options.reviewSimpleChanges === false) {
                    // parse the comment to look for triage classification
                    // Format is : [TRIAGE]: <NEEDS_REVIEW or APPROVED>
                    // if the change needs review return true, else false
                    const triageRegex = /\[TRIAGE\]:\s*(NEEDS_REVIEW|APPROVED)/;
                    const triageMatch = summarizeResp.match(triageRegex);
                    if (triageMatch != null) {
                        const triage = triageMatch[1];
                        const needsReview = triage === 'NEEDS_REVIEW';
                        // remove this line from the comment
                        const summary = summarizeResp.replace(triageRegex, '').trim();
                        (0, core_1.info)(`filename: ${filename}, triage: ${triage}`);
                        return [filename, summary, needsReview];
                    }
                }
                return [filename, summarizeResp, true];
            }
        }
        catch (e) {
            (0, core_1.warning)(`summarize: error from openai: ${e}`);
            summariesFailed.push(`${filename} (error from openai: ${e})})`);
            return null;
        }
    };
    const summaryPromises = [];
    const skippedFiles = [];
    for (const [filename, fileContent, fileDiff] of filesAndChanges) {
        if (options.maxFiles <= 0 || summaryPromises.length < options.maxFiles) {
            summaryPromises.push(openaiConcurrencyLimit(async () => await doSummary(filename, fileContent, fileDiff)));
        }
        else {
            skippedFiles.push(filename);
        }
    }
    const summaries = (await Promise.all(summaryPromises)).filter(summary => summary !== null);
    if (summaries.length > 0) {
        const batchSize = 10;
        // join summaries into one in the batches of batchSize
        // and ask the bot to summarize the summaries
        for (let i = 0; i < summaries.length; i += batchSize) {
            const summariesBatch = summaries.slice(i, i + batchSize);
            for (const [filename, summary] of summariesBatch) {
                inputs.rawSummary += `---
${filename}: ${summary}
`;
            }
            // ask chatgpt to summarize the summaries
            const [summarizeResp] = await heavyBot.chat(prompts.renderSummarizeChangesets(inputs), {});
            if (summarizeResp === '') {
                (0, core_1.warning)('summarize: nothing obtained from openai');
            }
            else {
                inputs.rawSummary = summarizeResp;
            }
        }
    }
    // final summary
    const [summarizeFinalResponse] = await heavyBot.chat(prompts.renderSummarize(inputs), {});
    if (summarizeFinalResponse === '') {
        (0, core_1.info)('summarize: nothing obtained from openai');
    }
    if (options.disableReleaseNotes === false) {
        // final release notes
        const [releaseNotesResponse] = await heavyBot.chat(prompts.renderSummarizeReleaseNotes(inputs), {});
        if (releaseNotesResponse === '') {
            (0, core_1.info)('release notes: nothing obtained from openai');
        }
        else {
            let message = '### Summary by SaundersB\n\n';
            message += releaseNotesResponse;
            try {
                await commenter.updateDescription(context.payload.pull_request.number, message);
            }
            catch (e) {
                (0, core_1.warning)(`release notes: error from github: ${e.message}`);
            }
        }
    }
    // generate a short summary as well
    const [summarizeShortResponse] = await heavyBot.chat(prompts.renderSummarizeShort(inputs), {});
    inputs.shortSummary = summarizeShortResponse;
    let summarizeComment = `${summarizeFinalResponse}
${commenter_1.RAW_SUMMARY_START_TAG}
${inputs.rawSummary}
${commenter_1.RAW_SUMMARY_END_TAG}
${commenter_1.SHORT_SUMMARY_START_TAG}
${inputs.shortSummary}
${commenter_1.SHORT_SUMMARY_END_TAG}

---
`;
    statusMsg += `
${skippedFiles.length > 0
        ? `
<details>
<summary>Files not processed due to max files limit (${skippedFiles.length})</summary>

* ${skippedFiles.join('\n* ')}

</details>
`
        : ''}
${summariesFailed.length > 0
        ? `
<details>
<summary>Files not summarized due to errors (${summariesFailed.length})</summary>

* ${summariesFailed.join('\n* ')}

</details>
`
        : ''}
`;
    if (!options.disableReview) {
        const filesAndChangesReview = filesAndChanges.filter(([filename]) => {
            const needsReview = summaries.find(([summaryFilename]) => summaryFilename === filename)?.[2] ?? true;
            return needsReview;
        });
        const reviewsSkipped = filesAndChanges
            .filter(([filename]) => !filesAndChangesReview.some(([reviewFilename]) => reviewFilename === filename))
            .map(([filename]) => filename);
        // failed reviews array
        const reviewsFailed = [];
        let lgtmCount = 0;
        let reviewCount = 0;
        const doReview = async (filename, fileContent, patches) => {
            (0, core_1.info)(`reviewing ${filename}`);
            // make a copy of inputs
            const ins = inputs.clone();
            ins.filename = filename;
            // calculate tokens based on inputs so far
            let tokens = (0, tokenizer_1.getTokenCount)(prompts.renderReviewFileDiff(ins));
            // loop to calculate total patch tokens
            let patchesToPack = 0;
            for (const [, , patch] of patches) {
                const patchTokens = (0, tokenizer_1.getTokenCount)(patch);
                if (tokens + patchTokens > options.heavyTokenLimits.requestTokens) {
                    (0, core_1.info)(`only packing ${patchesToPack} / ${patches.length} patches, tokens: ${tokens} / ${options.heavyTokenLimits.requestTokens}`);
                    break;
                }
                tokens += patchTokens;
                patchesToPack += 1;
            }
            let patchesPacked = 0;
            for (const [startLine, endLine, patch] of patches) {
                if (context.payload.pull_request == null) {
                    (0, core_1.warning)('No pull request found, skipping.');
                    continue;
                }
                // see if we can pack more patches into this request
                if (patchesPacked >= patchesToPack) {
                    (0, core_1.info)(`unable to pack more patches into this request, packed: ${patchesPacked}, total patches: ${patches.length}, skipping.`);
                    if (options.debug) {
                        (0, core_1.info)(`prompt so far: ${prompts.renderReviewFileDiff(ins)}`);
                    }
                    break;
                }
                patchesPacked += 1;
                let commentChain = '';
                try {
                    const allChains = await commenter.getCommentChainsWithinRange(context.payload.pull_request.number, filename, startLine, endLine, commenter_1.COMMENT_REPLY_TAG);
                    if (allChains.length > 0) {
                        (0, core_1.info)(`Found comment chains: ${allChains} for ${filename}`);
                        commentChain = allChains;
                    }
                }
                catch (e) {
                    (0, core_1.warning)(`Failed to get comments: ${e}, skipping. backtrace: ${e.stack}`);
                }
                // try packing comment_chain into this request
                const commentChainTokens = (0, tokenizer_1.getTokenCount)(commentChain);
                if (tokens + commentChainTokens >
                    options.heavyTokenLimits.requestTokens) {
                    commentChain = '';
                }
                else {
                    tokens += commentChainTokens;
                }
                ins.patches += `
${patch}
`;
                if (commentChain !== '') {
                    ins.patches += `
---comment_chains---
\`\`\`
${commentChain}
\`\`\`
`;
                }
                ins.patches += `
---end_change_section---
`;
            }
            if (patchesPacked > 0) {
                // perform review
                try {
                    const [response] = await heavyBot.chat(prompts.renderReviewFileDiff(ins), {});
                    if (response === '') {
                        (0, core_1.info)('review: nothing obtained from openai');
                        reviewsFailed.push(`${filename} (no response)`);
                        return;
                    }
                    // parse review
                    const reviews = parseReview(response, patches, options.debug);
                    for (const review of reviews) {
                        // check for LGTM
                        if (!options.reviewCommentLGTM &&
                            (review.comment.includes('LGTM') ||
                                review.comment.includes('looks good to me'))) {
                            lgtmCount += 1;
                            continue;
                        }
                        if (context.payload.pull_request == null) {
                            (0, core_1.warning)('No pull request found, skipping.');
                            continue;
                        }
                        try {
                            reviewCount += 1;
                            await commenter.bufferReviewComment(filename, review.startLine, review.endLine, `${review.comment}`);
                        }
                        catch (e) {
                            reviewsFailed.push(`${filename} comment failed (${e})`);
                        }
                    }
                }
                catch (e) {
                    (0, core_1.warning)(`Failed to review: ${e}, skipping. backtrace: ${e.stack}`);
                    reviewsFailed.push(`${filename} (${e})`);
                }
            }
            else {
                reviewsSkipped.push(`${filename} (diff too large)`);
            }
        };
        const reviewPromises = [];
        for (const [filename, fileContent, , patches] of filesAndChangesReview) {
            if (options.maxFiles <= 0 || reviewPromises.length < options.maxFiles) {
                reviewPromises.push(openaiConcurrencyLimit(async () => {
                    await doReview(filename, fileContent, patches);
                }));
            }
            else {
                skippedFiles.push(filename);
            }
        }
        await Promise.all(reviewPromises);
        statusMsg += `
${reviewsFailed.length > 0
            ? `<details>
<summary>Files not reviewed due to errors (${reviewsFailed.length})</summary>

* ${reviewsFailed.join('\n* ')}

</details>
`
            : ''}
${reviewsSkipped.length > 0
            ? `<details>
<summary>Files skipped from review due to trivial changes (${reviewsSkipped.length})</summary>

* ${reviewsSkipped.join('\n* ')}

</details>
`
            : ''}
<details>
<summary>Review comments generated (${reviewCount + lgtmCount})</summary>

* Review: ${reviewCount}
* LGTM: ${lgtmCount}

</details>

---

<details>
<summary>Tips</summary>

### Chat with <img src="https://avatars.githubusercontent.com/u/4874111?v=4" alt="Image description" width="20" height="20">  SaundersB Bot (\`@aiprbot\`)
- Reply on review comments left by this bot to ask follow-up questions. A review comment is a comment on a diff or a file.
- Invite the bot into a review comment chain by tagging \`@aiprbot\` in a reply.

### Code suggestions
- The bot may make code suggestions, but please review them carefully before committing since the line number ranges may be misaligned. 
- You can edit the comment made by the bot and manually tweak the suggestion if it is slightly off.

### Pausing incremental reviews
- Add \`@aiprbot: ignore\` anywhere in the PR description to pause further reviews from the bot.

</details>
`;
        // add existing_comment_ids_block with latest head sha
        summarizeComment += `\n${commenter.addReviewedCommitId(existingCommitIdsBlock, context.payload.pull_request.head.sha)}`;
        // post the review
        await commenter.submitReview(context.payload.pull_request.number, commits[commits.length - 1].sha, statusMsg);
    }
    // post the final summary comment
    await commenter.comment(`${summarizeComment}`, commenter_1.SUMMARIZE_TAG, 'replace');
};
exports.codeReview = codeReview;
const splitPatch = (patch) => {
    if (patch == null) {
        return [];
    }
    const pattern = /(^@@ -(\d+),(\d+) \+(\d+),(\d+) @@).*$/gm;
    const result = [];
    let last = -1;
    let match;
    while ((match = pattern.exec(patch)) !== null) {
        if (last === -1) {
            last = match.index;
        }
        else {
            result.push(patch.substring(last, match.index));
            last = match.index;
        }
    }
    if (last !== -1) {
        result.push(patch.substring(last));
    }
    return result;
};
const patchStartEndLine = (patch) => {
    const pattern = /(^@@ -(\d+),(\d+) \+(\d+),(\d+) @@)/gm;
    const match = pattern.exec(patch);
    if (match != null) {
        const oldBegin = parseInt(match[2]);
        const oldDiff = parseInt(match[3]);
        const newBegin = parseInt(match[4]);
        const newDiff = parseInt(match[5]);
        return {
            oldHunk: {
                startLine: oldBegin,
                endLine: oldBegin + oldDiff - 1
            },
            newHunk: {
                startLine: newBegin,
                endLine: newBegin + newDiff - 1
            }
        };
    }
    else {
        return null;
    }
};
const parsePatch = (patch) => {
    const hunkInfo = patchStartEndLine(patch);
    if (hunkInfo == null) {
        return null;
    }
    const oldHunkLines = [];
    const newHunkLines = [];
    let newLine = hunkInfo.newHunk.startLine;
    const lines = patch.split('\n').slice(1); // Skip the @@ line
    // Remove the last line if it's empty
    if (lines[lines.length - 1] === '') {
        lines.pop();
    }
    // Skip annotations for the first 3 and last 3 lines
    const skipStart = 3;
    const skipEnd = 3;
    let currentLine = 0;
    const removalOnly = !lines.some(line => line.startsWith('+'));
    for (const line of lines) {
        currentLine++;
        if (line.startsWith('-')) {
            oldHunkLines.push(`${line.substring(1)}`);
        }
        else if (line.startsWith('+')) {
            newHunkLines.push(`${newLine}: ${line.substring(1)}`);
            newLine++;
        }
        else {
            // context line
            oldHunkLines.push(`${line}`);
            if (removalOnly ||
                (currentLine > skipStart && currentLine <= lines.length - skipEnd)) {
                newHunkLines.push(`${newLine}: ${line}`);
            }
            else {
                newHunkLines.push(`${line}`);
            }
            newLine++;
        }
    }
    return {
        oldHunk: oldHunkLines.join('\n'),
        newHunk: newHunkLines.join('\n')
    };
};
function parseReview(response, patches, debug = false) {
    const reviews = [];
    response = sanitizeResponse(response.trim());
    const lines = response.split('\n');
    const lineNumberRangeRegex = /(?:^|\s)(\d+)-(\d+):\s*$/;
    const commentSeparator = '---';
    let currentStartLine = null;
    let currentEndLine = null;
    let currentComment = '';
    function storeReview() {
        if (currentStartLine !== null && currentEndLine !== null) {
            const review = {
                startLine: currentStartLine,
                endLine: currentEndLine,
                comment: currentComment
            };
            let withinPatch = false;
            let bestPatchStartLine = -1;
            let bestPatchEndLine = -1;
            let maxIntersection = 0;
            for (const [startLine, endLine] of patches) {
                const intersectionStart = Math.max(review.startLine, startLine);
                const intersectionEnd = Math.min(review.endLine, endLine);
                const intersectionLength = Math.max(0, intersectionEnd - intersectionStart + 1);
                if (intersectionLength > maxIntersection) {
                    maxIntersection = intersectionLength;
                    bestPatchStartLine = startLine;
                    bestPatchEndLine = endLine;
                    withinPatch =
                        intersectionLength === review.endLine - review.startLine + 1;
                }
                if (withinPatch)
                    break;
            }
            if (!withinPatch) {
                if (bestPatchStartLine !== -1 && bestPatchEndLine !== -1) {
                    review.comment = `> Note: This review was outside of the patch, so it was mapped to the patch with the greatest overlap. Original lines [${review.startLine}-${review.endLine}]

${review.comment}`;
                    review.startLine = bestPatchStartLine;
                    review.endLine = bestPatchEndLine;
                }
                else {
                    review.comment = `> Note: This review was outside of the patch, but no patch was found that overlapped with it. Original lines [${review.startLine}-${review.endLine}]

${review.comment}`;
                    review.startLine = patches[0][0];
                    review.endLine = patches[0][1];
                }
            }
            reviews.push(review);
            (0, core_1.info)(`Stored comment for line range ${currentStartLine}-${currentEndLine}: ${currentComment.trim()}`);
        }
    }
    function sanitizeCodeBlock(comment, codeBlockLabel) {
        const codeBlockStart = `\`\`\`${codeBlockLabel}`;
        const codeBlockEnd = '```';
        const lineNumberRegex = /^ *(\d+): /gm;
        let codeBlockStartIndex = comment.indexOf(codeBlockStart);
        while (codeBlockStartIndex !== -1) {
            const codeBlockEndIndex = comment.indexOf(codeBlockEnd, codeBlockStartIndex + codeBlockStart.length);
            if (codeBlockEndIndex === -1)
                break;
            const codeBlock = comment.substring(codeBlockStartIndex + codeBlockStart.length, codeBlockEndIndex);
            const sanitizedBlock = codeBlock.replace(lineNumberRegex, '');
            comment =
                comment.slice(0, codeBlockStartIndex + codeBlockStart.length) +
                    sanitizedBlock +
                    comment.slice(codeBlockEndIndex);
            codeBlockStartIndex = comment.indexOf(codeBlockStart, codeBlockStartIndex +
                codeBlockStart.length +
                sanitizedBlock.length +
                codeBlockEnd.length);
        }
        return comment;
    }
    function sanitizeResponse(comment) {
        comment = sanitizeCodeBlock(comment, 'suggestion');
        comment = sanitizeCodeBlock(comment, 'diff');
        return comment;
    }
    for (const line of lines) {
        const lineNumberRangeMatch = line.match(lineNumberRangeRegex);
        if (lineNumberRangeMatch != null) {
            storeReview();
            currentStartLine = parseInt(lineNumberRangeMatch[1], 10);
            currentEndLine = parseInt(lineNumberRangeMatch[2], 10);
            currentComment = '';
            if (debug) {
                (0, core_1.info)(`Found line number range: ${currentStartLine}-${currentEndLine}`);
            }
            continue;
        }
        if (line.trim() === commentSeparator) {
            storeReview();
            currentStartLine = null;
            currentEndLine = null;
            currentComment = '';
            if (debug) {
                (0, core_1.info)('Found comment separator');
            }
            continue;
        }
        if (currentStartLine !== null && currentEndLine !== null) {
            currentComment += `${line}\n`;
        }
    }
    storeReview();
    return reviews;
}
