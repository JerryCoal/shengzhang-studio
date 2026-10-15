"""Local-only Docling adapter. Input documents are data, never instructions.

This subprocess accepts one application-created temporary file. It never accepts
URLs, executes document code, launches helpers, or enables remote model services.
Dependencies and model weights are installed separately by the setup script.
"""
import argparse
import importlib.metadata
import importlib.util
import json
import os
from pathlib import Path
import socket
import sys
import zipfile

MAX_BYTES = 16 * 1024 * 1024
MAX_PAGES = 100
MAX_CHARACTERS = 300000
FORMATS = {"pdf", "docx", "pptx", "xlsx"}


def fail(code, message):
    return {"ok": False, "code": code, "error": message}


def local_only():
    for key in ("HF_HUB_OFFLINE", "TRANSFORMERS_OFFLINE", "HF_HUB_DISABLE_TELEMETRY", "DO_NOT_TRACK"):
        os.environ[key] = "1"

    def audit(event, args):
        if event in ("socket.connect", "socket.getaddrinfo", "subprocess.Popen", "os.system", "os.exec", "os.posix_spawn"):
            raise PermissionError("Document processing is offline and does not execute helpers")

    sys.addaudithook(audit)

    def blocked(*args, **kwargs):
        raise PermissionError("Document processing is offline")

    socket.create_connection = blocked


def installed_version():
    try:
        return importlib.metadata.version("docling-slim")
    except importlib.metadata.PackageNotFoundError:
        try:
            return importlib.metadata.version("docling")
        except importlib.metadata.PackageNotFoundError:
            return None


def models_ready(models):
    try:
        value = json.loads((models / "shengzhang-ready.json").read_text(encoding="utf-8"))
        entries = value.get("files", [])
        return value.get("version") == installed_version() and bool(entries) and all(
            isinstance(entry, dict) and isinstance(entry.get("path"), str)
            and (models / entry["path"]).resolve().is_relative_to(models.resolve())
            and (models / entry["path"]).is_file()
            and (models / entry["path"]).stat().st_size == entry.get("size")
            for entry in entries
        )
    except (OSError, ValueError, TypeError):
        return False


def status(models):
    version = installed_version()
    packages = ("docling", "docx", "pptx", "openpyxl")
    ready = bool(version) and all(importlib.util.find_spec(name) for name in packages)
    pdf_ready = ready and models_ready(models)
    return {"ok": True, "ready": ready, "pdfReady": pdf_ready, "version": version,
            "formats": (["docx", "pptx", "xlsx"] + (["pdf"] if pdf_ready else [])) if ready else [],
            "message": "本机增强解析已就绪；PDF 使用本机布局、表格与 OCR 模型" if pdf_ready else
            "Office 增强解析已就绪；PDF 模型未准备好，请运行完整组件安装" if ready else
            "所选 Python 尚未安装 Docling Office 解析组件"}


def preflight(source):
    if not source.is_file() or source.stat().st_size > MAX_BYTES:
        return fail("file_limit", "文件不存在或超过 16 MB")
    if source.suffix[1:].lower() not in FORMATS:
        return fail("unsupported_format", "增强解析支持 PDF、DOCX、PPTX、XLSX")
    if source.suffix.lower() == ".pdf":
        import pypdfium2
        try:
            document = pypdfium2.PdfDocument(str(source))
            try:
                if len(document) > MAX_PAGES:
                    return fail("page_limit", "请选择 100 页以内的 PDF")
            finally:
                document.close()
        except Exception:
            return fail("invalid_pdf", "PDF 无法读取；请解除阅读密码或另存副本后重试")
    else:
        try:
            with zipfile.ZipFile(source) as archive:
                entries = archive.infolist()
                if len(entries) > 2000 or sum(entry.file_size for entry in entries) > 80 * 1024 * 1024:
                    return fail("expanded_limit", "文档展开后过大，请拆分导入")
                if source.suffix.lower() == ".pptx" and sum(entry.filename.startswith("ppt/slides/slide") and entry.filename.endswith(".xml") and "/_rels/" not in entry.filename for entry in entries) > MAX_PAGES:
                    return fail("page_limit", "请选择 100 页以内的演示文稿")
                if source.suffix.lower() == ".xlsx" and sum(entry.filename.startswith("xl/worksheets/sheet") and entry.filename.endswith(".xml") and "/_rels/" not in entry.filename for entry in entries) > MAX_PAGES:
                    return fail("page_limit", "请选择 100 个工作表以内的表格文件")
                for entry in entries:
                    parts = Path(entry.filename.replace("\\", "/")).parts
                    if entry.file_size > 20 * 1024 * 1024 or entry.flag_bits & 1 or ".." in parts or entry.filename.startswith(("/", "\\")) or (parts and ":" in parts[0]):
                        return fail("invalid_office", "文档包含不支持的压缩内容，请另存副本后重试")
                    if "vbaproject" in entry.filename.lower() or entry.filename.lower().endswith((".exe", ".dll", ".js", ".vbs")):
                        return fail("active_content", "不支持含宏或可执行附件的文档，请另存无宏副本")
                    if entry.filename.endswith((".xml", ".rels")):
                        # XML markup is ASCII even when encoded as UTF-16/32.
                        xml = archive.read(entry).replace(b"\x00", b"").upper()
                        if b"<!DOCTYPE" in xml or b"<!ENTITY" in xml:
                            return fail("active_xml", "文档包含不支持的 XML 声明")
        except (OSError, ValueError, zipfile.BadZipFile, RuntimeError):
            return fail("invalid_office", "Office 文件结构损坏或已加密，请另存副本后重试")
    return None


