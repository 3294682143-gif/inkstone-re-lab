import argparse
import hashlib
import json
import struct
from pathlib import Path, PurePosixPath


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def walk(files, prefix=''):
    for name, item in files.items():
        if not name or name in ('.', '..') or any(c in name for c in '/\\:\0'):
            raise ValueError('Unsafe ASAR name')
        key = prefix + name
        if 'files' in item:
            yield from walk(item['files'], key + '/')
        else:
            yield key, item


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--asar', required=True, type=Path)
    ap.add_argument('--out', required=True, type=Path)
    ap.add_argument('--manifest', required=True, type=Path)
    args = ap.parse_args()
    if args.out.exists() or args.manifest.exists():
        raise ValueError('Use new output paths to preserve earlier evidence')
    size = args.asar.stat().st_size
    with args.asar.open('rb') as f:
        prelude = f.read(16)
        if len(prelude) != 16:
            raise ValueError('Truncated ASAR')
        pickle_size, header_size, payload_size, json_size = struct.unpack('<4I', prelude)
        if (pickle_size != 4 or header_size < 8 or header_size > 32 * 1024 * 1024
                or payload_size != header_size - 4 or json_size > header_size - 8
                or 8 + header_size > size):
            raise ValueError('Unsupported ASAR header')
        header = json.loads(f.read(json_size).decode('utf-8'))
        entries = list(walk(header['files']))
        base = 8 + header_size
        args.out.mkdir(parents=True)
        root = args.out.resolve()
        records = []
        for name, item in entries:
            if name != 'package.json' and not name.startswith('out/'):
                continue
            if item.get('unpacked') or 'link' in item or 'offset' not in item:
                raise ValueError('Unexpected external or linked application entry')
            length = item['size']
            offset = int(item['offset'])
            if type(length) is not int or length < 0 or offset < 0 or base + offset + length > size:
                raise ValueError('ASAR file outside archive bounds')
            target = root.joinpath(*PurePosixPath(name).parts)
            if not target.resolve().is_relative_to(root):
                raise ValueError('Path outside output root')
            f.seek(base + offset)
            data = f.read(length)
            actual = hashlib.sha256(data).hexdigest()
            integrity = item.get('integrity', {})
            expected = integrity.get('hash')
            if len(data) != length or (expected and
                    (integrity.get('algorithm') != 'SHA256' or expected != actual)):
                raise ValueError('Integrity mismatch: ' + name)
            target.parent.mkdir(parents=True, exist_ok=True)
            with target.open('xb') as output:
                output.write(data)
            records.append({'path': name, 'size': length, 'sha256': actual,
                            'archive_integrity_match': bool(expected)})
    result = {'archive_sha256': digest(args.asar), 'archive_size': size,
              'total_entries': len(entries), 'extracted_count': len(records),
              'executed_application_code': False, 'files': records}
    args.manifest.parent.mkdir(parents=True, exist_ok=True)
    with args.manifest.open('x', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    print(json.dumps({'total_entries': len(entries), 'extracted': len(records),
                      'manifest': str(args.manifest)}, ensure_ascii=False))


if __name__ == '__main__':
    main()
