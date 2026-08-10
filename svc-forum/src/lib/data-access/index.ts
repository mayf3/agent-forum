// index.ts — barrel re-export（显式匹配原始 data-access.ts 公共 API，符号集合 diff 为空）

// shared.ts — 公共工具（内部事务重试工具不暴露）
export { normalizeMentions, findPrincipalsByAgentIds } from './shared.js';

// threads.ts
export type { CreateThreadInput, ThreadFilter } from './threads.js';
export { createThread, findThreadById, findThreads, updateThread, softDeleteThread, createContextSnapshot, findSnapshotsByThreadId } from './threads.js';
export { heatScore, HOT_WEIGHT_VIEW, HOT_WEIGHT_MSG, HOT_WEIGHT_RECENCY, HOT_DECAY_PER_DAY, HOT_CANDIDATE_POOL } from './threads.js';

// views.ts — 阅读量追踪（AC#1: viewCount 按 principal 去重计次）
export { recordView } from './views.js';

// messages.ts
export type { CreateMessageInput } from './messages.js';
export { createMessage, findMessagesByThreadId, softDeleteMessage } from './messages.js';

// reactions.ts — 消息级反应（点赞/表情，AC#1-AC#4）
export type { ReactionSummary } from './reactions.js';
export { summarizeReactions, addReaction, removeReaction, getReactionsForMessage } from './reactions.js';

// watch.ts
export { watchThread, unwatchThread, markThreadRead, batchMarkRead, addParticipant, findParticipant, findParticipantsByThreadId, updateParticipant, softDeleteParticipant } from './watch.js';

// notifications.ts
export type { NotificationItem, NotificationsResult } from './notifications.js';
export { findMyNotifications } from './notifications.js';

// stats.ts
export type { ForumStats, TagStat } from './stats.js';
export { getForumStats, getTagStats } from './stats.js';

// search.ts — 全文搜索（AC: relevance + excerpt + pagination，合并自 feat/fulltext-search-d56dd713）
export type { SearchResultItem, SearchResults } from './search.js';
export { extractExcerpt, relevanceScore, searchAll } from './search.js';

// outcomes.ts
export { createOutcome, findOutcomesByThreadId, findLatestOutcomeByThreadId } from './outcomes.js';

// review.ts
export type { ReviewReadinessResult } from './review.js';
export { getThreadReviewReadiness, buildTranscriptMd } from './review.js';

// reports.ts — 举报队列（moderation queue，合并自 feat/report-entry-928ed7c6）
export type { CreateReportInput, ReportFilter, ReportAction } from './reports.js';
export { REPORT_REASONS, REPORT_STATUSES, REPORT_TARGET_TYPES, assertReportTargetExists, createReport, findReports, findReportById, reportStatusForAction, handleReport } from './reports.js';
