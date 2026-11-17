/**
 * WORLD ECHO (世界回声) - Serverless Backend Handler
 * Cloudflare Pages Functions: /api/echo
 */

// 自定义校验错误类（携带 HTTP 状态码）
class ValidationError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "ValidationError";
    this.status = status;
    this.isValidation = true;
  }
}

// 内存访问限流池（每个 IP 每分钟最多 10 次 POST）
const postRateLimitMap = new Map();

function checkRateLimit(clientIp) {
  const now = Date.now();
  const entry = postRateLimitMap.get(clientIp);

  if (!entry || now > entry.resetTime) {
    // 内存过大时清理已过期的 key
    if (postRateLimitMap.size > 5000) {
      for (const [ip, item] of postRateLimitMap.entries()) {
        if (now > item.resetTime) {
          postRateLimitMap.delete(ip);
        }
      }
    }
    postRateLimitMap.set(clientIp, { count: 1, resetTime: now + 60000 });
    return true;
  }

  if (entry.count >= 10) {
    return false;
  }

  entry.count += 1;
  return true;
}

// 恒定时间字符串比较（防止时序侧信道攻击）
function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const encoder = new TextEncoder();
  const bufA = encoder.encode(a);
  const bufB = encoder.encode(b);

  const lenA = bufA.length;
  const lenB = bufB.length;
  const maxLen = Math.max(lenA, lenB);

  let diff = lenA ^ lenB;
  for (let i = 0; i < maxLen; i++) {
    const byteA = i < lenA ? bufA[i] : 0;
    const byteB = i < lenB ? bufB[i] : 0;
    diff |= (byteA ^ byteB);
  }
  return diff === 0;
}

// 允许跨域请求头辅助函数
function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-admin-password, x-user-id, x-user-token",
    "Access-Control-Max-Age": "86400",
  };
}

// JSON 统一响应封装
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders(),
    },
  });
}

// 错误响应封装
function errorResponse(message, status = 400) {
  return jsonResponse({ success: false, error: message }, status);
}

// SHA-256 Token 哈希计算（Web Crypto API）
async function hashToken(token) {
  if (!token || typeof token !== "string") return "";
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ISO 3166-1 alpha-2 国家代码获取（Cloudflare 请求头）
function getVisitorCountry(request, hideCountry = false) {
  if (hideCountry) return "UN";
  const cfCountry = request.cf?.country || request.headers.get("CF-IPCountry") || "UN";
  const upper = cfCountry.toUpperCase();
  return /^[A-Z]{2}$/.test(upper) ? upper : "UN";
}

// 验证/渐进式创建用户身份
async function authenticateUser(db, userId, token, nickname = "") {
  if (!userId || !token) {
    throw new ValidationError("Missing user_id or token", 400);
  }
  const tokenHash = await hashToken(token);
  
  // 查询用户
  const existingUser = await db.prepare("SELECT * FROM users WHERE id = ?").bind(userId).first();
  
  if (!existingUser) {
    // 渐进式新建用户
    const cleanNick = (nickname || `Voyager #${userId.slice(-4)}`).trim().slice(0, 50);
    await db.prepare(
      "INSERT INTO users (id, nickname, token_hash, status) VALUES (?, ?, ?, 'active')"
    ).bind(userId, cleanNick, tokenHash).run();
    return { id: userId, nickname: cleanNick, status: "active" };
  }

  // 校验 Token Hash
  if (existingUser.token_hash !== tokenHash) {
    throw new ValidationError("Invalid token authentication", 401);
  }

  if (existingUser.status === "banned") {
    throw new ValidationError("Account has been banned", 403);
  }

  // 如果传了新昵称，则同步更新
  if (nickname && nickname.trim() && nickname.trim() !== existingUser.nickname) {
    const cleanNick = nickname.trim().slice(0, 50);
    await db.prepare("UPDATE users SET nickname = ? WHERE id = ?").bind(cleanNick, userId).run();
    existingUser.nickname = cleanNick;
  }

  return existingUser;
}

// GitHub 语音上传（含 409 Conflict 自动重试机制）
async function uploadToGitHub(env, mediaKey, base64Content, retries = 2) {
  if (!env.GITHUB_REPO || !env.GITHUB_TOKEN) {
    throw new Error("Server configuration error: GITHUB_REPO or GITHUB_TOKEN is not configured");
  }

  const url = `https://api.github.com/repos/${env.GITHUB_REPO}/contents/${mediaKey}`;
  
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url, {
      method: "PUT",
      headers: {
        "Authorization": `Bearer ${env.GITHUB_TOKEN}`,
        "User-Agent": "World-Echo-Cloudflare-Worker",
        "Content-Type": "application/json",
        "Accept": "application/vnd.github.v3+json",
      },
      body: JSON.stringify({
        message: `Upload voice echo: ${mediaKey}`,
        content: base64Content,
      }),
    });

    if (res.status === 201 || res.status === 200) {
      return await res.json();
    }

    // 遇到 409 并发冲突，延迟 300ms 重试
    if (res.status === 409 && attempt < retries) {
      await new Promise((resolve) => setTimeout(resolve, 300));
      continue;
    }

    const errText = await res.text();
    throw new Error(`GitHub upload failed (${res.status}): ${errText}`);
  }
}

