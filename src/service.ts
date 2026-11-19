import type { ISiyuan } from "siyuan/kernel";
import { RemoteError, Transport } from "./transport";
import { BINDING_ATTR, DEFAULT_OPTIONS, articleID, assetPath, baseURL, docID, htmlEscape, syncOptions, taskID, type Binding, type ImportRecord, type Settings } from "./shared";
import { previewSnapshot, saveSnapshot } from "./sync";

export class Service {
    private busy = new Set<string>();
    constructor(readonly host: ISiyuan) {}
    async read<T>(name: string, fallback: T): Promise<T> {
        const entries = await this.host.storage.list(".");
        if (!entries.some(e => e.name === name)) return fallback;
        return await (await this.host.storage.get(name)).json() as T;
    }
    async write(name: string, data: unknown) { await this.host.storage.put(name, JSON.stringify(data)); }
    async locked<T>(key: string, fn: () => Promise<T>): Promise<T> {
        if (this.busy.has(key)) throw new Error("该操作正在进行，请等待完成。");
        this.busy.add(key);
        try { return await fn(); } finally { this.busy.delete(key); }
    }
    async transport(): Promise<Transport> {
        const settings = await this.read<Settings>("settings.json", { baseUrl: "", accessCode: "" });
        return new Transport(this.host, settings);
    }
    async getSettings() {
        const t = await this.transport();
        return { baseUrl: t.settings.baseUrl, hasCode: Boolean(t.settings.accessCode) };
    }
    async saveSettings(input: { baseUrl: string; accessCode?: string; clearCode?: boolean }) {
        return this.locked("settings", async () => {
            const old = (await this.transport()).settings;
            const base = baseURL(input.baseUrl);
            if (input.accessCode !== undefined && (typeof input.accessCode !== "string" || /[\r\n]/.test(input.accessCode) || input.accessCode.length > 4096)) throw new Error("访问授权码格式无效。");
            // Do not silently forward an old secret to a newly configured server.
            const code = input.clearCode ? "" : input.accessCode || (base === old.baseUrl ? old.accessCode : "");
            await this.write("settings.json", { baseUrl: base, accessCode: code });
            return this.getSettings();
        });
    }
    async info() { return (await this.transport()).remote("/info"); }
    async resolveDoc(id: string, t: Transport) {
        const info = await t.local("/api/block/getBlockInfo", { id: docID(id) });
        if (info.rootID !== id || !info.box) throw new Error("请选择一篇可访问的思源文档，而非普通块。");
        return info;
    }
    async binding(id: string, t: Transport): Promise<Binding | null> {
        await this.resolveDoc(id, t);
        const attrs = await t.local("/api/attr/getBlockAttrs", { id });
        if (!attrs[BINDING_ATTR]) return null;
        try {
            const b = JSON.parse(attrs[BINDING_ATTR]);
            return { ...b, documentId: articleID(b.documentId), baseUrl: baseURL(b.baseUrl), options: syncOptions(b.options) };
        } catch { throw new Error("文档绑定属性无效，请手动解除绑定后重新绑定。"); }
    }
    async setBinding(id: string, binding: Binding | null, t: Transport) {
        await t.local("/api/attr/setBlockAttrs", { id, attrs: { [BINDING_ATTR]: binding ? JSON.stringify(binding) : "" } });
    }
    async getBinding(id: string) { return this.binding(docID(id), await this.transport()); }
    async bind(input: { docId: string; documentId: string; options: unknown }) {
        return this.locked(docID(input.docId), async () => {
            const t = await this.transport();
            await this.resolveDoc(input.docId, t);
            const documentId = articleID(input.documentId);
            await t.remote(`/documents/${documentId}`);
            const old = await this.binding(input.docId, t);
            if (old?.pending) throw new Error("上次同步结果尚未确认，请先使用原绑定完成同步恢复。");
            const same = old?.baseUrl === baseURL(t.settings.baseUrl) && old.documentId === documentId;
            const binding = { ...(same ? old : {}), documentId, baseUrl: baseURL(t.settings.baseUrl), options: syncOptions(input.options) };
            await this.setBinding(input.docId, binding, t);
            return binding;
        });
    }
    async unbind(id: string) {
        return this.locked(docID(id), async () => {
            const t = await this.transport();
            const old = await this.binding(id, t);
            if (old?.pending) throw new Error("上次同步结果尚未确认，请先恢复同步；历史快照未删除。");
            await this.setBinding(id, null, t);
            return { ok: true };
        });
    }
    async abandonPending(input: { docId: string; pendingId: string }) {
        return this.locked(docID(input.docId), async () => {
            const t = await this.transport();
            const binding = await this.binding(input.docId, t);
            if (!binding?.pending || binding.pending.id !== docID(input.pendingId)) throw new Error("待确认记录已变化，请刷新。");
            delete binding.pending;
            await this.setBinding(input.docId, binding, t);
            return { ok: true }; // Only discard the journal; never delete a potentially committed snapshot.
        });
    }
    async listDocuments(input: { q?: string; offset?: number } = {}) {
        const offset = input.offset ?? 0;
        if (!Number.isInteger(offset) || offset < 0 || offset > 10000000) throw new Error("分页参数无效。");
        return (await this.transport()).remote(`/documents?limit=30&offset=${offset}&q=${encodeURIComponent(String(input.q || "").slice(0, 500))}`);
    }
    async importDocument(input: { docId: string; bind?: boolean; translate?: boolean }) {
        const id = docID(input.docId);
        return this.locked(id, async () => {
            const t = await this.transport();
            await this.resolveDoc(id, t);
            const info = await t.remote("/info");
            if (!info.capabilities?.includes("import_html")) throw new Error("此 EasyRead 尚不支持 HTML 内容导入，请升级配套分支。");
            const exported = await t.local("/api/export/exportMdContent", { id, addTitle: false, yfm: false, refMode: 2, embedMode: 0 });
            if (typeof exported.content !== "string" || !exported.content.trim()) throw new Error("文档为空。");
            const { html } = await t.local("/api/lute/md2html", { markdown: exported.content });
            const { html: embedded, warnings } = await this.embedImages(html, t);
            const title = String(exported.hPath || "SiYuan").split("/").pop() || "SiYuan";
            const body = { html: `<!doctype html><html><head><title>${htmlEscape(title)}</title></head><body><article>${embedded}</article></body></html>`, title, source_id: `siyuan:${id}`, translate: input.translate === true };
            if (new TextEncoder().encode(body.html).byteLength > Math.min(info.max_html_bytes || 8 * 1024 * 1024, 8 * 1024 * 1024)) throw new Error("文档及内嵌图片超过 8 MiB，请缩小文档。");
            const result = await t.remote("/imports/html", body);
            try { await this.recordTask(result.task_id, t, id, input.bind === true); }
            catch { warnings.push(`已提交任务 ${result.task_id}，但本地记录保存失败。请保留此 ID 并检查 EasyRead 文献库，勿重复上传。`); }
            return { ...result, warnings };
        });
    }
    async embedImages(html: string, t: Transport) {
        const warnings: string[] = [];
        const replacements = new Map<string, string>();
        const matches = Array.from(html.matchAll(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi));
        let budget = 5 * 1024 * 1024;
        for (const match of matches) {
            const raw = match[1].replace(/&amp;/g, "&");
            if (replacements.has(match[0])) continue;
            if (/^data:image\/(png|jpeg|gif|webp);base64,/i.test(raw)) continue;
            try {
                const path = assetPath(raw);
                const ext = path.split(".").pop()?.toLowerCase();
                const mime = ({ png: "png", jpg: "jpeg", jpeg: "jpeg", gif: "gif", webp: "webp" } as Record<string, string>)[ext || ""];
                if (!mime) throw new Error("unsupported image");
                const bytes = await t.asset(path, Math.min(budget, 5 * 1024 * 1024));
                budget -= bytes.byteLength;
                replacements.set(match[0], match[0].replace(match[1], `data:image/${mime};base64,${Buffer.from(bytes).toString("base64")}`));
            } catch {
                warnings.push("部分图片不可读取、超限或为远程/SVG 图片，未上传这些图片。");
                replacements.set(match[0], "<p>[图片未导入]</p>");
            }
        }
        return { html: html.replace(/<img\b[^>]*>/gi, tag => replacements.get(tag) ?? tag), warnings: [...new Set(warnings)] };
    }
    async importPDF(input: { path: string; docId?: string; bind?: boolean; translate?: boolean }) {
        const path = assetPath(input.path, true);
        return this.locked(input.docId ? docID(input.docId) : path, async () => {
            const t = await this.transport();
            if (input.docId) await this.resolveDoc(input.docId, t);
            const bytes = await t.asset(path, 50 * 1024 * 1024);
            if (Buffer.from(bytes).subarray(0, 4).toString() !== "%PDF") throw new Error("附件不是有效的 PDF 文件。");
            const result = await t.remote(`/imports/file?filename=${encodeURIComponent(path.split("/").pop()!)}&translate=${input.translate === true}`, undefined, bytes);
            try { await this.recordTask(result.task_id, t, input.docId, input.bind === true); }
            catch { return { ...result, warnings: [`已提交任务 ${result.task_id}，但本地记录保存失败。请保留此 ID 并检查 EasyRead 文献库，勿重复上传。`] }; }
            return result;
        });
    }
    async recordTask(taskId: string, t: Transport, docId?: string, bind = false) {
        await this.locked("tasks", async () => {
            const tasks = await this.read<ImportRecord[]>("tasks.json", []);
            // Keep all active/uncertain tasks, and the latest 50 completed ones.
            const active = tasks.filter(t => !["done", "error", "interrupted"].includes(t.state));
            const finished = tasks.filter(t => !active.includes(t)).slice(-49);
            await this.write("tasks.json", [...active, ...finished, { taskId: taskID(taskId), baseUrl: baseURL(t.settings.baseUrl), created: new Date().toISOString(), docId, bind, state: "queued" }]);
        });
    }
    async tasks() { return this.read<ImportRecord[]>("tasks.json", []); }
    async removeTask(input: { taskId: string; baseUrl: string }) {
        const tid = taskID(input.taskId);
        const base = baseURL(input.baseUrl);
        return this.locked("tasks", async () => {
            const tasks = await this.tasks();
            const kept = tasks.filter(task => task.taskId !== tid || task.baseUrl !== base);
            if (kept.length !== tasks.length) await this.write("tasks.json", kept);
            return { removed: tasks.length - kept.length };
        });
    }
    async task(id: string, expectedBase?: string) {
        const tid = taskID(id);
        const t = await this.transport();
        const base = baseURL(t.settings.baseUrl);
        if (expectedBase !== undefined && baseURL(expectedBase) !== base) throw new Error("服务设置已变化，请刷新任务列表。");
        const matches = (record: ImportRecord) => record.taskId === tid && record.baseUrl === base;
        if (!(await this.tasks()).some(matches)) throw new Error("当前服务没有这个插件导入记录。");
        // Network I/O must not lock the local history: removing a row works even while offline.
        let task: any;
        try { task = await t.remote(`/tasks/${tid}`); }
        catch (error) {
            if (!(error instanceof RemoteError) || error.status !== 404 || error.code !== "not_found") throw error;
            return { id: tid, state: "missing", error: { code: "not_found", message: "远端任务记录已不存在，可以移除本地记录。" } };
        }
        if (task.document_id) {
            task.document_id = articleID(task.document_id);
            try {
                await t.remote(`/documents/${task.document_id}`);
                task.document_missing = false;
            } catch (error) {
                if (!(error instanceof RemoteError) || error.status !== 404 || error.code !== "not_found") throw error;
                task.document_missing = true;
            }
        }
        return this.locked("tasks", async () => {
            const tasks = await this.tasks();
            const record = tasks.find(matches);
            // A slow response must neither resurrect removed history nor perform late auto-binding.
            if (!record) return { ...task, removed: true };
            record.state = task.state;
            if (task.document_id) record.documentId = task.document_id;
            if (task.error) record.error = String(task.error.code || "import_failed");
            if (task.state === "done" && task.document_missing === false && record.bind && record.docId && record.documentId) {
                await this.locked(record.docId, async () => {
                    const existing = await this.binding(record.docId!, t);
                    if (!existing) await this.setBinding(record.docId!, { documentId: record.documentId!, baseUrl: record.baseUrl, options: { ...DEFAULT_OPTIONS } }, t);
                    // Never replace a binding that the user changed while import was running.
                    record.bind = false;
                });
            }
            await this.write("tasks.json", tasks);
            return task;
        });
    }
    async preview(input: { docId: string; options: unknown }) {
        return previewSnapshot(this, docID(input.docId), syncOptions(input.options));
    }
    async sync(input: { docId: string; options: unknown; expectedHash: string }) {
        return this.locked(docID(input.docId), () => saveSnapshot(this, input.docId, syncOptions(input.options), input.expectedHash));
    }
}
