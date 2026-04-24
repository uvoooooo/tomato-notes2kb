export type Locale = "zh" | "en";

/** All UI strings — keep zh/en keys in sync. */
export const STRINGS: Record<
  Locale,
  {
    appTitle: string;
    documentTitleSuffix: string;
    tagline: string;
    langZh: string;
    langEn: string;
    langAria: string;
    warnUnconfigured: string;
    cardKbTitle: string;
    rootDir: string;
    kbMetaSourcePrefix: string;
    kbSourceEnv: string;
    kbSourceUser: string;
    kbSourceDefault: string;
    kbMetaCustomPath: string;
    kbMetaEnvLocked: string;
    kbMetaNotesLocation: string;
    kbPathLabel: string;
    placeholderVault: string;
    btnSave: string;
    btnSaving: string;
    btnResetDefault: string;
    kbSaveOk: string;
    kbResetOk: string;
    errNetwork: string;
    errSaveFailed: string;
    errResetFailed: string;
    btnMaintain: string;
    btnMaintaining: string;
    badgeNotesCount: string;
    badgeLastMaintained: string;
    badgeNoMaintenanceYet: string;
    warnStub: string;
    addContentSection: string;
    uploadPhotoSubtitle: string;
    textInputSubtitle: string;
    textPlaceholder: string;
    btnConvertText: string;
    choosePhoto: string;
    processing: string;
    processingText: string;
    hintPhoto: string;
    resultSection: string;
    taskId: string;
    savedToKb: string;
    viewMarkdownSource: string;
    noMarkdown: string;
    statusPending: string;
    statusProcessing: string;
    statusDone: string;
    statusFailed: string;
    processingMsg: string;
    studySection: string;
    studyIntro: string;
    studyDraw: string;
    studyAnother: string;
    studyShowNote: string;
    studyHideNote: string;
    studyLoading: string;
    studyPlaceholder: string;
    studyErrUnconfigured: string;
    reviewCardTitle: string;
    reviewSelectLabel: string;
    reviewOptionNone: string;
    reviewPasteLabel: string;
    reviewApplyPaste: string;
    reviewLoadingNotes: string;
    reviewListEmpty: string;
    reviewFromFile: string;
    reviewFromPaste: string;
    reviewLoadFailed: string;
    reviewNeedMaterial: string;
    reviewClear: string;
    useResultInReview: string;
    reviewPastePlaceholder: string;
    addModuleBlurb: string;
    reviewModuleBlurb: string;
    kbModuleBlurb: string;
    kbLoading: string;
    kbLoadFailed: string;
    kbRetry: string;
  }
