"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Commenter = exports.COMMIT_ID_END_TAG = exports.COMMIT_ID_START_TAG = exports.SHORT_SUMMARY_END_TAG = exports.SHORT_SUMMARY_START_TAG = exports.RAW_SUMMARY_END_TAG = exports.RAW_SUMMARY_START_TAG = exports.DESCRIPTION_END_TAG = exports.DESCRIPTION_START_TAG = exports.IN_PROGRESS_END_TAG = exports.IN_PROGRESS_START_TAG = exports.SUMMARIZE_TAG = exports.COMMENT_REPLY_TAG = exports.COMMENT_TAG = exports.COMMENT_GREETING = void 0;
const core_1 = require("@actions/core");
// eslint-disable-next-line camelcase
const github_1 = require("@actions/github");
const octokit_1 = require("./octokit");
// eslint-disable-next-line camelcase
const context = github_1.context;
const repo = context.repo;
exports.COMMENT_GREETING = `${(0, core_1.getInput)('bot_icon')}  AI PR Reviewer Bot`;
exports.COMMENT_TAG = '<!-- This is an auto-generated comment by OSS AI PR Reviewer Bot -->';
exports.COMMENT_REPLY_TAG = '<!-- This is an auto-generated reply by OSS AI PR Reviewer Bot -->';
exports.SUMMARIZE_TAG = '<!-- This is an auto-generated comment: summarize by OSS AI PR Reviewer Bot -->';
exports.IN_PROGRESS_START_TAG = '<!-- This is an auto-generated comment: summarize review in progress by OSS AI PR Reviewer Bot -->';
exports.IN_PROGRESS_END_TAG = '<!-- end of auto-generated comment: summarize review in progress by OSS AI PR Reviewer Bot -->';
exports.DESCRIPTION_START_TAG = '<!-- This is an auto-generated comment: release notes by OSS AI PR Reviewer Bot -->';
exports.DESCRIPTION_END_TAG = '<!-- end of auto-generated comment: release notes by OSS AI PR Reviewer Bot -->';
exports.RAW_SUMMARY_START_TAG = `<!-- This is an auto-generated comment: raw summary by OSS AI PR Reviewer Bot -->
<!--
`;
exports.RAW_SUMMARY_END_TAG = `-->
<!-- end of auto-generated comment: raw summary by OSS AI PR Reviewer Bot -->`;
exports.SHORT_SUMMARY_START_TAG = `<!-- This is an auto-generated comment: short summary by OSS AI PR Reviewer Bot -->
<!--
`;
exports.SHORT_SUMMARY_END_TAG = `-->
<!-- end of auto-generated comment: short summary by OSS AI PR Reviewer Bot -->`;
exports.COMMIT_ID_START_TAG = '<!-- commit_ids_reviewed_start -->';
exports.COMMIT_ID_END_TAG = '<!-- commit_ids_reviewed_end -->';
class Commenter {
    /**
     * @param mode Can be "create", "replace". Default is "replace".
     */
    async comment(message, tag, mode) {
        let target;
        if (context.payload.pull_request != null) {
            target = context.payload.pull_request.number;
        }
        else if (context.payload.issue != null) {
            target = context.payload.issue.number;
        }
        else {
            (0, core_1.warning)('Skipped: context.payload.pull_request and context.payload.issue are both null');
            return;
        }
        if (!tag) {
            tag = exports.COMMENT_TAG;
        }
        const body = `${exports.COMMENT_GREETING}

${message}

${tag}`;
        if (mode === 'create') {
            await this.create(body, target);
        }
        else if (mode === 'replace') {
            await this.replace(body, tag, target);
        }
        else {
            (0, core_1.warning)(`Unknown mode: ${mode}, use "replace" instead`);
            await this.replace(body, tag, target);
        }
    }
    getContentWithinTags(content, startTag, endTag) {
        const start = content.indexOf(startTag);
        const end = content.indexOf(endTag);
        if (start >= 0 && end >= 0) {
            return content.slice(start + startTag.length, end);
        }
        return '';
    }
    removeContentWithinTags(content, startTag, endTag) {
        const start = content.indexOf(startTag);
        const end = content.lastIndexOf(endTag);
        if (start >= 0 && end >= 0) {
            return content.slice(0, start) + content.slice(end + endTag.length);
        }
        return content;
    }
    getRawSummary(summary) {
        return this.getContentWithinTags(summary, exports.RAW_SUMMARY_START_TAG, exports.RAW_SUMMARY_END_TAG);
    }
    getShortSummary(summary) {
        return this.getContentWithinTags(summary, exports.SHORT_SUMMARY_START_TAG, exports.SHORT_SUMMARY_END_TAG);
    }
    getDescription(description) {
        return this.removeContentWithinTags(description, exports.DESCRIPTION_START_TAG, exports.DESCRIPTION_END_TAG);
    }
    getReleaseNotes(description) {
        const releaseNotes = this.getContentWithinTags(description, exports.DESCRIPTION_START_TAG, exports.DESCRIPTION_END_TAG);
        return releaseNotes.replace(/(^|\n)> .*/g, '');
    }
    async updateDescription(pullNumber, message) {
        // add this response to the description field of the PR as release notes by looking
        // for the tag (marker)
        try {
            // get latest description from PR
            const pr = await octokit_1.octokit.pulls.get({
                owner: repo.owner,
                repo: repo.repo,
                // eslint-disable-next-line camelcase
                pull_number: pullNumber
            });
            let body = '';
            if (pr.data.body) {
                body = pr.data.body;
            }
            const description = this.getDescription(body);
            const messageClean = this.removeContentWithinTags(message, exports.DESCRIPTION_START_TAG, exports.DESCRIPTION_END_TAG);
            const newDescription = `${description}\n${exports.DESCRIPTION_START_TAG}\n${messageClean}\n${exports.DESCRIPTION_END_TAG}`;
            await octokit_1.octokit.pulls.update({
                owner: repo.owner,
                repo: repo.repo,
                // eslint-disable-next-line camelcase
                pull_number: pullNumber,
                body: newDescription
            });
        }
        catch (e) {
            (0, core_1.warning)(`Failed to get PR: ${e}, skipping adding release notes to description.`);
        }
    }
    reviewCommentsBuffer = [];
    async bufferReviewComment(path, startLine, endLine, message) {
        message = `${exports.COMMENT_GREETING}

${message}

${exports.COMMENT_TAG}`;
        this.reviewCommentsBuffer.push({
            path,
            startLine,
            endLine,
            message
        });
    }
    async deletePendingReview(pullNumber) {
        try {
            const reviews = await octokit_1.octokit.pulls.listReviews({
                owner: repo.owner,
                repo: repo.repo,
                // eslint-disable-next-line camelcase
                pull_number: pullNumber
            });
            const pendingReview = reviews.data.find(review => review.state === 'PENDING');
            if (pendingReview) {
                (0, core_1.info)(`Deleting pending review for PR #${pullNumber} id: ${pendingReview.id}`);
                try {
                    await octokit_1.octokit.pulls.deletePendingReview({
                        owner: repo.owner,
                        repo: repo.repo,
                        // eslint-disable-next-line camelcase
                        pull_number: pullNumber,
                        // eslint-disable-next-line camelcase
                        review_id: pendingReview.id
                    });
                }
                catch (e) {
                    (0, core_1.warning)(`Failed to delete pending review: ${e}`);
                }
            }
        }
        catch (e) {
            (0, core_1.warning)(`Failed to list reviews: ${e}`);
        }
    }
    async submitReview(pullNumber, commitId, statusMsg) {
        const body = `${exports.COMMENT_GREETING}

${statusMsg}
`;
        if (this.reviewCommentsBuffer.length === 0) {
            // Submit empty review with statusMsg
            (0, core_1.info)(`Submitting empty review for PR #${pullNumber}`);
            try {
                await octokit_1.octokit.pulls.createReview({
                    owner: repo.owner,
                    repo: repo.repo,
                    // eslint-disable-next-line camelcase
                    pull_number: pullNumber,
                    // eslint-disable-next-line camelcase
                    commit_id: commitId,
                    event: 'COMMENT',
                    body
                });
            }
            catch (e) {
                (0, core_1.warning)(`Failed to submit empty review: ${e}`);
            }
            return;
        }
        for (const comment of this.reviewCommentsBuffer) {
            const comments = await this.getCommentsAtRange(pullNumber, comment.path, comment.startLine, comment.endLine);
            for (const c of comments) {
                if (c.body.includes(exports.COMMENT_TAG)) {
                    (0, core_1.info)(`Deleting review comment for ${comment.path}:${comment.startLine}-${comment.endLine}: ${comment.message}`);
                    try {
                        await octokit_1.octokit.pulls.deleteReviewComment({
                            owner: repo.owner,
                            repo: repo.repo,
                            // eslint-disable-next-line camelcase
                            comment_id: c.id
                        });
                    }
                    catch (e) {
                        (0, core_1.warning)(`Failed to delete review comment: ${e}`);
                    }
                }
            }
        }
        await this.deletePendingReview(pullNumber);
        const generateCommentData = (comment) => {
            const commentData = {
                path: comment.path,
                body: comment.message,
                line: comment.endLine
            };
            if (comment.startLine !== comment.endLine) {
                // eslint-disable-next-line camelcase
                commentData.start_line = comment.startLine;
                // eslint-disable-next-line camelcase
                commentData.start_side = 'RIGHT';
            }
            return commentData;
        };
        try {
            const review = await octokit_1.octokit.pulls.createReview({
                owner: repo.owner,
                repo: repo.repo,
                // eslint-disable-next-line camelcase
                pull_number: pullNumber,
                // eslint-disable-next-line camelcase
                commit_id: commitId,
                comments: this.reviewCommentsBuffer.map(comment => generateCommentData(comment))
            });
            (0, core_1.info)(`Submitting review for PR #${pullNumber}, total comments: ${this.reviewCommentsBuffer.length}, review id: ${review.data.id}`);
            await octokit_1.octokit.pulls.submitReview({
                owner: repo.owner,
                repo: repo.repo,
                // eslint-disable-next-line camelcase
                pull_number: pullNumber,
                // eslint-disable-next-line camelcase
                review_id: review.data.id,
                event: 'COMMENT',
                body
            });
        }
        catch (e) {
            (0, core_1.warning)(`Failed to create review: ${e}. Falling back to individual comments.`);
            await this.deletePendingReview(pullNumber);
            let commentCounter = 0;
            for (const comment of this.reviewCommentsBuffer) {
                (0, core_1.info)(`Creating new review comment for ${comment.path}:${comment.startLine}-${comment.endLine}: ${comment.message}`);
                const commentData = {
                    owner: repo.owner,
                    repo: repo.repo,
                    // eslint-disable-next-line camelcase
                    pull_number: pullNumber,
                    // eslint-disable-next-line camelcase
                    commit_id: commitId,
                    ...generateCommentData(comment)
                };
                try {
                    await octokit_1.octokit.pulls.createReviewComment(commentData);
                }
                catch (ee) {
                    (0, core_1.warning)(`Failed to create review comment: ${ee}`);
                }
                commentCounter++;
                (0, core_1.info)(`Comment ${commentCounter}/${this.reviewCommentsBuffer.length} posted`);
            }
        }
    }
    async reviewCommentReply(pullNumber, topLevelComment, message) {
        const reply = `${exports.COMMENT_GREETING}

${message}

${exports.COMMENT_REPLY_TAG}
`;
        try {
            // Post the reply to the user comment
            await octokit_1.octokit.pulls.createReplyForReviewComment({
                owner: repo.owner,
                repo: repo.repo,
                // eslint-disable-next-line camelcase
                pull_number: pullNumber,
                body: reply,
                // eslint-disable-next-line camelcase
                comment_id: topLevelComment.id
            });
        }
        catch (error) {
            (0, core_1.warning)(`Failed to reply to the top-level comment ${error}`);
            try {
                await octokit_1.octokit.pulls.createReplyForReviewComment({
                    owner: repo.owner,
                    repo: repo.repo,
                    // eslint-disable-next-line camelcase
                    pull_number: pullNumber,
                    body: `Could not post the reply to the top-level comment due to the following error: ${error}`,
                    // eslint-disable-next-line camelcase
                    comment_id: topLevelComment.id
                });
            }
            catch (e) {
                (0, core_1.warning)(`Failed to reply to the top-level comment ${e}`);
            }
        }
        try {
            if (topLevelComment.body.includes(exports.COMMENT_TAG)) {
                // replace COMMENT_TAG with COMMENT_REPLY_TAG in topLevelComment
                const newBody = topLevelComment.body.replace(exports.COMMENT_TAG, exports.COMMENT_REPLY_TAG);
                await octokit_1.octokit.pulls.updateReviewComment({
                    owner: repo.owner,
                    repo: repo.repo,
                    // eslint-disable-next-line camelcase
                    comment_id: topLevelComment.id,
                    body: newBody
                });
            }
        }
        catch (error) {
            (0, core_1.warning)(`Failed to update the top-level comment ${error}`);
        }
    }
    async getCommentsWithinRange(pullNumber, path, startLine, endLine) {
        const comments = await this.listReviewComments(pullNumber);
        return comments.filter((comment) => comment.path === path &&
            comment.body !== '' &&
            ((comment.start_line !== undefined &&
                comment.start_line >= startLine &&
                comment.line <= endLine) ||
                (startLine === endLine && comment.line === endLine)));
    }
    async getCommentsAtRange(pullNumber, path, startLine, endLine) {
        const comments = await this.listReviewComments(pullNumber);
        return comments.filter((comment) => comment.path === path &&
            comment.body !== '' &&
            ((comment.start_line !== undefined &&
                comment.start_line === startLine &&
                comment.line === endLine) ||
                (startLine === endLine && comment.line === endLine)));
    }
    async getCommentChainsWithinRange(pullNumber, path, startLine, endLine, tag = '') {
        const existingComments = await this.getCommentsWithinRange(pullNumber, path, startLine, endLine);
        // find all top most comments
        const topLevelComments = [];
        for (const comment of existingComments) {
            if (!comment.in_reply_to_id) {
                topLevelComments.push(comment);
            }
        }
        let allChains = '';
        let chainNum = 0;
        for (const topLevelComment of topLevelComments) {
            // get conversation chain
            const chain = await this.composeCommentChain(existingComments, topLevelComment);
            if (chain && chain.includes(tag)) {
                chainNum += 1;
                allChains += `Conversation Chain ${chainNum}:
${chain}
---
`;
            }
        }
        return allChains;
    }
    async composeCommentChain(reviewComments, topLevelComment) {
        const conversationChain = reviewComments
            .filter((cmt) => cmt.in_reply_to_id === topLevelComment.id)
            .map((cmt) => `${cmt.user.login}: ${cmt.body}`);
        conversationChain.unshift(`${topLevelComment.user.login}: ${topLevelComment.body}`);
        return conversationChain.join('\n---\n');
    }
    async getCommentChain(pullNumber, comment) {
        try {
            const reviewComments = await this.listReviewComments(pullNumber);
            const topLevelComment = await this.getTopLevelComment(reviewComments, comment);
            const chain = await this.composeCommentChain(reviewComments, topLevelComment);
            return { chain, topLevelComment };
        }
        catch (e) {
            (0, core_1.warning)(`Failed to get conversation chain: ${e}`);
            return {
                chain: '',
                topLevelComment: null
            };
        }
    }
    async getTopLevelComment(reviewComments, comment) {
        let topLevelComment = comment;
        while (topLevelComment.in_reply_to_id) {
            const parentComment = reviewComments.find((cmt) => cmt.id === topLevelComment.in_reply_to_id);
            if (parentComment) {
                topLevelComment = parentComment;
            }
            else {
                break;
            }
        }
        return topLevelComment;
    }
    reviewCommentsCache = {};
    async listReviewComments(target) {
        if (this.reviewCommentsCache[target]) {
            return this.reviewCommentsCache[target];
        }
        const allComments = [];
        let page = 1;
        try {
            for (;;) {
                const { data: comments } = await octokit_1.octokit.pulls.listReviewComments({
                    owner: repo.owner,
                    repo: repo.repo,
                    // eslint-disable-next-line camelcase
                    pull_number: target,
                    page,
                    // eslint-disable-next-line camelcase
                    per_page: 100
                });
                allComments.push(...comments);
                page++;
                if (!comments || comments.length < 100) {
                    break;
                }
            }
            this.reviewCommentsCache[target] = allComments;
            return allComments;
        }
        catch (e) {
            (0, core_1.warning)(`Failed to list review comments: ${e}`);
            return allComments;
        }
    }
    async create(body, target) {
        try {
            // get comment ID from the response
            const response = await octokit_1.octokit.issues.createComment({
                owner: repo.owner,
                repo: repo.repo,
                // eslint-disable-next-line camelcase
                issue_number: target,
                body
            });
            // add comment to issueCommentsCache
            if (this.issueCommentsCache[target]) {
                this.issueCommentsCache[target].push(response.data);
            }
            else {
                this.issueCommentsCache[target] = [response.data];
            }
        }
        catch (e) {
            (0, core_1.warning)(`Failed to create comment: ${e}`);
        }
    }
    async replace(body, tag, target) {
        try {
            const cmt = await this.findCommentWithTag(tag, target);
            if (cmt) {
                await octokit_1.octokit.issues.updateComment({
                    owner: repo.owner,
                    repo: repo.repo,
                    // eslint-disable-next-line camelcase
                    comment_id: cmt.id,
                    body
                });
            }
            else {
                await this.create(body, target);
            }
        }
        catch (e) {
            (0, core_1.warning)(`Failed to replace comment: ${e}`);
        }
    }
    async findCommentWithTag(tag, target) {
        try {
            const comments = await this.listComments(target);
            for (const cmt of comments) {
                if (cmt.body && cmt.body.includes(tag)) {
                    return cmt;
                }
            }
            return null;
        }
        catch (e) {
            (0, core_1.warning)(`Failed to find comment with tag: ${e}`);
            return null;
        }
    }
    issueCommentsCache = {};
    async listComments(target) {
        if (this.issueCommentsCache[target]) {
            return this.issueCommentsCache[target];
        }
        const allComments = [];
        let page = 1;
        try {
            for (;;) {
                const { data: comments } = await octokit_1.octokit.issues.listComments({
                    owner: repo.owner,
                    repo: repo.repo,
                    // eslint-disable-next-line camelcase
                    issue_number: target,
                    page,
                    // eslint-disable-next-line camelcase
                    per_page: 100
                });
                allComments.push(...comments);
                page++;
                if (!comments || comments.length < 100) {
                    break;
                }
            }
            this.issueCommentsCache[target] = allComments;
            return allComments;
        }
        catch (e) {
            (0, core_1.warning)(`Failed to list comments: ${e}`);
            return allComments;
        }
    }
    // function that takes a comment body and returns the list of commit ids that have been reviewed
    // commit ids are comments between the commit_ids_reviewed_start and commit_ids_reviewed_end markers
    // <!-- [commit_id] -->
    getReviewedCommitIds(commentBody) {
        const start = commentBody.indexOf(exports.COMMIT_ID_START_TAG);
        const end = commentBody.indexOf(exports.COMMIT_ID_END_TAG);
        if (start === -1 || end === -1) {
            return [];
        }
        const ids = commentBody.substring(start + exports.COMMIT_ID_START_TAG.length, end);
        // remove the <!-- and --> markers from each id and extract the id and remove empty strings
        return ids
            .split('<!--')
            .map(id => id.replace('-->', '').trim())
            .filter(id => id !== '');
    }
    // get review commit ids comment block from the body as a string
    // including markers
    getReviewedCommitIdsBlock(commentBody) {
        const start = commentBody.indexOf(exports.COMMIT_ID_START_TAG);
        const end = commentBody.indexOf(exports.COMMIT_ID_END_TAG);
        if (start === -1 || end === -1) {
            return '';
        }
        return commentBody.substring(start, end + exports.COMMIT_ID_END_TAG.length);
    }
    // add a commit id to the list of reviewed commit ids
    // if the marker doesn't exist, add it
    addReviewedCommitId(commentBody, commitId) {
        const start = commentBody.indexOf(exports.COMMIT_ID_START_TAG);
        const end = commentBody.indexOf(exports.COMMIT_ID_END_TAG);
        if (start === -1 || end === -1) {
            return `${commentBody}\n${exports.COMMIT_ID_START_TAG}\n<!-- ${commitId} -->\n${exports.COMMIT_ID_END_TAG}`;
        }
        const ids = commentBody.substring(start + exports.COMMIT_ID_START_TAG.length, end);
        return `${commentBody.substring(0, start + exports.COMMIT_ID_START_TAG.length)}${ids}<!-- ${commitId} -->\n${commentBody.substring(end)}`;
    }
    // given a list of commit ids provide the highest commit id that has been reviewed
    getHighestReviewedCommitId(commitIds, reviewedCommitIds) {
        for (let i = commitIds.length - 1; i >= 0; i--) {
            if (reviewedCommitIds.includes(commitIds[i])) {
                return commitIds[i];
            }
        }
        return '';
    }
    async getAllCommitIds() {
        const allCommits = [];
        let page = 1;
        let commits;
        if (context && context.payload && context.payload.pull_request != null) {
            do {
                commits = await octokit_1.octokit.pulls.listCommits({
                    owner: repo.owner,
                    repo: repo.repo,
                    // eslint-disable-next-line camelcase
                    pull_number: context.payload.pull_request.number,
                    // eslint-disable-next-line camelcase
                    per_page: 100,
                    page
                });
                allCommits.push(...commits.data.map(commit => commit.sha));
                page++;
            } while (commits.data.length > 0);
        }
        return allCommits;
    }
    // add in-progress status to the comment body
    addInProgressStatus(commentBody, statusMsg) {
        const start = commentBody.indexOf(exports.IN_PROGRESS_START_TAG);
        const end = commentBody.indexOf(exports.IN_PROGRESS_END_TAG);
        // add to the beginning of the comment body if the marker doesn't exist
        // otherwise do nothing
        if (start === -1 || end === -1) {
            return `${exports.IN_PROGRESS_START_TAG}

Currently reviewing new changes in this PR...

${statusMsg}

${exports.IN_PROGRESS_END_TAG}

---

${commentBody}`;
        }
        return commentBody;
    }
    // remove in-progress status from the comment body
    removeInProgressStatus(commentBody) {
        const start = commentBody.indexOf(exports.IN_PROGRESS_START_TAG);
        const end = commentBody.indexOf(exports.IN_PROGRESS_END_TAG);
        // remove the in-progress status if the marker exists
        // otherwise do nothing
        if (start !== -1 && end !== -1) {
            return (commentBody.substring(0, start) +
                commentBody.substring(end + exports.IN_PROGRESS_END_TAG.length));
        }
        return commentBody;
    }
}
exports.Commenter = Commenter;
