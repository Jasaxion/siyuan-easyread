import { Service } from "./service";

const service = new Service(siyuan);
const methods = ["getSettings", "saveSettings", "info", "getBinding", "bind", "unbind", "abandonPending", "listDocuments", "importDocument", "importPDF", "tasks", "task", "removeTask", "preview", "sync"] as const;
siyuan.plugin.lifecycle.onload = async () => {
    for (const method of methods) {
        await siyuan.rpc.bind(method, (...args: any[]) => (service[method] as Function).apply(service, args));
    }
};
siyuan.plugin.lifecycle.onunload = async () => {
    for (const method of methods) await siyuan.rpc.unbind(method);
};