def convert(source, models):
    version = installed_version()
    if not version:
        return fail("dependency_missing", "未安装 Docling，请先安装可选组件")
    issue = preflight(source)
    if issue:
        return issue
    is_pdf = source.suffix.lower() == ".pdf"
    if is_pdf and not models_ready(models):
        return fail("models_missing", "PDF 增强模型尚未准备好，请先完成组件安装；本次未联网下载")
    if is_pdf:
        os.environ["DOCLING_ARTIFACTS_PATH"] = str(models)
    from docling.document_converter import DocumentConverter, PdfFormatOption
    from docling.datamodel.base_models import InputFormat, ConversionStatus
    format_options = {}
    if is_pdf:
        from docling.backend.pypdfium2_backend import PyPdfiumDocumentBackend
        from docling.datamodel.pipeline_options import PdfPipelineOptions, RapidOcrOptions, AcceleratorOptions, AcceleratorDevice
        options = PdfPipelineOptions(
            artifacts_path=models, enable_remote_services=False, do_ocr=True,
            do_table_structure=True, do_picture_classification=False, do_picture_description=False,
            do_code_enrichment=False, do_formula_enrichment=False,
            generate_page_images=False, generate_picture_images=False,
            document_timeout=160,
            ocr_options=RapidOcrOptions(backend="onnxruntime", lang=["ch"]),
            accelerator_options=AcceleratorOptions(device=AcceleratorDevice.CPU, num_threads=2),
        )
        # PDFium also handles Windows user folders containing non-ASCII names.
        format_options[InputFormat.PDF] = PdfFormatOption(pipeline_options=options, backend=PyPdfiumDocumentBackend)
    converter = DocumentConverter(
        allowed_formats=[getattr(InputFormat, source.suffix[1:].upper())],
        format_options=format_options,
    )
    result = converter.convert(source, raises_on_error=False, max_num_pages=MAX_PAGES, max_file_size=MAX_BYTES)
    if result.status not in (ConversionStatus.SUCCESS, ConversionStatus.PARTIAL_SUCCESS):
        return fail("parse_failed", "Docling 未能完成解析，请尝试简单提取或另存文档后重试")
    document = result.document
    blocks, heading, total = [], "", 0
    for item, _level in document.iterate_items():
        label = getattr(getattr(item, "label", None), "value", "")
        kind = "table" if label == "table" else "heading" if label in ("section_header", "title") else "list" if label == "list_item" else "paragraph"
        if kind == "table":
            value = item.export_to_markdown(doc=document)
        else:
            value = getattr(item, "text", "")
        value = str(value).replace("\x00", "").strip()
        if not value:
            continue
        if kind == "heading":
            heading = value[:300]
        block = {"id": "block-" + str(len(blocks) + 1), "kind": kind, "text": value}
        provenance = getattr(item, "prov", [])
        if provenance and isinstance(provenance[0].page_no, int) and provenance[0].page_no > 0:
            block["page"] = provenance[0].page_no
        if heading:
            block["heading"] = heading
        if source.suffix.lower() == ".xlsx" and getattr(item, "parent", None):
            group = item.parent.resolve(document)
            if getattr(getattr(group, "label", None), "value", "") == "sheet":
                block["heading"] = str(group.name)[:300]
        blocks.append(block)
        total += len(value) + 2
        if total > MAX_CHARACTERS or len(blocks) > 4000:
            return fail("text_limit", "解析正文超过 30 万字或分段过多，请拆分文档")
    text = "\n\n".join(block["text"] for block in blocks)
    if not text:
        return fail("no_text", "未识别到正文；请检查图片清晰度、语言或文档是否为空")
    warnings = ["增强提取可能误识别文字、表格或阅读顺序，请核对原文后保存。"]
    if source.suffix.lower() == ".xlsx":
        warnings.append("表格的页码表示工作表序号，标题表示工作表名称，并非打印页码；公式按文件中已有结果读取，不重新计算。")
    elif source.suffix.lower() == ".docx":
        warnings.append("Word 流式文档可能没有可靠页码；请按标题与内容块核对来源。")
    if result.status == ConversionStatus.PARTIAL_SUCCESS:
        warnings.append("Docling 仅完成了部分内容，请逐页核对；缺失内容不会自动补写。")
    metadata = {"version": version}
    if document.pages:
        metadata["pageCount"] = len(document.pages)
    return {"ok": True, "text": text, "blocks": blocks, "warnings": warnings, "metadata": metadata}


def main():
    parser = argparse.ArgumentParser()
    operation = parser.add_mutually_exclusive_group(required=True)
    operation.add_argument("--status", action="store_true")
    operation.add_argument("--parse", type=Path)
    parser.add_argument("--models", type=Path, required=True)
    args = parser.parse_args()
    local_only()
    try:
        result = status(args.models.resolve()) if args.status else convert(args.parse.resolve(), args.models.resolve())
    except ImportError:
        result = fail("dependency_missing", "本机组件依赖不完整，请重新运行可选组件安装")
    except Exception:
        result = fail("parse_failed", "本机增强解析失败，请检查模型安装或使用简单提取；本次未上传文档")
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
