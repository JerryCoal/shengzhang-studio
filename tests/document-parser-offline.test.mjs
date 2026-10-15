import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('Python document adapter rejects active archives and blocks network/helper execution', { skip: !process.env.STUDIO_TEST_PYTHON }, () => {
  const script = String.raw`
import json, pathlib, runpy, socket, subprocess, sys, tempfile, zipfile
api=runpy.run_path(sys.argv[1])
results={}
with tempfile.TemporaryDirectory(prefix='studio-parser-boundary-') as temporary:
    root=pathlib.Path(temporary)
    samples={
      'entity.docx': [('word/document.xml', '<!DOCTYPE x [<!ENTITY x SYSTEM "file:///should-not-open">]><x/>')],
      'entity-utf16.docx': [('word/document.xml', '<!DOCTYPE x [<!ENTITY x SYSTEM "file:///should-not-open">]><x/>'.encode('utf-16'))],
      'macro.docx': [('word/vbaProject.bin', 'synthetic')],
      'script.docx': [('word/embeddings/payload.js', 'synthetic')],
      'traversal.docx': [('../word/document.xml', '<x/>')],
      'too-many.docx': [(str(i)+'.xml','<x/>') for i in range(2001)],
      'slides.pptx': [('ppt/slides/slide'+str(i)+'.xml','<x/>') for i in range(101)],
      'sheets.xlsx': [('xl/worksheets/sheet'+str(i)+'.xml','<x/>') for i in range(101)],
    }
    for name,entries in samples.items():
        source=root/name
        with zipfile.ZipFile(source,'w') as archive:
            for key,value in entries: archive.writestr(key,value)
        result=api['preflight'](source)
        results[name]=result['code'] if result else 'allowed'
api['local_only']()
for name,operation in [('connect',lambda:socket.socket().connect(('127.0.0.1',9))),('dns',lambda:socket.getaddrinfo('127.0.0.1',9)),('helper',lambda:subprocess.run([sys.executable,'-c','pass']))]:
    try: operation(); results[name]='allowed'
    except PermissionError: results[name]='blocked'
print(json.dumps(results))
`;
  const result = spawnSync(process.env.STUDIO_TEST_PYTHON, ['-I', '-X', 'utf8', '-c', script, fileURLToPath(new URL('../desktop/document-parser.py', import.meta.url))], { encoding: 'utf8', windowsHide: true, timeout: 20000 });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { 'entity.docx': 'active_xml', 'entity-utf16.docx': 'active_xml', 'macro.docx': 'active_content', 'script.docx': 'active_content', 'traversal.docx': 'invalid_office', 'too-many.docx': 'expanded_limit', 'slides.pptx': 'page_limit', 'sheets.xlsx': 'page_limit', connect: 'blocked', dns: 'blocked', helper: 'blocked' });
});
