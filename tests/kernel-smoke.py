"""Run on jd-mac against a disposable SiYuan workspace; never use a real workspace.
Usage: python3 kernel-smoke.py /tmp/.../siyuan-easyread-test.XXXXXX ./dist
Uses real SiYuan kernel.js/RPC/storage/block APIs and a loopback fake EasyRead.
"""
import datetime
import hashlib
import http.server
import json
from pathlib import Path
import sys
import threading
import time
import urllib.error
import urllib.request
import uuid

root = Path(sys.argv[1]).resolve()
assert root.name.startswith("siyuan-easyread-test."), "Disposable test workspace required"
conf = json.loads((root / "workspace/conf/conf.json").read_text())
assert conf["accessAuthCode"] == "easyread-isolated-test-only", "Not the test kernel"
token = conf["api"]["token"]
base = "http://127.0.0.1:16808"
dist = Path(sys.argv[2]).resolve()
assert json.loads((dist / "plugin.json").read_text())["name"] == "siyuan-easyread"


def request(path, data=None, raw=None, content_type="application/json"):
    body = raw if raw is not None else json.dumps(data or {}).encode()
    req = urllib.request.Request(base + path, data=body, headers={"Authorization": "Token " + token, "Content-Type": content_type})
    with urllib.request.urlopen(req, timeout=80) as res:
        return json.loads(res.read())


def api(path, data=None):
    result = request(path, data)
    assert result.get("code") == 0, (path, result)
    return result.get("data")


def upload(path, contents, mime="application/octet-stream"):
    boundary = "easyread" + uuid.uuid4().hex
    body = (f'--{boundary}\r\nContent-Disposition: form-data; name="path"\r\n\r\n{path}\r\n'
            f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="file"\r\nContent-Type: {mime}\r\n\r\n').encode() + contents + f"\r\n--{boundary}--\r\n".encode()
    result = request("/api/file/putFile", raw=body, content_type="multipart/form-data; boundary=" + boundary)
    assert result["code"] == 0, result


# Only this throw-away workspace: permit the plugin under test, never change a user's trust setting.
api("/api/setting/setBazaar", {"trust": True, "petalDisabled": False})
disabled = request("/api/petal/setPetalEnabled", {"packageName": "siyuan-easyread", "enabled": False})
assert disabled["code"] == 0 or "not found" in disabled.get("msg", ""), disabled
for file in dist.iterdir():
    if file.is_file(): upload("/data/plugins/siyuan-easyread/" + file.name, file.read_bytes())
api("/api/petal/setPetalEnabled", {"packageName": "siyuan-easyread", "enabled": True})
api("/api/petal/loadPetals", {"frontend": "desktop"})


def rpc(method, *args):
    result = request("/api/plugin/rpc/siyuan-easyread", {"jsonrpc": "2.0", "id": uuid.uuid4().hex, "method": method, "params": list(args)})
    assert "error" not in result, (method, result)
    return result["result"]


for _ in range(40):
    try:
        rpc("getSettings")
        break
    except (AssertionError, urllib.error.HTTPError):
        time.sleep(.25)
else: raise AssertionError("kernel plugin did not start")
print("PASS real Goja kernel.js loads and RPC runs")

article = "aabbccddeeff"
task_id = "c" * 32
state = {"posts": [], "note": "kernel integration note"}


class EasyRead(http.server.BaseHTTPRequestHandler):
    def log_message(self, *_): pass
    def reply(self, data, status=200):
        payload = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)
    def do_GET(self):
        assert self.headers.get("Authorization") == "Bearer fixture-key"
        path = self.path.split("?")[0]
        items = []
        result = {}
        if path.endswith("/info"):
            return self.reply({"version": "fixture", "api_version": "1", "capabilities": ["import_html"], "max_html_bytes": 8388608})
        if path.endswith("/notes"):
            items = [{"id": "n1", "anchor": "p1", "body": state["note"], "quote": "quoted", "kind": "note"}]
            result = {"paper_note": {"body": "whole paper"}, "version": 1}
        elif path.endswith("/highlights"):
            items = [{"id": "h1", "anchor": "p1", "quote": "original", "color": "yellow"}]
            result = {"version": 1}
        elif path.endswith("/content"):
            items = [{"id": "p1", "type": "para", "en": "Original text", "zh": "中文译文"}]
            result = {"versions": {"paper": 1, "reader": 1}}
        elif "/tasks/" in path:
            return self.reply({"id": task_id, "state": "done", "document_id": article, "processing": None})
        elif path.endswith("/" + article): return self.reply({"id": article, "title_en": "Integration article"})
        elif path.endswith("/documents"): items = [{"id": article, "title_en": "Integration article"}]
        else: return self.reply({"error": {"code": "not_found"}}, 404)
        return self.reply({**result, "items": items, "offset": 0, "limit": 200, "total": len(items), "next_offset": None})
    def do_POST(self):
        assert self.headers.get("Authorization") == "Bearer fixture-key"
        body = self.rfile.read(int(self.headers["Content-Length"]))
        state["posts"].append((self.path, body))
        return self.reply({"task_id": task_id, "state": "queued"}, 202)


