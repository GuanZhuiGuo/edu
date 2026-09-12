#!/usr/bin/env python3
"""Build the offline research report without touching application dependencies.

Usage:
  /tmp/codex-education-report-20260912/bin/python render-report.py
  /tmp/codex-education-report-20260912/bin/python render-report.py --self-test

Requires Python-Markdown 3.9. A clean installation can use any temporary venv:
  python3 -m venv /tmp/codex-report-renderer
  /tmp/codex-report-renderer/bin/python -m pip install Markdown==3.9
"""

from __future__ import annotations

import argparse
import html
from html.parser import HTMLParser
import json
import os
from pathlib import Path
import re
import tempfile
from urllib.parse import quote, unquote, urlsplit, urlunsplit


BASE = Path(__file__).resolve().parent
MAIN_NAME = "课件分类与创作架构研究.md"
PROPOSAL_NAME = "deep-agent-proposal.md"

CSS = """
:root { color-scheme: light; --ink:#171717; --muted:#575757; --line:#d5d5d5; --soft:#f5f5f5; }
* { box-sizing:border-box; }
html { scroll-behavior:smooth; scroll-padding-top:24px; }
body { margin:0; background:#fff; color:var(--ink); font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",Arial,sans-serif; font-size:16px; line-height:1.85; }
::selection { background:#d9d9d9; color:#000; }
a { color:inherit; text-decoration:underline; text-decoration-thickness:1px; text-underline-offset:3px; overflow-wrap:anywhere; }
a:hover { text-decoration-thickness:2px; }
:focus-visible { outline:2px solid #222; outline-offset:4px; }
.report-layout { display:grid; grid-template-columns:244px minmax(0,1fr); gap:64px; max-width:1440px; margin:0 auto; padding:48px 48px 80px; }
.report-sidebar { position:sticky; top:32px; align-self:start; max-height:calc(100vh - 64px); overflow:auto; scrollbar-color:#aaa transparent; }
.report-toc { border-bottom:1px solid var(--line); padding-bottom:20px; }
.report-toc > summary { cursor:pointer; padding:0 0 12px; font-size:16px; font-weight:650; }
.report-toc nav > ol { margin:0; padding:0; list-style:none; }
.report-toc li { margin:0; padding:0; line-height:1.5; }
.report-toc a { display:block; padding:7px 0; color:var(--muted); font-size:13px; text-decoration:none; }
.report-toc a:hover, .report-toc a[aria-current="location"] { color:#000; text-decoration:underline; }
.report-toc .toc-level-3 { padding-left:14px; }
.report-toc .toc-level-4 { padding-left:28px; }
.report-tools { display:flex; flex-wrap:wrap; align-items:center; gap:12px; margin-top:20px; }
.report-tools button { min-height:40px; padding:6px 12px; border:1px solid #aaa; border-radius:3px; background:#fff; color:var(--ink); font:inherit; font-size:13px; cursor:pointer; }
.report-tools button:hover { background:var(--soft); }
.report-tools a { font-size:13px; color:var(--muted); }
main { min-width:0; max-width:1024px; }
.report-document + .report-document { margin-top:64px; padding-top:40px; border-top:1px solid var(--line); }
h1,h2,h3,h4,h5,h6 { color:#111; line-height:1.45; font-weight:650; overflow-wrap:anywhere; scroll-margin-top:24px; }
h1 { max-width:26em; margin:0 0 36px; font-size:32px; letter-spacing:-.02em; }
h2 { margin:48px 0 20px; padding-top:8px; font-size:24px; }
h3 { margin:32px 0 14px; font-size:19px; }
h4,h5,h6 { margin:24px 0 12px; font-size:16px; }
.report-document > :first-child { margin-top:0; }
p { max-width:78ch; margin:0 0 18px; }
ul,ol { margin:0 0 22px; padding-left:1.5em; }
li { margin:7px 0; }
li > p { margin-bottom:10px; }
strong { font-weight:650; }
blockquote { margin:24px 0; padding:0 0 0 20px; border-left:1px solid #777; color:#444; }
blockquote > :last-child { margin-bottom:0; }
hr { height:1px; margin:36px 0; border:0; background:var(--line); }
.table-scroll { max-width:100%; overflow-x:auto; margin:24px 0; scrollbar-color:#aaa var(--soft); }
table { border-collapse:collapse; width:100%; min-width:640px; font-size:14px; line-height:1.65; text-align:left; }
caption { padding:0 0 12px; text-align:left; font-weight:600; }
th,td { padding:12px 14px; border-bottom:1px solid var(--line); vertical-align:top; overflow-wrap:anywhere; }
th { border-top:1px solid #777; border-bottom-color:#777; background:var(--soft); font-weight:650; }
td > :last-child { margin-bottom:0; }
pre { overflow:auto; margin:24px 0; padding:18px 20px; border:1px solid var(--line); background:var(--soft); font-size:13px; line-height:1.7; tab-size:2; scrollbar-color:#aaa var(--soft); }
code { font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; font-size:.88em; overflow-wrap:anywhere; }
:not(pre) > code { padding:1px 4px; background:var(--soft); }
pre code { padding:0; background:none; font-size:inherit; overflow-wrap:normal; }
img,svg { max-width:100%; height:auto; }
.footnote { margin-top:36px; color:#444; font-size:13px; line-height:1.75; }
.footnote hr { margin:0 0 20px; }
.footnote li { margin:10px 0; }
.footnote p { max-width:none; }
.footnote-ref { font-size:12px; font-weight:650; text-decoration:none; }
.footnote-backref { white-space:nowrap; margin-left:6px; }
.report-diagram { margin:28px 0; }
.report-diagram-scroll { max-width:100%; overflow-x:auto; scrollbar-color:#aaa var(--soft); }
.report-diagram svg { display:block; width:100%; min-width:0; height:auto; }
.report-diagram figcaption { margin-top:12px; color:var(--muted); font-size:13px; line-height:1.7; }
@media (min-width:1600px) { .report-layout { padding-top:64px; } }
@media (max-width:1100px) { .report-layout { grid-template-columns:210px minmax(0,1fr); gap:36px; padding:36px 28px 64px; } }
@media (max-width:900px) {
  .report-diagram svg { min-width:860px; }
  .report-layout { display:block; padding:24px 24px 56px; }
  .report-sidebar { position:static; max-height:none; margin-bottom:32px; }
  .report-toc { padding-bottom:8px; }
  .report-toc > summary { min-height:44px; padding:8px 0; }
  .report-toc nav { max-height:50vh; overflow:auto; padding-bottom:12px; }
  .report-toc a { min-height:40px; padding:9px 0; font-size:14px; }
  .report-tools { margin-top:12px; }
  .report-tools button { min-height:44px; }
  h1 { font-size:28px; margin-bottom:28px; }
  h2 { margin-top:36px; font-size:22px; }
}
@media (max-width:480px) { .report-layout { padding:20px 18px 48px; } h1 { font-size:25px; } h2 { font-size:21px; } h3 { font-size:18px; } th,td { padding:10px 12px; } }
@media (prefers-reduced-motion:reduce) { html { scroll-behavior:auto; } }
@page { size:A4; margin:18mm 16mm; }
@media print {
  html { scroll-behavior:auto; }
  body { color:#000; font-size:10.5pt; line-height:1.65; }
  .report-layout { display:block; max-width:none; padding:0; }
  .report-sidebar { display:none; }
  main { max-width:none; }
  h1 { margin-bottom:20pt; font-size:22pt; }
  h2 { margin-top:24pt; font-size:16pt; }
  h3 { margin-top:18pt; font-size:12pt; }
  h4,h5,h6 { font-size:10.5pt; }
  h1,h2,h3,h4,h5,h6 { break-after:avoid; }
  p,li { orphans:3; widows:3; }
  .report-document + .report-document { margin-top:28pt; padding-top:20pt; }
  .table-scroll { overflow:visible; margin:16pt 0; }
  table { min-width:0; width:100%; font-size:8pt; line-height:1.5; }
  thead { display:table-header-group; }
  tr { break-inside:avoid; }
  th,td { padding:5pt 6pt; }
  pre { overflow:visible; white-space:pre-wrap; overflow-wrap:anywhere; font-size:8.5pt; padding:10pt; }
  pre code { white-space:pre-wrap; overflow-wrap:anywhere; }
  .footnote { font-size:8.5pt; }
  .report-diagram { break-inside:avoid; }
  .report-diagram-scroll { overflow:visible; }
  .report-diagram svg { min-width:0; width:100%; height:auto; }
  .report-diagram figcaption { font-size:8.5pt; }
  a { color:#000; }
}
"""

