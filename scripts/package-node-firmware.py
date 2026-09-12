"""Build the public source archive from an explicit allowlist; never include Secrets.h."""
from pathlib import Path
import zipfile

root = Path(__file__).resolve().parents[1]
source = root / 'firmware' / 'FlightDeck_Node_Live'
names = ['FlightDeck_Node_Live.ino', 'Config.h', 'Secrets.example.h',
         'FlightDeckProtocol.h', 'TelemetryModel.h', 'TelemetryJson.h',
         'TrustAnchors.h', 'README.md']
target = root / 'public' / 'FlightDeck_Node_Live.zip'
with zipfile.ZipFile(target, 'w', zipfile.ZIP_DEFLATED) as archive:
    for name in names:
        info = zipfile.ZipInfo('FlightDeck_Node_Live/' + name, date_time=(2026, 9, 12, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        info.external_attr = 0o644 << 16
        archive.writestr(info, (source / name).read_bytes())
(root / 'public' / 'NODEMCU_README.md').write_bytes((source / 'README.md').read_bytes())
print(f'Packaged {len(names)} source files, no device credentials: {target.name}')