server = http.server.HTTPServer(("127.0.0.1", 0), EasyRead)
threading.Thread(target=server.serve_forever, daemon=True).start()
try:
    rpc("saveSettings", {"baseUrl": "http://127.0.0.1:" + str(server.server_port), "accessCode": "fixture-key"})
    assert rpc("info")["version"] == "fixture"
    assert rpc("getSettings").get("hasCode") and "accessCode" not in rpc("getSettings")
    print("PASS kernel forwardProxy + Bearer; secrets not returned")
    notebook = api("/api/notebook/createNotebook", {"name": "EasyRead kernel test " + uuid.uuid4().hex[:6]})["notebook"]["id"]
    # Notebook identity metadata is indexed asynchronously by SiYuan.
    time.sleep(1)
    doc_id = datetime.datetime.now().strftime("%Y%m%d%H%M%S") + "-" + uuid.uuid4().hex[:7]
    result = api("/api/filetree/createDocByParent", {"id": doc_id, "notebook": notebook, "parentID": None, "title": {"format": "plain", "text": "Test source"}, "markdown": "# 中文测试\n\nThis is a private SiYuan test document.\n\n- list item\n\n$$\nx^2\n$$"})
    assert result["id"] == doc_id
    print("PASS identity-based createDocByParent")
    options = {"notes": True, "highlights": True, "bilingual": True}
    rpc("bind", {"docId": doc_id, "documentId": article, "options": options})
    preview = rpc("preview", {"docId": doc_id, "options": options})
    assert "中文译文" in preview["markdown"] and "kernel integration note" in preview["markdown"]
    result = rpc("sync", {"docId": doc_id, "options": options, "expectedHash": preview["hash"]})
    snapshot = result["id"]
    attrs = api("/api/attr/getBlockAttrs", {"id": snapshot})
    assert attrs["custom-easyread-source"] == doc_id
    assert attrs["custom-easyread-hash"] == preview["hash"]
    exported = api("/api/export/exportMdContent", {"id": snapshot, "addTitle": False})["content"]
    assert "中文译文" in exported and "kernel integration note" in exported
    assert rpc("sync", {"docId": doc_id, "options": options, "expectedHash": preview["hash"]})["unchanged"]
    state["note"] = "new remote note"
    preview2 = rpc("preview", {"docId": doc_id, "options": options})
    second = rpc("sync", {"docId": doc_id, "options": options, "expectedHash": preview2["hash"]})
    assert second["id"] != snapshot
    assert api("/api/export/exportMdContent", {"id": snapshot, "addTitle": False})["content"] == exported
    print("PASS real snapshot creation, readback, unchanged dedupe, old content preservation")
    doc_import = rpc("importDocument", {"docId": doc_id, "translate": False})
    payload = json.loads(state["posts"][-1][1])
    assert "中文测试" in payload["html"] and payload["translate"] is False
    assert payload["source_id"] == "siyuan:" + doc_id
    print("PASS kernel Markdown export / Lute HTML conversion / HTML upload")
    pdf_path = "assets/easyread-test-" + uuid.uuid4().hex[:8] + ".pdf"
    pdf = b"%PDF-1.4\n% integration fixture binary \x00\xff\n%%EOF"
    upload("/data/" + pdf_path, pdf, "application/pdf")
    rpc("importPDF", {"path": pdf_path, "translate": False})
    assert state["posts"][-1][1] == pdf
    assert "translate=false" in state["posts"][-1][0]
    assert rpc("task", task_id)["state"] == "done"
    print("PASS raw PDF bytes intact through kernel proxy; durable task lookup")
    rpc("unbind", doc_id)
    assert rpc("getBinding", doc_id) is None
    assert api("/api/export/exportMdContent", {"id": snapshot})["content"]
    print("PASS unbind preserves snapshot; all kernel integration checks passed")
finally:
    server.shutdown()
    server.server_close()