SCRIPT = """
(() => {
  const contents = document.querySelector('.report-toc');
  const desktop = window.matchMedia('(min-width: 901px)');
  contents.open = desktop.matches;
  desktop.addEventListener('change', event => { contents.open = event.matches; });
  document.querySelector('[data-print-report]').addEventListener('click', () => window.print());
  document.querySelectorAll('.report-toc a').forEach(link => {
    link.addEventListener('click', () => {
      if (!desktop.matches) contents.open = false;
      document.querySelectorAll('.report-toc a[aria-current]').forEach(item => item.removeAttribute('aria-current'));
      link.setAttribute('aria-current', 'location');
    });
  });
})();
"""


class HTMLFacts(HTMLParser):
    """Collect final heading text/anchors without an extra DOM dependency."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.ids = []
        self.links = []
        self.headings = []
        self._heading = None

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if attrs.get("id"):
            self.ids.append(attrs["id"])
        if tag == "a" and attrs.get("href"):
            self.links.append(attrs["href"])
        if re.fullmatch(r"h[1-6]", tag):
            self._heading = {"level": int(tag[1]), "id": attrs.get("id", ""), "text": ""}

    def handle_endtag(self, tag):
        if self._heading and tag == "h" + str(self._heading["level"]):
            self._heading["text"] = self._heading["text"].strip()
            self.headings.append(self._heading)
            self._heading = None

    def handle_data(self, data):
        if self._heading:
            self._heading["text"] += data


class DocumentRewriter(HTMLParser):
    """Namespace headings/footnotes and make tables keyboard-scrollable."""

    def __init__(self, document, source_map, output_directory, keep_title):
        super().__init__(convert_charrefs=False)
        self.document = document
        self.source_map = source_map
        self.output_directory = output_directory
        self.keep_title = keep_title
        self.title_kept = False
        self.fragments = []
        self.heading_tags = []
        self.suppressed = None

    def rewrite_link(self, value):
        parts = urlsplit(value)
        if parts.scheme.lower() in {"javascript", "vbscript", "data"}:
            return "#report-top"
        if parts.scheme or parts.netloc:
            return value
        if not parts.path and parts.fragment:
            return "#" + self.document["prefix"] + unquote(parts.fragment)
        if not parts.path:
            return value
        target = (self.document["path"].parent / unquote(parts.path)).resolve()
        if target in self.source_map:
            prefix = self.source_map[target]
            return "#" + (prefix + unquote(parts.fragment) if parts.fragment else prefix + "document")
        relative = Path(os.path.relpath(target, self.output_directory)).as_posix()
        return urlunsplit(("", "", quote(relative, safe="/._-~"), parts.query, parts.fragment))

    def handle_starttag(self, tag, attrs):
        if self.suppressed:
            return
        if tag in {"script", "style", "iframe", "object", "embed"}:
            self.suppressed = tag
            return
        output_tag = tag
        if re.fullmatch(r"h[1-6]", tag):
            level = int(tag[1])
            if self.keep_title and level == 1 and not self.title_kept:
                self.title_kept = True
            elif not self.keep_title:
                level = min(6, level + 1)
            elif level == 1:
                level = 2
            output_tag = "h" + str(level)
            self.heading_tags.append((tag, output_tag))
        if tag == "table":
            self.fragments.append('<div class="table-scroll" role="region" tabindex="0" aria-label="表格，可横向滚动">')
        rewritten = []
        for key, value in attrs:
            if key.lower().startswith("on"):
                continue
            if value is not None:
                if key in {"id", "name"}:
                    value = self.document["prefix"] + value
                elif key in {"href", "src"}:
                    value = self.rewrite_link(value)
                elif key in {"aria-labelledby", "aria-describedby", "headers"}:
                    value = " ".join(self.document["prefix"] + item for item in value.split())
                elif "url(#" in value:
                    value = re.sub(r"url\(#([^\)]+)\)", lambda match: "url(#" + self.document["prefix"] + match.group(1) + ")", value)
            rewritten.append(key if value is None else key + '="' + html.escape(value, quote=True) + '"')
        attributes = " " + " ".join(rewritten) if rewritten else ""
        self.fragments.append("<" + output_tag + attributes + ">")

    def handle_endtag(self, tag):
        if self.suppressed:
            if tag == self.suppressed:
                self.suppressed = None
            return
        output_tag = tag
        if self.heading_tags and self.heading_tags[-1][0] == tag:
            _, output_tag = self.heading_tags.pop()
        self.fragments.append("</" + output_tag + ">")
        if tag == "table":
            self.fragments.append("</div>")

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}:
            self.handle_endtag(tag)

    def handle_data(self, data):
        if not self.suppressed:
            self.fragments.append(data)

    def handle_entityref(self, name):
        if not self.suppressed:
            self.fragments.append("&" + name + ";")

    def handle_charref(self, name):
        if not self.suppressed:
            self.fragments.append("&#" + name + ";")


def teaching_architecture_svg(mermaid_source):
    """Render exactly the proposal's 5.1 graph; reject a changed topology."""
    positions = {
        "T": (70, 90, 220, 68), "V": (340, 90, 220, 68),
        "C": (610, 80, 290, 88), "R": (1000, 80, 270, 88),
        "Q": (1000, 246, 270, 68), "D": (735, 230, 160, 100),
        "P": (350, 405, 270, 68), "A": (670, 405, 270, 68),
        "K": (670, 535, 270, 88), "U": (350, 655, 300, 68),
        "X": (70, 840, 265, 88), "L": (370, 840, 265, 88),
        "E": (670, 840, 265, 88), "M": (970, 840, 300, 88),
        "G": (500, 1030, 420, 68), "F": (470, 1140, 480, 68),
        "UI": (530, 1260, 360, 88), "EV": (1000, 335, 270, 58),
        "S": (990, 460, 260, 68), "TT": (990, 570, 260, 68),
        "SP": (990, 680, 260, 88),
    }
    routes = {
        ("T", "V"): "M290 124 H340", ("V", "C"): "M560 124 H610",
        ("C", "R"): "M900 124 H1000", ("R", "Q"): "M1135 168 V246",
        ("Q", "D"): "M1000 280 H895", ("D", "P"): "M735 280 H485 V405",
        ("D", "A"): "M815 330 V365 H805 V405", ("A", "K"): "M805 473 V535",
        ("A", "U"): "M670 439 H655 V689 H650", ("P", "U"): "M485 473 V620 H500 V655",
        ("U", "X"): "M500 723 V790 H202 V840", ("U", "L"): "M500 723 V790 H502 V840",
        ("U", "E"): "M500 723 V790 H802 V840", ("U", "M"): "M500 723 V790 H1120 V840",
        ("M", "G"): "M1120 928 V986 H710 V1030", ("L", "G"): "M502 928 V986 H710 V1030",
        ("E", "G"): "M802 928 V986 H710 V1030", ("X", "G"): "M202 928 V986 H710 V1030",
        ("G", "F"): "M710 1098 V1140", ("F", "UI"): "M710 1208 V1260",
        ("UI", "C"): "M710 1348 V1380 H1360 V40 H755 V80",
        ("R", "EV"): "M1270 124 H1300 V364 H1270",
        ("EV", "UI"): "M1270 364 H1330 V1304 H890",
        ("S", "TT"): "M1120 528 V570", ("TT", "M"): "M1250 604 H1300 V884 H1270",
        ("TT", "SP"): "M1120 638 V680",
    }
    node_pattern = r"([A-Z]+)(?:\[([^\]]+)\]|\{([^}]+)\})?"
    edge_pattern = re.compile(r"^\s*" + node_pattern + r"\s*-->\s*(?:\|([^|]+)\|)?\s*" + node_pattern + r"\s*$")
    labels, edges, edge_labels = {}, set(), {}
    for raw_line in mermaid_source.strip().splitlines():
        line = raw_line.strip()
        if line in {"flowchart TD", "graph TD", ""}:
            continue
        match = edge_pattern.fullmatch(line)
        if not match:
            raise ValueError("5.1 Mermaid 格式已变化，需要同步静态 SVG：" + line)
        start, start_box, start_diamond, edge_label, end, end_box, end_diamond = match.groups()
        for key, label in [(start, start_box or start_diamond), (end, end_box or end_diamond)]:
            if label:
                labels[key] = label.replace("\\n", "\n")
        edges.add((start, end))
        if edge_label:
            edge_labels[(start, end)] = edge_label
    if edges != set(routes) or set(labels) != set(positions):
        raise ValueError("5.1 Mermaid 节点或连接已变化；请同步 SVG 布局后生成。")
    if edge_labels != {("D", "P"): "已有载体的短任务", ("D", "A"): "多步骤创作"}:
        raise ValueError("5.1 Mermaid 路由标签已变化；请核对 SVG 分支文案。")
    wraps = {
        "Q": ["持久任务与", "后台 Worker"], "K": ["教学 Skills", "与能力注册表"],
        "L": ["Lesson DSL", "与几何执行器"], "E": ["现有视频项目", "与任务 API"],
        "UI": ["对话内预览", "选择 修改 保存"], "SP": ["学习状态与", "可信双投影"],
    }
    parts = [
        '<figure class="report-diagram"><div class="report-diagram-scroll" role="region" tabindex="0" aria-label="架构图，可横向滚动">',
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1380 1410" width="1380" height="1410" role="img" aria-labelledby="architecture-title architecture-desc">',
        '<title id="architecture-title">教师课件创作与学生实时教学的独立运行链路</title>',
        '<desc id="architecture-desc">教师输入经创作入口、课件任务服务和后台 Worker，路由到 Pi 或 Deep Agents，再调用受控工具；产物经过质量门进入版本化资产仓库，预览修改回到创作入口。学生实时会话独立进入 teacher_turn，仅共享检索与素材服务，并产生自己的学习状态与可信双投影。</desc>',
        '<defs><marker id="architecture-arrow" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto" markerUnits="userSpaceOnUse"><path d="M0 0 L9 4.5 L0 9 Z" fill="#404040"/></marker></defs>',
        '<rect width="1380" height="1410" fill="#fff"/>',
        '<text x="70" y="61" fill="#333" font-size="22" font-weight="600">教师课件创作 · 独立任务 run</text>',
        '<rect x="970" y="424" width="342" height="366" fill="#f5f5f5" stroke="#aaa" stroke-dasharray="6 5"/>',
        '<text x="990" y="448" fill="#333" font-size="20" font-weight="600">学生实时教学 · 独立回合</text>',
        '<rect x="60" y="1008" width="1230" height="358" fill="#fafafa" stroke="#aaa"/>',
        '<text x="80" y="1040" fill="#444" font-size="20">内容质量与版本化资产</text>',
    ]
    event_edges = {("R", "EV"), ("EV", "UI"), ("UI", "C")}
    for edge, route in routes.items():
        dashed = ' stroke-dasharray="8 6"' if edge in event_edges else ""
        parts.append('<path data-edge="' + html.escape(edge[0] + "->" + edge[1], quote=True) + '" d="' + route + '" fill="none" stroke="#404040" stroke-width="2" stroke-linejoin="round" marker-end="url(#architecture-arrow)"' + dashed + '/>')
    for (key, (x, y, width, height)) in positions.items():
        label = labels[key]
        lines = wraps.get(key, label.split("\n"))
        if key in wraps and re.sub(r"\s+", "", "".join(lines)) != re.sub(r"\s+", "", label):
            raise ValueError("5.1 节点文案已变化，需要调整 SVG 换行：" + key)
        strong = key in {"R", "F", "TT"}
        stroke = "#222" if strong else "#777"
        fill = "#eeeeee" if strong else "#fff"
        parts.append('<g data-node="' + key + '" aria-label="' + html.escape(label.replace("\n", " · "), quote=True) + '">')
        if key == "D":
            parts.append('<polygon points="815,230 895,280 815,330 735,280" fill="#f5f5f5" stroke="#555" stroke-width="2"/>')
        else:
            parts.append('<rect x="' + str(x) + '" y="' + str(y) + '" width="' + str(width) + '" height="' + str(height) + '" rx="3" fill="' + fill + '" stroke="' + stroke + '" stroke-width="' + ("2" if strong else "1.5") + '"/>')
        start_y = y + height / 2 - (len(lines) - 1) * 15 + 8
        parts.append('<text x="' + str(x + width / 2) + '" y="' + str(start_y) + '" text-anchor="middle" fill="#171717" font-size="23" font-weight="' + ("600" if strong else "400") + '">')
        for index, line in enumerate(lines):
            parts.append('<tspan x="' + str(x + width / 2) + '" dy="' + ("0" if index == 0 else "30") + '">' + html.escape(line) + '</tspan>')
        parts.append('</text></g>')
    parts.extend([
        '<text x="610" y="264" text-anchor="middle" fill="#444" font-size="18">已有载体的短任务</text>',
        '<text x="832" y="379" fill="#444" font-size="18">多步骤创作</text>',
        '</svg></div><figcaption>教师创作与学生实时教学的目标运行链路。虚线表示事件通知与修改回路。</figcaption></figure>',
    ])
    return "".join(parts)


