// yadonghaja-sync — 최소 Workers (D1 + R2 연동 준비)
// 실제 동기화는 Syncular 라이브러리를 import 하여 사용

export interface Env {
  DB: D1Database;
  BUCKET: R2Bucket;
  SYNC_HMAC_KEY: string;
  R2_ACCOUNT_ID: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  SYNC_COORDINATOR: DurableObjectNamespace;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    
    // CORS 헤더
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-user',
    };
    
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }
    
    // 인증 (x-user 헤더)
    const actorId = request.headers.get('x-user');
    if (!actorId && !url.pathname.startsWith('/health')) {
      return new Response('Unauthorized', { status: 401, headers: corsHeaders });
    }
    
    // Health check
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({
        status: 'ok',
        timestamp: Date.now(),
        actorId: actorId || 'anonymous'
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    
    // Sync 엔드포인트 (Syncular 가 사용)
    if (url.pathname === '/sync') {
      // Syncular 핸들러 — 실제 구현은 @syncular/server 사용
      return new Response(JSON.stringify({
        message: 'Sync endpoint ready',
        actorId,
        method: request.method
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    
    // 세그먼트 엔드포인트
    if (url.pathname === '/segments') {
      return new Response(JSON.stringify({
        message: 'Segments endpoint ready'
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    
    // Blobs 엔드포인트 (사진 업로드용 presigned URL)
    if (url.pathname === '/blobs' && request.method === 'POST') {
      try {
        const body = await request.json<{ filename: string; contentType: string }>();
        const { filename, contentType } = body;
        
        // R2 presigned URL 생성 (간이 구현)
        const key = `photos/${actorId}/${Date.now()}-${filename}`;
        
        // 실제 presigned URL 은 AWS SDK v4 서명 필요
        // 여기서는 간단한 URL 만 반환
        const presignedUrl = `https://yadonghaja-blobs.${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${key}`;
        
        return new Response(JSON.stringify({
          uploadUrl: presignedUrl,
          publicUrl: presignedUrl,
          key
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }
    
    // 기본 404
    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  },
};
