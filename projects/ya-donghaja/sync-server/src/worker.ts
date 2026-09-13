// ya-donghaja sync 서버 - Syncular 공식
import {
  D1ServerStorage,
  S3BlobStore,
  S3SegmentStore,
  s3PresignedUrls,
  s3PresignedBlobUrls,
  type SyncServerConfig,
} from "@syncular/server";
import { createWorkersFetchHandler } from "@syncular/server-workers";
import { schema } from "./schema";

interface Env {
  DB: D1Database;
  R2_ACCOUNT_ID: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  BUCKET: R2Bucket;
}

function r2Config(env: Env) {
  return {
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    region: "auto" as const,
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  };
}

function syncConfig(env: Env): SyncServerConfig {
  const r2 = r2Config(env);
  const segments = new S3SegmentStore({ ...r2, bucket: "ya-donghaja-segments" });
  const blobs = new S3BlobStore({ ...r2, bucket: "ya-donghaja-blobs" });
  return {
    schema,
    storage: new D1ServerStorage(env.DB, { pushApplySerialized: true }),
    segments,
    blobs,
    signedUrls: s3PresignedUrls(segments, { ttlSeconds: 900 }),
    blobSignedUrls: s3PresignedBlobUrls(blobs, { ttlSeconds: 900 }),
    resolveScopes: async ({ actorId }) => {
      return {
        public_id: ["main"],
        user_id: [actorId],
      };
    },
  };
}

function authenticate(request: Request, env: Env) {
  const actorId = request.headers.get("x-user");
  if (!actorId) return undefined;
  return { actorId, partition: "main" };
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Max-Age": "86400",
};

const handler = createWorkersFetchHandler<Env>({
  config: (env) => ({
    config: syncConfig(env),
    authenticate: (request) => authenticate(request, env),
  }),
});

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    const response = await handler(request, env, ctx);
    const newHeaders = new Headers(response.headers);
    newHeaders.set("Access-Control-Allow-Origin", "*");
    newHeaders.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    newHeaders.set("Access-Control-Allow-Headers", "*");
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders,
    });
  },
};
