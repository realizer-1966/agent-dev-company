import type { Schema } from "@syncular/server";

// ya-donghaja - 개인 운동 기록 + 메이트 모집 + 미션/응원/보상
// 스코프: public(posts, cheers) / user(나머지)
export const schema: Schema = {
  version: 2,
  tables: [
    // 1. workouts - 개인 운동 기록 (user)
    {
      name: "workouts",
      columns: [
        { name: "id", type: "string", nullable: false },
        { name: "user_id", type: "string", nullable: false },
        { name: "type", type: "string", nullable: false },
        { name: "duration_min", type: "integer", nullable: false },
        { name: "intensity", type: "string", nullable: false },
        { name: "memo", type: "string", nullable: true },
        { name: "date", type: "string", nullable: false },
        { name: "created_at_ms", type: "integer", nullable: false },
      ],
      primaryKey: "id",
      scopes: [{ pattern: "user:{user_id}", column: "user_id" }],
    },
    // 2. habits - 습관 정의 (user)
    {
      name: "habits",
      columns: [
        { name: "id", type: "string", nullable: false },
        { name: "user_id", type: "string", nullable: false },
        { name: "title", type: "string", nullable: false },
        { name: "target_days", type: "integer", nullable: false },
        { name: "created_at_ms", type: "integer", nullable: false },
      ],
      primaryKey: "id",
      scopes: [{ pattern: "user:{user_id}", column: "user_id" }],
    },
    // 3. habit_logs - 습관 달성 기록 (user)
    {
      name: "habit_logs",
      columns: [
        { name: "id", type: "string", nullable: false },
        { name: "user_id", type: "string", nullable: false },
        { name: "habit_id", type: "string", nullable: false },
        { name: "date", type: "string", nullable: false },
        { name: "created_at_ms", type: "integer", nullable: false },
      ],
      primaryKey: "id",
      scopes: [{ pattern: "user:{user_id}", column: "user_id" }],
    },
    // 4. streaks - 연속 기록 (user)
    {
      name: "streaks",
      columns: [
        { name: "id", type: "string", nullable: false },
        { name: "user_id", type: "string", nullable: false },
        { name: "current", type: "integer", nullable: false },
        { name: "best", type: "integer", nullable: false },
        { name: "last_date", type: "string", nullable: true },
        { name: "updated_at_ms", type: "integer", nullable: false },
      ],
      primaryKey: "id",
      scopes: [{ pattern: "user:{user_id}", column: "user_id" }],
    },
    // 5. posts - 메이트 모집글 (public)
    {
      name: "posts",
      columns: [
        { name: "id", type: "string", nullable: false },
        { name: "public_id", type: "string", nullable: false },
        { name: "author_id", type: "string", nullable: false },
        { name: "author_name", type: "string", nullable: false },
        { name: "author_avatar", type: "string", nullable: false },
        { name: "types", type: "json", nullable: false },
        { name: "mode", type: "string", nullable: false },
        { name: "region", type: "string", nullable: false },
        { name: "days", type: "json", nullable: false },
        { name: "time_slot", type: "string", nullable: false },
        { name: "capacity", type: "integer", nullable: false },
        { name: "intro", type: "string", nullable: false },
        { name: "deadline", type: "string", nullable: false },
        { name: "status", type: "string", nullable: false },
        { name: "created_at_ms", type: "integer", nullable: true },
        { name: "updated_at_ms", type: "integer", nullable: false },
      ],
      primaryKey: "id",
      scopes: [{ pattern: "public:{public_id}", column: "public_id" }],
    },
    // 6. applications - 모집 신청 (public: 방장이 신청자 목록을 봐야 함)
    {
      name: "applications",
      columns: [
        { name: "id", type: "string", nullable: false },
        { name: "public_id", type: "string", nullable: false },
        { name: "user_id", type: "string", nullable: false },
        { name: "post_id", type: "string", nullable: false },
        { name: "post_author_id", type: "string", nullable: false },
        { name: "applicant_name", type: "string", nullable: false },
        { name: "applicant_avatar", type: "string", nullable: false },
        { name: "status", type: "string", nullable: false },
        { name: "message", type: "string", nullable: true },
        { name: "created_at_ms", type: "integer", nullable: false },
      ],
      primaryKey: "id",
      scopes: [{ pattern: "public:{public_id}", column: "public_id" }],
    },
    // 7. missions - 메이트에게 부여된 미션 (public: 부여자도 봐야 함)
    {
      name: "missions",
      columns: [
        { name: "id", type: "string", nullable: false },
        { name: "public_id", type: "string", nullable: false },
        { name: "user_id", type: "string", nullable: false },
        { name: "assigner_id", type: "string", nullable: false },
        { name: "title", type: "string", nullable: false },
        { name: "goal", type: "integer", nullable: false },
        { name: "status", type: "string", nullable: false },
        { name: "due_date", type: "string", nullable: true },
        { name: "created_at_ms", type: "integer", nullable: false },
        { name: "updated_at_ms", type: "integer", nullable: false },
      ],
      primaryKey: "id",
      scopes: [{ pattern: "public:{public_id}", column: "public_id" }],
    },
    // 8. cheers - 응원 (public)
    {
      name: "cheers",
      columns: [
        { name: "id", type: "string", nullable: false },
        { name: "public_id", type: "string", nullable: false },
        { name: "target_user_id", type: "string", nullable: false },
        { name: "from_user_id", type: "string", nullable: false },
        { name: "cheer_type", type: "string", nullable: false },
        { name: "created_at_ms", type: "integer", nullable: false },
      ],
      primaryKey: "id",
      scopes: [{ pattern: "public:{public_id}", column: "public_id" }],
    },
    // 9. point_ledger - 포인트 내역 (user)
    {
      name: "point_ledger",
      columns: [
        { name: "id", type: "string", nullable: false },
        { name: "user_id", type: "string", nullable: false },
        { name: "amount", type: "integer", nullable: false },
        { name: "reason", type: "string", nullable: false },
        { name: "balance_after", type: "integer", nullable: false },
        { name: "created_at_ms", type: "integer", nullable: false },
      ],
      primaryKey: "id",
      scopes: [{ pattern: "user:{user_id}", column: "user_id" }],
    },
  ],
};
