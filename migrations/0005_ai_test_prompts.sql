CREATE TABLE IF NOT EXISTS ai_test_prompt_templates (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  active_version_id TEXT,
  created_by_user_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS ai_test_prompt_versions (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'active', 'archived')),
  title TEXT NOT NULL,
  prompt_body TEXT NOT NULL,
  negative_prompt TEXT NOT NULL DEFAULT '',
  direction_json TEXT NOT NULL,
  variables_json TEXT NOT NULL,
  created_by_user_id TEXT,
  created_at TEXT NOT NULL,
  activated_at TEXT,
  notes TEXT NOT NULL DEFAULT '',
  UNIQUE (template_id, version),
  FOREIGN KEY (template_id) REFERENCES ai_test_prompt_templates(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS ai_test_category_factors (
  id TEXT PRIMARY KEY,
  category_key TEXT NOT NULL UNIQUE,
  category_label TEXT NOT NULL,
  factor_text TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_test_prompt_templates_key ON ai_test_prompt_templates(key);
CREATE INDEX IF NOT EXISTS idx_ai_test_prompt_templates_active_version_id ON ai_test_prompt_templates(active_version_id);
CREATE INDEX IF NOT EXISTS idx_ai_test_prompt_versions_template_id ON ai_test_prompt_versions(template_id, version DESC);
CREATE INDEX IF NOT EXISTS idx_ai_test_prompt_versions_status ON ai_test_prompt_versions(status);
CREATE INDEX IF NOT EXISTS idx_ai_test_prompt_versions_template_status ON ai_test_prompt_versions(template_id, status);
CREATE INDEX IF NOT EXISTS idx_ai_test_category_factors_enabled ON ai_test_category_factors(enabled, sort_order);

INSERT INTO ai_test_prompt_templates (
  id, key, title, description, active_version_id, created_by_user_id, created_at, updated_at
) VALUES (
  'aittpl_children_main_image',
  'children_main_image',
  '童装电商主图 AI 测图',
  '来自 AI测图功能-需求文档.md 的默认提示词模板',
  'aitver_children_main_image_v1',
  NULL,
  '2026-06-12T00:00:00.000Z',
  '2026-06-12T00:00:00.000Z'
) ON CONFLICT(id) DO NOTHING;

INSERT INTO ai_test_prompt_versions (
  id, template_id, version, status, title, prompt_body, negative_prompt,
  direction_json, variables_json, created_by_user_id, created_at, activated_at, notes
) VALUES (
  'aitver_children_main_image_v1',
  'aittpl_children_main_image',
  1,
  'active',
  '需求文档默认版本',
  '你是一名资深童装电商主图视觉导演，请基于参考产品图生成一张高点击率 AI 测图。

【拍摄构图】电商主图构图，主体清晰完整，商品占比充足，画面适合 {{aspectRatio}}，保留适度呼吸感和可点击的第一视觉焦点。
【原图锁死】严格保持参考图里的服装款式、版型、结构、口袋、腰头、裤脚、面料肌理和细节比例，不要改款，不要增删商品部件。
【模特锁定】{{modelProfile}}，童装模特表达自然健康，年龄感准确，不成人化，表情阳光亲和。
【动作姿态】{{pose}}，动作自然可信，能看清商品正面或关键卖点，身体比例真实。
【背景环境】{{background}}，背景干净，服务商品表达，不抢主体。
【衣服选色】主推 {{productColor}}，颜色准确稳定，面料质感清晰，不偏色不过曝。
【卖点文案】画面重点表达 {{sellingPoint}}，不生成真实文字，不添加促销字样，用视觉细节体现卖点。
【全局光影】柔和自然商业摄影光，肤色健康，阴影干净，商品轮廓明确。
【画质规格】{{resolution}} 清晰度，高清精修质感，适合童装电商主图测试，主体锐利，细节干净。
【加权倾斜】{{directionLabel}}：{{directionWeightText}}
【品类高点击因子】{{categoryLabel}}：{{categoryFactor}}
【测图组别】第 {{groupIndex}} / {{groupTotal}} 组，当前测试方向：{{directionLabel}}',
  '不要出现：畸形五官、畸形手指、肢体扭曲、头身比例异常、低清晰度、噪点、文字水印、品牌 Logo 错乱、衣服结构错误、颜色严重偏差、面料质感丢失、成人化性感表达、危险动作、背景杂乱、商品被遮挡、参考图款式被改造。',
  '[{"key":"scene","label":"场景主导","weightText":"加权倾斜真实穿着场景、生活氛围和背景叙事，让环境成为第一点击理由。"},{"key":"model","label":"模特主导","weightText":"加权倾斜模特年龄感、阳光元气、表情感染力和自然童真状态。"},{"key":"selling_point","label":"卖点主导","weightText":"加权倾斜商品功能卖点、版型优势和用户一眼能理解的购买理由。"},{"key":"pose","label":"姿势角度主导","weightText":"加权倾斜动作姿态、身体角度、抓拍动势和跑跳中的自然活力。"},{"key":"color","label":"产品颜色主导","weightText":"加权倾斜衣服选色、面料层次和颜色准确度，保证主推色醒目不偏色。"},{"key":"composition","label":"构图主导","weightText":"加权倾斜拍摄构图、商品主体占比、留白节奏和电商缩略图识别度。"}]',
  '["aspectRatio","resolution","modelProfile","pose","background","productColor","sellingPoint","directionLabel","directionWeightText","categoryLabel","categoryFactor","groupIndex","groupTotal"]',
  NULL,
  '2026-06-12T00:00:00.000Z',
  '2026-06-12T00:00:00.000Z',
  'Seeded from DEFAULT_AI_TEST_TEMPLATE.'
) ON CONFLICT(id) DO NOTHING;

UPDATE ai_test_prompt_templates
SET active_version_id = 'aitver_children_main_image_v1',
    updated_at = '2026-06-12T00:00:00.000Z'
WHERE id = 'aittpl_children_main_image'
  AND active_version_id IS NULL;

INSERT INTO ai_test_category_factors (
  id, category_key, category_label, factor_text, enabled, sort_order, created_at, updated_at
) VALUES
  ('aitcf_tshirt', 'tshirt', 'T恤', '突出亲肤棉感、领口不勒脖、童趣图案、夏日清爽和日常百搭。', 1, 10, '2026-06-12T00:00:00.000Z', '2026-06-12T00:00:00.000Z'),
  ('aitcf_pants', 'pants', '裤装', '突出中大童男童，阳光元气，侧身跳跃抓拍，纯白极简背景，藏青色，弹力腰头，高腰护肚，膝部活动不束缚。', 1, 20, '2026-06-12T00:00:00.000Z', '2026-06-12T00:00:00.000Z'),
  ('aitcf_dress', 'dress', '连衣裙', '突出甜美裙摆、轻盈转身、舒适里衬、节日出片感和精致但不过度成人化。', 1, 30, '2026-06-12T00:00:00.000Z', '2026-06-12T00:00:00.000Z'),
  ('aitcf_set', 'set', '套装', '突出上下装成套省心搭配、整体色系统一、校园通勤和运动休闲多场景。', 1, 40, '2026-06-12T00:00:00.000Z', '2026-06-12T00:00:00.000Z'),
  ('aitcf_outerwear', 'outerwear', '外套', '突出挺括版型、防风保暖、拉链口袋细节、层次穿搭和户外活动安全感。', 1, 50, '2026-06-12T00:00:00.000Z', '2026-06-12T00:00:00.000Z'),
  ('aitcf_down_cotton', 'down_cotton', '羽绒/棉服', '突出蓬松保暖、轻量不臃肿、防钻绒或锁温细节、冬季户外活力和包裹安全感。', 1, 60, '2026-06-12T00:00:00.000Z', '2026-06-12T00:00:00.000Z'),
  ('aitcf_hoodie_knit', 'hoodie_knit', '卫衣/针织', '突出软糯手感、宽松舒适、连帽或罗纹细节、校园运动感和秋冬叠穿氛围。', 1, 70, '2026-06-12T00:00:00.000Z', '2026-06-12T00:00:00.000Z'),
  ('aitcf_shorts', 'shorts', '短裤', '突出透气轻薄、弹力腰头、跑跳不束缚、夏日户外和清爽腿部比例。', 1, 80, '2026-06-12T00:00:00.000Z', '2026-06-12T00:00:00.000Z'),
  ('aitcf_onesie', 'onesie', '连体衣', '突出婴幼儿柔软包裹、换尿布便利、无骨缝舒适、萌趣造型和安全亲肤。', 1, 90, '2026-06-12T00:00:00.000Z', '2026-06-12T00:00:00.000Z'),
  ('aitcf_shoes', 'shoes', '童鞋', '突出防滑鞋底、轻便回弹、包头保护、跑跳稳定和校园运动场景。', 1, 100, '2026-06-12T00:00:00.000Z', '2026-06-12T00:00:00.000Z'),
  ('aitcf_home_underwear_swim', 'home_underwear_swim', '家居/内衣/泳装', '突出亲肤舒适、无感缝线、安全包覆、居家自在或泳池活力场景，表达健康自然。', 1, 110, '2026-06-12T00:00:00.000Z', '2026-06-12T00:00:00.000Z')
ON CONFLICT(category_key) DO NOTHING;