def embed_architecture(markup):
    pattern = re.compile(r'<pre><code class="language-mermaid">(.*?)</code></pre>', re.S)
    def replace(match):
        source = html.unescape(match.group(1))
        return teaching_architecture_svg(source) if "teacher_turn" in source else match.group(0)
    return pattern.sub(replace, markup)


def markdown_dependency():
    try:
        import markdown
        from markdown.extensions.toc import slugify_unicode
        return markdown, slugify_unicode
    except ImportError as exc:
        raise RuntimeError(
            "需要 Python-Markdown。可使用现有 /tmp/codex-education-report-20260912/bin/python，"
            "或在临时 venv 中安装 Markdown==3.9；无需修改项目 package。"
        ) from exc


def build_report(main_path: Path, proposal_path: Path, output_path: Path):
    markdown, slugify_unicode = markdown_dependency()
    paths = [main_path.resolve(), proposal_path.resolve()]
    for source in paths:
        if not source.is_file():
            raise FileNotFoundError("缺少报告输入：" + str(source))
    if paths[0] == paths[1]:
        raise ValueError("主报告和补充方案必须是不同文件。")
    output_path = output_path.resolve()
    if output_path in paths:
        raise ValueError("输出不能覆盖 Markdown 源文件。")
    documents = []
    for index, source in enumerate(paths):
        converter = markdown.Markdown(
            extensions=["tables", "fenced_code", "footnotes", "toc", "sane_lists"],
            extension_configs={
                "toc": {"slugify": slugify_unicode, "permalink": False},
                "footnotes": {"BACKLINK_TEXT": "返回正文"},
            },
            output_format="html",
        )
        documents.append({"path": source, "prefix": "main-" if index == 0 else "proposal-", "html": embed_architecture(converter.convert(source.read_text(encoding="utf-8")))})
    source_map = {document["path"]: document["prefix"] for document in documents}
    rendered = []
    for index, document in enumerate(documents):
        rewriter = DocumentRewriter(document, source_map, output_path.parent, keep_title=index == 0)
        rewriter.feed(document["html"])
        rewriter.close()
        rendered.append('<article class="report-document" id="' + document["prefix"] + 'document">' + "".join(rewriter.fragments) + "</article>")
    body = "\n".join(rendered)
    facts = HTMLFacts()
    facts.feed(body)
    titles = [heading for heading in facts.headings if heading["level"] == 1]
    if len(titles) != 1:
        raise ValueError("合并报告应恰好有一个总标题；请在主 Markdown 中提供一个 # 标题。")
    if len(facts.ids) != len(set(facts.ids)):
        raise ValueError("报告包含重复锚点；请检查源文档的显式 HTML id。")
    known = set(facts.ids) | {"report-top"}
    broken = sorted({unquote(link[1:]) for link in facts.links if link.startswith("#") and unquote(link[1:]) not in known})
    if broken:
        raise ValueError("存在无法跳转的文内链接：" + ", ".join(broken))
    toc = "".join(
        '<li class="toc-level-' + str(heading["level"]) + '"><a href="#' + html.escape(heading["id"], quote=True) + '">' + html.escape(heading["text"]) + "</a></li>"
        for heading in facts.headings if 2 <= heading["level"] <= 3
    )
    title = html.escape(titles[0]["text"])
    page = '\n'.join([
        '<!doctype html>', '<html lang="zh-CN">', '<head>', '<meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width, initial-scale=1">', '<title>' + title + '</title>',
        '<style>' + CSS + '</style>', '</head>', '<body id="report-top">', '<div class="report-layout">',
        '<aside class="report-sidebar"><details class="report-toc" open><summary>目录</summary><nav aria-label="文档目录"><ol>' + toc + '</ol></nav></details>',
        '<div class="report-tools"><button type="button" data-print-report>打印 / 保存 PDF</button><a href="#report-top">返回开头</a></div></aside>',
        '<main>' + body + '</main>', '</div>', '<script>' + SCRIPT + '</script>', '</body>', '</html>', '',
    ])
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=output_path.parent, prefix=".report-", suffix=".html", delete=False) as temporary:
        temporary.write(page)
        temporary_path = Path(temporary.name)
    os.replace(temporary_path, output_path)
    return {"output": str(output_path), "documents": len(documents), "headings": len(facts.headings), "footnote_references": sum("fnref:" in anchor for anchor in facts.ids), "broken_internal_links": 0}


