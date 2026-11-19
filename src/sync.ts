import type { Service } from "./service";
import { KernelError } from "./transport";
import { baseURL, docID, HASH_ATTR, newDocID, OWNER_ATTR, type SyncOptions } from "./shared";
import { renderSnapshot, type Snapshot } from "./render";

export async function digest(text: string): Promise<string> {
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, "0")).join("");
}
export async function previewSnapshot(service: Service, id: string, options: SyncOptions) {
    const t = await service.transport();
    const binding = await service.binding(id, t);
    if (!binding) throw new Error("请先绑定 EasyRead 文章。");
    if (binding.baseUrl !== baseURL(t.settings.baseUrl)) throw new Error("绑定属于另一 EasyRead 服务，请切回原服务；不会向新地址发送旧绑定请求。");
    const root = `/documents/${binding.documentId}`;
    const data: Snapshot = { document: await t.remote(root) };
    if (options.notes) data.notes = await t.all(root + "/notes");
    if (options.highlights) data.highlights = await t.all(root + "/highlights");
    if (options.bilingual) data.content = await t.all(root + "/content?language=both&view=effective");
    const versions = [data.notes?.version, data.highlights?.version, data.content?.versions?.reader].filter(v => v !== undefined);
    if (versions.some(v => v !== versions[0])) throw new Error("EasyRead 笔记在预览时发生变化，请重新预览。");
    const markdown = renderSnapshot(data, options, binding.baseUrl, binding.documentId);
    if (new TextEncoder().encode(markdown).byteLength > 8 * 1024 * 1024) throw new Error("同步内容超过 8 MiB，请减少同步范围。");
    return { markdown, hash: await digest(markdown), counts: { notes: data.notes?.items.length || 0, highlights: data.highlights?.items.length || 0, blocks: data.content?.items.length || 0 } };
}
export async function saveSnapshot(service: Service, id: string, options: SyncOptions, expectedHash: string) {
    const t = await service.transport();
    const info = await service.resolveDoc(id, t);
    const binding = await service.binding(id, t);
    if (!binding) throw new Error("请先绑定文章。");
    if (binding.baseUrl !== baseURL(t.settings.baseUrl)) throw new Error("绑定属于另一 EasyRead 服务。");
    // Recover a completed create whose reply was lost. Never blindly recreate or overwrite it.
    if (binding.pending) {
        const pendingId = docID(binding.pending.id);
        let attrs: Record<string, string>;
        try { attrs = await t.local("/api/attr/getBlockAttrs", { id: pendingId }); }
        catch { throw new Error(`上次同步写入结果未知，请检查快照 ${pendingId}；未自动重试创建。`); }
        if (attrs[OWNER_ATTR] !== id || attrs[HASH_ATTR] !== binding.pending.hash) {
            const location = await t.local("/api/block/getBlockInfo", { id: pendingId });
            const exported = await t.local("/api/export/exportMdContent", { id: pendingId, addTitle: false, yfm: false });
            if (!location.path.endsWith(`/${id}/${pendingId}.sy`) || !exported.content.includes(`EasyRead snapshot: ${id}/${binding.pending.hash}`)) throw new Error(`快照 ${pendingId} 的归属未能确认，已停止以保护笔记。`);
            await t.local("/api/attr/setBlockAttrs", { id: pendingId, attrs: { [OWNER_ATTR]: id, [HASH_ATTR]: binding.pending.hash } });
        }
        binding.snapshotId = pendingId; binding.lastHash = binding.pending.hash;
        delete binding.pending;
        binding.lastSync = new Date().toISOString();
        await service.setBinding(id, binding, t);
        return { id: pendingId, recovered: true, unchanged: false };
    }
    const preview = await previewSnapshot(service, id, options);
    if (preview.hash !== expectedHash) throw new Error("内容已变化，请重新预览后再同步。");
    if (binding.lastHash === preview.hash && binding.snapshotId) {
        // Don't recreate a snapshot the user intentionally moved/deleted/edited.
        return { id: binding.snapshotId, unchanged: true };
    }
    const snapshotId = newDocID();
    binding.pending = { id: snapshotId, hash: preview.hash };
    await service.setBinding(id, binding, t);
    // Native Markdown import discards root IAL: a plain marker survives a lost creation response.
    const markdown = `${preview.markdown}\nEasyRead snapshot: ${id}/${preview.hash}\n`;
    let created = false;
    const title = `EasyRead · ${new Date().toISOString().replace(/[:.]/g, "-")} · ${preview.hash.slice(0, 6)}`;
    try {
        const result = await t.local("/api/filetree/createDocByParent", {
            id: snapshotId, notebook: info.box, parentID: id,
            title: { format: "plain", text: title }, markdown, withMath: true,
        });
        if (result.id !== snapshotId) throw new Error("unexpected document id");
        created = true;
        await t.local("/api/attr/setBlockAttrs", { id: snapshotId, attrs: { [OWNER_ATTR]: id, [HASH_ATTR]: preview.hash } });
        const attrs = await t.local("/api/attr/getBlockAttrs", { id: snapshotId });
        if (attrs[OWNER_ATTR] !== id || attrs[HASH_ATTR] !== preview.hash) throw new Error("snapshot readback mismatch");
        const exported = await t.local("/api/export/exportMdContent", { id: snapshotId, addTitle: false, yfm: false });
        if (typeof exported.content !== "string" || !exported.content.trim()) throw new Error("snapshot content missing");
    } catch (error) {
        if (!created && error instanceof KernelError && error.details?.commitState === "none") {
            delete binding.pending;
            await service.setBinding(id, binding, t);
            throw new Error(`思源明确拒绝创建，尚未写入快照：${error.message}`);
        }
        throw new Error(`同步未能确认完成，请检查快照 ${snapshotId} 后使用恢复按钮。原文及历史快照未覆盖。`);
    }
    binding.snapshotId = snapshotId; binding.lastHash = preview.hash;
    binding.lastSync = new Date().toISOString(); binding.options = options;
    delete binding.pending;
    await service.setBinding(id, binding, t);
    return { id: snapshotId, unchanged: false };
}
