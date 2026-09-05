// yadonghaja-sync — Cloudflare Workers (v2.4)
// health/sync/segments/blobs 엔드포인트 제공

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    // CORS 헤더 (모든 응답에 포함)
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, x-user, Authorization',
    };
    
    // OPTIONS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }
    
    // x-user 헤더 확인 (health 는 제외)
    const actorId = request.headers.get('x-user');
    const isHealth = url.pathname === '/health';
    
    if (!actorId && !isHealth) {
      return new Response(JSON.stringify({
        error: 'Unauthorized',
        message: 'x-user header required',
        hint: 'Add header: x-user: your-actor-id'
      }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    
    // Health check (인증 불필요)
    if (isHealth) {
      return new Response(JSON.stringify({
        status: 'ok',
        timestamp: Date.now(),
        actorId: actorId || 'anonymous',
        worker: 'yadonghaja-sync v2.4',
        d1: env.DB ? 'connected' : 'not-configured',
        r2: env.BUCKET ? 'connected' : 'not-configured'
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    
    // Sync 엔드포인트
    if (url.pathname === '/sync') {
      return new Response(JSON.stringify({
        message: 'Sync endpoint ready',
        actorId,
        method: request.method,
        path: url.pathname
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    
    // Segments 엔드포인트
    if (url.pathname === '/segments') {
      return new Response(JSON.stringify({
        message: 'Segments endpoint ready',
        actorId
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    
    // Blobs 엔드포인트 (사진 업로드용)
    if (url.pathname === '/blobs' && request.method === 'POST') {
      try {
        const body = await request.json();
        const { filename, contentType } = body;
        
        if (!filename) {
          return new Response(JSON.stringify({
            error: 'Bad Request',
            message: 'filename is required'
          }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
        
        // R2 presigned URL 생성 (간이)
        const key = `photos/${actorId}/${Date.now()}-${filename}`;
        const presignedUrl = env.BUCKET 
          ? `https://yadonghaja-blobs.${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${key}`
          : `https://placeholder.blobs/${key}`;
        
        return new Response(JSON.stringify({
          uploadUrl: presignedUrl,
          publicUrl: presignedUrl,
          key,
          message: 'R2 not configured yet (v2.4)'
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } catch (e) {
        return new Response(JSON.stringify({
          error: 'Bad Request',
          message: e.message
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }
    
    // 404 Not Found
    return new Response(JSON.stringify({
      error: 'Not Found',
      path: url.pathname,
      available: ['/health', '/sync', '/segments', '/blobs']
    }), {
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  },
};
