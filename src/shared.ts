export type SyncOptions = { notes: boolean; highlights: boolean; bilingual: boolean };
export const DEFAULT_OPTIONS: SyncOptions = { notes: true, highlights: true, bilingual: false };
export type Settings = { baseUrl: string; accessCode: string };
export type Binding = {
    documentId: string; baseUrl: string; options: SyncOptions;
    lastHash?: string; snapshotId?: string; lastSync?: string;
    pending?: { id: string; hash: string };
};
export type ImportRecord = {
    taskId: string; baseUrl: string; created: string; docId?: string; bind: boolean;
    state: string; documentId?: string; error?: string;
};
export const BINDING_ATTR = "custom-easyread-binding";
export const OWNER_ATTR = "custom-easyread-source";
export const HASH_ATTR = "custom-easyread-hash";
export function baseURL(value: unknown): string {
    if (typeof value !== "string" || !value.trim()) throw new Error("请先设置 EasyRead 服务地址。");
    const url = new URL(value.trim());
    if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.search || url.hash) {
        throw new Error("服务地址必须为 HTTP(S)，不能包含凭据、查询参数或片段。");
    }
    // Accept a pasted API base, but retain reverse-proxy prefixes.
    return url.toString().replace(/\/$/, "").replace(/\/api\/v1$/, "");
}
export function docID(value: unknown): string {
    if (typeof value !== "string" || !/^\d{14}-[a-z0-9]{7}$/.test(value)) throw new Error("无效的思源文档 ID。");
    return value;
}
export function articleID(value: unknown): string {
    if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(value)) throw new Error("无效的 EasyRead 文章 ID。");
    return value;
}
export function taskID(value: unknown): string {
    if (typeof value !== "string" || !/^[a-f0-9]{32}$/.test(value)) throw new Error("无效的导入任务 ID。");
    return value;
}
export function syncOptions(value: unknown): SyncOptions {
    const v = value as SyncOptions;
    if (!v || [v.notes, v.highlights, v.bilingual].some(x => typeof x !== "boolean")) throw new Error("同步选项无效。");
    if (!v.notes && !v.highlights && !v.bilingual) throw new Error("请至少选择一种同步内容。");
    return { notes: v.notes, highlights: v.highlights, bilingual: v.bilingual };
}
export function assetPath(value: unknown, pdf = false): string {
    if (typeof value !== "string") throw new Error("附件路径无效。");
    let path: string;
    try { path = decodeURIComponent(value.split(/[?#]/)[0]).replace(/^\//, ""); }
    catch { throw new Error("附件路径编码无效。"); }
    if (!path.startsWith("assets/") || path.split("/").some(p => !p || p === "." || p === "..") || /[\\\x00-\x1f%]/.test(path)) {
        throw new Error("只能读取思源 assets/ 下的附件，不能上传任意本机文件。");
    }
    if (pdf && !/\.pdf$/i.test(path)) throw new Error("请选择 PDF 附件。");
    return path;
}
export function htmlEscape(value: unknown): string {
    return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
export function readingURL(base: string, id: string, block?: string): string {
    return `${baseURL(base)}/read/${encodeURIComponent(articleID(id))}${block ? "#" + encodeURIComponent(block) : ""}`;
}
export function newDocID(): string {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const time = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    const bytes = crypto.getRandomValues(new Uint8Array(7));
    return time + "-" + Array.from(bytes, b => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");
}
