"""Offline UTF-8 copy checker. No dependencies, network, credentials or model calls.

CLI: python sensitive_checker.py --rules sensitive_words.txt --text copy.txt
Automation: echo JSON {"text":"...","rules":[...]} | python sensitive_checker.py --stdin-json
start/end are UTF-16 offsets; startCodePoint/endCodePoint are Python slice indices.
"""
import argparse
import csv
import io
import json
from pathlib import Path
import re
import sys


def load_rules(path):
    content = Path(path).read_text(encoding="utf-8-sig")
    if len(content) > 200000:
        raise ValueError("词库最多 20 万字符")
    delimiter = "," if Path(path).suffix.lower() == ".csv" else "|"
    rows = csv.reader(io.StringIO(content), delimiter=delimiter, strict=True)
    rules, seen = [], set()
    for number, raw in enumerate(rows, 1):
        if not raw or all(not part.strip() for part in raw):
            continue
        if re.match(r"^#(?:\s|$)", raw[0].strip()):
            continue
        if delimiter == "|" and len(raw) == 1 and "=" in raw[0]:
            term, replacement = raw[0].split("=", 1)
            raw = [term, "replace", replacement, "A"]
        row = [part.strip() for part in raw]
        if row[:2] in [["敏感词", "处理方式"], ["term", "action"]]:
            continue
        if len(row) not in (4, 5):
            raise ValueError(f"第 {number} 条字段数量不正确")
        term, action, replacement, risk = row[:4]
        enabled = row[4] if len(row) == 5 else "true"
        if not term or utf16_len(term) > 60 or action not in ("replace", "rewrite", "allow", "semantic") or utf16_len(replacement) > 120 or not re.fullmatch(r"[A-Za-z0-9_-]{1,20}", risk) or enabled not in ("true", "false") or any(c in term + replacement for c in "\r\n\0"):
            raise ValueError(f"第 {number} 条格式不正确")
        if term.lower() in seen:
            raise ValueError(f"重复词条：{term}")
        if action == "semantic":
            numbers = r"[0-9０-９]+(?:[.,．，][0-9０-９]+)*"
            if not replacement or re.findall(numbers, term) != re.findall(numbers, replacement):
                raise ValueError("语义替换需要非空替换词，且不能更改数字")
        seen.add(term.lower())
        rules.append(dict(id=f"file-{number}", term=term, action=action, replacement=replacement, risk=risk, enabled=enabled == "true"))
    if not rules or len(rules) > 500:
        raise ValueError("词库需要 1–500 条有效词条")
    return rules


def utf16_len(text):
    return len(text.encode("utf-16-le")) // 2


def simple_fold(text):
    # Preserve one-to-one indices: do not expand ß to ss or normalize emoji.
    def fold(char):
        folded = char.casefold()
        if len(folded) == 1:
            return folded
        lower = char.lower()
        return lower if len(lower) == 1 else char
    return "".join(fold(char) for char in text)


def scan_text(text, rules, field="body"):
    selected = sorted([rule for rule in rules if rule.get("enabled", True) and rule.get("term")], key=lambda r: -utf16_len(r["term"]))
    if not selected:
        return []
    folded_terms = [simple_fold(rule["term"]) for rule in selected]
    pattern = re.compile("|".join(re.escape(term) for term in folded_terms))
    matches = []
    for match in pattern.finditer(simple_fold(text)):
        rule = selected[folded_terms.index(match.group())]
        action = rule.get("action", "replace")
        if action == "allow":
            continue
        start, end = match.span()
        matches.append(dict(ruleId=rule["id"], field=field, original=text[start:end], replacement=rule.get("replacement", ""), action=action, risk=rule.get("risk", "A"), start=utf16_len(text[:start]), end=utf16_len(text[:end]), startCodePoint=start, endCodePoint=end, context=text[max(0, start-20):end+20]))
    return matches


def apply_fixed(text, matches):
    result = text
    for hit in reversed(matches):
        if hit["action"] == "replace":
            result = result[:hit["startCodePoint"]] + hit["replacement"] + result[hit["endCodePoint"]:]
    return result


def check_copy(text, rules):
    matches = scan_text(text, rules)
    value = apply_fixed(text, matches)
    remaining = scan_text(value, rules)
    return dict(value=value, matches=matches, remaining=remaining, status="needs-review" if remaining else "clean", offsetUnit="utf16", endExclusive=True)


def main():
    parser = argparse.ArgumentParser(description="敏感词本地初筛；固定替换后再次检查")
    parser.add_argument("--rules")
    parser.add_argument("--text")
    parser.add_argument("--output")
    parser.add_argument("--stdin-json", action="store_true")
    args = parser.parse_args()
    if args.stdin_json:
        request = json.loads(sys.stdin.buffer.read().decode("utf-8-sig"))
        result = check_copy(request["text"], request["rules"])
    else:
        if not args.rules or not args.text:
            parser.error("请提供 --rules 和 --text")
        result = check_copy(Path(args.text).read_text(encoding="utf-8-sig"), load_rules(args.rules))
    output = json.dumps(result, ensure_ascii=False, indent=2)
    if args.output:
        Path(args.output).write_text(output, encoding="utf-8")
    else:
        sys.stdout.buffer.write((output + "\n").encode("utf-8"))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, KeyError, csv.Error) as error:
        sys.stderr.buffer.write((str(error) + "\n").encode("utf-8"))
        sys.exit(1)
