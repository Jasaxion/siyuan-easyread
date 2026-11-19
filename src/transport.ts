import type { ISiyuan } from "siyuan/kernel";
import { assetPath, baseURL, type Settings } from "./shared";

export class KernelError extends Error {
    constructor(message: string, readonly details: any) { super(message); }
}

export class Transport {
    constructor(readonly host: ISiyuan, readonly settings: Settings) {}

    async local<T = any>(path: `/${string}`, body: unknown = {}): Promise<T> {
        const response = await this.host.client.fetch(path, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body), timeout: 60000,
        });
        if (!response.ok) throw new Error(`思源内核请求失败 (${response.status})：${path}`);
        const result = await response.json() as { code: number; msg: string; data: T };
        if (result.code !== 0) throw new KernelError(`思源：${result.msg || "操作失败"}`, result.data);
        return result.data;
    }

    async asset(path: string, maxBytes: number): Promise<ArrayBuffer> {
        const safe = assetPath(path);
        const response = await this.host.client.fetch(`/${safe.split("/").map(encodeURIComponent).join("/")}`, { timeout: 60000 });
        if (!response.ok) throw new Error(`无法读取思源附件 (${response.status})。`);
        const bytes = await response.arrayBuffer();
        if (!bytes.byteLength || bytes.byteLength > maxBytes) throw new Error(`附件为空或超过 ${Math.floor(maxBytes / 1024 / 1024)} MiB 限制。`);
        return bytes;
    }

    async remote<T = any>(path: string, body?: unknown, pdf?: ArrayBuffer): Promise<T> {
        const base = baseURL(this.settings.baseUrl);
        if (!path.startsWith("/") || path.startsWith("//")) throw new Error("无效 API 路径。");
        const headers: Record<string, string> = { Accept: "application/json" };
        if (this.settings.accessCode) headers.Authorization = `Bearer ${this.settings.accessCode}`;
        let forwarded: { status: number; body: string };
        try {
            forwarded = await this.local("/api/network/forwardProxy", {
                url: `${base}/api/v1${path}`, method: body !== undefined || pdf ? "POST" : "GET",
                headers: [headers], contentType: pdf ? "application/pdf" : "application/json",
                ...(pdf ? { payload: Buffer.from(pdf).toString("base64"), payloadEncoding: "base64" }
                    : body !== undefined ? { payload: Buffer.from(JSON.stringify(body)).toString("base64"), payloadEncoding: "base64" } : {}),
                responseEncoding: "text", timeout: 60000, redirect: false,
            });
        } catch {
            // A proxy error can contain request headers; never reflect it to a frontend or log.
            throw new Error("思源内核无法连接 EasyRead。请检查内核所在机器可访问的地址及网络；写请求结果可能未知，请先检查任务/文献库，勿直接重试。");
        }
        let result: any;
        try { result = JSON.parse(forwarded.body); } catch { result = null; }
        if (forwarded.status < 200 || forwarded.status >= 300) {
            const hints: Record<number, string> = {
                401: "访问授权码错误或缺失", 403: "服务 Host/Origin 被拒绝，请检查 EasyRead 白名单",
                404: "接口不存在：请启用开放 API，并升级到支持 HTML 导入的 EasyRead 分支",
                413: "内容超过服务上传限制", 429: "请求过多或导入队列已满", 409: "文献库正在切换或不可用",
            };
            throw new Error(`EasyRead HTTP ${forwarded.status}：${hints[forwarded.status] || "请求被拒绝，请检查服务日志"}`);
        }
        if (!result || typeof result !== "object") throw new Error("EasyRead 返回了无效 JSON，请检查服务地址。");
        return result;
    }

    async all(path: string): Promise<any> {
        let offset = 0;
        let first: any;
        const items: any[] = [];
        const ids = new Set<string>();
        let total: number | undefined;
        for (let page = 0; page < 500; page++) {
            const result = await this.remote(`${path}${path.includes("?") ? "&" : "?"}limit=200&offset=${offset}`);
            if (!Array.isArray(result.items)) throw new Error("EasyRead 分页格式无效。");
            if (!first) { first = result; total = result.total; }
            else if (total !== result.total || JSON.stringify(first.versions ?? first.version) !== JSON.stringify(result.versions ?? result.version)) {
                throw new Error("EasyRead 内容在读取中发生变化，请重新预览；未写入不完整快照。");
            }
            for (const item of result.items) {
                if (typeof item.id !== "string" || ids.has(item.id)) throw new Error("EasyRead 分页数据重复或缺失，请重新同步。");
                ids.add(item.id); items.push(item);
            }
            if (result.next_offset === null) {
                if (items.length !== total) throw new Error("EasyRead 分页总数不一致，请重试。");
                return { ...first, items, next_offset: null };
            }
            if (!Number.isInteger(result.next_offset) || result.next_offset <= offset) throw new Error("EasyRead 分页游标无效。");
            offset = result.next_offset;
        }
        throw new Error("文章超过 100000 个条目，未写入截断内容。");
    }
}
