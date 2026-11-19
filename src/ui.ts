import { Dialog, confirm, openTab, showMessage, type Plugin } from "siyuan";
import { DEFAULT_OPTIONS, htmlEscape, readingURL, type Binding, type ImportRecord, type SyncOptions } from "./shared";

export class UI {
    private dialogs = new Set<Dialog>();
    private timers = new Set<ReturnType<typeof setTimeout>>();
    private disposed = false;
    constructor(private plugin: Plugin) {}
    destroy() {
        this.disposed = true;
        for (const timer of this.timers) clearTimeout(timer);
        for (const dialog of this.dialogs) dialog.destroy();
        this.timers.clear(); this.dialogs.clear();
    }
    async call(method: string, ...args: any[]): Promise<any> {
        if (this.disposed) throw new Error("插件已关闭。");
        if (!this.plugin.kernel?.rpc) throw new Error("思源内核插件不可用，请升级到 3.8.9+ 并启用此插件的内核。");
        try {
            const result = await this.plugin.kernel.rpc.call[method](...args);
            if (this.disposed) throw new Error("插件已关闭。");
            return result;
        } catch (error) {
            const detail = (error as { data?: unknown })?.data;
            if (typeof detail === "string") {
                const message = detail.match(/promise rejected: (?:Error|KernelError): ([\s\S]*)$/)?.[1];
                if (message) throw new Error(message);
            }
            throw error;
        }
    }
    async run(fn: () => Promise<void>) {
        try { await fn(); } catch (error) { if (!this.disposed) showMessage(htmlEscape(error instanceof Error ? error.message : String(error)), 8000, "error"); }
    }
    private dialog(title: string, content: string, width = "700px", onClose?: () => void) {
        let alive = true;
        const dialog = new Dialog({ title, content: `<div class="easyread-panel">${content}</div>`, width,
            destroyCallback: () => { alive = false; onClose?.(); this.dialogs.delete(dialog); } });
        this.dialogs.add(dialog);
        const root = dialog.element.querySelector<HTMLElement>(".easyread-panel")!;
        return { dialog, root, alive: () => alive && !this.disposed };
    }
    private button(root: HTMLElement, selector: string, action: () => Promise<void>) {
        const button = root.querySelector<HTMLButtonElement>(selector)!;
        button.addEventListener("click", () => this.run(async () => {
            button.disabled = true;
            try { await action(); } finally { button.disabled = false; }
        }));
    }
    private options(root: HTMLElement): SyncOptions {
        const checked = (name: string) => root.querySelector<HTMLInputElement>(`[name="${name}"]`)!.checked;
        return { notes: checked("notes"), highlights: checked("highlights"), bilingual: checked("bilingual") };
    }
    private optionHTML(options = DEFAULT_OPTIONS) {
        return `<fieldset><legend>选择同步内容</legend>${([["notes", "整篇 / 段落笔记、问题"], ["highlights", "划线摘录与颜色"], ["bilingual", "双语正文（可能较长）"]] as const).map(([key, text]) => `<label><input type="checkbox" name="${key}" ${options[key] ? "checked" : ""}> ${text}</label>`).join("")}</fieldset>`;
    }
    async settings() {
        const settings = await this.call("getSettings");
        const { root } = this.dialog("EasyRead · 连接设置", `
            <p>所有 API 请求由 <strong>kernel.js</strong> 发起。地址必须能从思源内核所在机器访问；不是前端浏览器的 localhost。</p>
            <label>EasyRead 服务地址<input class="b3-text-field" name="base" placeholder="http://127.0.0.1:8765"></label>
            <label>访问授权码<input class="b3-text-field" name="code" type="password" autocomplete="off" placeholder="${settings.hasCode ? "已保存；留空保持（更换地址会清除旧码）" : "未开启访问保护时可留空"}"></label>
            <label><input type="checkbox" name="clear"> 清除已保存的授权码</label>
            <p class="easyread-muted">凭据仅保存在思源插件私有存储（并非加密保险箱，可能随工作空间同步），不会写入文档绑定或返回前端。跨网络建议使用 HTTPS。</p>
            <div class="easyread-actions"><button class="b3-button" data-action="save">保存设置</button><button class="b3-button b3-button--outline" data-action="test">测试已保存连接</button></div>
            <p role="status"></p>`);
        root.querySelector<HTMLInputElement>('[name="base"]')!.value = settings.baseUrl;
        this.button(root, '[data-action="save"]', async () => {
            await this.call("saveSettings", { baseUrl: root.querySelector<HTMLInputElement>('[name="base"]')!.value,
                accessCode: root.querySelector<HTMLInputElement>('[name="code"]')!.value,
                clearCode: root.querySelector<HTMLInputElement>('[name="clear"]')!.checked });
            root.querySelector<HTMLInputElement>('[name="code"]')!.value = "";
            root.querySelector('[role="status"]')!.textContent = "设置已保存。请测试连接。";
        });
        this.button(root, '[data-action="test"]', async () => {
            const info = await this.call("info");
            root.querySelector('[role="status"]')!.textContent = `内核连接成功 · EasyRead ${info.version} · API ${info.api_version} · 文档内容导入：${info.capabilities?.includes("import_html") ? "支持" : "需升级配套分支"}`;
        });
    }
    async import(docId?: string, path?: string) {
        if (!path && !docId) throw new Error("请右键需要导入的文档或 PDF 附件。");
        const binding: Binding | null = docId ? await this.call("getBinding", docId) : null;
        const { dialog, root } = this.dialog(path ? "上传 PDF 到 EasyRead" : "导入文档到 EasyRead", `
            <p>${path ? "将此 PDF 附件上传到你配置的 EasyRead。" : "将此篇文档（不含子文档）导出为 Markdown，并在内核转为 HTML 后上传。普通排版及本地图片优先保留；数据库、挂件和嵌入查询不保证完整。"}</p>
            <p class="easyread-target"></p>
            <p>这是一次明确的数据上传。未完成的服务响应不要直接重试，请先查看导入任务。</p>
            ${docId ? `<label><input name="bind" type="checkbox" ${binding ? "" : "checked"}> 完成后绑定当前文档（已有绑定不会被覆盖）</label>` : ""}
            <label><input name="translate" type="checkbox"> 导入后请求翻译（可能调用收费模型）</label>
            <div class="easyread-actions"><button class="b3-button" data-action="import">确认上传</button></div>`);
        root.querySelector(".easyread-target")!.textContent = path || `思源文档：${docId}`;
        this.button(root, '[data-action="import"]', async () => {
            const params = { docId, bind: root.querySelector<HTMLInputElement>('[name="bind"]')?.checked === true,
                translate: root.querySelector<HTMLInputElement>('[name="translate"]')!.checked };
            const task = path ? await this.call("importPDF", { ...params, path }) : await this.call("importDocument", params);
            showMessage(`已提交任务 ${htmlEscape(task.task_id)}。导入完成不代表翻译完成。`, 7000);
            if (task.warnings?.length) showMessage(htmlEscape(task.warnings.join("\n")), 9000);
            dialog.destroy();
            await this.tasks();
        });
    }
    async binding(docId: string) {
        const binding: Binding | null = await this.call("getBinding", docId);
        const { dialog, root, alive } = this.dialog("EasyRead · 绑定与同步", `
            <p class="easyread-binding"></p>
            <div class="easyread-actions"><input class="b3-text-field" name="search" placeholder="搜索 EasyRead 文章标题 / 作者"><button class="b3-button b3-button--outline" data-action="search">搜索</button></div>
            <div class="easyread-results"></div><button class="b3-button b3-button--text" data-action="more" hidden>加载更多</button>
            <label>选中的文章 ID<input class="b3-text-field" name="article" placeholder="也可直接粘贴文章 ID"></label>
            ${binding?.pending ? '<div class="easyread-actions"><button class="b3-button" data-action="recover">确认上次同步结果</button><button class="b3-button b3-button--text" data-action="abandon">放弃待确认记录</button></div>' : ''}
            ${this.optionHTML(binding?.options)}
            <div class="easyread-actions"><button class="b3-button" data-action="bind">保存绑定</button><button class="b3-button b3-button--outline" data-action="preview">预览同步</button><button class="b3-button b3-button--outline" data-action="open">在 EasyRead 打开</button><button class="b3-button b3-button--text" data-action="unbind">解除绑定</button></div>
            <p class="easyread-muted">单向同步：内容不变不重复创建；内容改变时新增同步子文档，保留历史快照和你的编辑。不会回写 EasyRead、覆盖原文或自动翻译。</p>`);
        root.querySelector(".easyread-binding")!.textContent = binding ? `当前：${binding.documentId} · ${binding.baseUrl}${binding.lastSync ? " · 上次同步 " + binding.lastSync : ""}` : "当前文档尚未绑定文章。";
        root.querySelector<HTMLInputElement>('[name="article"]')!.value = binding?.documentId || "";
        if (binding?.pending) {
            root.querySelector(".easyread-binding")!.textContent += ` · 待确认快照：${binding.pending.id}`;
            this.button(root, '[data-action="recover"]', async () => {
                await this.call("sync", { docId, options: binding.options, expectedHash: "recovery" });
                dialog.destroy(); await this.binding(docId);
            });
            this.button(root, '[data-action="abandon"]', async () => {
                confirm("放弃待确认记录", `请先检查快照 ${htmlEscape(binding.pending!.id)}。此操作仅清理待确认记录，不删除快照；再次同步可能创建另一份快照。继续？`, () => { void this.run(async () => {
                    await this.call("abandonPending", { docId, pendingId: binding.pending!.id });
                    dialog.destroy(); await this.binding(docId);
                }); });
            });
        }
        let next: number | null = null;
        let query = "";
        const search = async (offset = 0) => {
            const result = await this.call("listDocuments", { q: query, offset });
            if (!alive()) return;
            const list = root.querySelector(".easyread-results")!;
            if (!offset) list.replaceChildren();
            for (const article of result.items) {
                const button = document.createElement("button");
                button.className = "b3-list-item";
                button.textContent = `${article.display_title || article.title_zh || article.title_en || article.id} · ${article.id}`;
                button.onclick = () => { root.querySelector<HTMLInputElement>('[name="article"]')!.value = article.id; };
                list.append(button);
            }
            if (!result.items.length && !offset) list.textContent = "没有匹配的文章。";
            next = result.next_offset;
            root.querySelector<HTMLButtonElement>('[data-action="more"]')!.hidden = next === null;
        };
        this.button(root, '[data-action="search"]', async () => { query = root.querySelector<HTMLInputElement>('[name="search"]')!.value; await search(); });
        this.button(root, '[data-action="more"]', async () => { if (next !== null) await search(next); });
        this.button(root, '[data-action="bind"]', async () => {
            const selected = root.querySelector<HTMLInputElement>('[name="article"]')!.value.trim();
            const save = async () => {
                await this.call("bind", { docId, documentId: selected, options: this.options(root) });
                dialog.destroy(); await this.binding(docId);
            };
            if (binding && binding.documentId !== selected) confirm("更换绑定", "只更换关联文章，历史同步子文档仍保留。继续？", () => { void this.run(save); });
            else await save();
        });
        this.button(root, '[data-action="preview"]', () => this.preview(docId, this.options(root)));
        this.button(root, '[data-action="open"]', async () => {
            const b = await this.call("getBinding", docId) as Binding | null;
            if (!b) throw new Error("请先保存绑定。");
            window.open(readingURL(b.baseUrl, b.documentId), "_blank", "noopener,noreferrer");
        });
        this.button(root, '[data-action="unbind"]', async () => {
            confirm("解除 EasyRead 绑定", "只清除绑定属性，不删除原文、快照或 EasyRead 数据。继续？", () => { void this.run(async () => {
                await this.call("unbind", docId); dialog.destroy(); await this.binding(docId);
            }); });
        });
    }
    private async preview(docId: string, options: SyncOptions) {
        const preview = await this.call("preview", { docId, options });
        const { dialog, root } = this.dialog("EasyRead · 同步预览", `<p>笔记 ${preview.counts.notes} · 划线 ${preview.counts.highlights} · 正文块 ${preview.counts.blocks}</p>
            <textarea readonly class="b3-text-field easyread-preview" aria-label="同步 Markdown 预览"></textarea>
            <div class="easyread-actions"><button class="b3-button" data-action="sync">确认同步到子文档</button></div>`);
        root.querySelector<HTMLTextAreaElement>("textarea")!.value = preview.markdown;
        this.button(root, '[data-action="sync"]', async () => {
            const result = await this.call("sync", { docId, options, expectedHash: preview.hash });
            showMessage(result.unchanged ? "内容未变化，保留现有快照。" : result.recovered ? "已确认上次同步结果。" : "同步完成，已新增快照子文档。");
            dialog.destroy();
            openTab({ app: this.plugin.app, doc: { id: result.id } });
        });
    }
    async tasks() {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const cancelTimer = () => {
            if (timer !== undefined) { clearTimeout(timer); this.timers.delete(timer); timer = undefined; }
        };
        const { root, alive } = this.dialog("EasyRead · 导入任务", `<p>done 仅表示入库。准备 / 翻译的状态请查看 processing 或在 EasyRead 中查看；不会自动重发失败任务。</p><div class="easyread-tasks"></div><button class="b3-button b3-button--outline" data-action="refresh">刷新状态</button>`, "700px", cancelTimer);
        let refreshing = false;
        const refresh = async () => {
            if (refreshing || !alive()) return;
            cancelTimer();
            refreshing = true;
            try {
                const settings = await this.call("getSettings");
                const records: ImportRecord[] = (await this.call("tasks")).slice().reverse();
                const list = root.querySelector(".easyread-tasks")!;
                list.replaceChildren();
                if (!records.length) list.textContent = "暂无插件提交的导入任务。";
                let active = false;
                for (const record of records) {
                    if (!alive()) return;
                    const row = document.createElement("div"); row.className = "easyread-task";
                    let task: any = record;
                    let error = "";
                    if (record.baseUrl === settings.baseUrl) {
                        try { task = await this.call("task", record.taskId); } catch (e) { error = String((e as Error).message); }
                    } else error = "属于另一服务，请切换设置后查看。";
                    const text = document.createElement("p");
                    text.textContent = `${record.taskId}\n${task.state}${task.processing ? " · processing: " + JSON.stringify(task.processing) : ""}${error ? " · " + error : ""}${task.error ? " · " + JSON.stringify(task.error) : ""}`;
                    row.append(text);
                    const id = task.document_id || record.documentId;
                    if (id) {
                        const link = document.createElement("a"); link.textContent = "打开文章";
                        link.href = readingURL(record.baseUrl, id); link.target = "_blank"; link.rel = "noopener noreferrer"; row.append(link);
                    }
                    list.append(row);
                    if (!error && ["queued", "running"].includes(task.state)) active = true;
                }
                if (active && alive()) {
                    timer = setTimeout(() => { cancelTimer(); void this.run(refresh); }, 2500);
                    this.timers.add(timer);
                }
            } finally { refreshing = false; }
        };
        this.button(root, '[data-action="refresh"]', refresh);
        await refresh();
    }
}
