"""Generate tiny ZIP64 fixtures for the upload parser tests.

Run from the repo root:  python scripts/make_zip_fixtures.py

Writes web/src/lib/health/__fixtures__/zip64-seekable.zip and zip64-streamed.zip, both
containing apple_health_export/export.xml with ZIP64 local headers. The streamed one is
written to a non-seekable sink, so sizes are stored in a trailing data descriptor.
"""
import pathlib
import zipfile

OUT = pathlib.Path(__file__).parent.parent / "web" / "src" / "lib" / "health" / "__fixtures__"
ENTRY = "apple_health_export/export.xml"
PAYLOAD = (
    b'<HealthData locale="en_US"><Record type="HKQuantityTypeIdentifierStepCount" '
    b'startDate="2026-01-12 08:00:00 -0500" value="1"/></HealthData>'
)


class NonSeekable:
    """Write-only sink: forces zipfile to use data descriptors instead of seeking back."""

    def __init__(self, fh):
        self._fh = fh

    def write(self, data):
        return self._fh.write(data)

    def flush(self):
        self._fh.flush()


def write_zip(path, seekable):
    with open(path, "wb") as raw:
        sink = raw if seekable else NonSeekable(raw)
        with zipfile.ZipFile(sink, "w", zipfile.ZIP_DEFLATED, allowZip64=True) as zf:
            info = zipfile.ZipInfo(ENTRY, date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            with zf.open(info, "w", force_zip64=True) as entry:
                entry.write(PAYLOAD)


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    write_zip(OUT / "zip64-seekable.zip", seekable=True)
    write_zip(OUT / "zip64-streamed.zip", seekable=False)
    print(f"Wrote fixtures to {OUT}")