// GitHub 语音物理删除（先取 SHA，再调用 DELETE）
async function deleteFromGitHub(env, mediaKey) {
  if (!mediaKey || !env.GITHUB_REPO || !env.GITHUB_TOKEN) return false;

  const url = `https://api.github.com/repos/${env.GITHUB_REPO}/contents/${mediaKey}`;
  try {
    // 1. 获取文件 SHA
    const getRes = await fetch(url, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${env.GITHUB_TOKEN}`,
        "User-Agent": "World-Echo-Cloudflare-Worker",
        "Accept": "application/vnd.github.v3+json",
      },
    });

    if (getRes.status === 404) return true; // 文件已被移除
    if (!getRes.ok) return false;

    const fileData = await getRes.json();
    const sha = fileData.sha;
    if (!sha) return false;

    // 2. 发起 DELETE 删除
    const delRes = await fetch(url, {
      method: "DELETE",
      headers: {
        "Authorization": `Bearer ${env.GITHUB_TOKEN}`,
        "User-Agent": "World-Echo-Cloudflare-Worker",
        "Content-Type": "application/json",
        "Accept": "application/vnd.github.v3+json",
      },
      body: JSON.stringify({
        message: `Delete voice echo: ${mediaKey}`,
        sha: sha,
      }),
    });

    return delRes.ok;
  } catch (err) {
    console.error("Failed to delete from GitHub:", err);
    return false;
  }
}

// 检查是否具备管理员权限（恒定时间比较）
function isAdmin(request, env) {
  const adminPassHeader = request.headers.get("x-admin-password");
  if (!env.ADMIN_PASSWORD || !adminPassHeader) return false;
  return timingSafeEqual(adminPassHeader, env.ADMIN_PASSWORD);
}

// ArrayBuffer 转 Base64 辅助函数
function arrayBufferToBase64(buffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// ======================== Cloudflare Pages Functions 路由入口 ========================

// 处理 OPTIONS 预检请求
export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(),
  });
}

// GET /api/echo: 获取地球统计、情绪天气与留言流
export async function onRequestGet(context) {
  const { request, env } = context;
  const db = env.DB;
  if (!db) {
    return errorResponse("Database binding 'DB' is not configured in Cloudflare Pages", 500);
  }

  const url = new URL(request.url);

  // 输入校验与白名单机制
  const rawCountry = url.searchParams.get("country");
  let countryParam = null;
  if (rawCountry && rawCountry !== "ALL") {
    const upper = rawCountry.toUpperCase();
    if (/^[A-Z]{2}$/.test(upper)) {
      countryParam = upper;
    }
  }

  const emotionParam = url.searchParams.get("emotion");
  const typeParam = url.searchParams.get("type");

  const rawSort = url.searchParams.get("sort");
  const allowedSorts = ["latest", "popular", "random"];
  const sortParam = allowedSorts.includes(rawSort) ? rawSort : "latest";

  const postIdParam = url.searchParams.get("post_id");
  const adminParam = url.searchParams.get("admin") === "1" || url.searchParams.get("admin") === "true";
  const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "30", 10), 1), 100);
  const offset = Math.max(parseInt(url.searchParams.get("offset") || "0", 10), 0);

  const adminAuthorized = adminParam && isAdmin(request, env);
  const visitorCountry = getVisitorCountry(request, false);

  try {
    // 1. 获取各国聚合数据（用于 3D 地球光点与光柱渲染）
    const countriesResult = await db.prepare(`
      SELECT country_code, COUNT(*) as total,
             SUM(CASE WHEN content_type = 'voice' THEN 1 ELSE 0 END) as voices
      FROM posts
      WHERE status = 'published'
      GROUP BY country_code
      ORDER BY total DESC
    `).all();

    // 2. 获取全球情绪聚合统计（用于世界情绪天气面板）
    const moodsResult = await db.prepare(`
      SELECT emotion, COUNT(*) as count
      FROM posts
      WHERE status = 'published'
      GROUP BY emotion
      ORDER BY count DESC
    `).all();

    // 3. 构建主留言列表 SQL 查询
    let whereClauses = [];
    let queryBindings = [];

    if (adminAuthorized) {
      // 管理员模式：可查看所有状态，支持单独过滤被举报的内容
      const statusFilter = url.searchParams.get("status");
      if (statusFilter) {
        whereClauses.push("status = ?");
        queryBindings.push(statusFilter);
      } else {
        whereClauses.push("status != 'deleted'");
      }
      if (url.searchParams.get("reported") === "1") {
        whereClauses.push("reports_count > 0");
      }
    } else {
      // 普通访客：仅展示 published 状态
      whereClauses.push("status = 'published'");
    }

    if (postIdParam) {
      const parsedId = parseInt(postIdParam, 10);
      if (!isNaN(parsedId)) {
        whereClauses.push("id = ?");
        queryBindings.push(parsedId);
      }
    } else {
      if (countryParam) {
        whereClauses.push("country_code = ?");
        queryBindings.push(countryParam);
      }
      if (emotionParam && emotionParam !== "all") {
        whereClauses.push("emotion = ?");
        queryBindings.push(emotionParam.toLowerCase());
      }
      if (typeParam && (typeParam === "text" || typeParam === "voice")) {
        whereClauses.push("content_type = ?");
        queryBindings.push(typeParam);
      }
    }

    const whereSQL = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";

    // 分页总数查询（使用相同的过滤条件）
    const countSQL = `SELECT COUNT(*) as total FROM posts ${whereSQL}`;
    const countResult = await db.prepare(countSQL).bind(...queryBindings).first();
    const totalCount = countResult?.total || 0;

    let orderSQL = "ORDER BY id DESC";
    if (sortParam === "popular") {
      orderSQL = "ORDER BY likes_count DESC, id DESC";
    } else if (sortParam === "random") {
      orderSQL = "ORDER BY RANDOM()";
    }

    const postsSQL = `
      SELECT id, user_id, nickname, country_code, content_type, content, emotion,
             media_url, media_key, duration, likes_count, comments_count, reports_count,
             status, created_at
      FROM posts
      ${whereSQL}
      ${orderSQL}
      LIMIT ? OFFSET ?
    `;

    const finalBindings = [...queryBindings, limit, offset];
    const postsResult = await db.prepare(postsSQL).bind(...finalBindings).all();

    // 4. 如果查询了单条留言详情（含 post_id），附带查询其评论列表
    let comments = [];
    if (postIdParam && postsResult.results && postsResult.results.length > 0) {
      const commentsResult = await db.prepare(`
        SELECT id, post_id, user_id, nickname, country_code, content, created_at
        FROM comments
        WHERE post_id = ?
        ORDER BY id ASC
      `).bind(parseInt(postIdParam, 10)).all();
      comments = commentsResult.results || [];
    }

    // 5. 如果是管理员模式，额外附带系统统计数据
    let adminStats = null;
    if (adminAuthorized) {
      const totalPosts = await db.prepare("SELECT COUNT(*) as cnt FROM posts WHERE status != 'deleted'").first();
      const reportedPosts = await db.prepare("SELECT COUNT(*) as cnt FROM posts WHERE reports_count > 0 AND status != 'deleted'").first();
      const hiddenPosts = await db.prepare("SELECT COUNT(*) as cnt FROM posts WHERE status = 'hidden'").first();
      const totalUsers = await db.prepare("SELECT COUNT(*) as cnt FROM users").first();
      adminStats = {
        total_posts: totalPosts?.cnt || 0,
        reported_posts: reportedPosts?.cnt || 0,
        hidden_posts: hiddenPosts?.cnt || 0,
        total_users: totalUsers?.cnt || 0,
      };
    }

    return jsonResponse({
      success: true,
      visitor_country: visitorCountry,
      countries: countriesResult.results || [],
      moods: moodsResult.results || [],
      total_count: totalCount,
      posts: postsResult.results || [],
      comments: comments,
      admin_stats: adminStats,
    });
  } catch (err) {
    console.error("GET /api/echo error:", err);
    return errorResponse("An internal error occurred", 500);
  }
}

// POST /api/echo: 发布内容（文字/语音）及互动（点赞、回复、举报、管理员审核）
export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.DB;
  if (!db) {
    return errorResponse("Database binding 'DB' is not configured in Cloudflare Pages", 500);
  }

  // 1. IP 访问频率限制（每 IP 每分钟最大 10 次 POST）
  const clientIp = request.headers.get("CF-Connecting-IP") || "unknown";
  if (!checkRateLimit(clientIp)) {
    return errorResponse("Too Many Requests: Rate limit exceeded. Max 10 requests per minute.", 429);
  }

  try {
    const contentType = request.headers.get("content-type") || "";
    let data = {};
    let file = null;

    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      formData.forEach((value, key) => {
        if (key === "file" && typeof value === "object" && typeof value.arrayBuffer === "function") {
          file = value;
        } else {
          data[key] = value;
        }
      });
    } else {
      data = await request.json().catch(() => ({}));
    }

    const action = data.action || "create";

    // ----------------- ACTION: CREATE (发布文字或语音回声) -----------------
    if (action === "create") {
      const userId = data.user_id;
      const token = data.token;
      const nickname = data.nickname || "";
      const postType = data.content_type === "voice" ? "voice" : "text";
      const hideCountry = data.hide_country === "1" || data.hide_country === "true" || data.hide_country === true;
      const countryCode = getVisitorCountry(request, hideCountry);
      const allowedEmotions = ["happy", "sad", "lonely", "calm", "angry", "anxious", "tired", "love", "hopeful"];
      const emotion = allowedEmotions.includes(data.emotion) ? data.emotion : "calm";
      let content = (data.content || "").trim();
      let duration = parseInt(data.duration || "0", 10);
      let mediaUrl = null;
      let mediaKey = null;

      // 验证身份
      const authUser = await authenticateUser(db, userId, token, nickname);

      if (postType === "text") {
        if (!content) {
          return errorResponse("Text content cannot be empty");
        }
        if (content.length > 1000) {
          return errorResponse("Text content cannot exceed 1000 characters");
        }
      } else {
        // 语音类型发布
        if (!file) {
          return errorResponse("Audio file is required for voice echoes");
        }
        if (file.size > 2 * 1024 * 1024) {
          return errorResponse("Audio file size cannot exceed 2MB");
        }

        const buffer = await file.arrayBuffer();
        const base64Audio = arrayBufferToBase64(buffer);
        const uuid = crypto.randomUUID();
        const extension = (file.name && file.name.split(".").pop()) || "webm";
        mediaKey = `voices/${uuid}.${extension}`;

        // 上传至 GitHub 仓库
        await uploadToGitHub(env, mediaKey, base64Audio);

        // 生成 jsDelivr CDN 直链
        mediaUrl = `https://cdn.jsdelivr.net/gh/${env.GITHUB_REPO}@main/${mediaKey}`;
        if (content.length > 1000) {
          content = content.slice(0, 1000);
        }
      }

      const insertResult = await db.prepare(`
        INSERT INTO posts (
          user_id, nickname, country_code, content_type, content, emotion,
          media_url, media_key, duration, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'published')
      `).bind(
        authUser.id,
        authUser.nickname,
        countryCode,
        postType,
        content,
        emotion,
        mediaUrl,
        mediaKey,
        duration
      ).run();

      const newPostId = insertResult.meta?.last_row_id;
      const createdPost = await db.prepare("SELECT * FROM posts WHERE id = ?").bind(newPostId).first();

      return jsonResponse({
        success: true,
        post: createdPost,
      }, 201);
    }

    // ----------------- ACTION: LIKE (点赞 / 取消点赞) -----------------
    if (action === "like") {
      const { user_id: userId, token, post_id: postId } = data;
      if (!postId) return errorResponse("Missing post_id");
      await authenticateUser(db, userId, token);

      const targetPost = await db.prepare("SELECT id, likes_count FROM posts WHERE id = ?").bind(postId).first();
      if (!targetPost) return errorResponse("Post not found", 404);

      // 查询是否已点赞
      const existingLike = await db.prepare("SELECT * FROM likes WHERE user_id = ? AND post_id = ?").bind(userId, postId).first();

      if (existingLike) {
        // 取消点赞
        await db.prepare("DELETE FROM likes WHERE user_id = ? AND post_id = ?").bind(userId, postId).run();
        await db.prepare("UPDATE posts SET likes_count = MAX(0, likes_count - 1) WHERE id = ?").bind(postId).run();
        const updated = await db.prepare("SELECT likes_count FROM posts WHERE id = ?").bind(postId).first();
        return jsonResponse({ success: true, liked: false, likes_count: updated.likes_count });
      } else {
        // 点赞
        await db.prepare("INSERT INTO likes (user_id, post_id) VALUES (?, ?)").bind(userId, postId).run();
        await db.prepare("UPDATE posts SET likes_count = likes_count + 1 WHERE id = ?").bind(postId).run();
        const updated = await db.prepare("SELECT likes_count FROM posts WHERE id = ?").bind(postId).first();
        return jsonResponse({ success: true, liked: true, likes_count: updated.likes_count });
      }
    }

    // ----------------- ACTION: COMMENT (发表评论) -----------------
    if (action === "comment") {
      const { user_id: userId, token, post_id: postId, content, nickname } = data;
      if (!postId) return errorResponse("Missing post_id");
      const cleanContent = (content || "").trim();
      if (!cleanContent) return errorResponse("Comment cannot be empty");
      if (cleanContent.length > 500) return errorResponse("Comment cannot exceed 500 characters");

      const authUser = await authenticateUser(db, userId, token, nickname);
      const hideCountry = data.hide_country === "1" || data.hide_country === "true" || data.hide_country === true;
      const countryCode = getVisitorCountry(request, hideCountry);

      const insertComment = await db.prepare(`
        INSERT INTO comments (post_id, user_id, nickname, country_code, content)
        VALUES (?, ?, ?, ?, ?)
      `).bind(postId, authUser.id, authUser.nickname, countryCode, cleanContent).run();

      await db.prepare("UPDATE posts SET comments_count = comments_count + 1 WHERE id = ?").bind(postId).run();

      const newCommentId = insertComment.meta?.last_row_id;
      const createdComment = await db.prepare("SELECT * FROM comments WHERE id = ?").bind(newCommentId).first();

      return jsonResponse({ success: true, comment: createdComment }, 201);
    }

    // ----------------- ACTION: REPORT (举报留言) -----------------
    if (action === "report") {
      const { user_id: userId, token, post_id: postId, reason } = data;
      if (!postId) return errorResponse("Missing post_id");
      await authenticateUser(db, userId, token);

      const cleanReason = (reason || "违规内容").trim().slice(0, 200);

      await db.prepare(`
        INSERT INTO reports (post_id, reporter_id, reason)
        VALUES (?, ?, ?)
      `).bind(postId, userId, cleanReason).run();

      await db.prepare("UPDATE posts SET reports_count = reports_count + 1 WHERE id = ?").bind(postId).run();

      // 检查举报次数：达到 5 次自动设为 hidden 待审核
      const post = await db.prepare("SELECT reports_count FROM posts WHERE id = ?").bind(postId).first();
      if (post && post.reports_count >= 5) {
        await db.prepare("UPDATE posts SET status = 'hidden' WHERE id = ?").bind(postId).run();
      }

      return jsonResponse({ success: true, message: "Report submitted successfully" });
    }

    // ----------------- ACTION: ADMIN_UPDATE_STATUS (管理员审核操作) -----------------
    if (action === "admin_update_status") {
      if (!isAdmin(request, env)) {
        return errorResponse("Unauthorized admin operation", 401);
      }
      const { post_id: postId, status, reset_reports } = data;
      if (!postId) return errorResponse("Missing post_id");

      if (status) {
        await db.prepare("UPDATE posts SET status = ? WHERE id = ?").bind(status, postId).run();
      }
      if (reset_reports) {
        await db.prepare("UPDATE posts SET reports_count = 0 WHERE id = ?").bind(postId).run();
        await db.prepare("UPDATE reports SET status = 'resolved' WHERE post_id = ?").bind(postId).run();
      }

      return jsonResponse({ success: true, message: "Status updated" });
    }

    // ----------------- ACTION: UPDATE_NICKNAME (更新用户昵称) -----------------
    if (action === "update_nickname") {
      const { user_id: userId, token, nickname } = data;
      const cleanNick = (nickname || "").trim().slice(0, 50);
      if (!cleanNick) return errorResponse("Nickname cannot be empty");
      await authenticateUser(db, userId, token, cleanNick);
      return jsonResponse({ success: true, nickname: cleanNick });
    }

    return errorResponse(`Unknown action: ${action}`);
  } catch (err) {
    console.error("POST /api/echo error:", err);
    if (err && err.isValidation) {
      return errorResponse(err.message, err.status || 400);
    }
    return errorResponse("An internal error occurred", 500);
  }
}

