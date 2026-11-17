-- WORLD ECHO (世界回声) - D1 Database Initial Schema V1.0

-- 1. 匿名用户表（渐进式创建，浏览器存原始 token，数据库只存 hash）
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  nickname TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  status TEXT DEFAULT 'active',          -- active / banned
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 2. 全球回声主表（合并文字、语音元数据与情绪标签）
CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  nickname TEXT NOT NULL,
  country_code TEXT DEFAULT 'UN',        -- ISO 3166-1 alpha-2 国家代码
  content_type TEXT NOT NULL,            -- 'text' 或 'voice'
  content TEXT,                          -- 文字内容（最大 1000 字符）
  emotion TEXT DEFAULT 'calm',           -- happy/sad/lonely/calm/angry/anxious/tired/love/hopeful
  media_url TEXT,                        -- jsDelivr CDN 音频访问直链
  media_key TEXT,                        -- GitHub 仓库内相对路径（如 voices/uuid.webm），用于同步删除
  duration INTEGER DEFAULT 0,            -- 语音时长（秒）
  likes_count INTEGER DEFAULT 0,
  comments_count INTEGER DEFAULT 0,
  reports_count INTEGER DEFAULT 0,
  status TEXT DEFAULT 'published',       -- published / pending / hidden / deleted
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 3. 评论回复表
CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  nickname TEXT NOT NULL,
  country_code TEXT DEFAULT 'UN',
  content TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 4. 点赞唯一约束表（防重复刷赞）
CREATE TABLE IF NOT EXISTS likes (
  user_id TEXT NOT NULL,
  post_id INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, post_id)
);

-- 5. 举报记录表
CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL,
  reporter_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT DEFAULT 'pending',         -- pending / resolved
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 核心查询索引
CREATE INDEX IF NOT EXISTS idx_posts_country ON posts(country_code, status, created_at);
CREATE INDEX IF NOT EXISTS idx_posts_status_id ON posts(status, id DESC);
CREATE INDEX IF NOT EXISTS idx_posts_emotion ON posts(emotion, status);
CREATE INDEX IF NOT EXISTS idx_comments_post ON comments(post_id, created_at);
