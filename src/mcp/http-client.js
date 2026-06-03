/**
 * HTTP 客户端适配器
 *
 * 提供与 FileLogStore 相同的接口，但通过 HTTP API 调用远程服务器。
 * 用于 MCP 连接到 Vite 进程已启动的 HTTP 服务器。
 */

export class HttpLogStore {
  constructor(serverUrl) {
    // 移除末尾的斜杠
    this.serverUrl = serverUrl.replace(/\/$/, "");
  }

  /**
   * 通用 HTTP 请求方法
   */
  async request(path, options = {}) {
    const url = `${this.serverUrl}${path}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeout || 10000);

    try {
      const res = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          ...options.headers
        }
      });

      if (!res.ok) {
        const error = await res.text();
        throw new Error(`HTTP ${res.status}: ${error}`);
      }

      return await res.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * 构建查询字符串
   */
  buildQueryString(filters) {
    const params = new URLSearchParams();

    if (filters.project) params.set("project", filters.project);
    if (filters.captureId) params.set("captureId", filters.captureId);
    if (filters.sessionId) params.set("sessionId", filters.sessionId);
    if (filters.sessionIds) params.set("sessionIds", filters.sessionIds);
    if (filters.level) params.set("level", filters.level);
    if (filters.kind) params.set("kind", filters.kind);
    if (filters.file) params.set("file", filters.file);
    if (filters.q) params.set("q", filters.q);
    if (filters.from) params.set("from", filters.from);
    if (filters.to) params.set("to", filters.to);
    if (filters.limit) params.set("limit", String(filters.limit));

    const query = params.toString();
    return query ? `?${query}` : "";
  }

  /**
   * 获取存储描述
   */
  async describeStorage() {
    const data = await this.request("/api/health");
    return data.storage || {
      rawDir: null,
      sqlitePath: null,
      queryDriver: "http",
      sqliteEnabled: false,
      sqliteDisabledReason: "Remote server"
    };
  }

  /**
   * 查询日志
   */
  async queryLogs(filters = {}) {
    const query = this.buildQueryString(filters);
    const data = await this.request(`/api/logs${query}`);
    return data.logs || [];
  }

  /**
   * 列出会话
   */
  async listSessions(filters = {}) {
    const params = new URLSearchParams();
    if (filters.project) params.set("project", filters.project);
    const query = params.toString();
    const data = await this.request(`/api/sessions${query ? `?${query}` : ""}`);
    return data.sessions || [];
  }

  /**
   * 列出捕获
   */
  async listCaptures(filters = {}) {
    const params = new URLSearchParams();
    if (filters.project) params.set("project", filters.project);
    const query = params.toString();
    const data = await this.request(`/api/captures${query ? `?${query}` : ""}`);
    return data.captures || [];
  }

  /**
   * 按 ID 获取单个日志
   *
   * 注意：HTTP API 没有直接的 getLogById 端点，
   * 使用 queryLogs 配合 id 过滤（如果服务器支持）
   * 或者使用 q 全文搜索作为回退
   */
  async getLogById(logId) {
    if (!logId) {
      return null;
    }

    // 尝试通过 queryLogs 获取，限制为 1 条
    // 注意：这可能不精确，因为 HTTP API 不支持 id 过滤
    const logs = await this.queryLogs({ limit: 1000 });
    return logs.find((log) => log.id === logId) || null;
  }

  /**
   * 按 ID 获取单个捕获
   */
  async getCaptureById(captureId, filters = {}) {
    if (!captureId) {
      return null;
    }

    const captures = await this.listCaptures(filters);
    return captures.find((item) => item.id === captureId) || null;
  }

  /**
   * 获取捕获关联的日志
   */
  async getLogsForCapture(capture, filters = {}) {
    if (!capture) {
      return [];
    }

    const queryFilters = {
      ...filters,
      captureId: capture.id,
      project: filters.project || capture.project?.name || ""
    };

    return await this.queryLogs(queryFilters);
  }

  /**
   * 获取时间窗口内的日志
   */
  async getLogsInWindow(filters = {}) {
    return await this.queryLogs(filters);
  }

  /**
   * 追加日志
   *
   * 注意：MCP 通常不需要写入日志，此方法主要用于兼容性
   */
  async appendLogs(payload) {
    return await this.request("/api/logs", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  /**
   * 清空所有日志
   */
  async clearLogs() {
    await this.request("/api/logs", {
      method: "DELETE"
    });
  }

  /**
   * 删除指定捕获
   */
  async deleteCapture(captureOrId) {
    const captureId = typeof captureOrId === "string" ? captureOrId : captureOrId?.id;

    if (!captureId) {
      return { capture: null, deletedCount: 0 };
    }

    return await this.request(`/api/captures/${encodeURIComponent(captureId)}`, {
      method: "DELETE"
    });
  }

  /**
   * 按保留策略清理旧日志
   *
   * 注意：HTTP API 不直接支持此操作，MCP 侧不需要执行清理
   */
  async cleanupByRetention(retentionMs, errorRetentionMs) {
    // HTTP 客户端不执行清理，由服务器端负责
    return 0;
  }

  /**
   * 关闭连接
   */
  async close() {
    // HTTP 客户端无需关闭连接
  }
}