// DELETE /api/echo?id=X: 双端删除（作者本人或管理员一键彻底删除）
export async function onRequestDelete(context) {
  const { request, env } = context;
  const db = env.DB;
  if (!db) {
    return errorResponse("Database binding 'DB' is not configured in Cloudflare Pages", 500);
  }

  const url = new URL(request.url);
  const postId = url.searchParams.get("id");
  if (!postId) {
    return errorResponse("Missing 'id' query parameter", 400);
  }

  try {
    const post = await db.prepare("SELECT * FROM posts WHERE id = ?").bind(postId).first();
    if (!post) {
      return errorResponse("Post not found", 404);
    }

    // 校验权限：是管理员，或是原作者（仅接受来自请求头的身份凭证）
    const adminAuth = isAdmin(request, env);
    let authorAuth = false;

    if (!adminAuth) {
      const userId = request.headers.get("x-user-id");
      const userToken = request.headers.get("x-user-token");
      if (userId && userToken && post.user_id === userId) {
        const tokenHash = await hashToken(userToken);
        const user = await db.prepare("SELECT token_hash FROM users WHERE id = ?").bind(userId).first();
        if (user && user.token_hash === tokenHash) {
          authorAuth = true;
        }
      }
    }

    if (!adminAuth && !authorAuth) {
      return errorResponse("Unauthorized: You do not have permission to delete this echo", 403);
    }

    // 1. 如果包含语音文件，向 GitHub API 发起物理删除
    if (post.media_key) {
      await deleteFromGitHub(env, post.media_key);
    }

    // 2. 级联清理 D1 中的关联数据
    await db.prepare("DELETE FROM likes WHERE post_id = ?").bind(postId).run();
    await db.prepare("DELETE FROM comments WHERE post_id = ?").bind(postId).run();
    await db.prepare("DELETE FROM reports WHERE post_id = ?").bind(postId).run();
    await db.prepare("DELETE FROM posts WHERE id = ?").bind(postId).run();

    return jsonResponse({
      success: true,
      message: "Echo and media have been permanently deleted from both database and GitHub",
    });
  } catch (err) {
    console.error("DELETE /api/echo error:", err);
    return errorResponse("An internal error occurred", 500);
  }
}
