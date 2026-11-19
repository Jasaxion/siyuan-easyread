import { readingURL, type SyncOptions } from "./shared";

type Row = Record<string, any>;
export type Snapshot = { document: Row; notes?: Row; highlights?: Row; content?: Row };
// Preserve ordinary Markdown, but never activate imported HTML, queries, IAL or custom blocks.
export function safeMarkdown(value: unknown): string {
    return String(value ?? "").replace(/\r/g, "").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/^([ \t]*)(\{[:{]|;;;)/gm, "$1\\$2")
        .replace(/\]\(\s*(?:javascript|data|vbscript|file):[^)]*\)/gi, "](blocked)");
}
const quote = (text: unknown) => safeMarkdown(text).split("\n").map(x => "> " + x).join("\n");
const md = (text: unknown) => safeMarkdown(text).trim();
const label = (text: unknown) => md(text).replace(/[\[\]\n]/g, " ");
function table(rows: unknown[][]): string {
    if (!rows.length) return "";
    const cols = Math.max(...rows.map(row => row.length));
    const row = (cells: unknown[]) => "| " + Array.from({ length: cols }, (_, i) => md(cells[i]).replace(/\|/g, "\\|").replace(/\n/g, " / ")).join(" | ") + " |";
    return [row(rows[0]), row(Array(cols).fill("---")), ...rows.slice(1).map(row)].join("\n");
}
function blockText(block: Row): string {
    const pair = (en: unknown, zh: unknown) => [md(en), zh ? `**译文**\n\n${md(zh)}` : ""].filter(Boolean).join("\n\n");
    if (block.type === "heading") return `${"#".repeat(Math.min(6, Math.max(3, Number(block.level || 1) + 2)))} ${label(block.en)}${block.zh ? " / " + label(block.zh) : ""}`;
    if (block.type === "list") return (block.items || []).map((item: Row, i: number) => `${block.ordered ? `${i + 1}.` : "-"} ${pair(item.en, item.zh).replace(/\n/g, "\n  ")}`).join("\n");
    if (block.type === "math") return `$$\n${String(block.tex || "").replace(/\$\$/g, "")}\n$$`;
    if (block.type === "table") return [table([...(block.head || []), ...(block.rows || [])]), pair(block.caption_en, block.caption_zh)].filter(Boolean).join("\n\n");
    if (block.type === "figure") return ["*图片请通过原文链接在 EasyRead 中查看。*", pair(block.image_en, block.image_zh), pair(block.caption_en, block.caption_zh)].filter(Boolean).join("\n\n");
    return pair(block.en, block.zh);
}
export function renderSnapshot(data: Snapshot, options: SyncOptions, base: string, id: string): string {
    const title = data.document.display_title || data.document.title_zh || data.document.title_en || id;
    const url = readingURL(base, id);
    const out = [`[${label(title)}](${url}) · [桌面打开](easyread://open?id=${encodeURIComponent(id)})`,
        "> EasyRead 单向同步快照。后续同步不会覆盖你对本快照的修改；新内容将保存为新快照。"];
    const link = (item: Row) => `[回到原句](${readingURL(base, id, item.anchor || item.id)})`;
    if (options.notes) {
        out.push("## 阅读笔记");
        const paper = data.notes?.paper_note?.body;
        if (paper) out.push("### 整篇笔记", md(paper));
        for (const note of data.notes?.items || []) {
            out.push(`### ${note.kind === "question" ? "问题" : "笔记"} · ${link(note)}`);
            if (note.quote) out.push(quote(note.quote));
            if (note.body) out.push(md(note.body));
        }
        if (!paper && !data.notes?.items?.length) out.push("*暂无阅读笔记。*");
    }
    if (options.highlights) {
        out.push("## 划线摘录");
        for (const highlight of data.highlights?.items || []) {
            out.push(`**${label(highlight.color || "highlight")}** · ${link(highlight)}`);
            if (highlight.quote) out.push(quote(highlight.quote));
            if (highlight.body) out.push(md(highlight.body));
        }
        if (!data.highlights?.items?.length) out.push("*暂无划线。*");
    }
    if (options.bilingual) {
        out.push("## 双语正文");
        const blocks = data.content?.items || [];
        if (!blocks.length) throw new Error("EasyRead 暂无结构化正文，请完成预处理后再同步；没有写入空快照。");
        const translated = blocks.some((b: Row) => b.zh || b.caption_zh || b.image_zh || b.items?.some((i: Row) => i.zh));
        if (!translated) out.push("> 尚无译文；本次只包含原文。请在 EasyRead 中完成翻译后再次同步。");
        for (const block of blocks) {
            out.push(blockText(block), `[原文位置](${readingURL(base, id, block.id)})`);
        }
    }
    return out.filter(Boolean).join("\n\n") + "\n";
}
