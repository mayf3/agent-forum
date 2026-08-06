// index.ts — barrel re-export（显式匹配原始 data-access.ts 公共 API，符号集合 diff 为空）

// shared.ts — 公共工具（内部事务重试工具不暴露）
export { normalizeMentions, findPrincipalsByAgentIds } from './shared.js';

// threads.ts
export type { CreateThreadInput, ThreadFilter } from './threads.js';
export { createThread, findThreadById, findThreads, updateThread, softDeleteThread, createContextSnapshot, findSnapshotsByThreadId } from './threads.js';

// messages.ts
export type { CreateMessageInput } from './messages.js';
export { createMessage, findMessagesByThreadId, softDeleteMessage } from './messages.js';

// watch.ts
export { watchThread, unwatchThread, markThreadRead, batchMarkRead, addParticipant, findParticipant, findParticipantsByThreadId, updateParticipant, softDeleteParticipant } from './watch.js';

// notifications.ts
export type { NotificationItem, NotificationsResult } from './notifications.js';
export { findMyNotifications } from './notifications.js';

// stats.ts
export type { ForumStats } from './stats.js';
export { getForumStats } from './stats.js';

// search.ts
export { searchAll } from './search.js';

// outcomes.ts
export { createOutcome, findOutcomesByThreadId, findLatestOutcomeByThreadId } from './outcomes.js';

// review.ts
export type { ReviewReadinessResult } from './review.js';
export { getThreadReviewReadiness, buildTranscriptMd } from './review.js';