def self_test():
    with tempfile.TemporaryDirectory(prefix="codex-report-check-") as directory:
        folder = Path(directory)
        main = folder / "main.md"
        proposal = folder / "proposal.md"
        main.write_text("# 唯一总标题\n\n## 共享标题\n\n主文[^same]，参见[补充方案](proposal.md#共享标题)。\n\n| 项目 | 说明 |\n| --- | --- |\n| 表格 | 可阅读 |\n\n```js\n<script>never_run()</script>\n```\n\n[^same]: 主文来源 <https://example.org/main>。\n", encoding="utf-8")
        proposal.write_text("# 补充方案\n\n## 共享标题\n\n补充来源[^same]，返回[主文](main.md#共享标题)。\n\n[^same]: 补充来源 <https://example.org/proposal>。\n", encoding="utf-8")
        result = build_report(main, proposal, folder / "report.html")
        rendered = (folder / "report.html").read_text(encoding="utf-8")
        facts = HTMLFacts()
        facts.feed(rendered)
        assert len([heading for heading in facts.headings if heading["level"] == 1]) == 1
        assert next(heading for heading in facts.headings if heading["text"] == "补充方案")["level"] == 2
        assert 'id="main-fn:same"' in rendered and 'id="proposal-fn:same"' in rendered
        assert 'href="#main-共享标题"' in rendered and 'href="#proposal-共享标题"' in rendered
        assert '<div class="table-scroll" role="region" tabindex="0"' in rendered
        assert '&lt;script&gt;never_run()&lt;/script&gt;' in rendered
        assert 'href="https://example.org/main"' in rendered
        assert 'href="https://example.org/proposal"' in rendered
        assert result["broken_internal_links"] == 0
        assert rendered.count('<script>') == 1
        main.write_text("# 标题\n\n[无效锚点](#missing)\n", encoding="utf-8")
        try:
            build_report(main, proposal, folder / "invalid.html")
        except ValueError as error:
            assert "无法跳转" in str(error)
        else:
            raise AssertionError("断开的内部链接应阻止生成。")
    return {"self_test": "passed", "checks": ["single_title", "heading_levels", "footnote_namespaces", "cross_document_links", "scrollable_tables", "fenced_code", "source_links", "broken_anchor_guard"]}


def main():
    parser = argparse.ArgumentParser(description="将主研究与 Deep Agent 方案渲染成独立 HTML。")
    parser.add_argument("--main", type=Path, default=BASE / MAIN_NAME)
    parser.add_argument("--proposal", type=Path, default=BASE / PROPOSAL_NAME)
    parser.add_argument("--output", type=Path, default=BASE / "report.html")
    parser.add_argument("--self-test", action="store_true")
    arguments = parser.parse_args()
    try:
        result = self_test() if arguments.self_test else build_report(arguments.main, arguments.proposal, arguments.output)
    except (OSError, RuntimeError, ValueError) as error:
        parser.exit(1, str(error) + "\n")
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
