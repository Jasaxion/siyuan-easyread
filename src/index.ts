import { Plugin, Menu, getActiveEditor } from "siyuan";
import { assetPath, htmlEscape } from "./shared";
import { UI } from "./ui";

export default class EasyReadPlugin extends Plugin {
    private ui!: UI;
    private listeners: Array<[string, (event: CustomEvent<any>) => void]> = [];
    onload() {
        this.ui = new UI(this);
        if ((window as any).siyuan?.config?.readonly || (window as any).siyuan?.isPublish) return;
        this.addIcons('<symbol id="iconEasyRead" viewBox="0 0 32 32"><path d="M3 5h11l2 2 2-2h11v22H18l-2 2-2-2H3V5zm3 3v16h7l1 1V10l-1-2H6zm13 0-1 2v15l1-1h7V8h-7z"/></symbol>');
        this.addTopBar({ icon: "iconEasyRead", title: "EasyRead", position: "right", callback: () => {
            const menu = new Menu("easyread-main");
            const id = getActiveEditor()?.protyle?.block?.rootID;
            if (id) this.documentMenu(menu, id);
            menu.addItem({ icon: "iconCloud", label: "导入任务", click: () => { void this.ui.run(() => this.ui.tasks()); } });
            menu.addItem({ icon: "iconSettings", label: "EasyRead 连接设置", click: () => this.openSetting() });
            menu.open({ x: Math.max(0, window.innerWidth - 300), y: 48 });
        } });
        this.listen("open-menu-doctree", event => {
            const d = event.detail;
            if (d.type !== "doc" || d.elements?.length !== 1) return;
            const id = d.items?.[0]?.id || d.elements[0]?.getAttribute("data-node-id");
            if (id) this.documentMenu(d.menu, id);
        });
        this.listen("click-editortitleicon", event => {
            const d = event.detail;
            const id = d.protyle?.block?.rootID || d.data?.id;
            if (id) this.documentMenu(d.menu, id);
        });
        for (const name of ["open-menu-link", "open-menu-content", "open-menu-fileannotationref"]) {
            this.listen(name, event => {
                const d = event.detail;
                this.pdfMenu(d.menu, [d.element], d.protyle?.block?.rootID);
            });
        }
        this.listen("click-blockicon", event => {
            const d = event.detail;
            this.pdfMenu(d.menu, d.blockElements || [], d.protyle?.block?.rootID);
        });
    }
    private listen(name: string, fn: (event: CustomEvent<any>) => void) {
        this.eventBus.on(name as any, fn);
        this.listeners.push([name, fn]);
    }
    private documentMenu(menu: any, id: string) {
        menu.addItem({ icon: "iconEasyRead", label: "EasyRead", submenu: [
            { icon: "iconUpload", label: "导入文档到 EasyRead", click: () => { void this.ui.run(() => this.ui.import(id)); } },
            { icon: "iconRefresh", label: "绑定文章 / 同步笔记", click: () => { void this.ui.run(() => this.ui.binding(id)); } },
        ] });
    }
    private pdfMenu(menu: any, elements: HTMLElement[], id?: string) {
        const paths = new Set<string>();
        for (const element of elements) {
            if (!element) continue;
            const candidates = [element, element.closest("[data-href], a[href]"), ...element.querySelectorAll("[data-href], a[href], iframe[src], embed[src]")];
            for (const candidate of candidates) {
                if (!candidate) continue;
                const raw = candidate.getAttribute("data-href") || candidate.getAttribute("href") || candidate.getAttribute("src");
                if (!raw) continue;
                try { paths.add(assetPath(raw, true)); } catch { /* Not a local PDF attachment. */ }
            }
        }
        for (const path of paths) menu.addItem({ icon: "iconEasyRead", label: `上传 PDF 到 EasyRead · ${htmlEscape(path.split("/").pop())}`, click: () => { void this.ui.run(() => this.ui.import(id, path)); } });
    }
    openSetting() { void this.ui.run(() => this.ui.settings()); }
    onunload() {
        for (const [name, fn] of this.listeners) this.eventBus.off(name as any, fn);
        this.listeners = [];
        this.ui?.destroy();
    }
}
