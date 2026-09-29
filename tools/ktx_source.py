"""KTX 원본 엑셀 위치 — 저장소 밖 `../KTX 운임표·시간표/` 폴더.

지석초이가 KORAIL 새 버전(운임표 .xls / 시간표 .xlsx)을 내려받아 이 폴더에 넣으면
파일 이름의 기준월("202609기준", "202610 기준")이 가장 늦은 것을 쓴다. 기준월이 없으면
수정 시각이 늦은 것. 옛 파일은 지우지 않아도 된다.
"""
import re
from pathlib import Path

APP = Path(__file__).resolve().parent.parent
KTX_DIR = APP.parent / 'KTX 운임표·시간표'


def _basis(p):
    m = re.search(r'(20\d{2})\s*(\d{2})\s*기준', p.name)
    return (int(m.group(1) + m.group(2)) if m else 0, p.stat().st_mtime)


def latest(keyword):
    files = [p for p in KTX_DIR.glob('*') if keyword in p.name
             and p.suffix.lower() in ('.xls', '.xlsx') and not p.name.startswith('~$')]
    if not files:
        raise SystemExit(f'!! {KTX_DIR} 에 "{keyword}" 엑셀(.xls/.xlsx)이 없다')
    return max(files, key=_basis)


class _XlsxBook:
    """openpyxl 통합문서를 xlrd 모양(sheets/nrows/ncols/cell_value)으로 감싼다.
    KORAIL 운임표가 .xlsx 로 바뀌어 와도 build_fares.py 를 그대로 쓰려고."""
    class _Sheet:
        def __init__(self, ws):
            self.name = ws.title
            self._rows = [list(r) for r in ws.iter_rows(values_only=True)]
            self.nrows = len(self._rows)
            self.ncols = max((len(r) for r in self._rows), default=0)

        def cell_value(self, r, c):
            row = self._rows[r]
            v = row[c] if c < len(row) else None
            if v is None:
                return ''
            return float(v) if isinstance(v, int) else v

    def __init__(self, path):
        import openpyxl
        wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
        self._sheets = [self._Sheet(ws) for ws in wb.worksheets]

    def sheets(self):
        return self._sheets


def open_book(path):
    if path.suffix.lower() == '.xlsx':
        return _XlsxBook(path)
    import xlrd
    return xlrd.open_workbook(str(path))
