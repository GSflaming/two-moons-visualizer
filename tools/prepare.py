import argparse
import hashlib
import json
import subprocess
import sys
import tempfile
from pathlib import Path

parser = argparse.ArgumentParser(description='Prepare private local assets. No downloads are performed.')
parser.add_argument('--audio', type=Path, required=True)
parser.add_argument('--score', type=Path, required=True)
parser.add_argument('--output', type=Path, default=Path('local/events.json'))
parser.add_argument('--drum-stem', type=Path)
args = parser.parse_args()
if not args.audio.is_file() or not args.score.exists():
    parser.error('Supply an existing local recording and score')
tools = Path(__file__).resolve().parent
args.output.parent.mkdir(parents=True, exist_ok=True)
with tempfile.TemporaryDirectory(prefix='prepare-', dir=args.output.parent) as work:
    work = Path(work)
    subprocess.run([sys.executable, str(tools/'align.py'), '--audio', str(args.audio.resolve()),
                    '--score', str(args.score.resolve()), '--workdir', str(work)], check=True)
    command = [sys.executable, str(tools/'augment.py'), '--workdir', str(work), '--score', str(args.score.resolve())]
    if args.drum_stem:
        command.extend(['--drum-stem', str(args.drum_stem.resolve())])
    subprocess.run(command, check=True)
    bundle = json.loads((work/'toe-band-render-data.json').read_text())
    bundle.update(title='Two Moons', artist='toe')
    bundle['audioSha256'] = hashlib.sha256(args.audio.read_bytes()).hexdigest()
    bundle['presentation'] = dict(start=67/60, gainDb=-2.7)
    # Publish the event bundle only after every preparation stage succeeds.
    temporary = work/'events.json'
    temporary.write_text(json.dumps(bundle, ensure_ascii=False, indent=2), encoding='utf-8')
    temporary.replace(args.output)
print(args.output)
