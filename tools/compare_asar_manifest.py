#!/usr/bin/env python3
"""比较两次 ASAR 提取清单是否一致（用于核对重提取结果与基线）。

只比较与内容相关的字段：归档 SHA256/大小、条目计数、以及按相对路径排序后的
每个文件的 size / sha256 / archive_integrity_match。
忽略与内容无关的元数据（输出目录、时间戳等）。

一致 → 退出 0；不一致 → 退出非零并打印可定位差异。
"""
import argparse
import json
import sys

CONTENT_FIELDS = ("archive_sha256", "archive_size", "total_entries", "extracted_count")
FILE_FIELDS = ("size", "sha256", "archive_integrity_match")


def load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--baseline", required=True)
    ap.add_argument("--candidate", required=True)
    args = ap.parse_args()
    a = load(args.baseline)
    b = load(args.candidate)
    diffs = []
    for field in CONTENT_FIELDS:
        if a.get(field) != b.get(field):
            diffs.append(f"{field}: baseline={a.get(field)} candidate={b.get(field)}")
    fa = {f["path"]: f for f in a.get("files", [])}
    fb = {f["path"]: f for f in b.get("files", [])}
    for path in sorted(set(fa) | set(fb)):
        x, y = fa.get(path), fb.get(path)
        if x is None:
            diffs.append(f"only in candidate: {path}")
            continue
        if y is None:
            diffs.append(f"only in baseline: {path}")
            continue
        for field in FILE_FIELDS:
            if x.get(field) != y.get(field):
                diffs.append(f"{path}: {field} baseline={x.get(field)} candidate={y.get(field)}")
    if diffs:
        print("MANIFEST MISMATCH", file=sys.stderr)
        for d in diffs:
            print(" - " + d, file=sys.stderr)
        return 1
    print("manifest matches baseline")
    return 0


if __name__ == "__main__":
    sys.exit(main())