> = {
  zh: {
    appTitle: "Tomato Notes2KB",
    documentTitleSuffix: "笔记 → Markdown",
    tagline:
      "上传手写照片或粘贴/输入文字，由 LLM 整理为 Markdown，并保存到本机个人知识库；后台可定期维护索引。",
    langZh: "中文",
    langEn: "English",
    langAria: "界面语言",
    warnUnconfigured:
      "当前后端未配置识别服务：请在 backend/.env 中设置 OPENROUTER_API_KEY（推荐）或 OPENAI_API_KEY，重启 API 后再上传。联调 UI 可设 TOMATO_USE_STUB=1（固定假数据）。",
    cardKbTitle: "个人知识库（本机目录）",
    rootDir: "根目录",
    kbMetaSourcePrefix: "来源：",
    kbSourceEnv: "环境变量 TOMATO_KB_DIR",
    kbSourceUser: "已保存的自定义路径",
    kbSourceDefault: "默认目录（未单独配置）",
    kbMetaCustomPath:
      "自定义路径保存在 {{path}}（在数据目录内，不包含笔记正文）。",
    kbMetaEnvLocked: "当前由环境变量锁定，请在 .env 中修改 TOMATO_KB_DIR 并重启后端。",
    kbMetaNotesLocation:
      "笔记文件位于 {{notes}}；总览与整理见根目录 {{index}}（由维护任务自动生成）。",
    kbPathLabel: "知识库根目录（本机绝对路径，可指向仓库外任意文件夹）",
    placeholderVault: "/Users/you/Documents/MyVault",
    btnSave: "保存",
    btnSaving: "保存中…",
    btnResetDefault: "恢复默认",
    kbSaveOk: "已保存。新笔记将写入该目录（可与代码仓库完全分离）。",
    kbResetOk: "已恢复为默认知识库目录。",
    errNetwork: "网络错误",
    errSaveFailed: "保存失败 ({{status}})",
    errResetFailed: "恢复失败 ({{status}})",
    btnMaintain: "立即整理知识库",
    btnMaintaining: "正在整理…",
    badgeNotesCount: "已存笔记 {{count}} 条",
    badgeLastMaintained: "最近整理",
    badgeNoMaintenanceYet: "尚未跑过整理",
    warnStub:
      "当前为占位模式（无 API Key 且 TOMATO_USE_STUB=1，或 TOMATO_FORCE_STUB=1），结果为固定示例 Markdown。配置 Key 并重启后一般会变为真实识别。",
    addContentSection: "添加笔记",
    uploadPhotoSubtitle: "从照片",
    textInputSubtitle: "从文字",
    textPlaceholder: "在此粘贴课堂草稿、清单、备忘录等，将整理为结构化 Markdown。",
    btnConvertText: "转为 Markdown 笔记",
    choosePhoto: "选择照片",
    processing: "正在识别手写内容…",
    processingText: "正在整理文字…",
    hintPhoto: "支持常见图片格式，尽量拍平、光线均匀，字迹更清晰。",
    resultSection: "识别结果",
    taskId: "任务 ID",
    savedToKb: "已写入知识库：{{path}}（相对知识库根目录）",
    viewMarkdownSource: "查看 Markdown 源码",
    noMarkdown: "未返回 Markdown 内容",
    statusPending: "待处理",
    statusProcessing: "识别中",
    statusDone: "完成",
    statusFailed: "失败",
    processingMsg: "处理中…",
    studySection: "自测复习",
    studyIntro: "从当前识别结果中抽取一道问答题。先自己回忆答案，再按需查看原笔记对照。",
    studyDraw: "抽一道题",
    studyAnother: "换一题",
    studyShowNote: "查看原笔记",
    studyHideNote: "收起原笔记",
    studyLoading: "正在出题…",
    studyPlaceholder: "点击「抽一道题」开始。",
    studyErrUnconfigured: "无法出题：请先在 backend/.env 中配置 API Key 并重启后端。",
    reviewCardTitle: "仅复习",
    reviewSelectLabel: "从知识库选择",
    reviewOptionNone: "（未选）",
    reviewPasteLabel: "或粘贴要复习的原文",
    reviewApplyPaste: "使用粘贴内容",
    reviewLoadingNotes: "正在加载笔记列表…",
    reviewListEmpty: "当前知识库中还没有 .md 笔记；可先往库目录放入文件，或直接用下方粘贴。",
    reviewFromFile: "知识库：",
    reviewFromPaste: "粘贴内容",
    reviewLoadFailed: "无法读取该笔记。",
    reviewNeedMaterial: "请先从知识库选一篇，或粘贴内容并点击「使用粘贴内容」。",
    reviewClear: "清除",
    useResultInReview: "在复习区打开本结果",
    reviewPastePlaceholder: "可粘贴整篇 Markdown（不必与知识库中文件一致）",
    addModuleBlurb: "新增：从照片或文字生成 Markdown，可写入个人知识库。",
    reviewModuleBlurb: "从知识库或粘贴的文本中抽题自测",
    kbModuleBlurb: "本机知识库根目录、笔记位置与（可选的）维护任务。与下方两个模块独立。",
    kbLoading: "正在加载知识库信息…",
    kbLoadFailed: "无法从后端读取知识库配置。请确认 API 已启动（如 uvicorn :8001）。",
    kbRetry: "重试",
  },
  en: {
    appTitle: "Tomato Notes2KB",
    documentTitleSuffix: "Notes → Markdown",
    tagline:
      "Upload a photo or paste text. An LLM turns it into Markdown and saves it to your local knowledge base; optional periodic maintenance updates the index.",
    langZh: "中文",
    langEn: "English",
    langAria: "Interface language",
    warnUnconfigured:
      "Vision is not configured: set OPENROUTER_API_KEY (recommended) or OPENAI_API_KEY in backend/.env, then restart the API. For UI-only testing, use TOMATO_USE_STUB=1 (stub data).",
    cardKbTitle: "Knowledge base (local folder)",
    rootDir: "Root",
    kbMetaSourcePrefix: "Source: ",
    kbSourceEnv: "Environment variable TOMATO_KB_DIR",
    kbSourceUser: "Saved custom path",
    kbSourceDefault: "Default (no custom path)",
    kbMetaCustomPath: "Custom path is stored in {{path}} (under the data directory; note content is not stored there).",
    kbMetaEnvLocked: "Locked by environment variable. Edit TOMATO_KB_DIR in .env and restart the server.",
    kbMetaNotesLocation:
      "Notes live under {{notes}}; the overview file is {{index}} at the vault root (auto-generated by maintenance).",
    kbPathLabel: "Knowledge base root (absolute path on this machine; can be outside the repo)",
    placeholderVault: "/Users/you/Documents/MyVault",
    btnSave: "Save",
    btnSaving: "Saving…",
    btnResetDefault: "Reset to default",
    kbSaveOk: "Saved. New notes will be written here (can be outside the code repo).",
    kbResetOk: "Restored the default knowledge base folder.",
    errNetwork: "Network error",
    errSaveFailed: "Save failed ({{status}})",
    errResetFailed: "Reset failed ({{status}})",
    btnMaintain: "Run maintenance now",
    btnMaintaining: "Maintaining…",
    badgeNotesCount: "{{count}} note(s) saved",
    badgeLastMaintained: "Last maintenance",
    badgeNoMaintenanceYet: "No maintenance run yet",
    warnStub:
      "Stub mode (no API key with TOMATO_USE_STUB=1, or TOMATO_FORCE_STUB=1): fixed sample Markdown. Configure a key and restart for real recognition.",
    addContentSection: "Add a note",
    uploadPhotoSubtitle: "From photo",
    textInputSubtitle: "From text",
    textPlaceholder: "Paste drafts, lists, or memos here. They will be structured as Markdown.",
    btnConvertText: "Convert to Markdown",
    choosePhoto: "Choose photo",
    processing: "Recognizing handwriting…",
    processingText: "Structuring text…",
    hintPhoto: "Common image formats supported. Shoot flat with even lighting for clearer text.",
    resultSection: "Result",
    taskId: "Job ID",
    savedToKb: "Saved to vault: {{path}} (relative to vault root)",
    viewMarkdownSource: "View Markdown source",
    noMarkdown: "No Markdown returned",
    statusPending: "Pending",
    statusProcessing: "Processing",
    statusDone: "Done",
    statusFailed: "Failed",
    processingMsg: "Working…",
    studySection: "Review quiz",
    studyIntro:
      "Draw a short question from the current result. Try to answer from memory, then check the original note if needed.",
    studyDraw: "Draw a question",
    studyAnother: "New question",
    studyShowNote: "View original note",
    studyHideNote: "Hide original",
    studyLoading: "Asking the model…",
    studyPlaceholder: "Tap “Draw a question” to start.",
    studyErrUnconfigured: "Cannot generate a question. Configure an API key in backend/.env and restart the server.",
    reviewCardTitle: "Review",
    reviewSelectLabel: "From vault",
    reviewOptionNone: "None",
    reviewPasteLabel: "Or paste what you want to review",
    reviewApplyPaste: "Use pasted text",
    reviewLoadingNotes: "Loading note list…",
    reviewListEmpty: "No .md notes in the vault yet; add files to the notes folder, or use paste below.",
    reviewFromFile: "Vault:",
    reviewFromPaste: "Pasted",
    reviewLoadFailed: "Could not read that note.",
    reviewNeedMaterial: "Select a note from the vault, or paste text and tap “Use pasted text”.",
    reviewClear: "Clear",
    useResultInReview: "Open in review",
    reviewPastePlaceholder: "Paste full Markdown (does not need to match a vault file)",
    addModuleBlurb: "Add: create Markdown from a photo or text, then save to your personal vault.",
    reviewModuleBlurb: "Quiz from vault files or any pasted text",
    kbModuleBlurb: "Local vault root, where notes go, and optional maintenance—separate from the two cards below.",
    kbLoading: "Loading vault info…",
    kbLoadFailed: "Could not load the vault. Is the API running (e.g. uvicorn on :8001)?",
    kbRetry: "Retry",
  },
};

export type MessageKey = keyof (typeof STRINGS)["zh"];

export function interpolate(template: string, vars: Record<string, string | number>): string {
  let s = template;
  for (const [k, v] of Object.entries(vars)) {
    s = s.split(`{{${k}}}`).join(String(v));
  }
  return s;
}
